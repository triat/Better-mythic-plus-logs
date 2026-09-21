import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AuditLog } from "../src/hosted/audit.ts";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedRuntime } from "../src/hosted/runtime.ts";
import type { LookupOptions, LookupOutcome } from "../src/lookup.ts";
import { History } from "../src/server-history.ts";
import { failureBody } from "../src/server/deepdive.ts";
import { runLookupWithCache } from "../src/server/lookup.ts";
import { WclError } from "../src/wcl/client.ts";
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
    region: "eu",
    specsSeen: [],
    data: { zoneID: 1, zoneName: "z", partition: 1, metric: "dps", metricAutoSelected: true, alternateMetricHasData: false, character: { id: 1, name: "Muleyoxo", classID: 7, spec: "Holy", scoreTop: null }, runs: [], seasonDungeons: [], specFilter: null },
    result: { targetLevel: 18, targetAutoDetected: false, atOrAboveTarget: [], prevLevelBest: null, perDungeon: p.perDungeon },
    rio: null, summary: p.summary, evaluation: { role: "dps", targetLevel: 18, axes: [], global: null, verdict: "insufficient data", runsUsed: 0, analyzedRuns: 0, configVersion: "test" },
    deepdive: [], deepdiveSummary: { tableWarning: null, analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
  } as unknown as Extract<LookupOutcome, { ok: true }>;
};
const opts = (refresh = false) => ({ character: "Muleyoxo-Silvermoon", level: 18, spec: null, metric: null, refresh, region: "eu" as const });

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
    // A third, non-refresh caller for the same key must join the original (first) flight, not the
    // refresh's: a refresh never displaces another caller's in-flight (non-refresh) fetch.
    const third = runLookupWithCache(opts(), h, { performLookup });
    expect(calls).toBe(2); // no third performLookup call: third joined first, not second
    const refusal = { error: "quota" as const, message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };
    releases[0]!(outcome());
    releases[1]!({ ok: false, status: 429, error: refusal.message, quota: refusal });
    const [r1, r2, r3] = await Promise.all([first, second, third]);
    expect(r2).toEqual({ ok: false, status: 429, error: refusal.message, quota: refusal });
    expect(r1.ok && r3.ok && r3.joined && r3.key === r1.key).toBe(true);
  });

  test("a joiner never inherits the starter's 429 (it carries the starter's quota): it retries its own lookup", async () => {
    let calls = 0;
    let releaseStarter: (o: LookupOutcome) => void = () => {};
    const refusal = { error: "quota" as const, message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };
    const performLookup = (async () => {
      calls++;
      if (calls === 1) return new Promise<LookupOutcome>((r) => { releaseStarter = r; });
      return outcome(); // the joiner's own retry, run directly (not through the in-flight map)
    }) as unknown as typeof import("../src/lookup.ts").performLookup;
    const a = new History(5); const b = new History(5);
    const starter = runLookupWithCache(opts(), a, { performLookup });
    const joiner = runLookupWithCache(opts(), b, { performLookup });
    await Promise.resolve();
    expect(calls).toBe(1); // the joiner shared the starter's flight, no second call yet
    releaseStarter({ ok: false, status: 429, error: refusal.message, quota: refusal });
    const [rs, rj] = await Promise.all([starter, joiner]);
    expect(rs).toEqual({ ok: false, status: 429, error: refusal.message, quota: refusal }); // starter still gets its own 429
    expect(calls).toBe(2); // the joiner retried on its own
    expect(rj.ok && rj.joined && !rj.fromCache).toBe(true);
    expect(b.size).toBe(1); // the joiner's own success is recorded in its own history
  });
});

describe("region", () => {
  test("a Raider.IO URL overrides the requested region and the effective request is returned", async () => {
    const seen: LookupOptions[] = [];
    const performLookup = (async (o: LookupOptions) => { seen.push(o); return outcome(); }) as never;
    const r = await runLookupWithCache({ character: "https://raider.io/characters/us/hyjal/Biwaasham", level: null, spec: null, metric: null, refresh: false, region: "eu" }, new History(5), { performLookup });
    expect(r.ok && r.request.region).toBe("us");
    expect(r.ok && r.request.character).toBe("Biwaasham-hyjal");
    expect(seen[0]!.region).toBe("us");
  });
  test("the requested region reaches the lookup and keys the history; two regions are two entries", async () => {
    const seen: LookupOptions[] = [];
    const performLookup = (async (o: LookupOptions) => { seen.push(o); return outcome(); }) as never;
    const h = new History(5);
    const eu = await runLookupWithCache(opts(), h, { performLookup });
    const kr = await runLookupWithCache({ ...opts(), region: "kr" }, h, { performLookup });
    expect(seen.map((o) => o.region)).toEqual(["eu", "kr"]);
    expect(eu.ok && kr.ok && eu.key !== kr.key).toBe(true);
    expect(h.list().map((i) => i.request.region)).toEqual(["kr", "eu"]);
    // A repeat in the same region is a cache hit that still reports its request.
    const again = await runLookupWithCache({ ...opts(), region: "kr" }, h, { performLookup });
    expect(again.ok && again.fromCache && again.request.region).toBe("kr");
    expect(seen.length).toBe(2);
  });
});

describe("failures", () => {
  test("a WclError thrown by the lookup is a 502 carrying the public message; any other throw is a 500 without it", async () => {
    const wcl = await runLookupWithCache(opts(), new History(5), { performLookup: async () => { throw new WclError("http", 503, "HTTP 503: <html>maintenance</html>"); } });
    expect(wcl).toEqual({ ok: false, status: 502, error: "WCL HTTP 503: <html>maintenance</html>", wcl: "HTTP 503: <html>maintenance</html>" });
    const other = await runLookupWithCache(opts(), new History(5), { performLookup: async () => { throw new Error("ENOENT: /srv/bmpl/bmpl.db"); } });
    expect(other).toEqual({ ok: false, status: 500, error: "ENOENT: /srv/bmpl/bmpl.db" });
  });
  test("failureBody: local mode keeps every message; hosted mode sanitises 5xx, passes WCL through, records quota refusals and server errors", () => {
    const quota = { error: "quota" as const, message: "Hourly quota reached (300/300) — resets in 120 s", used: 300, limit: 300, resetInS: 120 };
    expect(failureBody({ status: 500, error: "ENOENT: /srv/bmpl/bmpl.db" }, null)).toEqual({ ok: false, error: "ENOENT: /srv/bmpl/bmpl.db" });
    expect(failureBody({ status: 429, error: quota.message, quota }, null)).toEqual({ ok: false, ...quota });

    const db = openHosted(new Database(":memory:"));
    const runtime = { audit: new AuditLog(db.audit) } as unknown as HostedRuntime;
    expect(failureBody({ status: 500, error: "ENOENT: /srv/bmpl/bmpl.db" }, runtime)).toEqual({ ok: false, error: "Internal error" });
    expect(failureBody({ status: 502, error: "WCL GraphQL error: private", wcl: "GraphQL error: private" }, runtime)).toEqual({ ok: false, error: "WCL: GraphQL error: private" });
    expect(failureBody({ status: 404, error: "not in the cache" }, runtime)).toEqual({ ok: false, error: "not in the cache" });
    expect(failureBody({ status: 429, error: quota.message, quota }, runtime)).toEqual({ ok: false, ...quota });
    const rows = db.audit.list({ actions: null, before: null, limit: 10 });
    // The WCL failure is the observer's job (gql) and a 404 is nobody's: only the 500 and the refusal leave rows here.
    expect(rows.map((r) => [r.action, r.detail])).toEqual([
      ["quota_refused", { used: 300, limit: 300, resetInS: 120, error: "quota" }],
      ["server_error", { message: "ENOENT: /srv/bmpl/bmpl.db" }],
    ]);
  });
});
