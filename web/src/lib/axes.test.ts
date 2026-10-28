import { describe, expect, test } from "bun:test";
import type { AxisScore, Evidence, EvidenceSource, LookupPayload } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { axisInfo, axisWeightLabel, evidenceText, heroStats } from "./axes.ts";

const tFr = makeT(fr, "fr");

const axis = (key: AxisScore["key"], score: number | null, evidence: AxisScore["evidence"] = [], confidence: AxisScore["confidence"] = "high"): AxisScore =>
  ({ key, score, confidence, evidence } as AxisScore);

describe("axes view model", () => {
  test("heroStats", () => {
    const payload = {
      metric: "hps",
      character: { scoreTop: { points: 3942.4, regionRank: 412, serverRank: 7, spec: "Holy", rankPercent: 99 } },
      summary: { ilvl: 322, prevSeason: { slug: "s1", all: 4153.2, best: { role: "dps", score: 4153.2 } } },
    } as unknown as LookupPayload;
    expect(heroStats(tEn, payload)).toEqual([
      { label: "HPS score", value: "3942" },
      { label: "ilvl", value: "322" },
      { label: "region", value: "#412" },
      { label: "server", value: "#7" },
      { label: "prev season", value: "4153", sub: "dps" },
    ]);
    expect(heroStats(tFr, payload).map((s) => s.label)).toEqual(["score HPS", "ilvl", "région", "serveur", "saison précédente"]);
    const bare = { metric: "dps", character: { scoreTop: null }, summary: { ilvl: null, prevSeason: null } } as unknown as LookupPayload;
    expect(heroStats(tEn, bare)).toEqual([]);
  });
  test("axisWeightLabel reproduces the callout phrasing from the live axisWeights", () => {
    const w = {
      dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 },
      healer: { survival: 3, utility: 2.5, throughput: 2, consistency: 0, preparation: 1 },
      tank: { survival: 3, utility: 2, throughput: 2, consistency: 0, preparation: 1.5 },
    };
    expect(axisWeightLabel(tEn, w, "survival")).toBe("weight 3 for every role");
    expect(axisWeightLabel(tEn, w, "utility")).toBe("weight 2 (healer 2.5)");
    expect(axisWeightLabel(tEn, w, "throughput")).toBe("weight 3 for dps, 2 for healer and tank");
    expect(axisWeightLabel(tEn, w, "consistency")).toBe("weight 0 · informational");
    expect(axisWeightLabel(tEn, w, "preparation")).toBe("weight 1 (tank 1.5)");
    const three = { ...w, healer: { ...w.healer, preparation: 2 }, tank: { ...w.tank, preparation: 3 } };
    expect(axisWeightLabel(tEn, three, "preparation")).toBe("dps 1 · healer 2 · tank 3");
    expect(axisWeightLabel(tFr, w, "utility")).toBe("poids 2 (heal 2.5)");
    expect(axisWeightLabel(tFr, w, "throughput")).toBe("poids 3 pour dps, 2 pour heal et tank");
    expect(axisWeightLabel(tFr, three, "preparation")).toBe("dps 1 · heal 2 · tank 3");
  });
  test("axisInfo pairs the registry summary with the weight label", () => {
    const docs = {
      docs: { axes: { survival: { summary: "Deaths and damage taken." }, utility: { summary: "Kicks." }, throughput: { summary: "P." }, consistency: { summary: "C." }, preparation: { summary: "Pr." } } },
      config: { axisWeights: { dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 }, healer: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 }, tank: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 } } },
    } as never;
    const info = axisInfo(tEn, docs);
    expect(info.survival).toEqual({ description: "Deaths and damage taken.", weight: "weight 3 for every role" });
  });
});

describe("evidenceText", () => {
  // The byte-identity check against real server labels (evaluate over the fixtures) and the EVIDENCE_SOURCES
  // coverage check live in test/evaluation/evidence-text.test.ts: tests under web/src import src/ types only.
  test("rounding per source, in both languages", () => {
    const line = (source: EvidenceSource, value: number, extra?: Evidence["extra"]) =>
      [tEn, tFr].map((t, i) => evidenceText(t, i === 0 ? "en" : "fr", { source, value, delta: 0, label: "", ...(extra ? { extra } : {}) }));
    expect(line("survival.individualDeaths", 0)).toEqual(["0.0 individual deaths/run", "0,0 mort(s) hors wipe / run"]);
    expect(line("survival.avoidableVsPeers", -11.4)).toEqual(["avoidable −11% vs peers", "dégâts évitables −11 % vs le groupe"]);
    expect(line("survival.dtpsVsPeers", 4.6)).toEqual(["DTPS +5% vs peers", "dégâts subis +5 % vs les DPS"]);
    expect(line("survival.defensiveUsage", 0.6, { runs: 1 })).toEqual(["majors used 60% of possible (1 run)", "gros défensifs utilisés à 60 % du possible (1 run)"]);
    expect(line("survival.defensiveUsage", 0.6, { runs: 3 })).toEqual(["majors used 60% of possible (3 runs)", "gros défensifs utilisés à 60 % du possible (3 runs)"]);
    expect(line("survival.avoidableDeaths", 2 / 3, { count: 2, total: 3 })).toEqual(["2/3 deaths with something at hand", "2/3 morts avec un outil prêt"]);
    expect(line("utility.kicksAbsolute", 0.2)).toEqual(["20% of kick capacity used", "20 % des kicks possibles utilisés"]);
    expect(line("utility.dispels", 9)).toEqual(["9.0 dispels/run", "9,0 dissipations / run"]);
    expect(line("utility.crowdControl", 12.4, { rate: 4.2 })).toEqual(["crowd control +12% vs spec median (4.2 per 10 min)", "contrôle +12 % vs le joueur moyen de la spé (4,2 / 10 min)"]);
    expect(line("throughput.medianParse", 66.6)).toEqual(["median parse 67%", "parse médian 67 %"]);
    // French percent: a narrow no-break space (U+202F) before the sign, carried by the dictionary string.
    expect(line("throughput.medianParse", 66.6)[1]).toContain("\u202f%");
    expect(line("throughput.medianParse", 66.6)[0]).not.toContain(" %");
    expect(line("consistency.deathsSpread", 1.25)).toEqual(["deaths spread ±1.3", "les morts varient de ±1,3 / run"]);
    expect(line("preparation.ilvlVsLevel", -4)).toEqual(["ilvl −4 vs players at that key", "ilvl −4 vs les joueurs de ce niveau"]);
  });
  test("an unknown source or a payload without value falls back to the server label", () => {
    expect(evidenceText(tEn, "en", { source: "survival.unknown", value: 1, delta: 0, label: "server text" })).toBe("server text");
    expect(evidenceText(tFr, "fr", { source: "survival.wipeDeaths", delta: 0, label: "0.0 deaths in wipes/run" } as Evidence)).toBe("0.0 deaths in wipes/run");
  });
});
