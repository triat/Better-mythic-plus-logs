import { describe, expect, test } from "bun:test";
import type { Sample } from "../../src/calibration/fit.ts";
import { beats, halves, MIN_SPLIT_RUNS, outcomes, parseCheck, runStudy, signalStudy, studyMarkdown } from "../../src/calibration/study.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { deaths, payloadWith, runWith } from "../evaluation/helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

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
      payload: payloadWith(runs, { targetLevel: 16 }),
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

  test("a candidate beats today only when steadier without predicting worse", () => {
    const base = { splitHalf: 0.5, predicts: { deaths: 0.3, avoidable: 0.3, timed: 0.2 }, wclLadder: 0.6, verdicts: { invite: 0.3, maybe: 0.4, pass: 0.3, insufficient: 0 }, changes: 0 };
    expect(beats({ ...base, splitHalf: 0.53 }, base)).toBe(true);
    expect(beats({ ...base, splitHalf: 0.51 }, base)).toBe(false);
    expect(beats({ ...base, splitHalf: 0.6, predicts: { ...base.predicts, deaths: 0.2 } }, base)).toBe(false);
  });

  test("the whole study: candidates a config accepts, a report without any character name", () => {
    const r = runStudy(population(240), cfg, 1_800_000_000_000);
    expect(r.roles.dps.fit + r.roles.dps.test).toBe(240);
    expect(Object.keys(r.roles.dps.candidates)).toEqual(["today", "shrinkage", "percentile", "both"]);
    expect(r.roles.dps.candidates.today.changes).toBe(0);
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
    const md = studyMarkdown(r);
    expect(md).toContain("## dps");
    expect(md).not.toMatch(/Name\d/);
    expect(JSON.stringify(r)).not.toMatch(/Name\d/);
  });
});
