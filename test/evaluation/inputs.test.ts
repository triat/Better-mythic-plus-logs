import { describe, expect, test } from "bun:test";
import { collectInputs, detectRole, evalRuns } from "../../src/evaluation/inputs.ts";
import { deaths, fixturePayload, payloadWith, runWith } from "./helpers.ts";

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
    const i = collectInputs(p);
    expect(i.runsUsed).toBe(2);
    expect(i.survival.individualDeaths).toBe(0.5);
    expect(i.survival.wipeDeaths).toBe(0.5);
    expect(i.survival.groupDeaths).toBe(2.5);       // (5-2 + 2-0)/2
    expect(i.survival.dtpsVsPeers).toBe(-5);        // median of +10, -20
    expect(i.survival.avoidableVsPeers).toBe(-10);
    expect(collectInputs(payloadWith([runWith(null)])).survival.individualDeaths).toBeNull();
  });
});

describe("collectInputs — utility", () => {
  test("kick usage vs peers, absolute, dispels, hasKick", () => {
    const p = payloadWith([
      runWith({ interrupts: { count: 5, kickCooldownS: 15, capacity: 100, usage: 0.3, peer: { median: 0.2, count: 3 } }, dispels: { count: 4 } }),
      runWith({ interrupts: { count: 1, kickCooldownS: 15, capacity: 100, usage: 0.1, peer: { median: 0.2, count: 3 } }, dispels: { count: 0 } }),
    ]);
    const i = collectInputs(p);
    expect(i.utility.hasKick).toBe(true);
    expect(i.utility.kicksVsPeers).toBe(0);          // median of +10, -10
    expect(i.utility.kicksAbsolute).toBeCloseTo(0.2, 9);
    expect(i.utility.dispels).toBe(2);
    expect(i.utility.anyDispel).toBe(true);
    const noKick = collectInputs(payloadWith([runWith({})]));
    expect(noKick.utility.hasKick).toBe(false);
    expect(noKick.utility.kicksVsPeers).toBeNull();
    expect(noKick.utility.anyDispel).toBe(false);
  });
});

describe("collectInputs — throughput / consistency / preparation / experience", () => {
  test("parseAtTarget uses runs ≥ target-1 (with or without signals)", () => {
    const p = payloadWith([runWith({}, { keyLevel: 15, parsePercent: 90 }), runWith(null, { keyLevel: 14, parsePercent: 50 }), runWith(null, { keyLevel: 10, parsePercent: 10 })]);
    const i = collectInputs(p);
    expect(i.throughput.medianParse).toBe(50);
    expect(i.throughput.parseAtTarget).toBe(70);
  });
  test("consistency spreads need ≥2 samples", () => {
    const one = collectInputs(payloadWith([runWith({})]));
    expect(one.consistency.parseSpread).toBeNull();
    const two = collectInputs(payloadWith([runWith({ deaths: deaths(2) }, { parsePercent: 60 }), runWith({ deaths: deaths(0) }, { parsePercent: 80 })]));
    expect(two.consistency.sample).toBe(2);
    expect(two.consistency.parseSpread).toBe(10);
    expect(two.consistency.deathsSpread).toBe(1);
    expect(two.consistency.damageSpread).toBeNull();
  });
  test("preparation and experience", () => {
    const p = payloadWith(
      [runWith({ consumables: { potions: 6, healthstones: 2 } }, { keyLevel: 16 }), runWith({ consumables: { potions: 2, healthstones: 0 } }, { keyLevel: 14 }), runWith({})],
      { targetLevel: 15 },
    );
    const i = collectInputs(p);
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
    const i = collectInputs(await fixturePayload("s1-tank", false));
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
    const i = collectInputs(await fixturePayload("s2-healer", true));
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
