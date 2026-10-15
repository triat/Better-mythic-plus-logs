// `bmpl calibrate --hourly`: one hour of collection with the WCL points the members leave (spec
// docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md, decision 5). The scheduled spend is the explicit,
// user-approved exception to "never spend WCL points automatically"; the governor (window.ts) bounds it.
//
// Each run: prune the rolling window, stop if the day's quota is reached, (re)discover the pool once a week (pages cached in
// calibration.db, so an interrupted discovery resumes), then look characters up one at a time from the emptiest cell,
// asking WCL for its counter before every lookup.
import type { EvalPayload } from "../evaluation/inputs.ts";
import { getCurrentMplusZone } from "../mplus.ts";
import type { GqlFn } from "../signals/enrich.ts";
import type { RateLimit } from "../wcl/client.ts";
import { PING_QUERY } from "../wcl/queries.ts";
import {
  type Candidate, candidates, cellOf, discoverCombo, LEVELS, metricOf, type PoolEntry, type Ranking, RANKINGS_QUERY, type Role, schedule, SPECS,
} from "./discover.ts";
import type { SampleStore } from "./samples.ts";
import { decide } from "./window.ts";

const DAY_MS = 86_400_000;
/** The rolling window the fit reads (decision 7). */
export const WINDOW_MS = 28 * DAY_MS;
/**
 * New characters per rolling 24 hours (decision 5, amended 2026-10-15). A daily quota rather than a total for the window:
 * the window then renews every day (a seventh of it each week) instead of filling once and freezing for 4 weeks, and
 * settles at about 28 × 150 ≈ 4,200 characters, twice the first target's 2,000, for a tighter fit.
 */
export const DAILY_TARGET = 150;
/** What the window holds once every day of it has its quota: the dashboards' reference line. */
export const WINDOW_STEADY = DAILY_TARGET * 28;
/** A new discovery pass every this often: the current rankings bring new characters each week. */
export const CYCLE_MS = 7 * DAY_MS;
/** Discovery pages are ~1 pt each; a short gap keeps them from bursting. */
const PAGE_GAP_MS = 1000;
/** Backoff after a 429 (WCL limiting the IP): 1 minute, doubling, at most 10. */
const BACKOFF_MS = [60_000, 600_000] as const;

export type LookupResult = { ok: true; payload: EvalPayload } | { ok: false; error: string };

export interface CollectDeps {
  samples: SampleStore;
  /** The instance's client (never a member's): rankings pages, the zone, the counter. */
  gql: GqlFn;
  /** The production lookup on calibration.db; throws on a WCL failure. */
  lookup: (c: Candidate) => Promise<LookupResult>;
  /** The member marker's mtime (marker.ts), or null. */
  memberAt: () => number | null;
  reserve: number;
  /** The run ends here whatever its state (before the next hourly run starts). */
  endAt: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** One call per lookup that ran (a 429 retried later is not one): the logs stack's per-sample line. */
  onSample?: (s: SampleOutcome) => void;
  target?: number;
}

export interface SampleOutcome { spec: string; role: Role; level: number; ok: boolean; ms: number; error?: string }

export interface CollectReport {
  looked: number; failed: number; pages: number; stopped: string;
  /** Characters in the window when the hour ended; `day` of them in the last 24 hours, against the daily `target`. */
  window: number; day: number; target: number;
  /** The same window split by role (the fit needs each role, not only the total). */
  windowByRole: Record<Role, number>;
}

class Stop extends Error {}

interface Ping { rateLimitData: RateLimit }
interface Encounters { worldData: { zone: { encounters: { id: number; name: string }[] } } }
interface Page { rateLimitData: RateLimit; worldData: { encounter: { characterRankings: { rankings?: Ranking[] } } } }

const is429 = (e: unknown): boolean => /\b429\b/.test(e instanceof Error ? e.message : String(e));

export async function collectHour(d: CollectDeps): Promise<CollectReport> {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = d.log ?? ((l: string) => console.log(l));
  const target = d.target ?? DAILY_TARGET;
  const report: CollectReport = { looked: 0, failed: 0, pages: 0, stopped: "", window: 0, day: 0, target, windowByRole: { tank: 0, healer: 0, dps: 0 } };
  let counted: { season: number; since: number } | null = null;
  let lastStartAt: number | null = null;
  let backoff: number = BACKOFF_MS[0];

  /** Waits until the governor lets a WCL step start; throws Stop at the end of the hour or of the budget. */
  const gate = async (rl: RateLimit | null, pace: boolean): Promise<void> => {
    for (;;) {
      if (now() >= d.endAt) throw new Stop("the hour is over");
      const counter = rl ?? (await d.gql<Ping>(PING_QUERY)).rateLimitData;
      const dec = decide({ now: now(), rl: counter, memberAt: d.memberAt(), lastStartAt: pace ? lastStartAt : null, reserve: d.reserve });
      if (dec.go) return;
      if ("stop" in dec) throw new Stop(dec.why);
      await sleep(Math.min(dec.waitMs, Math.max(0, d.endAt - now())));
      rl = null; // read the counter again after a wait
    }
  };

  try {
    const zone = await getCurrentMplusZone(d.gql);
    const season = zone.id;
    const since = now() - WINDOW_MS;
    counted = { season, since };
    d.samples.prune(season, since);
    let total = d.samples.count(season, since).total;
    let day = d.samples.count(season, now() - DAY_MS).total;
    report.window = total;
    report.day = day;
    const quotaReached = (): Stop => new Stop(`daily quota reached (${day} characters in the last 24 h, ${total} in the window)`);
    if (day >= target) throw quotaReached();

    // Discovery: once per cycle. Pages already read this cycle come from the cache, so a pass cut short resumes.
    const cycle = Math.floor(now() / CYCLE_MS);
    let pool = d.samples.latestPool(season);
    if (!pool || pool.cycle < cycle) {
      try {
        const encounters = (await d.gql<Encounters>(`query($id: Int!) { worldData { zone(id: $id) { encounters { id name } } } }`, { id: season })).worldData.zone.encounters;
        let lastPageAt: number | null = null;
        let seen: RateLimit | null = null; // each page's own counter: no extra ping between pages
        const entries: PoolEntry[] = [];
        for (const key of SPECS) {
          const [className, spec] = key.split(":") as [string, string];
          for (const enc of encounters) {
            const get = async (p: number): Promise<Ranking[]> => {
              const cached = d.samples.getPage(season, cycle, enc.id, key, p);
              if (cached) return cached as Ranking[];
              const wait = lastPageAt === null ? 0 : lastPageAt + PAGE_GAP_MS - now();
              if (wait > 0) await sleep(wait);
              await gate(seen, false);
              lastPageAt = now();
              const r = await d.gql<Page>(RANKINGS_QUERY, { e: enc.id, c: className, s: spec, p, m: metricOf(spec) });
              seen = r.rateLimitData;
              const rows = r.worldData.encounter.characterRankings.rankings ?? [];
              d.samples.putPage(season, cycle, enc.id, key, p, rows);
              report.pages++;
              return rows;
            };
            entries.push(...(await discoverCombo(get, className, spec, enc.id)).entries);
          }
        }
        d.samples.putPool(season, cycle, entries, now());
        pool = d.samples.latestPool(season);
        log(`discovery: ${entries.length} entries in the pool (${report.pages} pages read)`);
      } catch (e) {
        if (!(e instanceof Stop) || !pool) throw e;
        log(`discovery paused (${e.message}); collecting from the previous pool meanwhile`);
      }
    }
    if (!pool) throw new Stop("no pool yet");

    // Collection: the emptiest cell first, one lookup at a time.
    const counts = d.samples.count(season, since).cells;
    const queues = new Map<string, Candidate[]>();
    for (const c of schedule(candidates(pool.pool))) {
      if (!LEVELS.includes(c.level as never) || d.samples.done(c.key, season, since)) continue;
      const k = cellOf(c);
      (queues.get(k) ?? queues.set(k, []).get(k)!).push(c);
    }
    const next = (): Candidate | null => {
      let best: string | null = null;
      for (const [k, q] of queues) {
        if (q.length === 0) continue;
        if (best === null || (counts.get(k) ?? 0) < (counts.get(best) ?? 0) || ((counts.get(k) ?? 0) === (counts.get(best) ?? 0) && k < best)) best = k;
      }
      return best === null ? null : queues.get(best)!.shift()!;
    };
    for (let c = next(); c; c = next()) {
      await gate(null, true);
      lastStartAt = now();
      const sample = (ok: boolean, error?: string): void =>
        d.onSample?.({ spec: c.spec, role: c.role, level: c.level, ok, ms: now() - lastStartAt!, ...(error ? { error } : {}) });
      try {
        const r = await d.lookup(c);
        backoff = BACKOFF_MS[0];
        sample(r.ok, r.ok ? undefined : r.error);
        if (r.ok) {
          d.samples.put(c, r.payload, season, now());
          counts.set(cellOf(c), (counts.get(cellOf(c)) ?? 0) + 1);
          report.looked++;
          total++;
          day++;
          report.window = total;
          report.day = day;
          if (day >= target) throw quotaReached();
        } else {
          d.samples.fail(c.key, season, now(), r.error);
          report.failed++;
        }
      } catch (e) {
        if (e instanceof Stop) throw e;
        if (is429(e)) {
          (queues.get(cellOf(c)) ?? []).push(c); // retried later
          log(`429: WCL is limiting this IP, pausing ${backoff / 60_000} min`);
          await sleep(Math.min(backoff, Math.max(0, d.endAt - now())));
          backoff = Math.min(BACKOFF_MS[1], backoff * 2);
        } else {
          d.samples.fail(c.key, season, now(), e instanceof Error ? e.message : String(e));
          sample(false, e instanceof Error ? e.message : String(e));
          report.failed++;
        }
      }
    }
    throw new Stop("every candidate of the pool is sampled");
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    report.stopped = e.message;
  }
  if (counted) {
    for (const [cell, n] of d.samples.count(counted.season, counted.since).cells) {
      const role = cell.split("|")[0] as Role;
      if (role in report.windowByRole) report.windowByRole[role] += n;
    }
  }
  log(`collection: ${report.looked} characters sampled, ${report.failed} failed, ${report.pages} discovery pages; stopped: ${report.stopped}`);
  return report;
}
