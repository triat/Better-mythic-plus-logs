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
    expect(raw.pointsSpent).toBeNull(); // no pointsBefore → nothing to diff against
  });
  test("no ids (table missing): requests the tables only, never a cast-events filter", async () => {
    const calls: Array<{ q: string; v: Record<string, unknown> | undefined }> = [];
    const gql = async <T,>(q: string, v?: Record<string, unknown>) => {
      calls.push({ q, v });
      const { castEvents: _drop, ...report } = page([], null).reportData.report;
      return { rateLimitData: page([], null).rateLimitData, reportData: { report } } as T;
    };
    const raw = await fetchRawDeepDive(gql, { code: "ABC", fightID: 16, character: "X", actorID: 1, ids: [] });
    expect(calls.length).toBe(1);
    expect(calls[0]!.q).not.toContain("castEvents");
    expect(calls[0]!.q).not.toContain("$filter");
    expect(calls[0]!.v).toEqual({ code: "ABC", fightID: 16, actorID: 1 });
    expect("filter" in calls[0]!.v!).toBe(false);
    expect(raw.castEvents).toEqual([]);
    expect(raw.tableIds).toEqual([]);
    expect(raw.truncated).toBe(false);
    expect(raw.casts?.data?.entries?.[0]?.guid).toBe(498);
  });
  test("follows nextPageTimestamp up to MAX_EVENT_PAGES and flags truncation", async () => {
    let n = 0;
    const gql = async <T,>() => { n++; return page([{ timestamp: n, type: "cast", abilityGameID: 498 }], n * 1000) as T; };
    const raw = await fetchRawDeepDive(gql, { code: "ABC", fightID: 1, character: "X", actorID: 1, ids: [498] });
    expect(n).toBe(MAX_EVENT_PAGES);
    expect(raw.castEvents.length).toBe(MAX_EVENT_PAGES);
    expect(raw.truncated).toBe(true);
  });
  test("a low budget keeps the page already paid for, but refuses before a second page", async () => {
    // Single page: the answer is used even though the counter is now low (the PING pre-check guards the first page).
    const one = await fetchRawDeepDive(async <T,>() => page([{ timestamp: 5, type: "cast", abilityGameID: 498 }], null, 3590) as T, { code: "ABC", fightID: 1, character: "X", actorID: 1, ids: [498] });
    expect(one.castEvents.length).toBe(1);
    // A next page exists: refuse before requesting it.
    let n = 0;
    const gql = async <T,>() => { n++; return page([], 5000, 3590) as T; };
    await expect(fetchRawDeepDive(gql, { code: "ABC", fightID: 1, character: "X", actorID: 1, ids: [498] })).rejects.toBeInstanceOf(BudgetLowError);
    expect(n).toBe(1);
  });
  test("measures points spent against the counter read before the fetch", async () => {
    let spent = 100;
    const gql = async <T,>() => { spent += 1.5; return page([], spent < 104 ? 5000 : null, spent) as T; };
    const raw = await fetchRawDeepDive(gql, { code: "A", fightID: 1, character: "X", actorID: 1, ids: [498], pointsBefore: 100 });
    expect(raw.pointsSpent).toBe(4.5); // three pages at 1.5 each: 104.5 − 100
    const cheap = await fetchRawDeepDive(async <T,>() => page([], null, 50) as T, { code: "A", fightID: 1, character: "X", actorID: 1, ids: [498], pointsBefore: 60 });
    expect(cheap.pointsSpent).toBe(0); // a counter that went down (hour reset) never yields a negative cost
  });
});
