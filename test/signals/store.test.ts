import { describe, expect, test } from "bun:test";
import { QUERY_VERSION, RIO_TTL_MS, openStore, openStoreOrMemory } from "../../src/signals/store.ts";
import type { MPlusRun } from "../../src/mplus.ts";
import { loadWclFixture } from "../fixtures.ts";

describe("store", () => {
  test("WCL raw round-trip, never expires", async () => {
    const s = openStore(":memory:");
    const f = await loadWclFixture("s1-tank");
    expect(s.getWclRun("QvhzaWwPNxMVY4Xd", 1)).toBeNull();
    s.putWclRun("QvhzaWwPNxMVY4Xd", 1, f.report);
    const back = s.getWclRun("QvhzaWwPNxMVY4Xd", 1);
    expect(back?.code).toBe("QvhzaWwPNxMVY4Xd");
    expect(back?.fights?.[0]?.keystoneBonus).toBe(1);
    s.close();
  });

  test("put overwrites an existing row", () => {
    const s = openStore(":memory:");
    s.putWclRun("A", 1, { code: "A", fights: [{ id: 1, keystoneBonus: 0 }] });
    s.putWclRun("A", 1, { code: "A", fights: [{ id: 1, keystoneBonus: 2 }] });
    expect(s.getWclRun("A", 1)?.fights?.[0]?.keystoneBonus).toBe(2);
    s.close();
  });

  test("rows from an older query version are hidden", () => {
    const s = openStore(":memory:");
    s.putWclRun("A", 1, { code: "A" });
    // Simulate a row written by an older build.
    s._db.run("UPDATE wcl_run_raw SET query_version = ? WHERE report_code = 'A'", [QUERY_VERSION - 1]);
    expect(s.getWclRun("A", 1)).toBeNull();
    s.close();
  });

  test("RIO TTL", () => {
    const s = openStore(":memory:");
    const t0 = 1_000_000;
    s.putRio("eu", "nerzhul", "Biwaadrood", { name: "Biwaadrood" }, t0);
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS - 1 })).toEqual({
      raw: { name: "Biwaadrood" }, fetchedAt: t0,
    });
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS + 1 })).toBeNull();
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS + 1, maxAgeMs: Infinity })).not.toBeNull();
    s.close();
  });

  test("RIO key is case-insensitive on name", () => {
    const s = openStore(":memory:");
    s.putRio("eu", "nerzhul", "Biwaadrood", { a: 1 }, 5);
    expect(s.getRio("EU", "nerzhul", "biwaadrood", { now: 6 })?.raw).toEqual({ a: 1 });
    s.close();
  });

  test("busy_timeout pragma is set (CLI + server may write the db concurrently)", () => {
    const s = openStore(":memory:");
    expect((s._db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout).toBe(5000);
    s.close();
  });

  test("openStoreOrMemory falls back to a working in-memory store when the path is unwritable", () => {
    const s = openStoreOrMemory("/nonexistent-dir-xyz/bmpl.db");
    s.putWclRun("A", 1, { code: "A" });
    expect(s.getWclRun("A", 1)?.code).toBe("A");
    s.close();
  });
});

describe("season store (character_runs)", () => {
  const key = { region: "eu", realm: "draenor", name: "Noshiidk" };
  const run = (code: string, startTime: number, over: Partial<MPlusRun> = {}): MPlusRun => ({
    encounterID: 12923, encounterName: "Voidscar Arena", keyLevel: 18, amount: 1000, parsePercent: 50, spec: "Frost",
    affixes: [9, 10], reportCode: code, fightID: 1, startTime, score: 400, timed: true, durationMs: 1_700_000, ...over,
  });

  test("upsert, newest first, idempotent, case-insensitive key", () => {
    const s = openStore(":memory:");
    s.upsertSeasonRuns(key, 55, "dps", [run("A", 1000), run("B", 3000), run("C", 2000, { timed: false })], 10);
    s.upsertSeasonRuns({ region: "EU", realm: "Draenor", name: "noshiidk" }, 55, "dps", [run("B", 3000, { parsePercent: 70 })], 20);
    const rows = s.seasonRuns(key, 55);
    expect(rows.map((r) => r.reportCode)).toEqual(["B", "C", "A"]);
    expect(rows[0]).toMatchObject({ parse: 70, discoveredAt: 10, seenAt: 20, timed: true, durationMs: 1_700_000, affixes: [9, 10], failedAt: null });
    expect(rows[1]!.timed).toBe(false);
    expect(s.latestSeasonZone(key)).toBe(55);
    expect(s.latestSeasonZone({ ...key, name: "Other" })).toBeNull();
    expect(s.seasonRuns(key, 54)).toEqual([]);
    s.close();
  });

  test("a failed fetch is remembered; hasWclRun reads the raw cache only", () => {
    const s = openStore(":memory:");
    s.upsertSeasonRuns(key, 55, "dps", [run("A", 1000)], 10);
    s.markSeasonRunFailed(key, "A", 1, 99);
    expect(s.seasonRuns(key, 55)[0]!.failedAt).toBe(99);
    expect(s.hasWclRun("A", 1)).toBe(false);
    s.putWclRun("A", 1, { code: "A" });
    expect(s.hasWclRun("A", 1)).toBe(true);
    s.close();
  });
});

describe("wcl_run_control", () => {
  test("put, get, version check; a newer version replaces the row", () => {
    const store = openStore(":memory:");
    const raw = { tableVersion: "mn-2.0", pets: [{ id: 333, petOwner: 328 }], events: [{ timestamp: 1, type: "applydebuff", sourceID: 333, abilityGameID: 91800 }] };
    expect(store.getRunControl("AbC", 9)).toBeNull();
    expect(store.hasRunControl("AbC", 9, "mn-2.0")).toBe(false);
    store.putRunControl("AbC", 9, raw);
    expect(store.getRunControl("AbC", 9)).toEqual(raw);
    expect(store.hasRunControl("AbC", 9, "mn-2.0")).toBe(true);
    expect(store.hasRunControl("AbC", 9, "mn-2.1")).toBe(false);
    store.putRunControl("AbC", 9, { ...raw, tableVersion: "mn-2.1", events: [] });
    expect(store.getRunControl("AbC", 9)?.events).toEqual([]);
    expect(store.hasRunControl("AbC", 9, "mn-2.1")).toBe(true);
  });
});
