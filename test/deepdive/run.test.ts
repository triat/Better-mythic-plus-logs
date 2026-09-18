import { describe, expect, test } from "bun:test";
import { runDeepdive } from "../../src/deepdive/run.ts";
import { SHIPPED } from "../../src/deepdive/table.ts";
import type { LoadedTables } from "../../src/deepdive/types.ts";
import { openStore } from "../../src/signals/store.ts";
import { loadDeepdiveFixture } from "../fixtures.ts";

const tables: LoadedTables = { shipped: SHIPPED, override: {}, overridePath: "/dev/null" };
const ping = (spent: number) => ({ rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: 10 } });

describe("runDeepdive", () => {
  test("404 when the run is not cached; no network", async () => {
    const store = openStore(":memory:");
    let calls = 0;
    const gql = async <T,>() => { calls++; return {} as T; };
    const r = await runDeepdive({ reportCode: "NOPE", fightID: 1, character: "X" }, { store, tables, gql });
    expect(r).toEqual({ ok: false, status: 404, error: "run NOPE:1 is not in the cache — look the character up first" });
    expect(calls).toBe(0);
    store.close();
  });
  test("cache hit → no network; force → refetch; budget refusal before spending", async () => {
    const store = openStore(":memory:");
    const f = await loadDeepdiveFixture("s2-healer");
    store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
    const req = { reportCode: f.run.reportCode as string, fightID: f.run.fightID as number, character: f.character as string };
    const queries: string[] = [];
    let spent = 100;
    const gql = async <T,>(q: string) => {
      queries.push(q.includes("rateLimitData") && !q.includes("reportData") ? "ping" : "deepdive");
      if (queries[queries.length - 1] === "ping") return ping(spent) as T;
      return { ...ping(spent + 3), reportData: { report: { fights: [{ startTime: f.deepdive.fightStart, endTime: f.deepdive.fightEnd }], casts: f.deepdive.casts, buffs: f.deepdive.buffs, castEvents: { data: f.deepdive.castEvents.map((e: { timestamp: number; abilityGameID: number }) => ({ ...e, type: "cast" })), nextPageTimestamp: null } } } } as T;
    };
    const first = await runDeepdive(req, { store, tables, gql });
    expect(first.ok).toBe(true);
    expect(queries).toEqual(["ping", "deepdive"]);
    if (first.ok) {
      expect(first.fromCache).toBe(false);
      expect(first.pointsSpent).toBe(3); // deep-dive counter minus the PING's counter
      expect(first.result.defensives.find((d) => d.id === 498)!.casts).toBe(27);
    }
    const second = await runDeepdive(req, { store, tables, gql });
    expect(queries.length).toBe(2);
    if (second.ok) expect(second.fromCache).toBe(true);
    await runDeepdive({ ...req, force: true }, { store, tables, gql });
    expect(queries.length).toBe(4);
    spent = 3590;
    const low = await runDeepdive({ ...req, force: true }, { store, tables, gql });
    expect(low).toEqual({ ok: false, status: 402, error: "WCL budget low (10 pts left this hour)" });
    expect(queries.length).toBe(5); // ping only
    store.close();
  });
  test("a WCL error is relayed as 502 and nothing is cached", async () => {
    const store = openStore(":memory:");
    const f = await loadDeepdiveFixture("s2-healer");
    store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
    const gql = async <T,>(q: string) => { if (!q.includes("reportData")) return ping(0) as T; throw new Error("WCL GraphQL error: boom"); };
    const r = await runDeepdive({ reportCode: f.run.reportCode, fightID: f.run.fightID, character: f.character }, { store, tables, gql });
    expect(r).toEqual({ ok: false, status: 502, error: "WCL GraphQL error: boom" });
    expect(store.getDeepDive(f.run.reportCode, f.run.fightID, f.character)).toBeNull();
    store.close();
  });
  test("the quota gate is consulted after the cache check and before the PING; a refusal spends nothing", async () => {
    const store = openStore(":memory:");
    const f = await loadDeepdiveFixture("s2-healer");
    store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
    const req = { reportCode: f.run.reportCode as string, fightID: f.run.fightID as number, character: f.character as string };
    let calls = 0;
    const gql = async <T,>() => { calls++; return ping(0) as T; };
    const refusal = { error: "quota" as const, message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };
    const estimates: number[] = [];
    const r = await runDeepdive(req, { store, tables, gql, reserve: (e) => { estimates.push(e); return refusal; } });
    expect(r).toEqual({ ok: false, status: 429, error: refusal.message, quota: refusal });
    expect(estimates).toEqual([3]);
    expect(calls).toBe(0);
    store.putDeepDive(req.reportCode, req.fightID, req.character, f.deepdive);
    const cached = await runDeepdive(req, { store, tables, gql, reserve: () => { throw new Error("must not be consulted for a cached analysis"); } });
    expect(cached.ok && cached.fromCache).toBe(true);
    store.close();
  });
});
