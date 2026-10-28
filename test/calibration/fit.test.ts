import { describe, expect, test } from "bun:test";
import { curveInputs, fitExpectedIlvl, fitGlobal, isFit, MIN_ILVL_N, MIN_N, percentileCurve, quantile, type Sample, withExpectedIlvl } from "../../src/calibration/fit.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import type { EvalPayload } from "../../src/evaluation/inputs.ts";
import { payloadWith, runWith } from "../evaluation/helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

/** `n` DPS characters whose six runs all parse at `parse(i)`. */
const dps = (n: number, parse: (i: number) => number): Sample[] => Array.from({ length: n }, (_, i) => ({
  study: { key: `c${i}`, name: `Char${i}`, server: "Realm", className: "Mage", spec: "Mage:Fire", role: "dps", level: 16, percentile: 0.5, quintile: 2 },
  payload: payloadWith(Array.from({ length: 6 }, () => runWith({}, { parsePercent: parse(i), keyLevel: 16 })), { targetLevel: 16 }),
}));

/** One character at key level `level` wearing `ilvl`, its Raider.IO profile naming `slug`. */
const geared = (level: number, ilvl: number, slug = "season-mn-2"): Sample => ({
  study: { key: `g${level}-${ilvl}`, name: "G", server: "Realm", className: "Mage", spec: "Mage:Fire", role: "dps", level, percentile: 0.5, quintile: 2 },
  payload: { ...payloadWith([runWith({}, { keyLevel: level })], { targetLevel: level }), rio: { itemLevel: ilvl, seasons: [{ slug }] } as unknown as EvalPayload["rio"] },
});
/** `n` characters at `level`, item levels spread evenly around `median` (± 3). */
const band = (level: number, median: number, n = MIN_ILVL_N, slug?: string): Sample[] =>
  Array.from({ length: n }, (_, i) => geared(level, median - 3 + (6 * i) / (n - 1), slug));

describe("calibration fit", () => {
  test("fitExpectedIlvl: the median item level per key level, the hand-set slope past both ends", () => {
    // Today's table: +10 → 300, +15 → 315, +20 → 325, +25 → 332.
    const f = fitExpectedIlvl([...band(15, 322), ...band(16, 324), ...band(18, 327), ...band(20, 333)], cfg)!;
    expect(f.slug).toBe("season-mn-2");
    expect(f.curve).toEqual([[10, 307], [15, 322], [16, 324], [18, 327], [20, 333], [25, 340]]);
    // A level lower than the one below it keeps that one's value; a level under the minimum is left out.
    const dip = fitExpectedIlvl([...band(15, 322), ...band(16, 320), ...band(17, 330, MIN_ILVL_N - 1), ...band(20, 333)], cfg)!;
    expect(dip.curve).toEqual([[10, 307], [15, 322], [16, 322], [20, 333], [25, 340]]);
    // Under two levels, or no item level at all: nothing to fit.
    expect(fitExpectedIlvl(band(16, 324), cfg)).toBeNull();
    expect(fitExpectedIlvl(dps(80, (i) => i), cfg)).toBeNull();
  });

  test("withExpectedIlvl: the season's table replaced in place, a new season added last", () => {
    const same = withExpectedIlvl(cfg, { slug: "season-mn-2", curve: [[15, 320], [20, 330]] });
    expect(same.expectedIlvl).toEqual({ "season-mn-2": [[15, 320], [20, 330]] });
    const next = fitExpectedIlvl([...band(15, 340, MIN_ILVL_N, "season-mn-3"), ...band(20, 350, MIN_ILVL_N, "season-mn-3")], cfg)!;
    expect(Object.keys(withExpectedIlvl(cfg, next).expectedIlvl)).toEqual(["season-mn-2", "season-mn-3"]);
    expect(withExpectedIlvl(cfg, null)).toBe(cfg);
  });

  test("percentileCurve: anchors rise with x, a constant population is neutral", () => {
    const c = percentileCurve(Array.from({ length: 100 }, (_, i) => i), true);
    expect(c[0]![1]).toBeLessThan(5);
    expect(c[c.length - 1]![1]).toBeGreaterThan(95);
    for (let i = 1; i < c.length; i++) expect(c[i]![1]).toBeGreaterThan(c[i - 1]![1]);
    expect(percentileCurve([3, 3, 3], true)).toEqual([[3, 50], [4, 50]]);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  test("curveInputs reads the measured value whatever the curves: per-role ones and shrinkage change nothing", () => {
    const [s] = dps(1, () => 70);
    const shaped = structuredClone(cfg);
    for (const axis of Object.values(shaped.axes)) {
      for (const sub of Object.values(axis.subSignals)) sub.curves = { dps: [[0, 0], [1, 100]], healer: [[0, 100], [1, 0]] };
    }
    const withShrinkage = { ...shaped, shrinkage: { dps: { "throughput.medianParse": 3 } } };
    expect(curveInputs(s!.payload, withShrinkage)).toEqual(curveInputs(s!.payload, cfg));
    expect(curveInputs(s!.payload, cfg)["throughput.medianParse"]).toBeCloseTo(70, 6);
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
