import { describe, expect, test } from "bun:test";
import type { LookupPayload } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { tiles } from "./tiles.ts";

const tFr = makeT(fr, "fr");

const payload = (summary: Partial<LookupPayload["summary"]>, perDungeon: Partial<LookupPayload["perDungeon"]> = {}): LookupPayload =>
  ({
    metric: "hps",
    perDungeon: { runs: [{}], medianAmount: 312_400, medianParse: 86.4, ...perDungeon },
    summary: {
      runsWithSignals: 9, timedShown: 9, avgDeaths: 0.7, deathsInWipes: 2, dtpsDeltaPct: -12.3, kicksDeltaPts: null,
      avoidableDeltaPct: 12, ilvl: 322, recentTimed: 9, recentTotal: 10, prevSeason: { slug: "s1", all: 4153, best: { role: "dps", score: 4153 } },
      ...summary,
    },
  }) as unknown as LookupPayload;

describe("tiles", () => {
  test("full payload", () => {
    expect(tiles(tEn, payload({}))).toEqual([
      { label: "Median HPS", value: "312.4k", cls: "", empty: false },
      { label: "Median parse", value: "86.4%", cls: "tier-magenta", empty: false },
      { label: "Timed (shown)", value: "9/9", cls: "tone-good", empty: false },
      { label: "Avg deaths", value: "0.7", cls: "tone-warn", sub: "2 in wipes", empty: false },
      { label: "Δ DTPS vs peers", value: "−12%", cls: "tone-good", empty: false },
      { label: "Avoidable vs peers", value: "+12%", cls: "tone-warn", empty: false },
      { label: "Kicks vs peers", value: "—", cls: "", empty: true },
      { label: "ilvl", value: "322", cls: "", empty: false },
      { label: "RIO recent timed", value: "9/10", cls: "tone-good", empty: false },
      { label: "Prev season", value: "4153", cls: "", sub: "dps", empty: false },
    ]);
  });
  test("absences", () => {
    const t = tiles(tEn, payload({ timedShown: 6, avgDeaths: 0, deathsInWipes: 0, dtpsDeltaPct: null, kicksDeltaPts: 4.2, ilvl: null, recentTimed: 4, recentTotal: 10, prevSeason: null }, { runs: [] }));
    expect(t.find((x) => x.label === "Median HPS")).toBeUndefined();
    expect(t.find((x) => x.label === "Timed (shown)")).toEqual({ label: "Timed (shown)", value: "6/9", cls: "tone-warn", empty: false });
    expect(t.find((x) => x.label === "Avg deaths")).toEqual({ label: "Avg deaths", value: "0.0", cls: "tone-good", empty: false });
    expect(t.find((x) => x.label === "Kicks vs peers")).toEqual({ label: "Kicks vs peers", value: "+4pts", cls: "tone-good", empty: false });
    expect(t.find((x) => x.label === "RIO recent timed")!.cls).toBe("tone-bad");
    expect(t.find((x) => x.label === "Prev season")).toEqual({ label: "Prev season", value: "— no data (reroll?)", cls: "", empty: true });
    // Raider.IO reports fractional equipped item levels.
    expect(tiles(tEn, payload({ ilvl: 322.875 })).find((x) => x.label === "ilvl")!.value).toBe("323");
    const none = tiles(tEn, payload({ runsWithSignals: 0, timedShown: null, avgDeaths: null, recentTotal: 0, recentTimed: 0 }, { runs: [] }));
    expect(none.find((x) => x.label === "Timed (shown)")!.empty).toBe(true);
    expect(none.find((x) => x.label === "RIO recent timed")).toEqual({ label: "RIO recent timed", value: "0/0", cls: "", empty: false });
  });
  test("French labels; values stay as they are", () => {
    const t = tiles(tFr, payload({ prevSeason: { slug: "s1", all: 4153, best: { role: "healer", score: 4153 } } }));
    expect(t.map((x) => x.label)).toEqual(["HPS médian", "Parse médian", "Timed (affichés)", "Morts moy.", "Δ DTPS vs pairs", "Évitable vs pairs", "Kicks vs pairs", "ilvl", "RIO récents timed", "Saison préc."]);
    expect(t[3]).toEqual({ label: "Morts moy.", value: "0.7", cls: "tone-warn", sub: "2 en wipe", empty: false });
    expect(t[9]).toEqual({ label: "Saison préc.", value: "4153", cls: "", sub: "heal", empty: false });
    expect(tiles(tFr, payload({ prevSeason: null }))[9]!.value).toBe("— pas de données (reroll ?)");
  });
});
