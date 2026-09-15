import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, configVersion, deepMerge, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate, globalScore, verdictFor } from "../../src/evaluation/evaluate.ts";
import type { AxisScore } from "../../src/evaluation/types.ts";
import { deaths, fixturePayload, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const ax = (key: AxisScore["key"], score: number | null): AxisScore => ({ key, score, confidence: "high", evidence: [] });

describe("globalScore / verdictFor", () => {
  test("weighted mean excludes null axes; all null → null", () => {
    const axes = [ax("survival", 100), ax("utility", null), ax("throughput", 50), ax("consistency", null), ax("preparation", null), ax("experience", null)];
    expect(globalScore(axes, "dps", cfg)).toBeCloseTo((3 * 100 + 3 * 50) / 6, 6);
    expect(globalScore(axes.map((a) => ({ ...a, score: null })), "dps", cfg)).toBeNull();
  });
  test("thresholds at the boundaries and insufficient", () => {
    expect(verdictFor(70, 3, cfg)).toBe("invite");
    expect(verdictFor(69.99, 3, cfg)).toBe("maybe");
    expect(verdictFor(45, 3, cfg)).toBe("maybe");
    expect(verdictFor(44.99, 3, cfg)).toBe("pass");
    expect(verdictFor(90, 2, cfg)).toBe("insufficient");
    expect(verdictFor(null, 9, cfg)).toBe("insufficient");
  });
});

describe("evaluate", () => {
  const good = () => runWith({
    deaths: deaths(0), consumables: { potions: 6, healthstones: 3 },
    interrupts: { count: 30, kickCooldownS: 15, capacity: 100, usage: 0.3, peer: { median: 0.2, count: 3 } },
    avoidableDamage: { total: 0, perMinute: 60, peer: { median: 100, count: 4 }, spellCount: 10 },
    damageTaken: { total: 0, dtps: 90, peer: { median: 100, count: 2 } },
  }, { parsePercent: 90, keyLevel: 16 });

  test("a strong DPS profile is invited, six axes, config version present", () => {
    const p = payloadWith(Array.from({ length: 8 }, good), { targetLevel: 16 });
    const e = evaluate(p, cfg);
    expect(e.role).toBe("dps");
    expect(e.targetLevel).toBe(16);
    expect(e.runsUsed).toBe(8);
    expect(e.axes.map((a) => a.key)).toEqual(["survival", "utility", "throughput", "consistency", "preparation", "experience"]);
    expect(e.axes.every((a) => a.confidence === "high")).toBe(true);
    expect(e.global!).toBeGreaterThan(85);
    expect(e.verdict).toBe("invite");
    expect(e.configVersion).toBe(configVersion(cfg));
  });

  test("a weak profile passes; user thresholds are honoured", () => {
    const bad = () => runWith({ deaths: deaths(3, 1), avoidableDamage: { total: 0, perMinute: 150, peer: { median: 100, count: 4 }, spellCount: 10 } }, { parsePercent: 10, keyLevel: 10 });
    const p = payloadWith(Array.from({ length: 6 }, bad), { targetLevel: 16 });
    expect(evaluate(p, cfg).verdict).toBe("pass");
    const lenient = validateConfig(deepMerge(DEFAULT_CONFIG, { verdict: { invite: 20, maybe: 10 } }));
    expect(evaluate(p, lenient).verdict).toBe("invite");
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
    expect(heal.axes[5]!.evidence.map((e) => e.source)).toContain("experience.prevSeasonBonus");
  });
});
