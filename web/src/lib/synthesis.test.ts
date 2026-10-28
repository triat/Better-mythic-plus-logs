import { describe, expect, test } from "bun:test";
import type { AxisScore, DocsResponse, Evaluation } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { scoreBand, sourceTitleOf, synthesisDocs, synthesisView } from "./synthesis.ts";
import type { SynthesisDocs } from "./synthesis.ts";

const tFr = makeT(fr, "fr");

const TITLES: Record<string, string> = {
  "preparation.ilvlVsLevel": "Item level vs cible",
  "utility.kicksVsPeers": "Kicks vs pairs", "utility.dispels": "Dispels",
  "throughput.parseAtTarget": "Parse à la cible", "throughput.medianParse": "Parse médian",
  "survival.avoidableVsPeers": "Dégâts évitables vs pairs", "survival.individualDeaths": "Morts individuelles", "survival.wipeDeaths": "Morts en wipe",
  "consistency.deathsSpread": "Écart de morts", "consistency.damageSpread": "Écart de dégâts vs pairs",
};
const docs: SynthesisDocs = {
  titleOf: (s) => TITLES[s] ?? s,
  axisWeights: {
    dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 },
    healer: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 },
    tank: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 },
  },
  verdict: { invite: 70, maybe: 30, minRuns: 3 },
  confidence: { high: 10 },
};

const axis = (key: string, score: number | null, evidence: [string, number, number][]): AxisScore =>
  ({ key, score, confidence: "high", evidence: evidence.map(([source, delta, value]) => ({ source, delta, value, label: source })) } as AxisScore);

// The mockup's Obye (F-Synthese): MAYBE 59 for a +11.
const obye = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 11, global: 59, verdict: "maybe", runsUsed: 8, analyzedRuns: 0, configVersion: "x",
  axes: [
    axis("preparation", 65, [["preparation.ilvlVsLevel", 20, 16]]),
    axis("utility", 61, [["utility.kicksVsPeers", 9.2, 0], ["utility.kicksAbsolute", -3.2, 0.1], ["utility.dispels", -2, 0]]),
    axis("throughput", 56, [["throughput.parseAtTarget", 4.8, 53], ["throughput.medianParse", -1.5, 43]]),
    axis("survival", 39, [["survival.avoidableVsPeers", -10.3, 46], ["survival.individualDeaths", -9.3, 1.6], ["survival.wipeDeaths", 6.1, 0.3], ["survival.dtpsVsPeers", -2, 4]]),
    axis("consistency", 35, [["consistency.deathsSpread", -8, 2.8], ["consistency.damageSpread", -6, 111]]),
    // Saved before the Experience axis left: ignored everywhere.
    axis("experience", 74, [["experience.prevSeason", 30, 3100]]),
  ],
  drivers: [
    { source: "survival.avoidableVsPeers", impact: -10, value: 46, reference: 0, label: "" },
    { source: "survival.individualDeaths", impact: -9, value: 1.6, reference: 0.7, label: "" },
    { source: "utility.dispels", impact: -5, value: 1.3, reference: 2, label: "" },
    { source: "consistency.deathsSpread", impact: -4, value: 2.8, reference: 1.2, label: "" },
    { source: "experience.prevSeason", impact: -3, value: 0, reference: 1, label: "" },
    { source: "utility.kicksAbsolute", impact: -2, value: 0.1, reference: 0.2, label: "" },
    { source: "throughput.medianParse", impact: -1, value: 43, reference: 50, label: "" },
    { source: "survival.dtpsVsPeers", impact: -1, value: 4, reference: 1, label: "" },
    { source: "utility.kicksVsPeers", impact: 6, value: 9, reference: -2, label: "" },
    { source: "survival.wipeDeaths", impact: 3, value: 0.3, reference: 0.5, label: "" },
    { source: "preparation.ilvlVsLevel", impact: 2, value: 16, reference: 8, label: "" },
    { source: "throughput.parseAtTarget", impact: 2, value: 53, reference: 50, label: "" },
    { source: "consistency.damageSpread", impact: 1, value: 111, reference: 90, label: "" },
  ],
  nextVerdict: { verdict: "invite", threshold: 70, sources: ["survival.avoidableVsPeers", "survival.individualDeaths", "consistency.deathsSpread", "experience.prevSeason", "utility.dispels"], score: 72, reachable: true },
  ...over,
});

describe("synthesisView", () => {
  test("verdict block (French)", () => {
    const v = synthesisView(tFr, "fr", obye(), docs, 15).verdict;
    expect(v).toMatchObject({ cls: "badge-maybe", label: "MAYBE", score: "59", target: "pour une +11", title: "Verdict pour une +11", barPct: 59 });
    expect(v.thresholds).toEqual([{ label: "MAYBE 30", at: 30 }, { label: "INVITE 70", at: 70 }]);
    expect(v.summary).toBe("Porté par kicks vs pairs et morts en wipe, mais freiné par dégâts évitables vs pairs et morts individuelles.");
    expect(v.confidence).toBe("8 runs notés sur 15 indexés. Peu de runs : le verdict peut bouger vite.");
  });
  test("strengths and weaknesses: the drivers in badge points vs the average player, counted axes only, capped at 4 and 5", () => {
    const s = synthesisView(tFr, "fr", obye(), docs, 15);
    expect(s.pros.map((p) => [p.name, p.pts, p.axis, p.widthPct])).toEqual([
      ["Kicks vs pairs", "+6", "Utilité", 60],
      ["Morts en wipe", "+3", "Survie", 30],
      ["Item level vs cible", "+2", "Préparation", 20],
      ["Parse à la cible", "+2", "Throughput", 20],
    ]);
    expect(s.cons.map((c) => c.pts)).toEqual(["−10", "−9", "−5", "−2", "−1"]);
    // The evidence line, then the average player's value: what the points are measured against.
    expect([s.cons[0]!.detail, s.cons[0]!.avg]).toEqual(["dégâts évitables +46\u202f% vs le groupe", "moy. +0 %"]);
    expect(s.cons[1]).toMatchObject({ name: "Morts individuelles", axis: "Survie", detail: "1,6 mort(s) hors wipe / run", avg: "moy. 0,7", widthPct: 90 });
    expect(s.cons[1]!.hint).toBe("Ses morts quand le groupe n'a pas wipe, par run, pondérées par le niveau de la clé.");
    // Régularité (weight 0) and the legacy Experience axis never show up as a strength or a weakness.
    const names = [...s.pros, ...s.cons].map((r) => r.name);
    expect(names).not.toContain("Écart de morts");
    expect(names).not.toContain("Écart de dégâts vs pairs");
    expect(names).not.toContain("experience.prevSeason");
    expect(s.cons.some((c) => c.name === "survival.dtpsVsPeers")).toBe(false); // sixth cost, past the cap
    // A signal as good as the average player's has no driver, so it is neither, whatever its score against 50.
    const flat = synthesisView(tFr, "fr", obye({ drivers: [] }), docs, 15);
    expect([flat.pros, flat.cons]).toEqual([[], []]);
  });
  test("what would flip it: the path without weight-0 or unknown axes", () => {
    const f = synthesisView(tFr, "fr", obye(), docs, 15).flip!;
    expect(f.title).toBe("Pour passer INVITE : +11 pts");
    expect(f.reachable).toBe(true);
    expect(f.note).toBeNull();
    expect(f.rows).toEqual([
      { name: "Dégâts évitables vs pairs", hint: "Dégâts pris sur les mécaniques évitables, comparés aux autres joueurs du même run.", gain: "Survie, jusqu'à +10", gap: "+46 % vs le groupe aujourd'hui · moy. +0 %" },
      { name: "Morts individuelles", hint: "Ses morts quand le groupe n'a pas wipe, par run, pondérées par le niveau de la clé.", gain: "Survie, jusqu'à +9", gap: "1,6 / run aujourd'hui · moy. 0,7" },
      { name: "Dispels", hint: "Dispels, purges, vols de sort et apaisements par run.", gain: "Utilité, jusqu'à +5", gap: "1,3 / run aujourd'hui · moy. 2,0" },
    ]);
  });
  test("out of reach: a note under the rows", () => {
    const ev = obye({ nextVerdict: { verdict: "maybe", threshold: 30, sources: ["survival.avoidableVsPeers", "survival.individualDeaths"], score: 25, reachable: false }, global: 12, verdict: "pass" });
    const f = synthesisView(tEn, "en", ev, docs, 15).flip!;
    expect(f.title).toBe("To reach MAYBE: +18 pts");
    expect(f.note).toBe("Bringing these 2 signals to the average player's level is not enough.");
    expect(f.rows[1]).toEqual({ name: "Morts individuelles", hint: "Deaths when the group did not wipe, per run, weighted by key level.", gain: "Survival, up to +9", gap: "1.6 / run today · avg 0.7" });
  });
  test("INVITE: no flip block", () => {
    const s = synthesisView(tEn, "en", obye({ global: 78, verdict: "invite", nextVerdict: null, runsUsed: 12 }), docs, 15);
    expect(s.flip).toBeNull();
    expect(s.verdict.confidence).toBe("12 runs scored out of 15 indexed");
  });
  test("not enough data: no score, no bar, no flip, the summary says so", () => {
    const ev = obye({ global: null, verdict: "insufficient", runsUsed: 2, nextVerdict: null, drivers: [] });
    const s = synthesisView(tEn, "en", ev, docs, 4);
    expect(s.verdict).toMatchObject({ score: null, barPct: null, label: "NOT ENOUGH DATA", summary: "Not enough scored runs for a verdict: 3 needed." });
    expect(s.verdict.confidence).toBe("2 runs scored out of 4 indexed");
    expect(s.flip).toBeNull();
    expect([s.pros, s.cons]).toEqual([[], []]);
    // A stray nextVerdict on an insufficient evaluation still draws no flip.
    expect(synthesisView(tEn, "en", { ...ev, nextVerdict: obye().nextVerdict }, docs, 4).flip).toBeNull();
  });
  test("informational axes: weight 0 for the role", () => {
    const s = synthesisView(tFr, "fr", obye(), docs, 15);
    expect(s.informational).toEqual([{ name: "Régularité", text: "les morts varient de ±2,8 / run · les dégâts subis vs le groupe varient de ±111\u202f%. Ne compte pas dans le score." }]);
  });
  test("axes table: AXIS_ORDER, bands, why, informational chip; Experience dropped", () => {
    const axes = synthesisView(tFr, "fr", obye(), docs, 15).axes;
    expect(axes.map((a) => [a.key, a.score, a.band, a.informational])).toEqual([
      ["survival", 39, "worse", false],
      ["utility", 61, "neutral", false],
      ["throughput", 56, "neutral", false],
      ["consistency", 35, "worse", true],
      ["preparation", 65, "neutral", false],
    ]);
    expect(axes[0]!.why).toBe("dégâts évitables +46\u202f% vs le groupe · 1,6 mort(s) hors wipe / run");
    const sparse = synthesisView(tEn, "en", obye({ axes: [axis("utility", 72, []), axis("survival", null, [])] }), docs, 15).axes;
    expect(sparse.find((a) => a.key === "utility")).toMatchObject({ band: "better", why: "no evidence" });
    expect(sparse.find((a) => a.key === "survival")).toMatchObject({ score: null, band: "neutral", why: "not enough data for this axis" });
  });
  test("summary variants", () => {
    const onlyPros = obye({ axes: [axis("utility", 80, [["utility.kicksVsPeers", 9.2, 0]])], drivers: [{ source: "utility.kicksVsPeers", impact: 4, value: 9, reference: -2, label: "" }] });
    expect(synthesisView(tEn, "en", onlyPros, docs, 15).verdict.summary).toBe("Helped by kicks vs pairs; nothing costs much.");
    const flat = obye({ axes: [], drivers: [] });
    expect(synthesisView(tEn, "en", flat, docs, 15).verdict.summary).toBe("No signal stands out.");
  });
  test("scoreBand thresholds", () => {
    expect([70, 69, 50, 49, null].map(scoreBand)).toEqual(["better", "neutral", "neutral", "worse", "neutral"]);
  });
  test("synthesisDocs names sub-signals in the UI language, then the registry title, then the source", () => {
    const d = {
      docs: { axes: { survival: { subSignals: { individualDeaths: { title: "Individual deaths" } } } } },
      config: { axisWeights: docs.axisWeights, verdict: docs.verdict, confidence: { high: 6, medium: 3, consistencyMinRuns: 5, deepdiveMinRuns: 2 } },
    } as unknown as DocsResponse;
    const s = synthesisDocs(tEn, d);
    expect(s.titleOf("survival.individualDeaths")).toBe("Deaths outside wipes");
    expect(synthesisDocs(tFr, d).titleOf("survival.individualDeaths")).toBe("Morts hors wipe");
    expect(synthesisDocs(tFr, d).titleOf("preparation.ilvlVsLevel")).toBe("Équipement pour la clé visée");
    expect(sourceTitleOf(tEn, d)("survival.unknownSignal")).toBe("survival.unknownSignal");
    const registryOnly = { docs: { axes: { survival: { subSignals: { futureSignal: { title: "Future signal" } } } } } } as unknown as DocsResponse;
    expect(sourceTitleOf(tEn, registryOnly)("survival.futureSignal")).toBe("Future signal");
    expect(sourceTitleOf(tEn, null)("utility.unknown")).toBe("utility.unknown");
    expect(s.confidence.high).toBe(6);
  });
});
