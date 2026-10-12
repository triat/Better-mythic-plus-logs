import { describe, expect, test } from "bun:test";
import type { HistoryItem } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { MAX_COMPARE, initialPick, pruneSelection, tabLevel, tabSubtitle, toggleSelection, withPayloadSummary } from "./history.ts";
import type { LookupPayload } from "../types.ts";

const tFr = makeT(fr, "fr");

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
  test("?pick= ticks a history entry, nothing else", () => {
    expect(initialPick("?pick=b", ["a", "b"])).toEqual(["b"]);
    expect(initialPick("?pick=z", ["a", "b"])).toEqual([]);
    expect(initialPick("", ["a"])).toEqual([]);
  });
  test("prune removes closed tabs", () => {
    expect(pruneSelection(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });
  test("tab subtitle", () => {
    const item = (over: Partial<HistoryItem>): HistoryItem => ({
      key: "k", label: "Muleyoxo-Silvermoon", charClass: 7, spec: null, targetLevel: 21, targetAutoDetected: true, verdict: null, score: null, fetchedAt: 0,
      request: { character: "Muleyoxo-Silvermoon", level: null, spec: null, metric: null, region: "eu" }, ...over,
    });
    expect(tabSubtitle(tEn, item({}), "eu")).toBe("+21 auto");
    expect(tabSubtitle(tEn, item({ targetAutoDetected: false, spec: "Holy" }), "eu")).toBe("+21 · Holy");
  });
  test("tabSubtitle names the region only when it is not the instance default", () => {
    const item = { targetLevel: 18, targetAutoDetected: true, spec: null, request: { character: "Biwaasham-Hyjal", level: null, spec: null, metric: null, region: "us" } } as never;
    expect(tabSubtitle(tEn, item, "eu")).toBe("US · +18 auto");
    expect(tabSubtitle(tEn, item, "us")).toBe("+18 auto");
    expect(tabLevel(item, "eu")).toBe("US · +18");
    expect(tabLevel(item, "us")).toBe("+18");
  });
  test("tabSubtitle in French", () => {
    const item = { targetLevel: 21, targetAutoDetected: true, spec: null, request: { character: "Muleyoxo-Silvermoon", level: null, spec: null, metric: null, region: "eu" } } as never;
    expect(tabSubtitle(tFr, item, "eu")).toBe("+21 auto");
  });
});

describe("withPayloadSummary", () => {
  const item = (key: string, verdict: HistoryItem["verdict"], score: number | null) => ({ key, verdict, score }) as HistoryItem;
  const ev = (verdict: string, global: number | null) => ({ evaluation: { verdict, global } }) as unknown as Pick<LookupPayload, "evaluation">;
  test("patches the matching entry's verdict and score from the re-evaluated payload", () => {
    const items = [item("a", "invite", 78), item("b", "pass", 20)];
    const next = withPayloadSummary(items, "a", ev("maybe", 63));
    expect(next.map((i) => [i.key, i.verdict, i.score])).toEqual([["a", "maybe", 63], ["b", "pass", 20]]);
    expect(next[1]).toBe(items[1]!);
  });
  test("INSUFFICIENT DATA is a null verdict", () => {
    expect(withPayloadSummary([item("a", "maybe", 50)], "a", ev("insufficient", null))[0]).toMatchObject({ verdict: null, score: null });
  });
  test("same array when unchanged or unknown", () => {
    const items = [item("a", "maybe", 63)];
    expect(withPayloadSummary(items, "a", ev("maybe", 63))).toBe(items);
    expect(withPayloadSummary(items, "z", ev("pass", 1))).toBe(items);
  });
});
