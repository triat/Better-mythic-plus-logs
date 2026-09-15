import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { collectInputs, detectRole, evalRuns } from "../../src/evaluation/inputs.ts";
import { deaths, fixturePayload, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

describe("evalRuns / detectRole", () => {
  test("dedupes prevLevelBest against perDungeon", () => {
    const a = runWith({});
    const p = payloadWith([a, runWith({})], { prevLevelBest: { best: a } });
    expect(evalRuns(p).length).toBe(2);
  });
  test("majority role, metric fallback", () => {
    expect(detectRole([runWith({ role: "tank" }), runWith({ role: "dps" }), runWith({ role: "tank" })], "dps")).toBe("tank");
    expect(detectRole([runWith(null)], "hps")).toBe("healer");
    expect(detectRole([], "dps")).toBe("dps");
  });
});

describe("collectInputs — survival", () => {
  test("means and peer medians, nulls when no sample", () => {
    const p = payloadWith([
      runWith({ deaths: deaths(1, 1, 5), damageTaken: { total: 0, dtps: 110, peer: { median: 100, count: 2 } }, avoidableDamage: { total: 0, perMinute: 90, peer: { median: 100, count: 4 }, spellCount: 10 } }),
      runWith({ deaths: deaths(0, 0, 2), damageTaken: { total: 0, dtps: 80, peer: { median: 100, count: 2 } } }),
      runWith(null),
    ]);
    const i = collectInputs(p, cfg);
    expect(i.runsUsed).toBe(2);
    expect(i.survival.individualDeaths).toBe(0.5);
    expect(i.survival.wipeDeaths).toBe(0.5);
    expect(i.survival.groupDeaths).toBe(2.5);       // (5-2 + 2-0)/2
    expect(i.survival.dtpsVsPeers).toBe(-5);        // median of +10, -20
    expect(i.survival.avoidableVsPeers).toBe(-10);
    expect(collectInputs(payloadWith([runWith(null)]), cfg).survival.individualDeaths).toBeNull();
  });
  test("individualDeathsScaled / groupDeathsScaled scale by each run's own key level, not the target", () => {
    // 4 runs at key level 8 (levelScale(8) = 1.6) with 1, 1, 1, 2 individual deaths → raw mean
    // 1.25, scaled mean 1.25 × 1.6 = 2. Same shape for group deaths (groupTotal 3, count as below).
    const p = payloadWith(
      [1, 1, 1, 2].map((n) =>
        runWith({
          keystone: { level: 8, chests: 1, timed: true, timeMs: 1_500_000, affixes: [] },
          deaths: deaths(n, 0, n + 1), // groupTotal = n+1 → teammate deaths (groupTotal-count) = 1 every run
        }),
      ),
      { targetLevel: 20 }, // target is irrelevant to this scaling
    );
    const i = collectInputs(p, cfg);
    expect(i.survival.individualDeaths).toBeCloseTo(1.25, 9);
    expect(i.survival.individualDeathsScaled).toBeCloseTo(2, 9);
    expect(i.survival.groupDeaths).toBeCloseTo(1, 9);
    expect(i.survival.groupDeathsScaled).toBeCloseTo(1.6, 9);
  });
});

describe("collectInputs — utility", () => {
  test("kick usage vs peers, absolute, dispels, hasKick", () => {
    const p = payloadWith([
      runWith({ interrupts: { count: 5, kickCooldownS: 15, capacity: 100, usage: 0.3, peer: { median: 0.2, count: 3 } }, dispels: { count: 4 } }),
      runWith({ interrupts: { count: 1, kickCooldownS: 15, capacity: 100, usage: 0.1, peer: { median: 0.2, count: 3 } }, dispels: { count: 0 } }),
    ]);
    const i = collectInputs(p, cfg);
    expect(i.utility.hasKick).toBe(true);
    expect(i.utility.kicksVsPeers).toBe(0);          // median of +10, -10
    expect(i.utility.kicksAbsolute).toBeCloseTo(0.2, 9);
    expect(i.utility.dispels).toBe(2);
    expect(i.utility.dispelsCommon).toBe(true);
    const noKick = collectInputs(payloadWith([runWith({})]), cfg);
    expect(noKick.utility.hasKick).toBe(false);
    expect(noKick.utility.kicksVsPeers).toBeNull();
    expect(noKick.utility.dispelsCommon).toBe(false);
  });
});

describe("collectInputs — throughput / consistency / preparation / experience", () => {
  test("parseAtTarget uses runs ≥ target-1 (with or without signals)", () => {
    const p = payloadWith([runWith({}, { keyLevel: 15, parsePercent: 90 }), runWith(null, { keyLevel: 14, parsePercent: 50 }), runWith(null, { keyLevel: 10, parsePercent: 10 })]);
    const i = collectInputs(p, cfg);
    expect(i.throughput.medianParse).toBe(50);
    expect(i.throughput.parseAtTarget).toBe(70);
  });
  test("consistency spreads are null below cfg.confidence.consistencyMinRuns (5), even with 2 samples", () => {
    const one = collectInputs(payloadWith([runWith({})]), cfg);
    expect(one.consistency.parseSpread).toBeNull();
    const two = collectInputs(payloadWith([runWith({ deaths: deaths(2) }, { parsePercent: 60 }), runWith({ deaths: deaths(0) }, { parsePercent: 80 })]), cfg);
    expect(two.consistency.sample).toBe(2);
    expect(two.consistency.parseSpread).toBeNull();
    expect(two.consistency.deathsSpread).toBeNull();
    expect(two.consistency.damageSpread).toBeNull();
  });
  test("consistency spreads populate once each sample clears consistencyMinRuns", () => {
    const five = collectInputs(
      payloadWith([
        runWith({ deaths: deaths(2) }, { parsePercent: 60 }),
        runWith({ deaths: deaths(0) }, { parsePercent: 80 }),
        runWith({ deaths: deaths(1) }, { parsePercent: 70 }),
        runWith({ deaths: deaths(3) }, { parsePercent: 50 }),
        runWith({ deaths: deaths(0) }, { parsePercent: 90 }),
      ]),
      cfg,
    );
    expect(five.consistency.sample).toBe(5);
    // parsePercent: 60,80,70,50,90 → mean 70 → population stddev = sqrt(((-10)^2+10^2+0^2+(-20)^2+20^2)/5) = sqrt(1000/5) = sqrt(200)
    expect(five.consistency.parseSpread).toBeCloseTo(Math.sqrt(200), 6);
    // deaths.count: 2,0,1,3,0 → mean 1.2 → stddev = sqrt(((0.8)^2+(1.2)^2+(0.2)^2+(1.8)^2+(1.2)^2)/5) = sqrt(6.8/5) = sqrt(1.36)
    expect(five.consistency.deathsSpread).toBeCloseTo(Math.sqrt(1.36), 6);
    // no avoidableDamage/damageTaken peer set on any run → damageSpread stays null regardless of sample size
    expect(five.consistency.damageSpread).toBeNull();
  });
  test("preparation and experience", () => {
    const p = payloadWith(
      [runWith({ consumables: { potions: 6, healthstones: 2 } }, { keyLevel: 16 }), runWith({ consumables: { potions: 2, healthstones: 0 } }, { keyLevel: 14 }), runWith({})],
      { targetLevel: 15 },
    );
    const i = collectInputs(p, cfg);
    expect(i.preparation.potions).toBe(4);
    expect(i.preparation.healthstones).toBe(1);
    expect(i.preparation.ilvl).toBeNull();
    expect(i.experience.coverage).toBe(3 / 8);
    expect(i.experience.atTarget).toBe(2 / 8);
    expect(i.experience.medianVsTarget).toBe(0);
    expect(i.experience.activity).toBeNull();
    expect(i.experience.prevSeasonAll).toBeNull();
  });
});

describe("collectInputs — fixtures", () => {
  test("S1 tank run", async () => {
    const i = collectInputs(await fixturePayload("s1-tank", false), cfg);
    expect(i.role).toBe("tank");
    expect(i.runsUsed).toBe(1);
    expect(i.survival.individualDeaths).toBe(0);
    expect(i.survival.avoidableVsPeers).toBeNull();
    expect(i.utility.hasKick).toBe(true);
    expect(i.utility.kicksAbsolute).toBeCloseTo(23 / (1700.498 / 15), 4);
    expect(i.preparation.potions).toBe(1);
    expect(i.seasonSlug).toBeNull();
  });
  test("S2 healer run with RIO", async () => {
    const i = collectInputs(await fixturePayload("s2-healer", true), cfg);
    expect(i.role).toBe("healer");
    expect(i.survival.wipeDeaths).toBe(1);
    expect(i.survival.groupDeaths).toBe(4);
    expect(i.utility.hasKick).toBe(false);
    expect(i.utility.dispels).toBe(9);
    expect(i.preparation.ilvl).toBe(322);
    expect(i.preparation.potions).toBe(5);
    expect(i.experience.activity).toBe(10);
    expect(i.experience.prevSeasonAll).toBe(4152.7);
    expect(i.seasonSlug).toBe("season-mn-2");
  });
});
