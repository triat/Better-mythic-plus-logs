import { describe, expect, test } from "bun:test";
import { BudgetLowError, MAX_EVENT_PAGES, fetchRawDeepDive } from "../../src/deepdive/wcl.ts";

const page = (events: unknown[], next: number | null, spent = 10) => ({
  rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: 100 },
  reportData: { report: {
    fights: [{ startTime: 1000, endTime: 61000 }],
    casts: { data: { entries: [{ guid: 498, name: "Divine Protection", total: 2 }] } },
    buffs: { data: { auras: [{ guid: 498, name: "Divine Protection", totalUptime: 16000, totalUses: 2 }] } },
    castEvents: { data: events, nextPageTimestamp: next },
  } },
});

describe("fetchRawDeepDive", () => {
  test("one page: shapes the raw row and passes the id filter", async () => {
    const calls: Record<string, unknown>[] = [];
    const gql = async <T,>(_q: string, v?: Record<string, unknown>) => { calls.push(v!); return page([{ timestamp: 2000, type: "cast", abilityGameID: 498 }], null) as T; };
    const raw = await fetchRawDeepDive(gql, { code: "ABC", fightID: 16, character: "Muleyoxo", actorID: 1, ids: [498, 642] });
    expect(calls[0]!.filter).toBe("ability.id in (498, 642)");
    expect(calls[0]!.startTime).toBeNull();
    expect(raw.fightStart).toBe(1000);
    expect(raw.fightEnd).toBe(61000);
    expect(raw.castEvents).toEqual([{ timestamp: 2000, abilityGameID: 498, sourceID: undefined, targetID: undefined }]);
    expect(raw.tableIds).toEqual([498, 642]);
    expect(raw.truncated).toBe(false);
    expect(raw.pointsSpent).toBeNull(); // first query of the process: no baseline to diff against
  });
  test("follows nextPageTimestamp up to MAX_EVENT_PAGES and flags truncation", async () => {
    let n = 0;
    const gql = async <T,>() => { n++; return page([{ timestamp: n, type: "cast", abilityGameID: 498 }], n * 1000) as T; };
    const raw = await fetchRawDeepDive(gql, { code: "ABC", fightID: 1, character: "X", actorID: 1, ids: [498] });
    expect(n).toBe(MAX_EVENT_PAGES);
    expect(raw.castEvents.length).toBe(MAX_EVENT_PAGES);
    expect(raw.truncated).toBe(true);
  });
  test("refuses when the remaining budget is under 20 points", async () => {
    const gql = async <T,>() => page([], null, 3590) as T;
    await expect(fetchRawDeepDive(gql, { code: "ABC", fightID: 1, character: "X", actorID: 1, ids: [498] })).rejects.toBeInstanceOf(BudgetLowError);
  });
  test("measures points spent against the previous query's counter", async () => {
    let spent = 100;
    const gql = async <T,>() => { spent += 3; return page([], null, spent) as T; };
    await fetchRawDeepDive(gql, { code: "A", fightID: 1, character: "X", actorID: 1, ids: [498] });
    const second = await fetchRawDeepDive(gql, { code: "B", fightID: 1, character: "X", actorID: 1, ids: [498] });
    expect(second.pointsSpent).toBe(3);
  });
});
