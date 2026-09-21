import { describe, expect, test } from "bun:test";
import type { AxisScore, Evaluation, Evidence, EvidenceSource, LookupPayload } from "../types.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../../src/evaluation/config.ts";
import { evaluate } from "../../../src/evaluation/evaluate.ts";
import { EVIDENCE_SOURCES } from "../../../src/evaluation/axes/index.ts";
import { fixturePayload } from "../../../test/evaluation/helpers.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { axisInfo, axisRows, axisWeightLabel, evidenceText, heroStats, radarPoints } from "./axes.ts";

const tFr = makeT(fr, "fr");

const axis = (key: AxisScore["key"], score: number | null, evidence: AxisScore["evidence"] = [], confidence: AxisScore["confidence"] = "high"): AxisScore =>
  ({ key, score, confidence, evidence } as AxisScore);

const ev: Evaluation = {
  role: "healer", targetLevel: 21, global: 78, verdict: "invite", runsUsed: 9, analyzedRuns: 0, configVersion: "x",
  axes: [
    axis("throughput", 88, [
      { label: "median parse 86%", delta: 27.4, source: "throughput.medianParse", value: 86.4 },
      { label: "parse 79% at target level", delta: 10.6, source: "throughput.parseAtTarget", value: 79 },
    ]),
    axis("survival", 82, [
      { label: "0.2 individual deaths/run", delta: 18, source: "survival.individualDeaths", value: 0.2 },
      { label: "avoidable +12% vs peers", delta: -6.2, source: "survival.avoidableVsPeers", value: 12.3 },
      { label: "DTPS −3% vs peers", delta: 1, source: "survival.dtpsVsPeers", value: -3 },
    ]),
    axis("consistency", null, [], "low"),
    axis("utility", 61), axis("preparation", 55), axis("experience", 74),
  ],
};

describe("axes view model", () => {
  test("rows follow AXIS_ORDER and carry top-2 evidence by |delta|", () => {
    const rows = axisRows(tEn, "en", ev);
    expect(rows.map((r) => r.key)).toEqual(["survival", "utility", "throughput", "consistency", "preparation", "experience"]);
    expect(rows.map((r) => r.label)).toEqual(["Survival", "Utility", "Throughput", "Consistency", "Preparation", "Experience"]);
    expect(rows[0]!.top).toEqual([
      { label: "0.2 individual deaths/run", delta: "+18", tone: "good", source: "survival.individualDeaths" },
      { label: "avoidable +12% vs peers", delta: "−6", tone: "bad", source: "survival.avoidableVsPeers" },
    ]);
    expect(rows[0]!.all).toHaveLength(3);
    expect(rows[0]!.all[0]!.source).toBe("survival.individualDeaths");
    expect(rows[2]!.top[0]).toEqual({ label: "median parse 86%", delta: "+27", tone: "good", source: "throughput.medianParse" });
  });
  test("null axis: no confidence, hollow note", () => {
    const c = axisRows(tEn, "en", ev)[3]!;
    expect(c.score).toBeNull();
    expect(c.confidence).toBeNull();
    expect(c.note).toBe("not enough data for this axis");
    expect(c.top).toEqual([]);
  });
  test("axis with score but no evidence notes it", () => {
    expect(axisRows(tEn, "en", ev)[1]!.note).toBe("no evidence");
  });
  test("radarPoints in AXIS_ORDER", () => {
    expect(radarPoints(ev)).toEqual([82, 61, 88, null, 55, 74]);
  });
  test("survival carries an analyzed-runs badge when deep-dive evidence exists", () => {
    const rows = axisRows(tEn, "en", { ...ev, analyzedRuns: 3 });
    expect(rows.find((r) => r.key === "survival")!.badge).toBe("3 runs analyzed");
    expect(rows.find((r) => r.key === "utility")!.badge).toBeNull();
    expect(axisRows(tEn, "en", { ...ev, analyzedRuns: 1 }).find((r) => r.key === "survival")!.badge).toBe("1 run analyzed");
    expect(axisRows(tEn, "en", ev).find((r) => r.key === "survival")!.badge).toBeNull();
  });
  test("French rows: axis names, notes, badge and evidence lines", () => {
    const rows = axisRows(tFr, "fr", { ...ev, analyzedRuns: 3 });
    expect(rows.map((r) => r.label)).toEqual(["Survie", "Utilité", "Throughput", "Régularité", "Préparation", "Expérience"]);
    expect(rows[0]!.badge).toBe("3 runs analysés");
    expect(rows[0]!.top.map((e) => e.label)).toEqual(["0,2 mort(s) individuelle(s) / run", "évitable +12 % vs pairs"]);
    expect(rows[3]!.note).toBe("pas assez de données pour cet axe");
    expect(rows[1]!.note).toBe("aucun indice");
  });
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
      dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 },
      healer: { survival: 3, utility: 2.5, throughput: 2, consistency: 0, preparation: 1, experience: 2 },
      tank: { survival: 3, utility: 2, throughput: 2, consistency: 0, preparation: 1, experience: 2.5 },
    };
    expect(axisWeightLabel(tEn, w, "survival")).toBe("weight 3 for every role");
    expect(axisWeightLabel(tEn, w, "utility")).toBe("weight 2 (healer 2.5)");
    expect(axisWeightLabel(tEn, w, "throughput")).toBe("weight 3 for dps, 2 for healer and tank");
    expect(axisWeightLabel(tEn, w, "consistency")).toBe("weight 0 · informational");
    expect(axisWeightLabel(tEn, w, "experience")).toBe("weight 2 (tank 2.5)");
    const three = { ...w, healer: { ...w.healer, preparation: 2 }, tank: { ...w.tank, preparation: 3 } };
    expect(axisWeightLabel(tEn, three, "preparation")).toBe("dps 1 · healer 2 · tank 3");
    expect(axisWeightLabel(tFr, w, "utility")).toBe("poids 2 (heal 2.5)");
    expect(axisWeightLabel(tFr, w, "throughput")).toBe("poids 3 pour dps, 2 pour heal et tank");
    expect(axisWeightLabel(tFr, three, "preparation")).toBe("dps 1 · heal 2 · tank 3");
  });
  test("axisInfo pairs the registry summary with the weight label; rows fall back to placeholders without it", () => {
    const docs = {
      docs: { axes: { survival: { summary: "Deaths and damage taken." }, utility: { summary: "Kicks." }, throughput: { summary: "P." }, consistency: { summary: "C." }, preparation: { summary: "Pr." }, experience: { summary: "E." } } },
      config: { axisWeights: { dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 }, healer: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 }, tank: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 } } },
    } as never;
    const info = axisInfo(tEn, docs);
    expect(info.survival).toEqual({ description: "Deaths and damage taken.", weight: "weight 3 for every role" });
    expect(axisRows(tEn, "en", ev, info)[0]).toMatchObject({ description: "Deaths and damage taken.", weight: "weight 3 for every role" });
    expect(axisRows(tEn, "en", ev)[0]).toMatchObject({ description: "", weight: "…" });
  });
});

describe("evidenceText", () => {
  const probe = (source: string, value = 1.25): Evidence => ({ source, value, delta: 0, label: "", extra: { runs: 2, count: 1, total: 3 } });

  test("every EVIDENCE_SOURCES entry has a message in both languages (never a bare key)", () => {
    for (const source of EVIDENCE_SOURCES) {
      for (const [t, locale] of [[tEn, "en"], [tFr, "fr"]] as const) {
        const out = evidenceText(t, locale, probe(source));
        expect(out, `${locale} ${source}`).not.toContain("evidence.");
        expect(out.length, `${locale} ${source}`).toBeGreaterThan(0);
      }
    }
  });
  test("English is byte-identical to the server label for every evidence entry of the fixture evaluations", async () => {
    const cfg = validateConfig(DEFAULT_CONFIG);
    const all = [evaluate(await fixturePayload("s1-tank", false), cfg), evaluate(await fixturePayload("s2-healer", true), cfg)]
      .flatMap((e) => e.axes.flatMap((a) => a.evidence));
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((e) => e.source)).size).toBeGreaterThan(15);
    for (const e of all) expect(evidenceText(tEn, "en", e), e.source).toBe(e.label);
  });
  test("rounding per source, in both languages", () => {
    const line = (source: EvidenceSource, value: number, extra?: Evidence["extra"]) =>
      [tEn, tFr].map((t, i) => evidenceText(t, i === 0 ? "en" : "fr", { source, value, delta: 0, label: "", ...(extra ? { extra } : {}) }));
    expect(line("survival.individualDeaths", 0)).toEqual(["0.0 individual deaths/run", "0,0 mort(s) individuelle(s) / run"]);
    expect(line("survival.avoidableVsPeers", -11.4)).toEqual(["avoidable −11% vs peers", "évitable −11 % vs pairs"]);
    expect(line("survival.dtpsVsPeers", 4.6)).toEqual(["DTPS +5% vs peers", "DTPS +5 % vs pairs"]);
    expect(line("survival.defensiveUsage", 0.6, { runs: 1 })).toEqual(["majors used 60% of possible (1 run)", "majors utilisés à 60 % du possible (1 run)"]);
    expect(line("survival.defensiveUsage", 0.6, { runs: 3 })).toEqual(["majors used 60% of possible (3 runs)", "majors utilisés à 60 % du possible (3 runs)"]);
    expect(line("survival.avoidableDeaths", 2 / 3, { count: 2, total: 3 })).toEqual(["2/3 deaths with a defensive available", "2/3 morts avec un defensive dispo"]);
    expect(line("utility.kicksAbsolute", 0.2)).toEqual(["20% of kick capacity used", "20 % de la capacité de kick utilisée"]);
    expect(line("utility.dispels", 9)).toEqual(["9.0 dispels/run", "9,0 dispels / run"]);
    expect(line("throughput.medianParse", 66.6)).toEqual(["median parse 67%", "parse médian 67 %"]);
    expect(line("consistency.deathsSpread", 1.25)).toEqual(["deaths spread ±1.3", "écart de morts ±1,3"]);
    expect(line("preparation.ilvlVsLevel", -4)).toEqual(["ilvl −4 vs expected", "ilvl −4 vs attendu"]);
    expect(line("experience.coverage", 1)).toEqual(["100% dungeons covered", "100 % des donjons couverts"]);
    expect(line("experience.medianVsTarget", 0)).toEqual(["median key +0 vs target", "key médiane +0 vs cible"]);
    expect(line("experience.activity", 10)).toEqual(["10 runs in last 7 days", "10 runs sur les 7 derniers jours"]);
    expect(line("experience.prevSeasonBonus", 4152.7)).toEqual(["previous season 4153", "saison précédente 4153"]);
  });
  test("an unknown source or a payload without value falls back to the server label", () => {
    expect(evidenceText(tEn, "en", { source: "survival.unknown", value: 1, delta: 0, label: "server text" })).toBe("server text");
    expect(evidenceText(tFr, "fr", { source: "survival.wipeDeaths", delta: 0, label: "0.0 deaths in wipes/run" } as Evidence)).toBe("0.0 deaths in wipes/run");
  });
});
