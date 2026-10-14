import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, configVersion, deepMerge, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate, globalScore, verdictFor } from "../../src/evaluation/evaluate.ts";
import type { AxisScore } from "../../src/evaluation/types.ts";
import { deaths, fixturePayload, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const ax = (key: AxisScore["key"], score: number | null): AxisScore => ({ key, score, confidence: "high", evidence: [] });

describe("globalScore / verdictFor", () => {
  test("weighted mean excludes null axes; all null → null", () => {
    const axes = [ax("survival", 100), ax("utility", null), ax("throughput", 50), ax("consistency", null), ax("preparation", null)];
    expect(globalScore(axes, "dps", cfg)).toBeCloseTo((3 * 100 + 3 * 50) / 6, 6);
    expect(globalScore(axes.map((a) => ({ ...a, score: null })), "dps", cfg)).toBeNull();
  });
  test("consistency is informational: zero weight in the global for every role", () => {
    for (const role of ["dps", "healer", "tank"] as const) expect(cfg.axisWeights[role].consistency).toBe(0);
    const axes = [ax("survival", 80), ax("utility", null), ax("throughput", null), ax("consistency", 10), ax("preparation", null)];
    expect(globalScore(axes, "dps", cfg)).toBe(80);
  });
  test("thresholds at the boundaries and insufficient", () => {
    expect(verdictFor(70, 3, cfg)).toBe("invite");
    expect(verdictFor(69.99, 3, cfg)).toBe("maybe");
    expect(verdictFor(30, 3, cfg)).toBe("maybe");
    expect(verdictFor(29.99, 3, cfg)).toBe("pass");
    expect(verdictFor(90, 2, cfg)).toBe("insufficient");
    expect(verdictFor(null, 9, cfg)).toBe("insufficient");
  });
  test("display and verdict agree at the rounding boundary (I1)", () => {
    // A single scored axis makes the raw weighted mean equal to that axis's score exactly,
    // regardless of its weight — the other four axes are null and excluded from the mean.
    const axesAt = (score: number): AxisScore[] => [
      ax("survival", score), ax("utility", null), ax("throughput", null),
      ax("consistency", null), ax("preparation", null),
    ];
    const raw696 = globalScore(axesAt(69.6), "dps", cfg);
    expect(raw696).toBeCloseTo(69.6, 6);
    const rounded696 = raw696 === null ? null : Math.round(raw696);
    expect(rounded696).toBe(70);
    expect(verdictFor(rounded696, 3, cfg)).toBe("invite");

    const raw694 = globalScore(axesAt(69.4), "dps", cfg);
    expect(raw694).toBeCloseTo(69.4, 6);
    const rounded694 = raw694 === null ? null : Math.round(raw694);
    expect(rounded694).toBe(69);
    expect(verdictFor(rounded694, 3, cfg)).toBe("maybe");
  });
});

describe("evaluate", () => {
  const good = () => runWith({
    deaths: deaths(0), consumables: { potions: 6, healthstones: 3 },
    interrupts: { count: 30, kickCooldownS: 15, capacity: 100, usage: 0.3, peer: { median: 0.2, count: 3 } },
    avoidableDamage: { total: 0, perMinute: 60, peer: { median: 100, count: 4 }, spellCount: 10 },
    damageTaken: { total: 0, dtps: 90, peer: { median: 100, count: 2 } },
  }, { parsePercent: 90, keyLevel: 16 });

  test("a strong DPS profile is invited, five axes, config version present", () => {
    const p = payloadWith(Array.from({ length: 8 }, good), { targetLevel: 16 });
    const e = evaluate(p, cfg);
    expect(e.role).toBe("dps");
    expect(e.targetLevel).toBe(16);
    expect(e.runsUsed).toBe(8);
    expect(e.axes.map((a) => a.key)).toEqual(["survival", "utility", "throughput", "consistency", "preparation"]);
    expect(e.axes.every((a) => a.confidence === "high")).toBe(true);
    expect(e.global!).toBeGreaterThan(85);
    expect(e.verdict).toBe("invite");
    expect(e.configVersion).toBe(configVersion(cfg));
  });

  test("a weak profile passes; user thresholds are honoured", () => {
    const bad = () => runWith({ deaths: deaths(3, 1), avoidableDamage: { total: 0, perMinute: 150, peer: { median: 100, count: 4 }, spellCount: 10 } }, { parsePercent: 10, keyLevel: 10 });
    const p = payloadWith(Array.from({ length: 6 }, bad), { targetLevel: 16 });
    expect(evaluate(p, cfg).verdict).toBe("pass");
    const identity = { dps: [[0, 0], [100, 100]], healer: [[0, 0], [100, 100]], tank: [[0, 0], [100, 100]] };
    const lenient = validateConfig(deepMerge(DEFAULT_CONFIG, { verdict: { invite: 20, maybe: 10 }, globalCurve: identity }));
    expect(evaluate(p, lenient).verdict).toBe("invite");
  });

  test("the global is the weighted mean through the role's globalCurve, rounded", () => {
    const p = payloadWith(Array.from({ length: 8 }, good), { targetLevel: 16 });
    const identity = { dps: [[0, 0], [100, 100]], healer: [[0, 0], [100, 100]], tank: [[0, 0], [100, 100]] };
    const plain = evaluate(p, validateConfig(deepMerge(DEFAULT_CONFIG, { globalCurve: identity })));
    const raw = globalScore(plain.axes, "dps", cfg)!;
    expect(plain.global).toBe(Math.round(raw));
    // A curve that halves every raw score: same axes, halved global, verdict read on the halved value.
    const half = validateConfig(deepMerge(DEFAULT_CONFIG, { globalCurve: { ...identity, dps: [[0, 0], [100, 50]] } }));
    const e = evaluate(p, half);
    expect(e.axes).toEqual(plain.axes);
    expect(e.global).toBe(Math.round(raw / 2));
    expect(e.verdict).toBe(verdictFor(e.global, e.runsUsed, half));
  });

  test("the default curve places a median player of the calibration population near 50", () => {
    for (const role of ["dps", "healer", "tank"] as const) {
      const median = cfg.globalCurve[role].find(([, y]) => y === 50)!;
      expect(median).toBeDefined();
      expect(median[0]).toBeGreaterThan(70); // today's raw weighted mean of a median player sits in the mid-70s
    }
  });

  test("fewer than minRuns runs with signals → insufficient, axes still scored", () => {
    const p = payloadWith([good(), good(), runWith(null), runWith(null)], { targetLevel: 16 });
    const e = evaluate(p, cfg);
    expect(e.runsUsed).toBe(2);
    expect(e.verdict).toBe("insufficient");
    expect(e.axes[0]!.score).not.toBeNull();
    expect(e.axes[3]!.score).toBeNull(); // consistency needs 5
  });

  test("fixtures: single-run payloads evaluate without throwing and are insufficient", async () => {
    const tank = evaluate(await fixturePayload("s1-tank", false), cfg);
    expect(tank.role).toBe("tank");
    expect(tank.verdict).toBe("insufficient");
    expect(tank.axes[0]!.score).toBe(100);                       // 0 deaths, no avoidable list, no dtps for tank
    expect(tank.axes[1]!.score!).toBeGreaterThan(50);            // kicks ≈ peers
    expect(tank.axes[1]!.score!).toBeLessThan(70);
    const heal = evaluate(await fixturePayload("s2-healer", true), cfg);
    expect(heal.role).toBe("healer");
    expect(heal.axes[1]!.evidence.map((e) => e.source)).toEqual(["utility.dispels"]);
    expect(heal.axes[4]!.evidence.map((e) => e.source)).toContain("preparation.ilvlVsLevel");
    expect(heal.axes.length).toBe(5);
  });
});

describe("default config snapshot (v8)", () => {
  // v7 removed the experience axis (weight 0: no global moved). v8 removed preparation.potions and
  // preparation.healthstones (judged at each death since 2026-10-14): globals moved (good 99 → 98, s1-tank 59 → 81,
  // s1-tank + rio 70 → 80, s2-healer 59 → 48, s2-healer + rio 48 → 40), no verdict did. Any later drift means a
  // weight or curve moved.
  const good = () => runWith({
    deaths: deaths(0), consumables: { potions: 6, healthstones: 3 },
    interrupts: { count: 30, kickCooldownS: 15, capacity: 100, usage: 0.3, peer: { median: 0.2, count: 3 } },
    avoidableDamage: { total: 0, perMinute: 60, peer: { median: 100, count: 4 }, spellCount: 10 },
    damageTaken: { total: 0, dtps: 90, peer: { median: 100, count: 2 } },
  }, { parsePercent: 90, keyLevel: 16 });
  const bad = () => runWith({ deaths: deaths(3, 1), avoidableDamage: { total: 0, perMinute: 150, peer: { median: 100, count: 4 }, spellCount: 10 } }, { parsePercent: 10, keyLevel: 10 });

  test("globals and verdicts unchanged on every evaluation fixture, no experience axis", async () => {
    const cases: Array<[string, Promise<ReturnType<typeof evaluate>>, number, string]> = [
      ["good", Promise.resolve(evaluate(payloadWith(Array.from({ length: 8 }, good), { targetLevel: 16 }), cfg)), 98, "invite"],
      ["bad", Promise.resolve(evaluate(payloadWith(Array.from({ length: 6 }, bad), { targetLevel: 16 }), cfg)), 1, "pass"],
      ["s1-tank", fixturePayload("s1-tank", false).then((p) => evaluate(p, cfg)), 81, "insufficient"],
      ["s1-tank + rio", fixturePayload("s1-tank", true).then((p) => evaluate(p, cfg)), 80, "insufficient"],
      ["s2-healer", fixturePayload("s2-healer", false).then((p) => evaluate(p, cfg)), 48, "insufficient"],
      ["s2-healer + rio", fixturePayload("s2-healer", true).then((p) => evaluate(p, cfg)), 40, "insufficient"],
    ];
    for (const [name, pending, global, verdict] of cases) {
      const e = await pending;
      expect([name, e.global, e.verdict]).toEqual([name, global, verdict]);
      expect(e.axes.some((a) => (a.key as string) === "experience"), name).toBe(false);
    }
  });
});
