import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../../src/evaluation/config.ts";
import { globalScore } from "../../../src/evaluation/global.ts";
import { docsResponse } from "../../../src/server/routes-shared.ts";
import type { AxisScore, Evaluation } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { methodView, rawScore } from "./method.ts";

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
    expect(m.axes[0]!.note).toBe("Les signaux du deep-dive (utilisation des defensives et morts avec un defensive dispo) comptent dès 2 runs analysés : 1 pour l'instant.");
    expect(m.axes[1]!.note).toBeNull();
  });

  test("signal rows: value and the average player formatted alike, weight, signed effect", () => {
    const m = methodView(tFr, "fr", vachaman(), docsFr)!;
    const survival = m.axes[0]!.signals;
    expect(survival[0]).toEqual({ name: "Morts individuelles", value: "0,6", ref: "0,7", weight: "×3", effect: "+16,0", tone: "better" });
    expect(survival[1]).toMatchObject({ name: "Dégâts évitables vs pairs", weight: "×2", effect: "+14,0" });
    expect(survival[1]!.value).toBe(tFr("drivers.unit.pct", { value: "−40" }));
    expect(survival[1]!.ref).toBe(tFr("drivers.unit.pct", { value: "−3" }));
    const prep = m.axes[3]!.signals;
    expect(prep[2]).toMatchObject({ name: "Healthstones", effect: "−2,0", tone: "worse" });
    // No reference and no weight: "—".
    expect(prep[3]).toMatchObject({ name: "preparation.unknown", ref: "—", weight: "—", effect: "0,0", tone: "neutral" });
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
