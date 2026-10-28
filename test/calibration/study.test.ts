import { describe, expect, test } from "bun:test";
import type { Sample } from "../../src/calibration/fit.ts";
import {
  beats, bootstrapDiffs, halves, MIN_SPLIT_RUNS, outcomes, parseCheck, proposalFrom, runStudy, type ScoreRows, type ScoreStudy, signalStudy, studyMarkdown,
  targetedAxes,
} from "../../src/calibration/study.ts";
import type { EvalPayload } from "../../src/evaluation/inputs.ts";
import { validateConfig } from "../../src/evaluation/config.ts";
import { deaths, MECHANICS_CONFIG, payloadWith, runWith } from "../evaluation/helpers.ts";

const cfg = MECHANICS_CONFIG;

/** Deterministic noise in [0, 1). */
const noise = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

/**
 * `n` DPS players with a hidden skill in [0, 1): deaths and avoidable damage follow the skill from run to run, wipe
 * deaths are pure noise. Eight runs each, one per dungeon, dated in order.
 */
function population(n: number, seed = 7): Sample[] {
  const rnd = noise(seed);
  return Array.from({ length: n }, (_, i) => {
    const skill = rnd();
    const runs = Array.from({ length: 8 }, (_, d) => {
      const r = runWith({
        deaths: deaths(Math.round((1 - skill) * 3 + rnd() * 0.8), rnd() < 0.15 ? 1 : 0),
        avoidableDamage: { total: 0, perMinute: 60 + (1 - skill) * 120 + rnd() * 20, peer: { median: 100, count: 4 }, spellCount: 5 },
        interrupts: { count: 20, kickCooldownS: 15, capacity: 100, usage: 0.1 + skill * 0.3, peer: { median: 0.2, count: 3 } },
        keystone: { level: 16, chests: 1, timed: rnd() < 0.4 + skill * 0.5, timeMs: 1_500_000, affixes: [] },
      }, { parsePercent: Math.max(1, Math.min(99, Math.round(skill * 80 + rnd() * 20))), keyLevel: 16 });
      return Object.assign(r, { startTime: 1_000 * (d + 1), encounterID: d + 1, spec: "Fire", amount: 300_000 + skill * 200_000 + rnd() * 20_000 });
    });
    return {
      study: { key: `c${i}`, name: `Name${i}`, server: "Realm", className: "Mage", spec: "Mage:Fire", role: "dps", level: 16, percentile: 1 - skill, quintile: 2 },
      // The item level is the character's, the same in every half of its runs.
      payload: Object.assign(payloadWith(runs, { targetLevel: 16 }), { rio: { itemLevel: 640 + Math.round(skill * 12), seasons: [] } as unknown as EvalPayload["rio"] }),
    } as Sample;
  });
}

describe("evaluation study", () => {
  test("halves: alternating or older / newer, none under the minimum", () => {
    const [s] = population(1);
    const alt = halves(s!.payload, "alternate")!;
    const date = halves(s!.payload, "date")!;
    const times = (p: typeof alt[0]) => p.perDungeon.runs.map((r) => (r as unknown as { startTime: number }).startTime);
    expect(times(alt[0])).toEqual([1000, 3000, 5000, 7000]);
    expect(times(date[0])).toEqual([1000, 2000, 3000, 4000]);
    expect(times(date[1])).toEqual([5000, 6000, 7000, 8000]);
    const short = payloadWith(s!.payload.perDungeon.runs.slice(0, MIN_SPLIT_RUNS - 1), { targetLevel: 16 });
    expect(halves(short, "alternate")).toBeNull();
  });

  test("outcomes: higher is better on every axis", () => {
    const [s] = population(1);
    const o = outcomes(s!.payload);
    expect(o.deaths!).toBeLessThanOrEqual(0);
    expect(o.timed!).toBeGreaterThanOrEqual(0);
    expect(o.timed!).toBeLessThanOrEqual(1);
  });

  test("a signal that follows the player is reliable; one that is noise is not, and gets no shrinkage k", () => {
    const rows = signalStudy(population(160), cfg, "dps");
    const of = (src: string) => rows.find((r) => r.source === src)!;
    expect(of("survival.individualDeaths").splitHalf!).toBeGreaterThan(0.5);
    expect(of("survival.avoidableVsPeers").splitHalf!).toBeGreaterThan(0.5);
    expect(of("survival.individualDeaths").k!).toBeLessThan(2);
    expect(Math.abs(of("survival.wipeDeaths").splitHalf ?? 0)).toBeLessThan(0.3);
    // Measured on the character, not on its runs: no reliability, no k, though it still has its share of the score.
    expect(of("preparation.ilvlVsLevel")).toMatchObject({ runBased: false, splitHalf: null, oneRun: null, k: null });
    expect(of("preparation.ilvlVsLevel").n).toBe(160);
    expect(of("survival.individualDeaths").runBased).toBe(true);
    const share = rows.reduce((s, r) => s + r.effective, 0);
    expect(share).toBeCloseTo(1, 2);
    expect(rows.reduce((s, r) => s + r.nominal, 0)).toBeCloseTo(1, 2);
  });

  test("parse check: ranked per key level, or across levels", () => {
    const rnd = noise(3);
    const make = (perLevel: boolean): Sample[] => Array.from({ length: 60 }, () => {
      const runs = [14, 16, 18, 20].map((level, d) => {
        const amount = 200_000 + level * 20_000 + rnd() * 100_000;
        // Per key level: the parse ranks the amount among that level's own runs (centred on the level's mean).
        const parse = perLevel ? Math.round(((amount - (200_000 + level * 20_000)) / 100_000) * 98) + 1 : Math.round(((amount - 480_000) / 300_000) * 98) + 1;
        return Object.assign(runWith({}, { parsePercent: Math.max(1, Math.min(99, parse)), keyLevel: level }), { encounterID: 1, spec: "Fire", amount, startTime: d });
      });
      return { study: { role: "dps" }, payload: payloadWith(runs) } as unknown as Sample;
    });
    expect(parseCheck(make(true)).reading).toBe("per key level");
    expect(parseCheck(make(false)).reading).toBe("across levels");
  });

  test("a candidate beats today only when surely steadier and not surely worse at predicting", () => {
    const base: ScoreStudy = { splitHalf: 0.5, predicts: { deaths: 0.3, avoidable: 0.3, timed: 0.2 }, wclLadder: 0.6, verdicts: { invite: 0.3, maybe: 0.4, pass: 0.3, insufficient: 0 }, changes: 0, vsToday: null };
    const flat = { diff: 0, low: -0.05, high: 0.05 };
    const steadier = { diff: 0.1, low: 0.04, high: 0.16 };
    const with_ = (v: Partial<NonNullable<ScoreStudy["vsToday"]>>): ScoreStudy => ({ ...base, vsToday: { splitHalf: flat, deaths: flat, avoidable: flat, timed: flat, ...v } });
    expect(beats(with_({ splitHalf: steadier }))).toBe(true);
    // A prediction that may have dropped (its interval holds 0) does not stop it; one that surely dropped does.
    expect(beats(with_({ splitHalf: steadier, deaths: { diff: -0.03, low: -0.08, high: 0.02 } }))).toBe(true);
    expect(beats(with_({ splitHalf: steadier, deaths: { diff: -0.1, low: -0.15, high: -0.04 } }))).toBe(false);
    // A rise inside the noise is no rise.
    expect(beats(with_({ splitHalf: { diff: 0.03, low: -0.01, high: 0.07 } }))).toBe(false);
    expect(beats(with_({ splitHalf: null }))).toBe(false);
    expect(beats(base)).toBe(false);
  });

  test("paired bootstrap: the same scores give 0 both ways; noisier scores are surely less steady", () => {
    const rnd = noise(11);
    const n = 200;
    const skill = Array.from({ length: n }, () => rnd());
    const rows = (spread: number): ScoreRows => ({
      halves: skill.map((s) => [s + (rnd() - 0.5) * spread, s + (rnd() - 0.5) * spread]),
      before: skill.map((s) => s + (rnd() - 0.5) * spread),
    });
    const after = skill.map((s) => ({ deaths: s + (rnd() - 0.5) * 0.4, avoidable: null, timed: null }));
    const today = rows(0.2);
    const d = bootstrapDiffs(today, { same: today, noisy: rows(1.5) }, after, 300);
    expect(d.same!.splitHalf).toEqual({ diff: 0, low: 0, high: 0 });
    expect(d.same!.avoidable).toBeNull();
    expect(d.noisy!.splitHalf!.high).toBeLessThan(0);
    expect(d.noisy!.deaths!.high).toBeLessThan(0);
    expect(d.noisy!.splitHalf!.low).toBeLessThanOrEqual(d.noisy!.splitHalf!.diff);
    expect(d.noisy!.splitHalf!.diff).toBeLessThanOrEqual(d.noisy!.splitHalf!.high);
    // The same samples give the same intervals.
    expect(bootstrapDiffs(today, { noisy: rows(1.5) }, after, 300).noisy!.splitHalf).not.toBeNull();
    expect(bootstrapDiffs(today, { same: today }, after, 300)).toEqual(bootstrapDiffs(today, { same: today }, after, 300));
  });

  test("the proposal takes, per role, what its best candidate changes and nothing else", () => {
    const fit = population(160);
    const p = proposalFrom(fit, cfg, { dps: "both", healer: null, tank: null });
    expect(Object.keys(p.shrinkage!)).toEqual(["dps"]);
    expect(p.axes.survival.subSignals.individualDeaths!.curves!.dps).toBeDefined();
    expect(p.axes.survival.subSignals.individualDeaths!.curves!.healer).toBeUndefined();
    expect(p.axes.utility.subSignals.dispels!.weights).toEqual(cfg.axes.utility.subSignals.dispels!.weights);
    // "all" for the healer brings its targeted weight only, never the tank's.
    const all = proposalFrom(fit, cfg, { dps: null, healer: "all", tank: null });
    expect(all.axes.utility.subSignals.dispels!.weights.healer).toBe(1);
    expect(all.axes.survival.subSignals.individualDeaths!.weights.tank).toBe(3);
    // No winner anywhere: today's config.
    expect(proposalFrom(fit, cfg, { dps: null, healer: null, tank: null })).toEqual(cfg);
  });

  test("targeted weights: tank individual deaths and healer dispels weigh 1, nothing else moves", () => {
    const axes = targetedAxes(cfg.axes);
    expect(axes.survival.subSignals.individualDeaths!.weights).toEqual({ ...cfg.axes.survival.subSignals.individualDeaths!.weights, tank: 1 });
    expect(axes.utility.subSignals.dispels!.weights).toEqual({ ...cfg.axes.utility.subSignals.dispels!.weights, healer: 1 });
    expect(cfg.axes.survival.subSignals.individualDeaths!.weights.tank).toBe(3);
    expect(() => validateConfig({ ...cfg, axes })).not.toThrow();
  });

  test("the whole study: candidates a config accepts, a report without any character name", () => {
    const r = runStudy(population(240), cfg, 1_800_000_000_000, 200);
    expect(r.roles.dps.fit + r.roles.dps.test).toBe(240);
    expect(r.bootstrap).toBe(200);
    expect(Object.keys(r.roles.dps.candidates)).toEqual(["today", "shrinkage", "percentile", "both", "targeted", "all", "proposal"]);
    // The proposal: a config the engine accepts, judged against today like the candidates.
    expect(() => validateConfig(r.proposal!.config)).not.toThrow();
    expect(r.proposal!.config.version).toBe(cfg.version);
    expect(r.roles.dps.candidates.proposal!.vsToday!.splitHalf).not.toBeNull();
    // Every character plays +16 here: one key level is not enough to fit the expected item level.
    expect(r.proposal!.expectedIlvl).toBeNull();
    expect(r.proposal!.config.expectedIlvl).toEqual(cfg.expectedIlvl);
    expect(r.roles.dps.candidates.today.changes).toBe(0);
    expect(r.roles.dps.candidates.today.vsToday).toBeNull();
    const shrink = r.roles.dps.candidates.shrinkage.vsToday!.splitHalf!;
    expect(shrink.low).toBeLessThanOrEqual(shrink.high);
    expect(r.candidate.weights).toEqual([
      { source: "survival.individualDeaths", role: "tank", from: 3, to: 1 },
      { source: "utility.dispels", role: "healer", from: 3, to: 1 },
    ]);
    // A role without held-out characters has no interval and no winner.
    expect(r.roles.tank.candidates.both.vsToday!.splitHalf).toBeNull();
    expect(r.best.tank).toBeNull();
    expect(r.roles.dps.candidates.today.splitHalf!).toBeGreaterThan(0.3);
    const axes = structuredClone(cfg.axes);
    for (const [src, curves] of Object.entries(r.candidate.curves)) {
      const [axis, id] = src.split(".") as [keyof typeof axes, string];
      axes[axis].subSignals[id]!.curves = curves;
    }
    expect(() => validateConfig({ ...cfg, axes, shrinkage: r.candidate.shrinkage })).not.toThrow();
    // Everyone has 0 dispels here: a constant signal has no reliability and no k.
    expect(r.roles.dps.signals.find((x) => x.source === "utility.dispels")!.splitHalf).toBeNull();
    expect(r.candidate.shrinkage.dps?.["utility.dispels"]).toBeUndefined();
    expect(r.candidate.shrinkage.dps?.["preparation.ilvlVsLevel"]).toBeUndefined();
    const md = studyMarkdown(r);
    expect(md).toContain("## dps");
    expect(md).toContain("## Proposal");
    expect(md).toContain("| proposal |");
    expect(md).toContain("n/a, per character");
    expect(md).toMatch(/\| shrinkage \| \d\.\d\d · \**[+−±]\d\.\d\d \[/);
    expect(md).not.toMatch(/Name\d/);
    expect(JSON.stringify(r)).not.toMatch(/Name\d/);
  });
});
