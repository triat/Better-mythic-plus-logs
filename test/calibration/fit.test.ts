import { describe, expect, test } from "bun:test";
import { fitGlobal, isFit, MIN_N, percentileCurve, quantile, type Sample } from "../../src/calibration/fit.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { payloadWith, runWith } from "../evaluation/helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

/** `n` DPS characters whose six runs all parse at `parse(i)`. */
const dps = (n: number, parse: (i: number) => number): Sample[] => Array.from({ length: n }, (_, i) => ({
  study: { key: `c${i}`, name: `Char${i}`, server: "Realm", className: "Mage", spec: "Mage:Fire", role: "dps", level: 16, percentile: 0.5, quintile: 2 },
  payload: payloadWith(Array.from({ length: 6 }, () => runWith({}, { parsePercent: parse(i), keyLevel: 16 })), { targetLevel: 16 }),
}));

describe("calibration fit", () => {
  test("percentileCurve: anchors rise with x, a constant population is neutral", () => {
    const c = percentileCurve(Array.from({ length: 100 }, (_, i) => i), true);
    expect(c[0]![1]).toBeLessThan(5);
    expect(c[c.length - 1]![1]).toBeGreaterThan(95);
    for (let i = 1; i < c.length; i++) expect(c[i]![1]).toBeGreaterThan(c[i - 1]![1]);
    expect(percentileCurve([3, 3, 3], true)).toEqual([[3, 50], [4, 50]]);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  test("fitGlobal: the reference is a median of measured values only, never of imputed ones", () => {
    // These runs carry no avoidable list: avoidableVsPeers is missing everywhere, so it gets no reference at all, even
    // though the evaluation scores it at today's reference.
    const fit = fitGlobal(dps(60, (i) => 20 + i), cfg);
    expect(fit.reference.dps["survival.avoidableVsPeers"]).toBeUndefined();
    // No death anywhere: the median curve input is exactly 0, which an imputed neighbour in Σw would skew.
    expect(fit.reference.dps["survival.individualDeaths"]!.x).toBeCloseTo(0, 3);
  });

  test("isFit: a character is in one half whatever its spec, and the halves are both filled", () => {
    const s = (name: string, spec: string) => ({ study: { name, server: "Ysondre", spec } });
    expect(isFit(s("Abc", "Mage:Fire"))).toBe(isFit(s("Abc", "Mage:Frost")));
    const halves = Array.from({ length: 200 }, (_, i) => isFit(s(`N${i}`, "x")));
    expect(halves.filter(Boolean).length).toBeGreaterThan(60);
    expect(halves.filter((h) => !h).length).toBeGreaterThan(60);
  });

  test("fitGlobal: the role's curve runs 0 → 100 through the population, its reference is the median player", () => {
    const fit = fitGlobal(dps(60, (i) => 20 + i), cfg);
    expect(fit.n).toEqual({ dps: 60, healer: 0, tank: 0 });
    const c = fit.globalCurve.dps;
    expect(c[0]).toEqual([0, 0]);
    expect(c[c.length - 1]).toEqual([100, 100]);
    for (let i = 1; i < c.length; i++) { expect(c[i]![0]).toBeGreaterThan(c[i - 1]![0]); expect(c[i]![1]).toBeGreaterThanOrEqual(c[i - 1]![1]); }
    expect(validateConfig({ ...cfg, globalCurve: fit.globalCurve, reference: fit.reference }).globalCurve.dps).toEqual(c);
    expect(fit.reference.dps["throughput.medianParse"]!.value).toBeCloseTo(quantile(Array.from({ length: 60 }, (_, i) => 20 + i), 0.5), 1);
    // Roles without enough samples keep today's curve and reference.
    expect(fit.globalCurve.healer).toEqual(cfg.globalCurve.healer);
    expect(fit.reference.tank).toEqual(cfg.reference.tank);
  });

  test(`fitGlobal: under ${MIN_N} samples a role is not refitted`, () => {
    const fit = fitGlobal(dps(MIN_N - 1, (i) => i), cfg);
    expect(fit.globalCurve.dps).toEqual(cfg.globalCurve.dps);
    expect(fit.reference.dps).toEqual(cfg.reference.dps);
  });
});
