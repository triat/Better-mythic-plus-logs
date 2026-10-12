import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDefensives } from "../src/deepdive/table.ts";
import { DEFAULT_CONFIG, validateConfig } from "../src/evaluation/config.ts";
import { evaluate } from "../src/evaluation/evaluate.ts";
import type { LookupPayload } from "../src/lookup.ts";
import { analyzeLookup, type MPlusRun } from "../src/mplus.ts";
import { runServer } from "../src/server.ts";
import { getLocalHistory } from "../src/server/local-history.ts";
import { History, cacheKey, requestFromJson, summaryOf } from "../src/server-history.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { signalSummary } from "../src/signals/summary.ts";
import { parseRunSignals } from "../src/signals/wcl-run.ts";
import type { Region } from "../src/wow/regions.ts";
import { loadDeepdiveFixture } from "./fixtures.ts";

const req = (character: string, level: number | null = null) => ({ character, level, spec: null, metric: null, region: "eu" as Region });
const entry = (over: Partial<Parameters<History["record"]>[1]> = {}) => ({
  result: { any: "payload" },
  label: "Muleyoxo-Silvermoon",
  charClass: 7,
  spec: "Holy",
  targetLevel: 21,
  targetAutoDetected: true,
  ...over,
});

describe("History — keyed by effective level", () => {
  test("cacheKey normalizes and carries the level", () => {
    expect(cacheKey(req(" Muleyoxo-Silvermoon ", 18))).toBe(JSON.stringify(["muleyoxo-silvermoon", 18, "", "", "eu"]));
  });

  test("cacheKey carries the region; two regions are two tabs", () => {
    expect(cacheKey({ ...req("Biwaasham-Hyjal", 18), region: "eu" })).toBe(JSON.stringify(["biwaasham-hyjal", 18, "", "", "eu"]));
    expect(cacheKey({ ...req("Biwaasham-Hyjal", 18), region: "us" })).not.toBe(cacheKey({ ...req("Biwaasham-Hyjal", 18), region: "eu" }));
  });

  test("requestFromJson defaults a stored request without region", () => {
    expect(requestFromJson(JSON.stringify({ character: "A-B", level: null, spec: null, metric: null }), "eu").region).toBe("eu");
    expect(requestFromJson(JSON.stringify({ character: "A-B", level: 2, spec: null, metric: null, region: "kr" }), "eu").region).toBe("kr");
  });

  test("an auto lookup that resolves to +21 merges with an explicit +21 entry", () => {
    const h = new History(20, () => 1000);
    const explicit = h.record(req("Muleyoxo-Silvermoon", 21), entry({ targetAutoDetected: false }));
    const auto = h.record(req("Muleyoxo-Silvermoon", null), entry({ targetAutoDetected: true }));
    expect(auto.key).toBe(explicit.key);
    expect(h.size).toBe(1);
    expect(h.get(auto.key)!.targetAutoDetected).toBe(true); // newest wins
  });

  test("an auto request hits the cache once its effective level is known", () => {
    const h = new History(20, () => 1000);
    expect(h.cached(req("Muleyoxo-Silvermoon", null))).toBeNull();
    const e = h.record(req("Muleyoxo-Silvermoon", null), entry());
    expect(h.cached(req("Muleyoxo-Silvermoon", null))?.key).toBe(e.key);
    expect(h.cached(req("muleyoxo-silvermoon", 21))?.key).toBe(e.key);
    expect(h.cached(req("Muleyoxo-Silvermoon", 18))).toBeNull();
  });

  test("a cache hit moves the entry to the newest position", () => {
    const h = new History(20, () => 1000);
    h.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false }));
    h.record(req("B-X", 18), entry({ label: "B-X", targetLevel: 18, targetAutoDetected: false }));
    h.cached(req("A-X", 18));
    expect(h.list().map((e) => e.label)).toEqual(["A-X", "B-X"]); // newest first
  });

  test("an auto re-evaluation that lands on a new level replaces the old auto entry, not an explicit one", () => {
    const h = new History(20, () => 1000);
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 20, targetAutoDetected: true }));
    h.record(req("Muleyoxo-Silvermoon", 18), entry({ targetLevel: 18, targetAutoDetected: false }));
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 21, targetAutoDetected: true }));
    expect(h.list().map((e) => [e.targetLevel, e.targetAutoDetected])).toEqual([[21, true], [18, false]]);
  });

  test("evicts the oldest past the cap; remove/clear also forget auto levels", () => {
    const h = new History(2, () => 1000);
    h.record(req("A-X", 18), entry({ label: "A-X" }));
    h.record(req("B-X", 18), entry({ label: "B-X" }));
    h.record(req("C-X", null), entry({ label: "C-X", targetLevel: 19 }));
    expect(h.list().map((e) => e.label)).toEqual(["C-X", "B-X"]);
    expect(h.remove(cacheKey(req("C-X", 19)))).toBe(true);
    expect(h.cached(req("C-X", null))).toBeNull();
    h.clear();
    expect(h.size).toBe(0);
  });

  // I1: `peek` is `cached` with no write — POST /api/live/cached reads through it on every roster change.
  test("peek returns a hit without reordering, and resolves an auto alias like cached does", () => {
    const h = new History(5, () => 1000);
    const a = h.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false }));
    const b = h.record(req("B-X", null), entry({ label: "B-X", targetLevel: 20, targetAutoDetected: true }));
    expect(h.peek(req("A-X", 18))?.key).toBe(a.key);
    expect(h.peek(req("B-X", null))?.key).toBe(b.key); // auto alias resolved, same as cached()
    expect(h.list().map((e) => e.label)).toEqual(["B-X", "A-X"]); // LRU order untouched
    expect(h.peek(req("Nobody-X", 18))).toBeNull();
    expect(h.peek(req("Nobody-X", null))).toBeNull(); // an unresolved auto request is a plain miss
    h.cached(req("A-X", 18));
    expect(h.list().map((e) => e.label)).toEqual(["A-X", "B-X"]); // ... which cached() does move
  });

  test("updateResult replaces the payload in place and keeps the key", () => {
    const h = new History(5);
    const e = h.record(req("A-B", 10), entry({ label: "A-B", targetLevel: 10, result: { v: 1 } }));
    h.updateResult(e.key, { v: 2 });
    expect(h.get(e.key)!.result).toEqual({ v: 2 });
    h.updateResult("nope", { v: 3 });
    expect(h.size).toBe(1);
  });
});

const evaluated = (verdict: unknown, global: unknown) => ({ evaluation: { verdict, global, axes: [] } });

describe("History — verdict and score", () => {
  test("summaryOf reads evaluation.verdict / .global defensively", () => {
    expect(summaryOf(evaluated("invite", 87))).toEqual({ verdict: "invite", score: 87 });
    expect(summaryOf(evaluated("maybe", 54.6))).toEqual({ verdict: "maybe", score: 54.6 });
    expect(summaryOf(evaluated("insufficient", null))).toEqual({ verdict: null, score: null });
    expect(summaryOf(evaluated("nope", "12"))).toEqual({ verdict: null, score: null });
    expect(summaryOf({ evaluation: null })).toEqual({ verdict: null, score: null });
    expect(summaryOf({ any: "payload" })).toEqual({ verdict: null, score: null });
    expect(summaryOf(null)).toEqual({ verdict: null, score: null });
    expect(summaryOf("x")).toEqual({ verdict: null, score: null });
  });

  test("record fills verdict/score from the result; list carries them; updateResult refreshes them", () => {
    const h = new History(5, () => 1000);
    const e = h.record(req("A-B", 10), entry({ label: "A-B", targetLevel: 10, result: evaluated("pass", 31) }));
    expect(e.verdict).toBe("pass");
    expect(e.score).toBe(31);
    expect(h.list().map((i) => [i.verdict, i.score])).toEqual([["pass", 31]]);
    h.updateResult(e.key, evaluated("invite", 90));
    expect(h.list().map((i) => [i.verdict, i.score])).toEqual([["invite", 90]]);
    h.updateResult(e.key, { any: "payload" });
    expect(h.get(e.key)!.verdict).toBeNull();
    expect(h.get(e.key)!.score).toBeNull();
  });
});

describe("GET /api/history — verdict and score", () => {
  let dir: string;
  let server: Awaited<ReturnType<typeof runServer>>;
  const saved = { db: process.env.BMPL_DB_PATH, defensives: process.env.BMPL_DEFENSIVES, id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "bmpl-hist-"));
    closeStore();
    process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
    // The shipped table only: never the user's defensives.json next to the repo's .env.
    process.env.BMPL_DEFENSIVES = join(dir, "defensives.json");
    resetDefensives();
    // Nothing here looks up, but never let a stray path reach WCL with the real credentials.
    process.env.WCL_CLIENT_ID = "dummy";
    process.env.WCL_CLIENT_SECRET = "dummy";
    server = await runServer({ port: 0, open: false, assets: async () => null });
  });
  afterAll(() => {
    server.stop(true);
    closeStore();
    restore("BMPL_DB_PATH", saved.db);
    restore("BMPL_DEFENSIVES", saved.defensives);
    resetDefensives();
    restore("WCL_CLIENT_ID", saved.id);
    restore("WCL_CLIENT_SECRET", saved.secret);
    rmSync(dir, { recursive: true, force: true });
  });

  test("each item carries verdict and score", async () => {
    getLocalHistory().record(req("A-B", 10), entry({ label: "A-B", targetLevel: 10, result: evaluated("maybe", 62) }));
    getLocalHistory().record(req("C-D", 10), entry({ label: "C-D", targetLevel: 10, result: { any: "payload" } }));
    const res = await fetch(`http://localhost:${server.port}/api/history`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: { label: string; verdict: unknown; score: unknown }[] };
    expect(body.items.map((i) => [i.label, i.verdict, i.score])).toEqual([["C-D", null, null], ["A-B", "maybe", 62]]);
  });

  // A payload saved with no analysis attached, while SQLite holds the run's raw rows and its analysis.
  const savedWithoutAnalyses = async (): Promise<LookupPayload> => {
    const f = await loadDeepdiveFixture("s2-healer");
    const store = await getStore();
    const run: MPlusRun = { ...f.run };
    run.signals = parseRunSignals(f.report, f.character, { keyLevel: run.keyLevel, affixes: run.affixes, encounterID: run.encounterID })!;
    store.putWclRun(run.reportCode, run.fightID, f.report);
    store.putDeepDive(run.reportCode, run.fightID, f.character, f.deepdive);
    const cfg = validateConfig(DEFAULT_CONFIG);
    const result = analyzeLookup([run], run.keyLevel, [{ id: run.encounterID, name: run.encounterName }], true);
    const base = { metric: "hps" as const, targetLevel: result.targetLevel, perDungeon: result.perDungeon, prevLevelBest: result.prevLevelBest, rio: null, summary: signalSummary([run], null) };
    const payload = {
      character: { id: 1, name: f.character, classID: 2, spec: "Holy", scoreTop: null, realmSlug: "hyjal", region: "eu" },
      zone: { id: 1, name: "z", partition: 1 }, metricAutoSelected: true, alternateMetricHasData: false, specFilter: null, runsIndexed: 1, seasonDungeons: [],
      targetAutoDetected: true, atOrAboveTargetCount: 0, rioError: null,
      ...base, evaluation: evaluate(base, cfg), deepdive: [],
      deepdiveSummary: { tableWarning: null, analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
    } as unknown as LookupPayload;
    return payload;
  };
  const expectAttached = (result: LookupPayload) => {
    expect(result.deepdive.length).toBe(1);
    expect(result.deepdiveSummary.analyzedRuns).toBe(1);
    const dp = result.deepdive[0]!.defensives.find((d) => d.id === 498)!;
    expect(dp.castsAtMs.length).toBe(dp.casts);
    expect(dp.castsAtMs.every((ms) => ms >= 0)).toBe(true);
  };

  // A local entry saved before an analysis field existed (here: castsAtMs) gains it on read, from the cached raw rows.
  test("a local history read re-attaches cached analyses (0 pts) without rewriting the entry", async () => {
    const payload = await savedWithoutAnalyses();
    const e = getLocalHistory().record(req("Old-Entry", 10), entry({ label: "Old-Entry", targetLevel: 10, result: payload }));
    const res = await fetch(`http://localhost:${server.port}/api/history/${encodeURIComponent(e.key)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { fromCache: boolean; result: LookupPayload };
    expect(body.fromCache).toBe(true);
    expectAttached(body.result);
    expect((getLocalHistory().get(e.key)!.result as LookupPayload).deepdive).toEqual([]); // a read never writes the entry
  });

  // The same entry reached through a lookup cache hit returns the same shape as a history read (no WCL call: dummy creds).
  test("a local lookup cache hit re-attaches cached analyses (0 pts) without rewriting the entry", async () => {
    const payload = await savedWithoutAnalyses();
    const e = getLocalHistory().record(req("Hit-Entry", 10), entry({ label: "Hit-Entry", targetLevel: 10, result: payload }));
    const res = await fetch(`http://localhost:${server.port}/api/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ character: "Hit-Entry", level: 10, region: "eu" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { fromCache: boolean; key: string; result: LookupPayload };
    expect(body.fromCache).toBe(true);
    expect(body.key).toBe(e.key);
    expectAttached(body.result);
    expect((getLocalHistory().get(e.key)!.result as LookupPayload).deepdive).toEqual([]);
  });
});
