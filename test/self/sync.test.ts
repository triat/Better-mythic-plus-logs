import { describe, expect, test } from "bun:test";
import type { MPlusData, MPlusRun } from "../../src/mplus.ts";
import { SYNC_RETRY_MS, pendingRows, runSeasonSync, syncBatch, syncState } from "../../src/self/sync.ts";
import { openStore } from "../../src/signals/store.ts";
import { PING_QUERY } from "../../src/wcl/queries.ts";

const key = { region: "eu" as const, realm: "draenor", name: "Noshiidk" };
const NOW = Date.UTC(2026, 9, 9, 12);
const run = (i: number): MPlusRun => ({
  encounterID: 12923, encounterName: "Voidscar Arena", keyLevel: 18, amount: 1000, parsePercent: 50, spec: "Frost",
  affixes: [], reportCode: `R${i}`, fightID: 1, startTime: i * 1000, score: 400, timed: true, durationMs: 1_700_000,
});

/** PING answers from `spent` in order (the last one repeats); report queries answer `{ code }`, null or throw. */
function fakeGql(o: { spent?: number[]; missing?: string[]; throwOn?: string[] } = {}) {
  const calls: string[] = [];
  let ping = 0;
  const spent = o.spent ?? [0];
  const gql = async <T,>(q: string, vars?: Record<string, unknown>): Promise<T> => {
    if (q === PING_QUERY) {
      const s = spent[Math.min(ping++, spent.length - 1)]!;
      return { rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: s, pointsResetIn: 1000 } } as T;
    }
    const code = String(vars?.code);
    calls.push(code);
    if (o.throwOn?.includes(code)) throw new Error("boom");
    return { reportData: { report: o.missing?.includes(code) ? null : { code } } } as T;
  };
  return { gql, calls };
}

function seeded(n: number) {
  const store = openStore(":memory:");
  store.upsertSeasonRuns(key, 55, "dps", Array.from({ length: n }, (_, i) => run(i + 1)), NOW);
  return store;
}

describe("syncState / pendingRows", () => {
  test("counts and the estimate (rankings + 10 pts per pending run)", () => {
    const store = seeded(12);
    store.putWclRun("R12", 1, { code: "R12" });
    store.putWclRun("R1", 1, { code: "R1" });
    expect(syncState(store, store.seasonRuns(key, 55), NOW)).toEqual({ runs: 12, analysed: 2, pending: 10, failed: 0, estimate: 120 });
  });
});

describe("syncBatch", () => {
  test("fetches the 10 newest uncached runs, then the rest", async () => {
    const store = seeded(12);
    const f = fakeGql();
    expect(await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).toEqual({ ok: true, fetched: 10, failed: 0 });
    expect(f.calls).toEqual(["R12", "R11", "R10", "R9", "R8", "R7", "R6", "R5", "R4", "R3"]);
    expect(await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).toEqual({ ok: true, fetched: 2, failed: 0 });
    expect(await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).toEqual({ ok: true, fetched: 0, failed: 0 });
    expect(f.calls).toHaveLength(12);
  });

  test("a report WCL does not return is skipped for 24 h, then retried", async () => {
    const store = seeded(3);
    await syncBatch(store, key, store.seasonRuns(key, 55), { gql: fakeGql({ missing: ["R3"] }).gql, now: NOW });
    const rows = store.seasonRuns(key, 55);
    expect(syncState(store, rows, NOW)).toMatchObject({ analysed: 2, pending: 0, failed: 1 });
    expect(pendingRows(store, rows, NOW + 3_600_000)).toEqual([]);
    expect(pendingRows(store, rows, NOW + SYNC_RETRY_MS).map((r) => r.reportCode)).toEqual(["R3"]);
  });

  test("refuses to start under 20 + 10 pts per run left, spending nothing", async () => {
    const store = seeded(10);
    const f = fakeGql({ spent: [3600 - 119] });
    const out = await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW });
    expect(out.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("a batch where every fetch throws rethrows and marks nothing", async () => {
    const store = seeded(2);
    const f = fakeGql({ throwOn: ["R1", "R2"] });
    await expect(syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).rejects.toThrow("boom");
    expect(syncState(store, store.seasonRuns(key, 55), NOW)).toMatchObject({ pending: 2, failed: 0 });
  });
});

describe("runSeasonSync", () => {
  test("refresh re-reads the rankings, then one batch; points measured by PING", async () => {
    const store = openStore(":memory:");
    let fetches = 0;
    const data = { zoneID: 55, metric: "dps", runs: [run(1), run(2)] } as unknown as MPlusData;
    const fetchMplus = async () => { fetches++; return data; };
    const f = fakeGql({ spent: [100, 121, 140] });
    const out = await runSeasonSync({ name: "Noshiidk", realm: "Draenor", region: "eu", refresh: true }, { store, gql: f.gql, fetchMplus, now: NOW });
    expect(out).toEqual({ ok: true, fetched: 2, failed: 0, state: { runs: 2, analysed: 2, pending: 0, failed: 0, estimate: 0 }, pointsSpent: 40 });
    expect(fetches).toBe(1);
    // Without refresh, a stored season is not fetched again.
    await runSeasonSync({ name: "Noshiidk", realm: "Draenor", region: "eu" }, { store, gql: f.gql, fetchMplus, now: NOW });
    expect(fetches).toBe(1);
  });
});
