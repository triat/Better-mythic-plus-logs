// What the evaluation's rules must always do, whatever the weights and curves (spec
// docs/superpowers/specs/2026-10-27-evaluation-validity-design.md, decision 2). Synthetic profiles, 0 WCL points.
import { describe, expect, test } from "bun:test";
import { scoreAllAxes } from "../../src/evaluation/axes/index.ts";
import { shrink } from "../../src/evaluation/axis.ts";
import { validateConfig } from "../../src/evaluation/config.ts";
import { curve } from "../../src/evaluation/curve.ts";
import { evaluate, globalScore } from "../../src/evaluation/evaluate.ts";
import { collectInputs, type EvalInputs } from "../../src/evaluation/inputs.ts";
import type { CurvePoints, Role } from "../../src/evaluation/types.ts";
import { deaths, MECHANICS_CONFIG, payloadWith, runWith } from "./helpers.ts";

const cfg = MECHANICS_CONFIG;
const ROLES: Role[] = ["dps", "healer", "tank"];

/** A profile with every sub-signal measured, each near an ordinary value. */
const measured = (role: Role): EvalInputs => ({
  role, targetLevel: 16, runsUsed: 8, analyzedRuns: 0, seasonSlug: "season-mn-2",
  survival: {
    individualDeaths: 0.6, individualDeathsScaled: 0.6, wipeDeaths: 0.2, avoidableVsPeers: 5, dtpsVsPeers: 3,
    groupDeaths: 2.5, groupDeathsScaled: 2.5, defensiveUsage: null, avoidableDeathShare: null, avoidableDeathsCount: 0, countedDeathsCount: 0,
  },
  utility: { hasKick: true, kicksVsPeers: -2, kicksAbsolute: 0.22, dispels: 4, hasDispel: true, crowdControl: null, controlRate: null },
  throughput: { medianParse: 58, parseAtTarget: 55 },
  consistency: { sample: 8, parseSpread: 20, deathsSpread: 0.8, damageSpread: 60 },
  preparation: { ilvl: 325 },
  counts: Object.fromEntries(["survival.individualDeaths", "survival.wipeDeaths", "survival.avoidableVsPeers", "survival.dtpsVsPeers",
    "survival.groupDeaths", "utility.kicksVsPeers", "utility.kicksAbsolute", "utility.dispels", "throughput.medianParse",
    "throughput.parseAtTarget"].map((s) => [s, 8])),
});

const raw = (i: EvalInputs): number => globalScore(scoreAllAxes(i, cfg), i.role, cfg)!;

/** Where each source's curve input lives in EvalInputs, and how to write a curve input `x` back there. */
const SLOTS: Record<string, { get: (i: EvalInputs) => number | null; set: (i: EvalInputs, x: number | null) => void }> = {
  "survival.individualDeaths": { get: (i) => i.survival.individualDeathsScaled, set: (i, x) => { i.survival.individualDeathsScaled = x; i.survival.individualDeaths = x; } },
  "survival.wipeDeaths": { get: (i) => i.survival.wipeDeaths, set: (i, x) => { i.survival.wipeDeaths = x; } },
  "survival.avoidableVsPeers": { get: (i) => i.survival.avoidableVsPeers, set: (i, x) => { i.survival.avoidableVsPeers = x; } },
  "survival.dtpsVsPeers": { get: (i) => i.survival.dtpsVsPeers, set: (i, x) => { i.survival.dtpsVsPeers = x; } },
  "survival.groupDeaths": { get: (i) => i.survival.groupDeathsScaled, set: (i, x) => { i.survival.groupDeathsScaled = x; i.survival.groupDeaths = x; } },
  "utility.kicksVsPeers": { get: (i) => i.utility.kicksVsPeers, set: (i, x) => { i.utility.kicksVsPeers = x; } },
  "utility.kicksAbsolute": { get: (i) => i.utility.kicksAbsolute, set: (i, x) => { i.utility.kicksAbsolute = x; } },
  "utility.dispels": { get: (i) => i.utility.dispels, set: (i, x) => { i.utility.dispels = x; } },
  "throughput.medianParse": { get: (i) => i.throughput.medianParse, set: (i, x) => { i.throughput.medianParse = x; } },
  "throughput.parseAtTarget": { get: (i) => i.throughput.parseAtTarget, set: (i, x) => { i.throughput.parseAtTarget = x; } },
  "consistency.parseSpread": { get: (i) => i.consistency.parseSpread, set: (i, x) => { i.consistency.parseSpread = x; } },
  "consistency.deathsSpread": { get: (i) => i.consistency.deathsSpread, set: (i, x) => { i.consistency.deathsSpread = x; } },
  "consistency.damageSpread": { get: (i) => i.consistency.damageSpread, set: (i, x) => { i.consistency.damageSpread = x; } },
};

const curveOf = (source: string): CurvePoints => {
  const [axis, id] = source.split(".") as [keyof typeof cfg.axes, string];
  return cfg.axes[axis].subSignals[id]!.curve;
};
/** +1 when a higher input scores better, −1 when lower does. */
const direction = (c: CurvePoints): 1 | -1 => (c[c.length - 1]![1] >= c[0]![1] ? 1 : -1);

const withSlot = (base: EvalInputs, source: string, x: number | null): EvalInputs => {
  const copy = structuredClone(base);
  SLOTS[source]!.set(copy, x);
  return copy;
};

describe("evaluation properties", () => {
  test("every curve is monotone, so a better value never scores lower", () => {
    const monotone = (c: CurvePoints) => {
      const up = c.every((p, k) => k === 0 || p[1] >= c[k - 1]![1]);
      const down = c.every((p, k) => k === 0 || p[1] <= c[k - 1]![1]);
      return up || down;
    };
    for (const [axis, a] of Object.entries(cfg.axes)) {
      for (const [id, s] of Object.entries(a.subSignals)) expect(monotone(s.curve), `${axis}.${id}`).toBe(true);
    }
    for (const role of ROLES) expect(cfg.globalCurve[role].every((p, k, c) => k === 0 || p[1] >= c[k - 1]![1]), role).toBe(true);
  });

  test("moving one sub-signal toward worse never raises the global score", () => {
    for (const role of ROLES) {
      for (const source of Object.keys(SLOTS)) {
        const base = measured(role);
        const c = curveOf(source);
        const now = SLOTS[source]!.get(base)!;
        const span = Math.abs(c[c.length - 1]![0] - c[0]![0]);
        const worse = withSlot(base, source, now - direction(c) * span * 0.25);
        expect(raw(worse), `${role} ${source}`).toBeLessThanOrEqual(raw(base) + 1e-9);
      }
    }
  });

  test("unknown data scores as the average player: never above a bad value, never below a good one", () => {
    for (const role of ROLES) {
      for (const source of Object.keys(SLOTS)) {
        const ref = cfg.reference[role][source];
        const [axis, id] = source.split(".") as [keyof typeof cfg.axes, string];
        if (!ref || cfg.axes[axis].subSignals[id]!.weights[role] <= 0) continue;
        const base = measured(role);
        const unknown = scoreAllAxes(withSlot(base, source, null), cfg).find((a) => a.key === axis)!;
        const average = scoreAllAxes(withSlot(base, source, ref.x), cfg).find((a) => a.key === axis)!;
        expect(unknown.score, `${role} ${source}`).toBe(average.score);
        expect(unknown.imputed, `${role} ${source}`).toContain(source);
        expect(unknown.evidence.map((e) => e.source)).not.toContain(source);
        const c = curveOf(source);
        const bad = scoreAllAxes(withSlot(base, source, c[direction(c) === 1 ? 0 : c.length - 1]![0]), cfg).find((a) => a.key === axis)!;
        const good = scoreAllAxes(withSlot(base, source, c[direction(c) === 1 ? c.length - 1 : 0]![0]), cfg).find((a) => a.key === axis)!;
        expect(unknown.score!, `${role} ${source}`).toBeGreaterThanOrEqual(bad.score!);
        expect(unknown.score!, `${role} ${source}`).toBeLessThanOrEqual(good.score!);
      }
    }
  });

  test("a kit without an interrupt or a dispel is not scored as missing it", () => {
    const base = measured("dps");
    base.utility = { ...base.utility, hasKick: true, hasDispel: false, dispels: null };
    const utility = scoreAllAxes(base, cfg).find((a) => a.key === "utility")!;
    expect(utility.imputed ?? []).not.toContain("utility.dispels");
    const kickless = measured("dps");
    kickless.utility = { ...kickless.utility, hasKick: false, kicksVsPeers: null, kicksAbsolute: null };
    const u2 = scoreAllAxes(kickless, cfg).find((a) => a.key === "utility")!;
    expect(u2.imputed ?? []).toEqual([]);
    expect(u2.score).toBe(Math.round(curve(4, curveOf("utility.dispels"))));
  });

  test("deep-dive analyses never change the global score or the verdict", () => {
    for (const role of ROLES) {
      const base = measured(role);
      for (const [usage, share] of [[0, 1], [1, 0], [0.5, 0.5]] as const) {
        const analysed = structuredClone(base);
        analysed.analyzedRuns = 6;
        analysed.survival = { ...analysed.survival, defensiveUsage: usage, avoidableDeathShare: share, avoidableDeathsCount: 3, countedDeathsCount: 3 };
        expect(raw(analysed), `${role} ${usage}/${share}`).toBe(raw(base));
        const survival = scoreAllAxes(analysed, cfg).find((a) => a.key === "survival")!;
        expect(survival.pillarOnly?.map((e) => e.source).sort()).toEqual(["survival.avoidableDeaths", "survival.defensiveUsage"]);
      }
    }
  });

  test("the order of the runs never changes the evaluation", () => {
    const runs = [0, 1, 2, 3, 0, 2].map((d, k) => runWith({
      deaths: deaths(d),
      interrupts: { count: 10 + k, kickCooldownS: 15, capacity: 100, usage: 0.1 + k / 20, peer: { median: 0.2, count: 3 } },
      avoidableDamage: { total: 0, perMinute: 80 + 10 * k, peer: { median: 100, count: 4 }, spellCount: 10 },
    }, { parsePercent: 30 + 10 * k, keyLevel: 14 + (k % 3) }));
    const once = evaluate(payloadWith(runs, { targetLevel: 16 }), cfg);
    for (const order of [[...runs].reverse(), [...runs.slice(2), ...runs.slice(0, 2)]]) {
      const again = evaluate(payloadWith(order, { targetLevel: 16 }), cfg);
      expect([again.global, again.verdict]).toEqual([once.global, once.verdict]);
      expect(again.axes.map((a) => a.score)).toEqual(once.axes.map((a) => a.score));
    }
  });

  test("shrinkage pulls toward the average player, never past it, less with more runs; off without k", () => {
    for (const [x, ref] of [[3, 0.6], [-20, 5], [80, 61]] as const) {
      const few = shrink(x, 3, 4, ref);
      const many = shrink(x, 9, 4, ref);
      expect(Math.abs(few - ref)).toBeLessThan(Math.abs(x - ref));
      expect(Math.sign(few - ref)).toBe(Math.sign(x - ref));
      expect(Math.abs(many - ref)).toBeGreaterThan(Math.abs(few - ref));
      expect(shrink(x, 3, undefined, ref)).toBe(x);
      expect(shrink(x, 3, 0, ref)).toBe(x);
    }
    const base = measured("dps");
    base.survival.individualDeathsScaled = 3;
    base.counts["survival.individualDeaths"] = 3;
    const shrunk = validateConfig({ ...cfg, shrinkage: { dps: { "survival.individualDeaths": 4 } } });
    const ax = (c: typeof cfg) => scoreAllAxes(base, c).find((a) => a.key === "survival")!.score!;
    expect(ax(shrunk)).toBeGreaterThan(ax(cfg));
  });

  test("a per-role curve replaces the shared one for that role only", () => {
    const sub = cfg.axes.throughput.subSignals.medianParse!;
    const flat: CurvePoints = [[0, 50], [100, 50]];
    const perRole = validateConfig({ ...cfg, axes: { ...cfg.axes, throughput: { subSignals: { ...cfg.axes.throughput.subSignals, medianParse: { ...sub, curves: { healer: flat } } } } } });
    const evidence = (role: Role) => scoreAllAxes(measured(role), perRole).find((a) => a.key === "throughput")!.evidence.find((e) => e.source === "throughput.medianParse")!;
    expect(evidence("healer").score).toBe(50);
    expect(evidence("dps").score).toBe(curve(58, sub.curve));
  });

  test("a config's shrinkage and per-role curves are validated: known roles and sources only", () => {
    expect(() => validateConfig({ ...cfg, shrinkage: { mage: {} } })).toThrow(/shrinkage\.mage/);
    expect(() => validateConfig({ ...cfg, shrinkage: { dps: { "survival.nope": 2 } } })).toThrow(/unknown source/);
    expect(() => validateConfig({ ...cfg, shrinkage: { dps: { "survival.wipeDeaths": -1 } } })).toThrow(/wipeDeaths/);
    const sub = cfg.axes.throughput.subSignals.medianParse!;
    expect(() => validateConfig({ ...cfg, axes: { ...cfg.axes, throughput: { subSignals: { ...cfg.axes.throughput.subSignals, medianParse: { ...sub, curves: { mage: sub.curve } } } } } })).toThrow(/unknown role/);
  });

  test("the measured profile's collectInputs agrees with the slots it is varied through", () => {
    // Guards SLOTS against drifting from EvalInputs: one real payload, every slot readable.
    const i = collectInputs(payloadWith([runWith({ deaths: deaths(1) })], { targetLevel: 15 }), cfg);
    for (const [source, slot] of Object.entries(SLOTS)) expect(() => slot.get(i), source).not.toThrow();
  });
});
