import { describe, expect, test } from "bun:test";
import type { HistoryItem, KnownCharacter, MyCharacter } from "../types.ts";
import { SUGGEST_MAX, classLine, ghostOf, matchSuggestions, suggestionsOf, typedNameLength } from "./suggest.ts";

const mine = (name: string, realm: string, region: MyCharacter["region"] = "eu"): MyCharacter => ({ name, realm, region, source: "bnet" });
const item = (key: string, character: string, charClass: number, spec: string | null, region: MyCharacter["region"] = "eu") =>
  ({ key, label: character, charClass, spec, request: { character, level: null, spec: null, metric: null, region } }) as unknown as HistoryItem;
const known = (name: string, realm: string, over: Partial<KnownCharacter> = {}): KnownCharacter =>
  ({ region: "eu", realm, name, displayName: null, displayRealm: null, className: null, spec: null, seenAt: 1, ...over });

describe("suggestionsOf", () => {
  test("My characters first, then history newest first, then the cache; one row per character", () => {
    const list = suggestionsOf(
      [mine("Muleyoxo", "silvermoon")],
      [item("h1", "Muleyfrost-Silvermoon", 4, "Frost"), item("h2", "muleyoxo-silvermoon", 7, "Holy"), item("h3", "Muleyfrost-Silvermoon", 4, "Fire")],
      [known("mulanshi", "ysondre", { displayName: "Mulanshi", className: "Monk", spec: "Mistweaver" }), known("muleyoxo", "silvermoon")],
    );
    expect(list.map((s) => [s.fill, s.historyKey, s.charClass, s.spec])).toEqual([
      ["Muleyoxo-Silvermoon", "h2", 7, "Holy"],
      ["Muleyfrost-Silvermoon", "h1", 4, "Frost"],
      ["Mulanshi-Ysondre", null, 5, "Mistweaver"],
    ]);
  });
  test("a hyphenated realm fills with its spaces; Raider.IO's spelling of the realm wins", () => {
    const [a, b] = suggestionsOf([mine("Brewbrew", "tarren-mill")], [item("h1", "noshiidk-kelthuzad", 1, "Blood")],
      [known("noshiidk", "kelthuzad", { displayRealm: "Kel'Thuzad" })]);
    expect(a).toMatchObject({ name: "Brewbrew", realm: "Tarren Mill", fill: "Brewbrew-Tarren Mill", charClass: null, historyKey: null });
    expect(b).toMatchObject({ name: "Noshiidk", realm: "Kel'Thuzad", fill: "Noshiidk-Kel'Thuzad", historyKey: "h1" });
  });
  test("a character without a history tab takes its class from the cache; regions stay apart", () => {
    const list = suggestionsOf([mine("Mulgrim", "kazzak")], [], [
      known("mulgrim", "kazzak", { className: "Death Knight", spec: "Unholy" }),
      known("mulgrim", "kazzak", { region: "us" }),
      known("mulgrim", "kazzak", { region: "xx" }),
    ]);
    expect(list.map((s) => [s.region, s.charClass])).toEqual([["eu", 1], ["us", null]]);
  });
});

describe("matchSuggestions", () => {
  const all = suggestionsOf([], [], [
    known("muleyoxo", "silvermoon"), known("muleyfrost", "tarren-mill"), known("mulgrim", "kazzak"), known("élan", "hyjal"), known("muleyoxo", "tarren-mill"),
  ]);
  const fills = (typed: string) => matchSuggestions(all, typed).map((s) => s.fill);
  test("names that start with what is typed, in the list's order, whatever the case or accents", () => {
    expect(fills("mul")).toEqual(["Muleyoxo-Silvermoon", "Muleyfrost-Tarren Mill", "Mulgrim-Kazzak", "Muleyoxo-Tarren Mill"]);
    expect(fills("ELA")).toEqual(["Élan-Hyjal"]);
    expect(fills("Zzq")).toEqual([]);
  });
  test("past the first - or space, the realm narrows it, its slug or its name", () => {
    expect(fills("Muleyoxo-")).toEqual(["Muleyoxo-Silvermoon", "Muleyoxo-Tarren Mill"]);
    expect(fills("muleyoxo tarren m")).toEqual(["Muleyoxo-Tarren Mill"]);
    expect(fills("Muleyoxo-tarren-")).toEqual(["Muleyoxo-Tarren Mill"]);
  });
  test("no list for one letter, a Raider.IO link, or a full Name-Realm of one of them", () => {
    expect(fills("m")).toEqual([]);
    expect(fills("https://raider.io/characters/eu/silvermoon/Muleyoxo")).toEqual([]);
    expect(fills("muleyoxo-silvermoon")).toEqual([]);
    expect(fills("Muleyoxo-Tarren Mill")).toEqual([]);
  });
  test("at most SUGGEST_MAX rows", () => {
    const many = suggestionsOf([], [], Array.from({ length: 12 }, (_, i) => known(`mul${"abcdefghijkl"[i]}`, "hyjal")));
    expect(matchSuggestions(many, "mul")).toHaveLength(SUGGEST_MAX);
  });
});

describe("ghostOf and classLine", () => {
  const [s] = suggestionsOf([], [item("h1", "Muleyoxo-Silvermoon", 3, "BeastMastery")], []);
  test("the rest of the highlighted row's fill, when it extends what is typed", () => {
    expect(ghostOf("mul", s)).toBe("eyoxo-Silvermoon");
    expect(ghostOf("Muleyoxo-Sil", s)).toBe("vermoon");
    expect(ghostOf("Muleyoxo-Silvermoon", s)).toBeNull();
    expect(ghostOf("muleyoxo tar", s)).toBeNull();
    expect(ghostOf("mul", undefined)).toBeNull();
  });
  test("the bold part of a row's name is the typed name, without the realm", () => {
    expect(typedNameLength(" Mul")).toBe(3);
    expect(typedNameLength("Muleyoxo-Sil")).toBe(8);
    expect(typedNameLength("muleyoxo tar")).toBe(8);
  });
  test("spec and class, the class alone, or nothing", () => {
    expect(classLine(s!)).toBe("Beast Mastery Hunter");
    expect(classLine({ ...s!, spec: null })).toBe("Hunter");
    expect(classLine({ ...s!, charClass: null })).toBe("");
  });
});
