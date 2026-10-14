import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../../src/evaluation/config.ts";
import { globalScore } from "../../../src/evaluation/global.ts";
import { docsResponse } from "../../../src/server/routes-shared.ts";
import type { AxisScore, Evaluation } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { curveGeometry, methodView, rawScore } from "./method.ts";

const tFr = makeT(fr, "fr");
const docsFr = docsResponse(DEFAULT_CONFIG, false, null, "fr");
const docsEn = docsResponse(DEFAULT_CONFIG, false, null, "en");

type Ev = [source: string, delta: number, value: number, weight?: number];
const axis = (key: string, score: number | null, evidence: Ev[]): AxisScore =>
  ({ key, score, confidence: "high", evidence: evidence.map(([source, delta, value, weight]) => ({ source, delta, value, label: source, ...(weight !== undefined ? { weight } : {}) })) } as AxisScore);

// The mockup's Vachâman (F-Methode): INVITE 77, raw 78.0 for a DPS.
const vachaman = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 19, global: 77, verdict: "invite", runsUsed: 9, analyzedRuns: 1, configVersion: "x",
  axes: [
    axis("survival", 90, [
      ["survival.individualDeaths", 16, 0.6, 3], ["survival.avoidableVsPeers", 14, -40, 2],
      ["survival.wipeDeaths", 7, 0, 1], ["survival.dtpsVsPeers", 3, -2, 1],
    ]),
    axis("utility", 74, [["utility.kicksVsPeers", 12, 4, 3], ["utility.kicksAbsolute", 8, 0.36, 1]]),
    axis("throughput", 68, [["throughput.medianParse", 10, 59, 3], ["throughput.parseAtTarget", 8, 61, 2]]),
    axis("consistency", 58, [["consistency.deathsSpread", 6, 1, 2], ["consistency.parseSpread", 5, 19, 2]]),
    axis("preparation", 80, [["preparation.potions", 17, 5, 2], ["preparation.ilvlVsLevel", 15, 5, 2], ["preparation.healthstones", -2, 0, 1], ["preparation.unknown", 0, 1]]),
    // Saved before the Experience axis left: ignored everywhere.
    axis("experience", 74, [["experience.prevSeason", 30, 3100]]),
  ],
  ...over,
});

describe("rawScore", () => {
  test("is src/evaluation/global.ts's globalScore", () => {
    const ev = vachaman();
    const known = ev.axes.filter((a) => (a.key as string) !== "experience");
    expect(rawScore(known, DEFAULT_CONFIG.axisWeights.dps)).toBe(globalScore(known, "dps", DEFAULT_CONFIG)!);
    expect(globalScore(known, "dps", DEFAULT_CONFIG)!).toBeCloseTo(78, 6);
    const healer = known.map((a) => (a.key === "utility" ? { ...a, score: null } : a));
    expect(rawScore(healer, DEFAULT_CONFIG.axisWeights.healer)).toBe(globalScore(healer, "healer", DEFAULT_CONFIG)!);
    expect(rawScore([], DEFAULT_CONFIG.axisWeights.dps)).toBeNull();
  });
});

describe("methodView", () => {
  test("null until the docs load", () => {
    expect(methodView(tEn, "en", vachaman(), null)).toBeNull();
  });

  test("path, raw and final (French)", () => {
    const m = methodView(tFr, "fr", vachaman(), docsFr)!;
    expect(m.title).toBe("Comment on arrive à INVITE 77");
    expect(m.path).toEqual([
      { label: "1 · Runs", value: "9", sub: "runs notés en +19, le meilleur par donjon" },
      { label: "2 · Signaux", value: "12", sub: "chacun noté 0–100 par une courbe" },
      { label: "3 · Axes", value: "4 + 1", sub: "4 comptés, Régularité informative" },
      { label: "4 · Brut", value: "78,0", sub: "axes pondérés pour un DPS" },
      { label: "5 · Verdict", value: "77", sub: "rang parmi les DPS de référence" },
    ]);
    expect(m.raw).toBe("78,0");
    expect(m.final).toBe("77");
    expect(m.waterfallCaption).toBe("Ce que chaque axe apporte au score brut (DPS : Survie ×3, Utilité ×2, Throughput ×3, Préparation ×1)");
  });

  test("waterfall: counted axes only, the parts sum to the raw score", () => {
    const m = methodView(tEn, "en", vachaman(), docsEn)!;
    expect(m.waterfall.map((w) => [w.key, w.label])).toEqual([
      ["survival", "Survival"], ["utility", "Utility"], ["throughput", "Throughput"], ["preparation", "Preparation"],
    ]);
    expect(m.waterfall.map((w) => Math.round(w.pct * 10) / 10)).toEqual([30, 16.4, 22.7, 8.9]);
    const sum = m.waterfall.reduce((n, w) => n + w.pct, 0);
    const known = vachaman().axes.filter((a) => (a.key as string) !== "experience");
    expect(sum).toBeCloseTo(globalScore(known, "dps", DEFAULT_CONFIG)!, 9);
    expect(m.waterfall.some((w) => w.key === "consistency")).toBe(false);
  });

  test("axis cards: heaviest first, the informational axis last with its card", () => {
    const m = methodView(tFr, "fr", vachaman(), docsFr)!;
    expect(m.axes.map((a) => [a.name, a.weightLabel, a.score, a.band, a.informational])).toEqual([
      ["Survie", "poids 3", "90", "better", false],
      ["Throughput", "poids 3", "68", "neutral", false],
      ["Utilité", "poids 2", "74", "better", false],
      ["Préparation", "poids 1", "80", "better", false],
      ["Régularité", "informatif · poids 0", "58", "neutral", true],
    ]);
    expect(m.axes[0]!.confidence).toBe("confiance haute · 9 runs");
    expect(m.axes[4]!.note).toBe("Montré pour lire le profil, sans effet sur le verdict.");
    expect(m.axes[0]!.note).toBe("Les signaux du deep-dive (utilisation des défensifs et morts avec un outil prêt) comptent dès 2 runs analysés : 1 pour l'instant.");
    expect(m.axes[1]!.note).toBeNull();
  });

  test("signal rows: value and the average player formatted alike, weight, signed effect", () => {
    const m = methodView(tFr, "fr", vachaman(), docsFr)!;
    const survival = m.axes[0]!.signals;
    expect(survival[0]).toEqual({ name: "Morts hors wipe", hint: "Ses morts quand le groupe n'a pas wipe, par run, pondérées par le niveau de la clé.", value: "0,6", ref: "0,7", weight: "×3", effect: "+16,0", tone: "better" });
    expect(survival[1]).toMatchObject({ name: "Dégâts évitables vs le groupe", weight: "×2", effect: "+14,0" });
    expect(survival[1]!.value).toBe(tFr("drivers.unit.pct", { value: "−40" }));
    expect(survival[1]!.ref).toBe(tFr("drivers.unit.pct", { value: "−3" }));
    const prep = m.axes[3]!.signals;
    // A source the dictionaries no longer name (healthstones left in config version 8) reads as its key.
    expect(prep[2]).toMatchObject({ name: "preparation.healthstones", effect: "−2,0", tone: "worse" });
    // No reference and no weight: "—".
    expect(prep[3]).toMatchObject({ name: "preparation.unknown", hint: null, ref: "—", weight: "—", effect: "0,0", tone: "neutral" });
  });

  test("a missing reference reads —", () => {
    const docs = { ...docsEn, config: { ...docsEn.config, reference: { ...docsEn.config.reference, dps: {} } } };
    const rows = methodView(tEn, "en", vachaman(), docs)!.axes.flatMap((a) => a.signals);
    expect(rows.every((r) => r.ref === "—")).toBe(true);
  });

  test("curve and rules from the config", () => {
    const m = methodView(tEn, "en", vachaman(), docsEn)!;
    expect(m.curve.points).toEqual(DEFAULT_CONFIG.globalCurve.dps);
    expect(m.curve.raw).toBeCloseTo(78, 9);
    expect(m.curve.final).toBe(77);
    expect(m.curve.zones).toEqual([
      { verdict: "pass", from: 0, to: 30 }, { verdict: "maybe", from: 30, to: 70 }, { verdict: "invite", from: 70, to: 100 },
    ]);
    expect(m.rules).toEqual({ invite: 70, maybe: 30, minRuns: 3, high: 6, medium: 3 });
  });

  test("INSUFFICIENT DATA: no final, no verdict step", () => {
    const ev = vachaman({
      global: null, verdict: "insufficient", runsUsed: 2,
      axes: [axis("survival", 60, [["survival.individualDeaths", 10, 0.5, 3]]), axis("utility", null, []), axis("consistency", null, [])],
    });
    const m = methodView(tEn, "en", ev, docsEn)!;
    expect(m.title).toBe("Why there is no verdict yet");
    expect(m.final).toBe("—");
    expect(m.raw).toBe("60.0");
    expect(m.curve.final).toBeNull();
    expect(m.path[0]!.sub).toBe("runs scored at +19, the best per dungeon");
    expect(m.path[2]).toMatchObject({ value: "1 + 1", sub: "1 counted, Consistency informational" });
    expect(m.path[4]).toEqual({ label: "5 · Verdict", value: "—", sub: "3 scored runs needed" });
    const utility = m.axes.find((a) => a.key === "utility")!;
    expect(utility).toMatchObject({ score: "—", confidence: "—", note: "not enough data for this axis", band: "neutral" });
    expect(m.waterfall.map((w) => w.key)).toEqual(["survival"]);
  });
});

describe("methodView — legends and rules", () => {
  test("French: legend, curve label, rule lines with the informational axis", () => {
    const m = methodView(tFr, "fr", vachaman(), docsFr)!;
    expect(m.axesLegend).toBe("valeur du joueur · joueur moyen DPS · poids du signal · effet en points");
    expect(m.curveSub).toBe("courbe des DPS de référence");
    expect(m.curveLabel).toBe("Courbe : score brut 78,0 placé à 77 parmi les DPS de référence : INVITE");
    expect(m.ruleLines).toEqual([
      "Le verdict est un rang : 77 veut dire mieux que 77\u202f% des DPS de référence au même niveau.",
      "Moins de 3 runs notés : pas de verdict, seulement « données insuffisantes ».",
      "Confiance d'un axe : haute dès 6 runs, moyenne dès 3.",
      "Régularité est affichée pour lire le profil, sans effet sur le verdict.",
    ]);
  });

  test("no rank line and a bare curve label without a verdict", () => {
    const m = methodView(tEn, "en", vachaman({ global: null, verdict: "insufficient", runsUsed: 2 }), docsEn)!;
    expect(m.curveLabel).toBe("Curve of the reference DPS");
    expect(m.ruleLines[0]).toBe("Fewer than 3 scored runs: no verdict, only “not enough data”.");
  });
});

describe("curveGeometry", () => {
  const zones = [
    { verdict: "pass" as const, from: 0, to: 30 },
    { verdict: "maybe" as const, from: 30, to: 70 },
    { verdict: "invite" as const, from: 70, to: 100 },
  ];
  test("the mockup's DPS plot: 40 → 100, zones top-down, the player at (78.0, 77)", () => {
    const g = curveGeometry({ points: DEFAULT_CONFIG.globalCurve.dps, raw: 78, final: 77, zones });
    expect(g.xMin).toBe(40);
    expect(g.xTicks.map((x) => [x.value, x.x])).toEqual([[40, 0], [60, 186.7], [80, 373.3], [100, 560]]);
    expect(g.yTicks).toEqual([{ y: 0, value: 100 }, { y: 60, value: 70 }, { y: 140, value: 30 }, { y: 200, value: 0 }]);
    expect(g.zones).toEqual([
      { verdict: "invite", y: 0, height: 60, at: 70 },
      { verdict: "maybe", y: 60, height: 80, at: 30 },
      { verdict: "pass", y: 140, height: 60, at: 0 },
    ]);
    expect(g.marker).toEqual({ x: 354.7, y: 46, anchor: "start", verdict: "invite" });
    // Starts at the left edge on the curve (interpolated), then the config's points: 47.7 → 2 is the mockup's 71.9,196.
    expect(g.path.startsWith("M0,196.6 L71.9,196 ")).toBe(true);
    expect(g.path.endsWith("L560,0")).toBe(true);
  });

  test("the left edge goes down to the player; no marker without a verdict; label kept inside on the right", () => {
    expect(curveGeometry({ points: DEFAULT_CONFIG.globalCurve.healer, raw: 41, final: 1, zones }).xMin).toBe(40);
    expect(curveGeometry({ points: DEFAULT_CONFIG.globalCurve.healer, raw: 80, final: 70, zones }).xMin).toBe(50);
    expect(curveGeometry({ points: DEFAULT_CONFIG.globalCurve.healer, raw: 50, final: null, zones }).marker).toBeNull();
    expect(curveGeometry({ points: DEFAULT_CONFIG.globalCurve.dps, raw: 95, final: 99, zones }).marker!.anchor).toBe("end");
    expect(curveGeometry({ points: DEFAULT_CONFIG.globalCurve.dps, raw: 60, final: 30, zones }).marker!.verdict).toBe("maybe");
    expect(curveGeometry({ points: DEFAULT_CONFIG.globalCurve.dps, raw: 60, final: 29, zones }).marker!.verdict).toBe("pass");
    const healer = curveGeometry({ points: DEFAULT_CONFIG.globalCurve.healer, raw: 80, final: 70, zones });
    expect(healer.xTicks.map((x) => x.value)).toEqual([50, 60, 70, 80, 90, 100]);
  });
});
