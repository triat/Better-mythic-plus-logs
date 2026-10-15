// `bmpl calibrate --hourly | --fit`: the weekly recalibration's two systemd units (deploy/bmpl-calibrate-*.service).
// Spec: docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md.
import { getDefensives } from "../deepdive/table.ts";
import { DEFAULT_CONFIG, validateConfig } from "../evaluation/config.ts";
import { buildLookupPayload, performLookup } from "../lookup.ts";
import { resolveCalibrationDbPath } from "../setup.ts";
import { openStore } from "../signals/store.ts";
import { gql, setRateLimitObserver } from "../wcl/client.ts";
import type { RateLimit } from "../wcl/client.ts";
import { setUpstreamObserver, upstreamFields } from "../upstream.ts";
import { getCurrentMplusZone } from "../mplus.ts";
import { collectHour, WINDOW_MS } from "./collect.ts";
import { fitAndCompare, writeFit } from "./report.ts";
import { ensureMarker, memberMarkerAt, resolveMarkerPath } from "./marker.ts";
import { openSamples } from "./samples.ts";
import { reserveFromEnv } from "./window.ts";
import { errorFields, log } from "../log.ts";

// Structured lines (src/log.ts), like the server's: the journal of the two units ships to the logs stack.
const note = (message: string) => log.info("calibration_note", { message });

/** One hour of collection; `minutes` bounds it so the next hourly run never overlaps. */
export async function runHourly(minutes = 55): Promise<void> {
  const path = await resolveCalibrationDbPath();
  const marker = await resolveMarkerPath();
  ensureMarker(marker);
  const samples = openSamples(path);
  const store = openStore(path);
  const evalConfig = validateConfig(DEFAULT_CONFIG);
  const tables = await getDefensives();
  const startedAt = Date.now();
  // The instance counter as WCL last reported it: a sample's cost is the counter's rise across its lookup.
  let counter: RateLimit | null = null;
  setRateLimitObserver((rl) => { counter = rl; });
  setUpstreamObserver((c) => (c.ok ? log.info : log.warn)("upstream", upstreamFields(c)));
  let before: number | null = null;
  try {
    const report = await collectHour({
      samples, gql, reserve: reserveFromEnv(process.env.BMPL_CALIBRATION_RESERVE), endAt: Date.now() + minutes * 60_000,
      memberAt: () => memberMarkerAt(marker), log: note,
      onSample: (s) => {
        const after = (counter as RateLimit | null)?.pointsSpentThisHour ?? null;
        // A counter that went down crossed WCL's hourly reset: that sample's cost is unknown.
        const points = before !== null && after !== null && after >= before ? Math.round((after - before) * 10) / 10 : null;
        // `level` is the log line's own field (info / warn): the key level goes as `key_level`.
        const { level, ...rest } = s;
        (s.ok ? log.info : log.warn)("calibration_sample", { ...rest, key_level: level, points });
      },
      lookup: async (c) => {
        before = (counter as RateLimit | null)?.pointsSpentThisHour ?? null;
        const o = await performLookup({ name: c.name, realm: c.server, region: "eu", level: c.level, spec: c.spec, enrich: true }, { store, evalConfig, tables });
        return o.ok ? { ok: true, payload: buildLookupPayload(o, c.server) } : { ok: false, error: o.error };
      },
    });
    const { windowByRole, ...rest } = report;
    const last = counter as RateLimit | null;
    log.info("calibration_hour", {
      ...rest, window_tank: windowByRole.tank, window_healer: windowByRole.healer, window_dps: windowByRole.dps,
      minutes: Math.round((Date.now() - startedAt) / 60_000),
      // The instance counter at the end of the hour (members included) and its limit: how close the hour came.
      wcl_spent: last?.pointsSpentThisHour ?? null, wcl_limit: last?.limitPerHour ?? null,
    });
  } catch (e) {
    log.error("calibration_failed", { step: "hourly", ...errorFields(e) });
    throw e;
  } finally {
    setRateLimitObserver(null);
    setUpstreamObserver(null);
    store.close();
    samples.close();
  }
}

/** The weekly fit, 0 WCL points: reads the window's samples, writes candidate.json and comparison.md. */
export async function runFit(): Promise<void> {
  const path = await resolveCalibrationDbPath();
  const samples = openSamples(path);
  try {
    const zone = await getCurrentMplusZone();
    const now = Date.now();
    samples.prune(zone.id, now - WINDOW_MS);
    const r = fitAndCompare(samples.list(zone.id, now - WINDOW_MS), validateConfig(DEFAULT_CONFIG), now);
    writeFit(path, r);
    // Per role, flat (`tank_fit`, `healer_median_candidate` …): what the Recalibration dashboard's fit table reads.
    const roles: Record<string, unknown> = {};
    for (const [role, c] of Object.entries(r.roles)) {
      Object.assign(roles, {
        [`${role}_fit`]: c.fit, [`${role}_test`]: c.test, [`${role}_changes`]: c.verdictChanges, [`${role}_refitted`]: c.refitted,
        [`${role}_median_current`]: c.medianCurrent, [`${role}_median_candidate`]: c.medianCandidate,
      });
    }
    log.info("calibration_fit", { test: r.test, verdictChanges: r.verdictChanges, thresholdMet: r.thresholdMet, reason: r.reason, ...roles });
  } catch (e) {
    log.error("calibration_failed", { step: "fit", ...errorFields(e) });
    throw e;
  } finally {
    samples.close();
  }
}

export async function cmdCalibrate(rest: string[]): Promise<void> {
  if (rest.includes("--fit")) {
    await runFit();
    return;
  }
  if (rest.includes("--hourly")) {
    const i = rest.indexOf("--minutes");
    const minutes = i >= 0 ? Number(rest[i + 1]) : 55;
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--minutes must be a positive number");
    await runHourly(minutes);
    return;
  }
  throw new Error("Usage: bmpl calibrate --hourly [--minutes 55] | --fit");
}
