import { describe, expect, test } from "bun:test";
import type { HistoryItem, MyCharacter, SeasonView } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { addCharacter, historyKeyFor, lookupQuery, mainPillars, makeMain, mineRequest, parseEntry, removeAt, rowCells, seasonLine, slugOf } from "./me.ts";

const tFr = makeT(fr, "fr");
const c = (name: string, realm = "silvermoon", region: MyCharacter["region"] = "eu"): MyCharacter => ({ name, realm, region, source: "manual" });

describe("slugOf (same output as src/util.ts realmToSlug, values captured 2026-10-09)", () => {
  test("samples", () => {
    expect(["Silvermoon", "Kel'Thuzad", "Aggra (Português)", "Argent Dawn", "Гордунни", "ArgentDawn", "Pozzo dell'Eternità"].map(slugOf))
      .toEqual(["silvermoon", "kelthuzad", "aggra-portugues", "argent-dawn", "гордунни", "argent-dawn", "pozzo-delleternita"]);
  });
});

describe("parseEntry", () => {
  test("Name-Realm with the region chip, or a Raider.IO URL with its own region", () => {
    expect(parseEntry("muleyoxo-Silvermoon", "eu")).toEqual(c("Muleyoxo"));
    expect(parseEntry("Noshiidk-Argent Dawn", "us")).toEqual(c("Noshiidk", "argent-dawn", "us"));
    expect(parseEntry("https://raider.io/characters/eu/draenor/Noshiidk", "us")).toEqual(c("Noshiidk", "draenor", "eu"));
    expect(parseEntry("nope", "eu")).toBeNull();
    expect(parseEntry("A1-Silvermoon", "eu")).toBeNull();
  });
});

describe("list edits", () => {
  test("add: duplicate, full, ok; make main; remove", () => {
    expect(addCharacter([c("Muleyoxo")], c("muleyoxo"))).toEqual({ ok: false, error: "duplicate" });
    expect(addCharacter(["Aa", "Bb", "Cc", "Dd", "Ee"].map((n) => c(n)), c("Ff"))).toEqual({ ok: false, error: "full" });
    expect(addCharacter([c("Aa")], c("Bb"))).toEqual({ ok: true, list: [c("Aa"), c("Bb")] });
    expect(makeMain([c("Aa"), c("Bb"), c("Cc")], 2)).toEqual([c("Cc"), c("Aa"), c("Bb")]);
    expect(removeAt([c("Aa"), c("Bb")], 0)).toEqual([c("Bb")]);
  });
});

describe("history", () => {
  const item = (key: string, character: string, region: MyCharacter["region"] = "eu") =>
    ({ key, label: character, request: { character, level: null, spec: null, metric: null, region } }) as unknown as HistoryItem;
  test("the most recent matching tab, by Name-Realm or Raider.IO URL, region included", () => {
    const items = [item("k1", "Other-Hyjal"), item("k2", "https://raider.io/characters/eu/argent-dawn/Noshiidk"), item("k3", "noshiidk-Argent Dawn")];
    expect(historyKeyFor(items, c("Noshiidk", "argent-dawn"))).toBe("k2");
    expect(historyKeyFor(items, c("Noshiidk", "argent-dawn", "us"))).toBeNull();
    expect(lookupQuery(c("Noshiidk", "argent-dawn"))).toBe("https://raider.io/characters/eu/argent-dawn/Noshiidk");
  });
});

describe("season figures", () => {
  const season = {
    checkedAt: 0, state: { runs: 142, analysed: 24, pending: 118, controlOnly: 0, failed: 0, estimate: 1200 },
    recent: { runs: 38, global: 60, pillars: [{ key: "damage", score: 68, evidence: [] }, { key: "survival", score: 41, evidence: [] }] },
    season: null,
    trends: [{ key: "damage", delta: 6, direction: "up", recentRuns: 5, weekly: [] }],
  } as unknown as SeasonView;
  test("season line", () => {
    expect(seasonLine(tEn, season, 2 * 3_600_000)).toBe("142 runs this season · 118 not analysed · checked 2h ago");
    expect(seasonLine(tEn, null)).toBe("No season stored yet: open or look it up once");
    expect(seasonLine(tFr, { ...season, state: { ...season.state, pending: 0, analysed: 142 } }, 2 * 3_600_000)).toContain("tous analysés");
  });
  test("pillars of the main card and cells of a row", () => {
    expect(mainPillars(tEn, season).slice(0, 2).map((p) => [p.title, p.score, p.band, p.trend.text]))
      .toEqual([["Damage", "68", "mid", "↗ +6"], ["Survival", "41", "bad", "not enough runs for a trend (0 recently)"]]);
    expect(rowCells(season).map((x) => x.text)).toEqual(["68", "41", "—", "—", "—"]);
    expect(rowCells(null).every((x) => x.band === "na")).toBe(true);
  });
});

describe("mainPillars without a season", () => {
  test("no trend text in any tile", () => {
    expect(mainPillars(tEn, null).map((p) => [p.score, p.trend.text])).toEqual([["n/a", ""], ["n/a", ""], ["n/a", ""], ["n/a", ""], ["n/a", ""]]);
  });
});


describe("mineRequest", () => {
  const list: MyCharacter[] = [{ name: "Noshiidk", realm: "argent-dawn", region: "eu", source: "manual" }];
  test("a Name-Realm or a Raider.IO link of a listed character", () => {
    expect(mineRequest(list, "Noshiidk-Argent Dawn", "eu")).toBe(true);
    expect(mineRequest(list, "noshiidk-ArgentDawn", "eu")).toBe(true);
    expect(mineRequest(list, "https://raider.io/characters/eu/argent-dawn/Noshiidk", "us")).toBe(true);
  });
  test("anyone else, another region, or nothing parseable", () => {
    expect(mineRequest(list, "Other-Argent Dawn", "eu")).toBe(false);
    expect(mineRequest(list, "Noshiidk-Argent Dawn", "us")).toBe(false);
    expect(mineRequest(list, "Noshiidk", "eu")).toBe(false);
    expect(mineRequest([], "Noshiidk-Argent Dawn", "eu")).toBe(false);
  });
});
