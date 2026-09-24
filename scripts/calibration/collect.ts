// Dev-only, spends WCL points (~100 per character never seen before, a few if already cached). Runs
// the production lookup — `performLookup`, the very code behind bmpl.riat.dev — on a stratified sample
// of the pool discover.ts built, and saves each payload for offline analysis (analyze.ts re-scores them
// at 0 points, as often as needed).
//
//   bun scripts/calibration/collect.ts [--until HH:MM] [--reserve 200] [--concurrency 3] [--limit N]
//
// Sampling: every character gets one cell, role × level (15..20) × performance quintile (5), and the
// collector takes one character per cell per round, round after round. Whenever it stops — deadline,
// budget, Ctrl+C — the sample is balanced across cells. Resumable: a character with a saved payload (or
// a recorded failure) is never looked up twice.
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setRateLimitObserver, type RateLimit } from "../../src/wcl/client.ts";
import { buildLookupPayload, performLookup } from "../../src/lookup.ts";
import { DIR, LEVELS, type PoolEntry, type Role } from "./discover.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const UNTIL = args.get("until") ?? "12:50";
const RESERVE = Number(args.get("reserve") ?? 200);
const CONCURRENCY = Number(args.get("concurrency") ?? 3);
const LIMIT = Number(args.get("limit") ?? Infinity);
/** Never start a lookup that could push the hour past the reserve: a fresh character's worst case. */
const LOOKUP_HEADROOM = 250;

const PAYLOADS = `${DIR}/payloads`;
const FAILED = `${DIR}/failed.jsonl`;
const LOG = `${DIR}/collect.log`;

export interface Candidate {
  key: string;
  name: string;
  server: string;
  className: string;
  spec: string;
  role: Role;
  level: number;
  percentile: number;
  quintile: number;
}

export const fileKey = (name: string, server: string, spec: string): string =>
  `${name}-${server}-${spec}`.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "_");

/** One candidate per (character, spec): level = median of their bands, percentile = median position. */
export function candidates(pool: PoolEntry[]): Candidate[] {
  const byChar = new Map<string, PoolEntry[]>();
  for (const e of pool) {
    const k = `${e.name}|${e.server}|${e.spec}`;
    (byChar.get(k) ?? byChar.set(k, []).get(k)!).push(e);
  }
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
  const out: Candidate[] = [];
  for (const entries of byChar.values()) {
    const e0 = entries[0]!;
    const level = med(entries.map((e) => e.level));
    const percentile = med(entries.map((e) => e.percentile));
    out.push({
      key: fileKey(e0.name, e0.server, e0.spec), name: e0.name, server: e0.server, className: e0.className,
      spec: e0.spec, role: e0.role, level, percentile, quintile: Math.min(4, Math.floor(percentile * 5)),
    });
  }
  return out;
}

/** Deterministic shuffle (mulberry32), so a rerun walks the cells in the same order. */
function shuffle<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

/** Round-robin over role × level × quintile: round r takes the r-th candidate of every cell. */
export function schedule(cands: Candidate[]): Candidate[] {
  const cells = new Map<string, Candidate[]>();
  for (const c of cands) {
    const k = `${c.role}|${c.level}|${c.quintile}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(c);
  }
  const lists = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, l]) => shuffle(l, [...k].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)));
  const order: Candidate[] = [];
  for (let r = 0; lists.some((l) => r < l.length); r++) for (const l of lists) if (r < l.length) order.push(l[r]!);
  return order;
}

function deadline(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h!, m!, 0, 0);
  return d.getTime();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  mkdirSync(PAYLOADS, { recursive: true });
  const pool = JSON.parse(readFileSync(`${DIR}/pool.json`, "utf8")) as PoolEntry[];
  const failed = new Set(existsSync(FAILED) ? readFileSync(FAILED, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).key as string) : []);
  const queue = schedule(candidates(pool)).filter((c) => LEVELS.includes(c.level as never) && !failed.has(c.key) && !existsSync(`${PAYLOADS}/${c.key}.json`));
  const stopAt = deadline(UNTIL);
  const log = (line: string) => { const l = `${new Date().toTimeString().slice(0, 8)} ${line}`; console.log(l); appendFileSync(LOG, l + "\n"); };
  log(`queue ${queue.length} candidates, until ${UNTIL}, reserve ${RESERVE} pts, ${CONCURRENCY} workers`);

  // Budget, from every WCL response's rateLimitData.
  let rl: (RateLimit & { at: number }) | null = null;
  setRateLimitObserver((r) => { if (!rl || r.pointsSpentThisHour >= rl.pointsSpentThisHour || Date.now() > rl.at + rl.pointsResetIn * 1000) rl = { ...r, at: Date.now() }; });
  let throttledUntil = 0;
  let done = 0;
  let next = 0;

  async function waitForBudget(): Promise<void> {
    for (;;) {
      if (Date.now() < throttledUntil) { await sleep(throttledUntil - Date.now()); continue; }
      if (!rl) return;
      const left = rl.limitPerHour - rl.pointsSpentThisHour;
      if (left >= RESERVE + LOOKUP_HEADROOM) return;
      const resetAt = rl.at + rl.pointsResetIn * 1000 + 5000;
      log(`budget: ${left.toFixed(0)} pts left this hour — pausing until the reset (${new Date(resetAt).toTimeString().slice(0, 5)})`);
      await sleep(Math.max(5000, resetAt - Date.now()));
      rl = null; // the next response re-primes it
      return;
    }
  }

  async function worker(): Promise<void> {
    while (next < queue.length && done < LIMIT && Date.now() < stopAt) {
      const c = queue[next++]!;
      await waitForBudget();
      if (Date.now() >= stopAt) break;
      const before = rl?.pointsSpentThisHour ?? null;
      try {
        const outcome = await performLookup({ name: c.name, realm: c.server, region: "eu", level: c.level, spec: c.spec, enrich: true });
        if (!outcome.ok) {
          appendFileSync(FAILED, JSON.stringify({ key: c.key, status: outcome.status, error: outcome.error }) + "\n");
          log(`skip ${c.name}-${c.server} (${c.spec}): ${outcome.status} ${outcome.error.slice(0, 80)}`);
          continue;
        }
        const payload = buildLookupPayload(outcome, c.server);
        writeFileSync(`${PAYLOADS}/${c.key}.json`, JSON.stringify({ study: c, payload }));
        done++;
        const ev = outcome.evaluation;
        // With 3 workers the delta also carries the other lookups' spending: an estimate, not a bill.
        const cost = before === null || !rl ? "?" : Math.max(0, rl.pointsSpentThisHour - before).toFixed(0);
        log(`#${done} ${c.role}/+${c.level}/q${c.quintile} ${c.name}-${c.server} ${c.spec}: ${ev.verdict} ${ev.global ?? "—"} (~${cost} pts, ${rl ? (rl.limitPerHour - rl.pointsSpentThisHour).toFixed(0) : "?"} left)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/429/.test(msg)) {
          throttledUntil = Date.now() + 30_000;
          queue.push(c); // retried at the end of the queue
          log(`429 on ${c.name}-${c.server}: all workers pause 30 s`);
        } else {
          appendFileSync(FAILED, JSON.stringify({ key: c.key, status: 0, error: msg.slice(0, 300) }) + "\n");
          log(`error ${c.name}-${c.server} (${c.spec}): ${msg.slice(0, 120)}`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  log(`stopped: ${done} payloads saved this run`);
}

if (import.meta.main) await main();
