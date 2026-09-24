import { describe, expect, test } from "bun:test";
import { scoreAxis } from "../../src/evaluation/axis.ts";
import { EVIDENCE_SOURCES, scoreAllAxes } from "../../src/evaluation/axes/index.ts";
import { scoreConsistency } from "../../src/evaluation/axes/consistency.ts";
import { scoreExperience } from "../../src/evaluation/axes/experience.ts";
import { scorePreparation } from "../../src/evaluation/axes/preparation.ts";
import { scoreSurvival } from "../../src/evaluation/axes/survival.ts";
import { scoreUtility } from "../../src/evaluation/axes/utility.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { collectInputs, type EvalInputs } from "../../src/evaluation/inputs.ts";
import { AXIS_KEYS } from "../../src/evaluation/types.ts";
import { deaths, fixturePayload, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

const baseInputs = (over: Partial<EvalInputs> = {}): EvalInputs => ({
  role: "dps", targetLevel: 16, runsUsed: 6, analyzedRuns: 0, seasonSlug: "season-mn-2",
  survival: { individualDeaths: null, individualDeathsScaled: null, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: null, groupDeaths: null, groupDeathsScaled: null, defensiveUsage: null, avoidableDeathShare: null, avoidableDeathsCount: 0, countedDeathsCount: 0 },
  utility: { hasKick: false, kicksVsPeers: null, kicksAbsolute: null, dispels: null, hasDispel: true },
  throughput: { medianParse: null, parseAtTarget: null },
  consistency: { sample: 6, parseSpread: null, deathsSpread: null, damageSpread: null },
  preparation: { potions: null, healthstones: null, ilvl: null },
  experience: { coverage: null, atTarget: null, medianVsTarget: null, activity: null, prevSeasonAll: null },
  ...over,
});

describe("scoreAxis engine", () => {
  test("weighted mean, evidence delta and order, skips null and zero-weight", () => {
    const a = scoreAxis("survival", [
      { id: "individualDeaths", value: 1, label: (r) => `${r} deaths` },   // 65, w3 → delta +3×15/5 = +9
      { id: "wipeDeaths", value: null, label: () => "x" },
      { id: "avoidableVsPeers", value: 50, label: (r) => `${r}%` },        // 10, w2 → delta +2×-40/5 = -16
      { id: "groupDeaths", value: 0, label: () => "g" },                    // weight 0 for dps → skipped
    ], "dps", cfg, 6);
    // Σw = 3+2 = 5 ; score = (3×65 + 2×10)/5 = 43
    expect(a.score).toBe(43);
    expect(a.evidence.map((e) => e.source)).toEqual(["survival.avoidableVsPeers", "survival.individualDeaths"]);
    expect(a.evidence[0]!.delta).toBe(-16);
    expect(a.evidence[1]!.delta).toBe(9);
    expect(a.evidence[1]!.label).toBe("1 deaths");
    expect(a.evidence[1]!.value).toBe(1);
    expect(a.evidence[1]!.extra).toBeUndefined();
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
    expect(a.evidence[0]!.value).toBe(2);
    expect(a.confidence).toBe("medium");
  });
  test("raw wins over value as the evidence value; extra is copied onto the evidence", () => {
    const a = scoreAxis("survival", [
      { id: "individualDeaths", value: 2, raw: 1.25, label: (r) => `${r}` },
      { id: "avoidableDeaths", value: 0.5, extra: { count: 1, total: 2 }, label: () => "1/2" },
    ], "tank", cfg, 4);
    expect(a.evidence.find((e) => e.source === "survival.individualDeaths")).toMatchObject({ label: "1.25", value: 1.25 });
    expect(a.evidence.find((e) => e.source === "survival.avoidableDeaths")).toMatchObject({ value: 0.5, extra: { count: 1, total: 2 } });
  });
});

describe("survival", () => {
  test("scoreSurvival consumes the pre-scaled mean (scaling itself happens in collectInputs, per run); tank has no dtps sub-signal", () => {
    // individualDeathsScaled as collectInputs would produce it for runs at key level 8
    // (levelScale(8) = 1.6): raw mean 1.25 × 1.6 = 2 → curve(2) = 35. dtps +20% vs peers → 40.
    const at8 = scoreSurvival(
      baseInputs({
        survival: { individualDeaths: 1.25, individualDeathsScaled: 2, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: 20, groupDeaths: null, groupDeathsScaled: null, defensiveUsage: null, avoidableDeathShare: null, avoidableDeathsCount: 0, countedDeathsCount: 0 },
      }),
      cfg,
    );
    // dps weights individualDeaths=3, dtpsVsPeers=1 → (3×35 + 1×40)/4 = 145/4 = 36.25 → round 36
    expect(at8.score).toBe(36);

    const tank = scoreSurvival(
      baseInputs({
        role: "tank",
        survival: { individualDeaths: 0, individualDeathsScaled: 0, wipeDeaths: 0, avoidableVsPeers: 0, dtpsVsPeers: 50, groupDeaths: 9, groupDeathsScaled: 9, defensiveUsage: null, avoidableDeathShare: null, avoidableDeathsCount: 0, countedDeathsCount: 0 },
      }),
      cfg,
    );
    expect(tank.evidence.map((e) => e.source)).not.toContain("survival.dtpsVsPeers");
    expect(tank.evidence.map((e) => e.source)).not.toContain("survival.groupDeaths");
    // tank weights individualDeaths=3, wipeDeaths=1, avoidableVsPeers=2 → (3×100 + 1×100 + 2×65)/6 = 530/6 = 88.33 → round 88
    expect(tank.score).toBe(88);
  });
  test("healer counts teammate deaths", () => {
    const h = scoreSurvival(
      baseInputs({ role: "healer", survival: { individualDeaths: 0, individualDeathsScaled: 0, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: null, groupDeaths: 4, groupDeathsScaled: 4, defensiveUsage: null, avoidableDeathShare: null, avoidableDeathsCount: 0, countedDeathsCount: 0 } }),
      cfg,
    );
    expect(h.evidence.map((e) => e.source)).toContain("survival.groupDeaths");
    // healer weights individualDeaths=3, groupDeaths=2 → (3×100 + 2×45)/5 = 390/5 = 78
    expect(h.score).toBe(78);
  });
  test("survival score is independent of targetLevel — scaling depends only on the run's own key level", () => {
    const runsAt12 = () => [runWith({ keystone: { level: 12, chests: 2, timed: true, timeMs: 1_500_000, affixes: [] }, deaths: deaths(2) })];
    const at12 = scoreSurvival(collectInputs(payloadWith(runsAt12(), { targetLevel: 12 }), cfg), cfg);
    const at20 = scoreSurvival(collectInputs(payloadWith(runsAt12(), { targetLevel: 20 }), cfg), cfg);
    expect(at12.score).toBe(at20.score);
    expect(at12.evidence).toEqual(at20.evidence);
  });
  test("deep-dive sub-signals score and label from the counts", () => {
    const a = scoreSurvival(baseInputs({ analyzedRuns: 3, survival: { ...baseInputs().survival, defensiveUsage: 0.6, avoidableDeathShare: 2 / 3, avoidableDeathsCount: 2, countedDeathsCount: 3 } }), cfg);
    const usage = a.evidence.find((e) => e.source === "survival.defensiveUsage")!;
    expect(usage.label).toBe("majors used 60% of possible (3 runs)");
    expect(usage.value).toBe(0.6);
    expect(usage.extra).toEqual({ runs: 3 });
    const deaths = a.evidence.find((e) => e.source === "survival.avoidableDeaths")!;
    expect(deaths.label).toBe("2/3 deaths with a defensive available");
    expect(deaths.value).toBeCloseTo(2 / 3, 6);
    expect(deaths.extra).toEqual({ count: 2, total: 3 });
    expect(deaths.delta).toBeLessThan(0);   // 0.67 → 30 on the curve
    expect(usage.delta).toBeGreaterThan(0); // 0.6 → 85
  });
});

describe("EVIDENCE_SOURCES", () => {
  test("lists the default config's sub-signals plus the previous-season bonus, nothing else", () => {
    const fromConfig = AXIS_KEYS.flatMap((k) => Object.keys(DEFAULT_CONFIG.axes[k].subSignals).map((id) => `${k}.${id}`));
    expect([...(EVIDENCE_SOURCES as readonly string[])].sort()).toEqual([...fromConfig, "experience.prevSeasonBonus"].sort());
  });
  test("every evidence entry of the fixture evaluations has a listed source, a finite value, and extra where the label needs it", async () => {
    const all = [evaluate(await fixturePayload("s1-tank", false), cfg), evaluate(await fixturePayload("s2-healer", true), cfg)]
      .flatMap((e) => e.axes.flatMap((a) => a.evidence));
    expect(all.length).toBeGreaterThan(20);
    for (const e of all) {
      expect(EVIDENCE_SOURCES as readonly string[]).toContain(e.source);
      expect(Number.isFinite(e.value), e.source).toBe(true);
    }
    expect(all.find((e) => e.source === "experience.prevSeasonBonus")).toMatchObject({ label: "previous season 4153", value: 4152.7 });
    expect(all.find((e) => e.source === "preparation.ilvlVsLevel")!.label).toBe("ilvl −4 vs expected");
  });
  test("survival.defensiveUsage carries extra.runs when a deep-dive exists", () => {
    const a = scoreSurvival(baseInputs({ analyzedRuns: 1, survival: { ...baseInputs().survival, defensiveUsage: 0.5 } }), cfg);
    expect(a.evidence.find((e) => e.source === "survival.defensiveUsage")).toMatchObject({ label: "majors used 50% of possible (1 run)", value: 0.5, extra: { runs: 1 } });
  });
});

describe("utility", () => {
  test("no kick, no dispel, dps → null", () => {
    expect(scoreUtility(baseInputs(), cfg).score).toBeNull();
  });
  test("healer without kick still scored on dispels (0 dispels is information)", () => {
    const h = scoreUtility(baseInputs({ role: "healer", utility: { hasKick: false, kicksVsPeers: null, kicksAbsolute: null, dispels: 0, hasDispel: true } }), cfg);
    expect(h.score).toBe(40);
  });
  test("dps with kicks: peers and absolute", () => {
    const d = scoreUtility(baseInputs({ utility: { hasKick: true, kicksVsPeers: 15, kicksAbsolute: 0.3, dispels: 3, hasDispel: true } }), cfg);
    // dps weights kicksVsPeers=3, kicksAbsolute=1, dispels=1 → (3×85 + 1×80 + 1×60)/5 = 395/5 = 79
    expect(d.score).toBe(79);
  });
  test("a kit without any dispel is not penalized for 0 dispels/run", () => {
    const d = scoreUtility(baseInputs({ utility: { hasKick: true, kicksVsPeers: 15, kicksAbsolute: 0.3, dispels: null, hasDispel: false } }), cfg);
    // dispels n/a → (3×85 + 1×80)/4 = 335/4 = 83.75 → 84
    expect(d.score).toBe(84);
    expect(d.evidence.map((e) => e.source)).not.toContain("utility.dispels");
  });
  test("no kick, no dispel, dps → null even with a 0 dispel count", () => {
    expect(scoreUtility(baseInputs({ utility: { hasKick: false, kicksVsPeers: null, kicksAbsolute: null, dispels: null, hasDispel: false } }), cfg).score).toBeNull();
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
    // weights parseSpread=2, deathsSpread=2 → (2×85 + 2×45)/4 = 260/4 = 65
    expect(c.score).toBe(65);
  });
});

describe("preparation", () => {
  test("ilvl vs expected uses the season curve", () => {
    const p = scorePreparation(baseInputs({ targetLevel: 20, preparation: { potions: 6, healthstones: 3, ilvl: 335 } }), cfg);
    // expected at +20 = 325 → +10 → 100 ; potions 6 → 100 ; hs 3 → 100
    expect(p.score).toBe(100);
    expect(p.evidence.find((e) => e.source === "preparation.ilvlVsLevel")!.label).toBe("ilvl +10 vs expected");
  });
  test("unknown season slug falls back to the last expectedIlvl curve", () => {
    const p = scorePreparation(baseInputs({ seasonSlug: "season-xx-9", targetLevel: 20, preparation: { potions: null, healthstones: null, ilvl: 315 } }), cfg);
    expect(p.score).toBe(45);
  });
});

describe("experience", () => {
  test("previous season is a capped bonus; absent adds nothing", () => {
    const base = { coverage: 1, atTarget: 1, medianVsTarget: 0, activity: null };
    // weights coverage=2, atTarget=3, medianVsTarget=2 (activity null → skipped) → Σw 7
    // (2×100 + 3×100 + 2×70)/7 = 640/7 = 91.4285… → base axis score rounds to 91 (I1).
    const none = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: null } }), cfg);
    expect(none.score).toBe(91);
    expect(none.evidence.find((e) => e.source === "experience.prevSeasonBonus")).toBeUndefined();
    // bonus = min(10, 2000/400) = 5 ; 91 + 5 = 96
    const some = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: 2000 } }), cfg);
    expect(some.score).toBe(96);
    // bonus = min(10, 9000/400) = 10 ; 91 + 10 = 101 → clamped to 100
    const big = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: 9000 } }), cfg);
    expect(big.score).toBe(100);
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

describe("scoreAxis override", () => {
  const subs = [
    { id: "individualDeaths", value: 2, label: (r: number) => `${r}` },
    { id: "wipeDeaths", value: 1, label: (r: number) => `${r}` },
  ];
  test("replaces only the named sub-signal's curve input", () => {
    const base = scoreAxis("survival", subs, "dps", cfg, 6);
    const over = scoreAxis("survival", subs, "dps", cfg, 6, { "survival.individualDeaths": 0 });
    const get = (a: typeof base, s: string) => a.evidence.find((e) => e.source === s)!;
    expect(get(over, "survival.individualDeaths").delta).toBeGreaterThan(get(base, "survival.individualDeaths").delta);
    expect(get(over, "survival.wipeDeaths").delta).toBeCloseTo(get(base, "survival.wipeDeaths").delta, 6);
    expect(get(over, "survival.individualDeaths").value).toBe(2); // the evidence still reports the actual value
    expect(over.score!).toBeGreaterThan(base.score!);
  });
});
