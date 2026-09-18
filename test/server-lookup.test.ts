import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LookupOutcome } from "../src/lookup.ts";
import { History } from "../src/server-history.ts";
import { runLookupWithCache } from "../src/server/lookup.ts";
import { payloadWith } from "./evaluation/helpers.ts";

const saved = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
beforeAll(() => { process.env.WCL_CLIENT_ID = "bmpl-test"; process.env.WCL_CLIENT_SECRET = "bmpl-test"; });
afterAll(() => {
  if (saved.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = saved.id;
  if (saved.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = saved.secret;
});

/** A successful outcome with the fields buildLookupPayload/history.record read. */
const outcome = (): Extract<LookupOutcome, { ok: true }> => {
  const p = payloadWith([], { targetLevel: 18 });
  return {
    ok: true,
    data: { zoneID: 1, zoneName: "z", partition: 1, metric: "dps", metricAutoSelected: true, alternateMetricHasData: false, character: { id: 1, name: "Muleyoxo", classID: 7, spec: "Holy", scoreTop: null }, runs: [], seasonDungeons: [], specFilter: null },
    result: { targetLevel: 18, targetAutoDetected: false, atOrAboveTarget: [], prevLevelBest: null, perDungeon: p.perDungeon },
    rio: null, summary: p.summary, evaluation: { role: "dps", targetLevel: 18, axes: [], global: null, verdict: "insufficient data", runsUsed: 0, analyzedRuns: 0, configVersion: "test" },
    deepdive: [], deepdiveSummary: { tableWarning: null, analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
  } as unknown as Extract<LookupOutcome, { ok: true }>;
};
const opts = (refresh = false) => ({ character: "Muleyoxo-Silvermoon", level: 18, spec: null, metric: null, refresh });

describe("runLookupWithCache — in-flight dedupe", () => {
  test("overlapping identical lookups share one fetch; each caller records its own history", async () => {
    let calls = 0;
    let release: (o: LookupOutcome) => void = () => {};
    const performLookup = (async () => { calls++; return new Promise<LookupOutcome>((r) => { release = r; }); }) as unknown as typeof import("../src/lookup.ts").performLookup;
    const a = new History(5); const b = new History(5);
    const pa = runLookupWithCache(opts(), a, { performLookup });
    const pb = runLookupWithCache(opts(), b, { performLookup });
    await Promise.resolve();
    release(outcome());
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(calls).toBe(1);
    expect(ra.ok && rb.ok && ra.key === rb.key).toBe(true);
    if (ra.ok && rb.ok) { expect(ra.joined).toBe(false); expect(rb.joined).toBe(true); expect(rb.fromCache).toBe(false); }
    expect(a.size).toBe(1); expect(b.size).toBe(1);
    // The settled flight is gone from the map by now: this is a brand new flight, not a join, so it
    // needs its own release (the mock's `release` was reassigned to this new promise's resolver).
    const againP = runLookupWithCache(opts(), new History(5), { performLookup });
    release(outcome());
    const again = await againP;
    expect(calls).toBe(2); // the flight is gone once settled
    expect(again.ok).toBe(true);
  });
  test("refresh never joins a flight; a 429 outcome keeps its quota payload", async () => {
    let calls = 0;
    const releases: Array<(o: LookupOutcome) => void> = [];
    const performLookup = (async () => { calls++; return new Promise<LookupOutcome>((r) => { releases.push(r); }); }) as unknown as typeof import("../src/lookup.ts").performLookup;
    const h = new History(5);
    const first = runLookupWithCache(opts(), h, { performLookup });
    const second = runLookupWithCache(opts(true), h, { performLookup });
    expect(calls).toBe(2);
    const refusal = { error: "quota" as const, message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };
    for (const release of releases) release({ ok: false, status: 429, error: refusal.message, quota: refusal });
    const [, r] = await Promise.all([first, second]);
    expect(r).toEqual({ ok: false, status: 429, error: refusal.message, quota: refusal });
  });
});
