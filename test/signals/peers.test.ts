import { describe, expect, test } from "bun:test";
import { median, peerComparison } from "../../src/signals/peers.ts";
import type { GroupRole } from "../../src/signals/types.ts";

const roles = new Map<string, GroupRole>([
  ["Me", "dps"], ["A", "dps"], ["B", "dps"], ["T", "tank"], ["H", "healer"],
]);
const DPS = new Set<GroupRole>(["dps"]);
const NON_HEALERS = new Set<GroupRole>(["dps", "tank"]);

describe("median", () => {
  test("empty → null", () => expect(median([])).toBeNull());
  test("odd count", () => expect(median([3, 1, 2])).toBe(2));
  test("even count averages the middle pair", () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe("peerComparison", () => {
  const values = [
    { name: "Me", value: 100 }, { name: "A", value: 10 }, { name: "B", value: 30 },
    { name: "T", value: 500 }, { name: "H", value: 5 },
  ];
  test("excludes the target and filters by role", () => {
    expect(peerComparison(values, "Me", roles, DPS)).toEqual({ median: 20, count: 2 });
  });
  test("tank counts when tank is in the peer roles", () => {
    expect(peerComparison(values, "Me", roles, NON_HEALERS)).toEqual({ median: 30, count: 3 });
  });
  test("null values are skipped", () => {
    const v = [...values, { name: "C", value: null }];
    roles.set("C", "dps");
    expect(peerComparison(v, "Me", roles, DPS)).toEqual({ median: 20, count: 2 });
  });
  test("no peers → null", () => {
    expect(peerComparison(values, "Me", roles, new Set<GroupRole>(["healer"]))).toEqual({ median: 5, count: 1 });
    expect(peerComparison([{ name: "Me", value: 1 }], "Me", roles, DPS)).toBeNull();
  });
  test("unknown role never counts as a peer", () => {
    const v = [{ name: "Me", value: 1 }, { name: "X", value: 2 }];
    expect(peerComparison(v, "Me", roles, DPS)).toBeNull();
  });
});
