import { describe, expect, test } from "bun:test";
import { openStore } from "../../src/signals/store.ts";
import type { RawDeepDive } from "../../src/deepdive/types.ts";

const raw = (over: Partial<RawDeepDive> = {}): RawDeepDive => ({
  code: "ABC", fightID: 3, character: "Muleyoxo", actorID: 1, fightStart: 0, fightEnd: 1000,
  casts: null, buffs: null, castEvents: [], tableIds: [498], truncated: false, fetchedAt: 1, pointsSpent: 3, ...over,
});

describe("store: wcl_deepdive", () => {
  test("round trip keyed by report, fight and character", () => {
    const s = openStore(":memory:");
    expect(s.getDeepDive("ABC", 3, "Muleyoxo")).toBeNull();
    s.putDeepDive("ABC", 3, "Muleyoxo", raw());
    expect(s.getDeepDive("ABC", 3, "Muleyoxo")?.actorID).toBe(1);
    expect(s.getDeepDive("ABC", 3, "Other")).toBeNull();
    s.putDeepDive("ABC", 3, "Muleyoxo", raw({ actorID: 7 }));
    expect(s.getDeepDive("ABC", 3, "Muleyoxo")?.actorID).toBe(7);
    s.close();
  });
  test("rows from another query version are ignored", () => {
    const s = openStore(":memory:");
    s._db.run("INSERT INTO wcl_deepdive (report_code, fight_id, character, query_version, fetched_at, json) VALUES ('X', 1, 'A', 0, 0, '{}')");
    expect(s.getDeepDive("X", 1, "A")).toBeNull();
    s.close();
  });
});
