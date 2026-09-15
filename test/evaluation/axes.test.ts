import { describe, expect, test } from "bun:test";
import { scoreAxis } from "../../src/evaluation/axis.ts";
import { scoreAllAxes } from "../../src/evaluation/axes/index.ts";
import { scoreConsistency } from "../../src/evaluation/axes/consistency.ts";
import { scoreExperience } from "../../src/evaluation/axes/experience.ts";
import { scorePreparation } from "../../src/evaluation/axes/preparation.ts";
import { scoreSurvival } from "../../src/evaluation/axes/survival.ts";
import { scoreUtility } from "../../src/evaluation/axes/utility.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import type { EvalInputs } from "../../src/evaluation/inputs.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

const baseInputs = (over: Partial<EvalInputs> = {}): EvalInputs => ({
  role: "dps", targetLevel: 16, runsUsed: 6, seasonSlug: "season-mn-2",
  survival: { individualDeaths: null, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: null, groupDeaths: null },
  utility: { hasKick: false, kicksVsPeers: null, kicksAbsolute: null, dispels: null, anyDispel: false },
  throughput: { medianParse: null, parseAtTarget: null },
  consistency: { sample: 6, parseSpread: null, deathsSpread: null, damageSpread: null },
  preparation: { potions: null, healthstones: null, ilvl: null },
  experience: { coverage: null, atTarget: null, medianVsTarget: null, activity: null, prevSeasonAll: null },
  ...over,
});

describe("scoreAxis engine", () => {
  test("weighted mean, evidence delta and order, skips null and zero-weight", () => {
    const a = scoreAxis("survival", [
      { id: "individualDeaths", value: 1, label: (r) => `${r} deaths` },   // 65, w3 → delta +45
      { id: "wipeDeaths", value: null, label: () => "x" },
      { id: "avoidableVsPeers", value: 50, label: (r) => `${r}%` },        // 10, w2 → delta -80
      { id: "groupDeaths", value: 0, label: () => "g" },                    // weight 0 for dps → skipped
    ], "dps", cfg, 6);
    expect(a.score).toBeCloseTo((3 * 65 + 2 * 10) / 5, 6);
    expect(a.evidence.map((e) => e.source)).toEqual(["survival.avoidableVsPeers", "survival.individualDeaths"]);
    expect(a.evidence[0]!.delta).toBe(-80);
    expect(a.evidence[1]!.label).toBe("1 deaths");
    expect(a.confidence).toBe("high");
  });
  test("no contributing sub-signal → null score", () => {
    const a = scoreAxis("throughput", [{ id: "medianParse", value: null, label: () => "" }], "dps", cfg, 2);
    expect(a.score).toBeNull();
    expect(a.evidence).toEqual([]);
    expect(a.confidence).toBe("low");
  });
  test("x transform applies before the curve, label gets raw", () => {
    const a = scoreAxis("survival", [{ id: "individualDeaths", value: 2, x: (r) => r / 2, label: (r) => `${r}` }], "tank", cfg, 4);
    expect(a.score).toBe(65);
    expect(a.evidence[0]!.label).toBe("2");
    expect(a.confidence).toBe("medium");
  });
});

describe("survival", () => {
  test("level scaling: 2 deaths at +8 score like 1.25 at +16; tank has no dtps sub-signal", () => {
    const at8 = scoreSurvival(baseInputs({ targetLevel: 8, survival: { individualDeaths: 1.25, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: 20, groupDeaths: null } }), cfg);
    // 1.25 × 1.6 = 2 → 35 ; dtps +20 → 40 ; dps weights 3,1 → (105+40)/4
    expect(at8.score).toBeCloseTo(145 / 4, 6);
    const tank = scoreSurvival(baseInputs({ role: "tank", survival: { individualDeaths: 0, wipeDeaths: 0, avoidableVsPeers: 0, dtpsVsPeers: 50, groupDeaths: 9 } }), cfg);
    expect(tank.evidence.map((e) => e.source)).not.toContain("survival.dtpsVsPeers");
    expect(tank.evidence.map((e) => e.source)).not.toContain("survival.groupDeaths");
    expect(tank.score).toBeCloseTo((3 * 100 + 1 * 100 + 2 * 65) / 6, 6);
  });
  test("healer counts teammate deaths", () => {
    const h = scoreSurvival(baseInputs({ role: "healer", survival: { individualDeaths: 0, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: null, groupDeaths: 4 } }), cfg);
    expect(h.evidence.map((e) => e.source)).toContain("survival.groupDeaths");
    expect(h.score).toBeCloseTo((3 * 100 + 2 * 45) / 5, 6);
  });
});

describe("utility", () => {
  test("no kick, no dispel, dps → null", () => {
    expect(scoreUtility(baseInputs(), cfg).score).toBeNull();
  });
  test("healer without kick still scored on dispels (0 dispels is information)", () => {
    const h = scoreUtility(baseInputs({ role: "healer", utility: { hasKick: false, kicksVsPeers: null, kicksAbsolute: null, dispels: 0, anyDispel: false } }), cfg);
    expect(h.score).toBe(40);
  });
  test("dps with kicks: peers and absolute", () => {
    const d = scoreUtility(baseInputs({ utility: { hasKick: true, kicksVsPeers: 15, kicksAbsolute: 0.3, dispels: 3, anyDispel: true } }), cfg);
    expect(d.score).toBeCloseTo((3 * 85 + 1 * 80 + 1 * 60) / 5, 6);
  });
});

describe("consistency", () => {
  test("null and low under the minimum sample", () => {
    const c = scoreConsistency(baseInputs({ consistency: { sample: 4, parseSpread: 0, deathsSpread: 0, damageSpread: 0 } }), cfg);
    expect(c.score).toBeNull();
    expect(c.confidence).toBe("low");
  });
  test("scores spreads", () => {
    const c = scoreConsistency(baseInputs({ consistency: { sample: 6, parseSpread: 10, deathsSpread: 1.5, damageSpread: null } }), cfg);
    expect(c.score).toBeCloseTo((2 * 85 + 2 * 45) / 4, 6);
  });
});

describe("preparation", () => {
  test("ilvl vs expected uses the season curve", () => {
    const p = scorePreparation(baseInputs({ targetLevel: 20, preparation: { potions: 6, healthstones: 3, ilvl: 335 } }), cfg);
    // expected at +20 = 325 → +10 → 100 ; potions 6 → 100 ; hs 3 → 100
    expect(p.score).toBe(100);
    expect(p.evidence.find((e) => e.source === "preparation.ilvlVsLevel")!.label).toBe("ilvl +10 vs expected");
  });
  test("unknown season slug falls back to the first curve", () => {
    const p = scorePreparation(baseInputs({ seasonSlug: "season-xx-9", targetLevel: 20, preparation: { potions: null, healthstones: null, ilvl: 315 } }), cfg);
    expect(p.score).toBe(45);
  });
});

describe("experience", () => {
  test("previous season is a capped bonus; absent adds nothing", () => {
    const base = { coverage: 1, atTarget: 1, medianVsTarget: 0, activity: null };
    const none = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: null } }), cfg);
    expect(none.score).toBeCloseTo((2 * 100 + 3 * 100 + 2 * 70) / 7, 6);
    expect(none.evidence.find((e) => e.source === "experience.prevSeasonBonus")).toBeUndefined();
    const some = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: 2000 } }), cfg);
    expect(some.score).toBeCloseTo((2 * 100 + 3 * 100 + 2 * 70) / 7 + 5, 6);
    const big = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: 9000 } }), cfg);
    // (2*100+3*100+2*70)/7 + 10 = 101.43 > 100, so the overall clamp (see "bonus is
    // clamped to 100" below, and the "score = clamp(score + bonus, 0, 100)" rule) caps it at 100.
    expect(big.score).toBeCloseTo(100, 6);
    expect(big.evidence.find((e) => e.source === "experience.prevSeasonBonus")!.delta).toBe(10);
  });
  test("bonus is clamped to 100", () => {
    const e = scoreExperience(baseInputs({ experience: { coverage: 1, atTarget: 1, medianVsTarget: 2, activity: 10, prevSeasonAll: 4000 } }), cfg);
    expect(e.score).toBe(100);
  });
});

describe("scoreAllAxes", () => {
  test("six axes in radar order", () => {
    const axes = scoreAllAxes(baseInputs(), cfg);
    expect(axes.map((a) => a.key)).toEqual(["survival", "utility", "throughput", "consistency", "preparation", "experience"]);
  });
});
