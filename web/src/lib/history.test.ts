import { describe, expect, test } from "bun:test";
import type { HistoryItem } from "../types.ts";
import { MAX_COMPARE, pruneSelection, tabLevel, tabSubtitle, toggleSelection } from "./history.ts";

describe("history selection", () => {
  test("toggle adds, removes, keeps order", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
  test("selecting a 4th drops the oldest selection", () => {
    expect(MAX_COMPARE).toBe(3);
    expect(toggleSelection(["a", "b", "c"], "d")).toEqual(["b", "c", "d"]);
  });
  test("prune removes closed tabs", () => {
    expect(pruneSelection(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });
  test("tab subtitle", () => {
    const item = (over: Partial<HistoryItem>): HistoryItem => ({
      key: "k", label: "Muleyoxo-Silvermoon", charClass: 7, spec: null, targetLevel: 21, targetAutoDetected: true, fetchedAt: 0,
      request: { character: "Muleyoxo-Silvermoon", level: null, spec: null, metric: null, region: "eu" }, ...over,
    });
    expect(tabSubtitle(item({}), "eu")).toBe("+21 auto");
    expect(tabSubtitle(item({ targetAutoDetected: false, spec: "Holy" }), "eu")).toBe("+21 · Holy");
  });
  test("tabSubtitle names the region only when it is not the instance default", () => {
    const item = { targetLevel: 18, targetAutoDetected: true, spec: null, request: { character: "Biwaasham-Hyjal", level: null, spec: null, metric: null, region: "us" } } as never;
    expect(tabSubtitle(item, "eu")).toBe("US · +18 auto");
    expect(tabSubtitle(item, "us")).toBe("+18 auto");
    expect(tabLevel(item, "eu")).toBe("US · +18");
    expect(tabLevel(item, "us")).toBe("+18");
  });
});
