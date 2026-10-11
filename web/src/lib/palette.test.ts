import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import type { HistoryItem, MyCharacter } from "../types.ts";
import { moveIndex, paletteSections, rowAt, type PaletteSources } from "./palette.ts";
import { suggestionsOf } from "./suggest.ts";

const tFr = makeT(fr, "fr");
const mine = (name: string, realm: string, region: MyCharacter["region"] = "eu"): MyCharacter => ({ name, realm, region, source: "bnet" });
const item = (key: string, character: string, charClass: number, spec: string | null, verdict: HistoryItem["verdict"] = "invite", score: number | null = 70) =>
  ({ key, label: character, charClass, spec, verdict, score, request: { character, level: null, spec: null, metric: null, region: "eu" } }) as unknown as HistoryItem;

function sources(characters: MyCharacter[], history: HistoryItem[]): PaletteSources {
  return { suggestions: suggestionsOf(characters, history, []), mine: characters, history, region: "eu" };
}

const history = [
  item("h1", "Vachaman-Ysondre", 9, "Elemental", "invite", 76.6),
  item("h2", "Obye-Hyjal", 12, "Havoc", "maybe", 59),
  item("h3", "Biwaasham-Hyjal", 9, "Restoration", null, null),
  item("h4", "Vachaman-Ysondre", 9, "Elemental", "pass", 30), // older tab of the same character
  item("h5", "Danilaskuf-Silvermoon", 1, "Blood"),
  item("h6", "Moadmoad-Kazzak", 7, "Holy"),
  item("h7", "Circe-Hyjal", 8, null),
];
const characters = [mine("Biwaasham", "hyjal"), mine("Biwaarlock", "nerzhul"), ...["a", "b", "c", "d", "e"].map((n) => mine(`Alt${n}`, "hyjal"))];

describe("paletteSections, empty query", () => {
  const sections = paletteSections(tEn, "  ", sources(characters, history));
  test("recent characters, My characters, actions", () => {
    expect(sections.map((s) => s.title)).toEqual(["Recent characters", "My characters", "Actions"]);
  });
  test("recent: history newest first, one row per character, 5 at most, verdict and score as the hint", () => {
    const [recent] = sections;
    expect(recent!.rows.map((r) => r.label)).toEqual(["Vachaman", "Obye", "Biwaasham", "Danilaskuf", "Moadmoad"]);
    expect(recent!.rows[0]).toMatchObject({ hint: "INVITE 77", verdict: "invite", classId: 9, detail: "Ysondre (EU) · Elemental Shaman", action: { kind: "open", historyKey: "h1" } });
    expect(recent!.rows[2]).toMatchObject({ hint: "Open · 0 pts", verdict: null });
  });
  test("My characters: 5 at most, the main first and marked, open when in history else look up", () => {
    const rows = sections[1]!.rows;
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ label: "Biwaasham", detail: "main · Hyjal (EU)", hint: "Open · 0 pts", classId: 9, action: { kind: "open", historyKey: "h3" } });
    expect(rows[1]).toMatchObject({ label: "Biwaarlock", detail: "Nerzhul (EU)", hint: "Look up", action: { kind: "lookup", fill: "Biwaarlock-Nerzhul", region: "eu" } });
  });
  test("actions go to Compare, Live, Help, My characters", () => {
    expect(sections[2]!.rows.map((r) => r.action)).toEqual([
      { kind: "go", href: "/compare" }, { kind: "go", href: "/live" }, { kind: "go", href: "/help" }, { kind: "go", href: "/me" },
    ]);
  });
  test("nothing known: only the actions", () => {
    expect(paletteSections(tEn, "", sources([], [])).map((s) => s.title)).toEqual(["Actions"]);
  });
  test("in French", () => {
    const fr = paletteSections(tFr, "", sources(characters, history));
    expect(fr.map((s) => s.title)).toEqual(["Personnages récents", "Mes persos", "Actions"]);
    expect(fr[1]!.rows[0]!.detail).toBe("principal · Hyjal (EU)");
    expect(fr[2]!.rows[2]!.label).toBe("Aide : comment le verdict est calculé");
  });
});

describe("paletteSections, typed", () => {
  test("results in the suggestions' order (My characters, then history), open or look up", () => {
    const s = sources([mine("Biwaarlock", "nerzhul")], [item("h1", "Biwaasham-Hyjal", 9, null)]);
    const [results] = paletteSections(tEn, "biwa", s);
    expect(results!.title).toBe("Results");
    expect(results!.rows.map((r) => [r.label, r.hint, r.action.kind])).toEqual([
      ["Biwaarlock", "Look up", "lookup"],
      ["Biwaasham", "Open · 0 pts", "open"],
    ]);
  });
  test("a free Name-Realm nobody knows: one look-up row in the chip's region", () => {
    const sections = paletteSections(tEn, "Newguy-Tarren Mill", { ...sources([], history), region: "us" });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.rows).toEqual([{
      id: "result:us|tarren-mill|newguy", label: "Newguy", detail: "Tarren Mill (US)", hint: "Look up", verdict: null, classId: null,
      action: { kind: "lookup", fill: "Newguy-Tarren Mill", region: "us" },
    }]);
  });
  test("the full Name-Realm of a known character opens it", () => {
    const [results] = paletteSections(tEn, "Obye-Hyjal", sources([], history));
    expect(results!.rows.map((r) => r.action)).toEqual([{ kind: "open", historyKey: "h2" }]);
  });
  test("a Raider.IO link: a look-up row in the link's region", () => {
    const [results] = paletteSections(tEn, "https://raider.io/characters/kr/azshara/Somebody", sources([], history));
    expect(results!.rows[0]).toMatchObject({ label: "Somebody", detail: "Azshara (KR)", action: { kind: "lookup", fill: "Somebody-Azshara", region: "kr" } });
  });
  test("actions whose label starts with the query are appended; nothing at all gives no section", () => {
    const sections = paletteSections(tEn, "comp", sources([], history));
    expect(sections.map((s) => s.title)).toEqual(["Actions"]);
    expect(sections[0]!.rows.map((r) => r.action)).toEqual([{ kind: "go", href: "/compare" }]);
    expect(paletteSections(tEn, "zz", sources([], history))).toEqual([]);
  });
});

describe("moveIndex / rowAt", () => {
  const sections = paletteSections(tEn, "", sources([mine("Biwaarlock", "nerzhul")], history.slice(0, 2)));
  // 2 recent + 1 mine + 4 actions = 7 rows
  test("wraps both ways across sections", () => {
    expect(moveIndex(sections, 0, 1)).toBe(1);
    expect(moveIndex(sections, 1, 1)).toBe(2);
    expect(moveIndex(sections, 6, 1)).toBe(0);
    expect(moveIndex(sections, 0, -1)).toBe(6);
    expect(moveIndex([], 0, 1)).toBe(0);
  });
  test("rowAt walks the sections; out of range is null", () => {
    expect(rowAt(sections, 0)!.label).toBe("Vachaman");
    expect(rowAt(sections, 2)!.label).toBe("Biwaarlock");
    expect(rowAt(sections, 3)!.action).toEqual({ kind: "go", href: "/compare" });
    expect(rowAt(sections, 7)).toBeNull();
    expect(rowAt(sections, -1)).toBeNull();
  });
});
