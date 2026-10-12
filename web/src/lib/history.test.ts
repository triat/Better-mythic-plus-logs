import { describe, expect, test } from "bun:test";
import type { HistoryItem } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  MAX_COMPARE, addPick, compareKeys, compareSearch, pickMenu, pruneSelection, tabLevel, tabSubtitle, toggleSelection, withPayloadSummary,
} from "./history.ts";
import type { LookupPayload } from "../types.ts";

const tFr = makeT(fr, "fr");

describe("history selection", () => {
  test("toggle adds, removes, keeps order", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
  test("selecting a 6th drops the oldest selection", () => {
    expect(MAX_COMPARE).toBe(5);
    expect(toggleSelection(["a", "b", "c", "d", "e"], "f")).toEqual(["b", "c", "d", "e", "f"]);
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

describe("compare selection in the URL", () => {
  const keys = ["a", "b", "c", "d", "e", "f", "g"];
  test("several pick params, in order, unknown keys and duplicates dropped", () => {
    expect(compareKeys("?pick=c&pick=z&pick=a&pick=c&pick=b", keys)).toEqual(["c", "a", "b"]);
    expect(compareKeys("", keys)).toEqual([]);
    expect(compareKeys("?other=a", keys)).toEqual([]);
  });
  test("a sixth key is ignored", () => {
    expect(compareKeys("?pick=a&pick=b&pick=c&pick=d&pick=e&pick=f", keys)).toEqual(["a", "b", "c", "d", "e"]);
  });
  test("the profile header's ?pick=<one>", () => {
    expect(compareKeys("?pick=b", ["a", "b"])).toEqual(["b"]);
    expect(compareKeys("?pick=z", ["a", "b"])).toEqual([]);
  });
  test("a JSON key with commas and quotes survives the round trip", () => {
    const k1 = JSON.stringify(["Vachâman-Ysondre", 18, null, "dps", "eu"]);
    const k2 = JSON.stringify(["Circe-Hyjal", null, "Holy & co", null, "us"]);
    const search = compareSearch([k1, k2]);
    expect(search.startsWith("?pick=")).toBe(true);
    expect(search).not.toContain(",");
    expect(compareKeys(search, [k2, k1])).toEqual([k1, k2]);
    expect(compareSearch([])).toBe("");
  });
  test("addPick appends, never twice, never past five", () => {
    expect(addPick(["a"], "b")).toEqual(["a", "b"]);
    expect(addPick(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(addPick(["a", "b", "c", "d", "e"], "f")).toEqual(["a", "b", "c", "d", "e"]);
  });
  test("pickMenu leaves out the selected entries, newest first", () => {
    const item = (key: string, fetchedAt: number, score: number | null): HistoryItem => ({
      key, label: `${key}-Hyjal`, charClass: 7, spec: null, targetLevel: 18, targetAutoDetected: false, verdict: null, score, fetchedAt,
      request: { character: `${key}-Hyjal`, level: null, spec: null, metric: null, region: "eu" },
    });
    const items = [item("a", 10, 77.4), item("b", 30, null), item("c", 20, 60)];
    expect(pickMenu(tEn, items, ["c"])).toEqual([
      { value: "b", label: "b-Hyjal", hint: "+18", on: false },
      { value: "a", label: "a-Hyjal", hint: "+18 · 77", on: false },
    ]);
    expect(pickMenu(tFr, items, ["a", "b"])).toEqual([{ value: "c", label: "c-Hyjal", hint: "+18 · 60", on: false }]);
  });
  test("the picker's FR hint", () => {
    expect(tFr("compare.pick.hint")).toBe("À partir de trois candidats, la vue devient un classement");
    expect(tFr("compare.pick.addFull", { max: MAX_COMPARE })).toBe("+ Ajouter (5 max)");
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
