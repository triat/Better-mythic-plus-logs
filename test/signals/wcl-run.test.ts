import { describe, expect, test } from "bun:test";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadWclFixture } from "../fixtures.ts";

const fb = (f: any) => ({ keyLevel: f.run.keyLevel, affixes: f.run.affixes, encounterID: f.run.encounterID });

describe("parseRunSignals — S1 tank (Biwaadrood, Magisters' Terrace +18)", () => {
  test("keystone, role, ilvl, duration", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", fb(f))!;
    expect(s.keystone).toEqual({ level: 18, chests: 1, timed: true, timeMs: 1751502, affixes: [10, 9, 147] });
    expect(s.role).toBe("tank");
    expect(s.itemLevel).toBe(280);
    expect(s.fightDurationMs).toBe(1700498);
    expect(s.partial).toBeUndefined();
  });

  test("tank gets no damage-taken peer comparison", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", fb(f))!;
    expect(s.damageTaken.total).toBe(112246233);
    expect(s.damageTaken.dtps).toBeCloseTo(112246233 / 1700.498, 0);
    expect(s.damageTaken.peer).toBeNull();
  });

  test("a DPS is compared to the other DPS on damage taken", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Mstercheif", fb(f))!;
    // peers = Mariabanks 32707271, Forssaken 34730334 → median 33718802.5 dtps-normalized
    expect(s.damageTaken.peer!.count).toBe(2);
    expect(s.damageTaken.peer!.median).toBeCloseTo(33718802.5 / 1700.498, 0);
  });

  test("interrupts: count, cooldown-normalized usage, peers on usage", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", fb(f))!;
    expect(s.interrupts.count).toBe(23);
    expect(s.interrupts.kickCooldownS).toBe(15);
    expect(s.interrupts.capacity).toBeCloseTo(1700.498 / 15, 3);
    expect(s.interrupts.usage).toBeCloseTo(23 / (1700.498 / 15), 4);
    // peers = dps+tank with a kick, excluding target: Mariabanks (24 s), Forssaken (15 s), Mstercheif (15 s)
    expect(s.interrupts.peer!.count).toBe(3);
    const usages = [16 / (1700.498 / 24), 24 / (1700.498 / 15), 16 / (1700.498 / 15)].sort((a, b) => a - b);
    expect(s.interrupts.peer!.median).toBeCloseTo(usages[1]!, 4);
  });

  test("Restoration Shaman healer keeps its Wind Shear (12 s)", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Aicham", fb(f))!;
    expect(s.interrupts.kickCooldownS).toBe(12);
    expect(s.interrupts.count).toBe(4);
    expect(s.dispels.count).toBe(37);
  });

  test("dispels: player absent from the table → 0", async () => {
    const f = await loadWclFixture("s1-tank");
    expect(parseRunSignals(f.report, "Biwaadrood", fb(f))!.dispels.count).toBe(0);
    expect(parseRunSignals(f.report, "Mariabanks", fb(f))!.dispels.count).toBe(21);
  });

  test("deaths with context, no wipe", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Mstercheif", fb(f))!;
    expect(s.deaths.count).toBe(3);
    expect(s.deaths.groupTotal).toBe(4);
    expect(s.deaths.events[0]).toEqual({
      atMs: 98742, cause: "Holy Fire", source: "Lightward Healer", overkill: 11498, inWipe: false,
      killingHits: [
        { ability: "Holy Fire", abilityId: 1255187, amount: 99796, overkill: 11498, friendly: false, instakill: false },
        { ability: "Holy Fire", abilityId: 1255187, amount: 102686, overkill: 0, friendly: false, instakill: false },
        { ability: "Holy Fire", abilityId: 1255187, amount: 105729, overkill: 0, friendly: false, instakill: false },
      ],
    });
    expect(s.deaths.events.map((e) => e.inWipe)).toEqual([false, false, false]);
  });

  test("no avoidable list for an S1 dungeon → null", async () => {
    const f = await loadWclFixture("s1-tank");
    expect(parseRunSignals(f.report, "Biwaadrood", fb(f))!.avoidableDamage).toBeNull();
  });
});

describe("parseRunSignals — S2 healer (Muleyoxo, Voidscar Arena +21)", () => {
  test("Holy Priest has no kick: usage null, still reports the count", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    expect(s.role).toBe("healer");
    expect(s.interrupts.count).toBe(1);
    expect(s.interrupts.kickCooldownS).toBeNull();
    expect(s.interrupts.usage).toBeNull();
    // peers still computed (dps + tank with a kick): Deeprayaa 12 s, Bizentein 15 s, Wazocutie 15 s, Zerøcool 15 s
    expect(s.interrupts.peer!.count).toBe(4);
  });

  test("avoidable damage with all-other-players peers", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    const minutes = 1775032 / 60000;
    expect(s.avoidableDamage).not.toBeNull();
    expect(s.avoidableDamage!.total).toBe(10724909);
    expect(s.avoidableDamage!.perMinute).toBeCloseTo(10724909 / minutes, 0);
    expect(s.avoidableDamage!.peer!.count).toBe(4);
    // peers per minute: 11199439, 12634574, 17051476, 11507332 → median (11507332+12634574)/2
    expect(s.avoidableDamage!.peer!.median).toBeCloseTo(((11507332 + 12634574) / 2) / minutes, 0);
    expect(s.avoidableDamage!.spellCount).toBeGreaterThan(5);
  });

  test("wipe detection: three deaths within 15 s", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    expect(s.deaths.count).toBe(1);
    expect(s.deaths.events[0]!.atMs).toBe(1764223);
    expect(s.deaths.events[0]!.inWipe).toBe(true);
    const d = parseRunSignals(f.report, "Deeprayaa", fb(f))!;
    expect(d.deaths.events.map((e) => e.inWipe)).toEqual([false, true]);
  });
});

describe("parseRunSignals — degraded inputs", () => {
  test("null report → null", () => {
    expect(parseRunSignals(null, "X", { keyLevel: 10, affixes: [9], encounterID: 1 })).toBeNull();
  });

  test("missing fights → keystone from fallback, partial flag", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals({ ...f.report, fights: [] }, "Biwaadrood", fb(f))!;
    expect(s.partial).toBe(true);
    expect(s.keystone).toEqual({ level: 18, chests: 0, timed: false, timeMs: 0, affixes: f.run.affixes });
  });

  test("missing interrupts/dispels tables → zero counts, null peers", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals({ ...f.report, interrupts: null, dispels: null }, "Biwaadrood", fb(f))!;
    expect(s.interrupts.count).toBe(0);
    expect(s.interrupts.peer).toBeNull();
    expect(s.dispels.count).toBe(0);
  });

  test("character not in composition → role unknown, ilvl null", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Nobody", fb(f))!;
    expect(s.role).toBe("unknown");
    expect(s.itemLevel).toBeNull();
    expect(s.deaths.count).toBe(0);
  });
});

describe("parseRunSignals — consumables", () => {
  test("potions and healthstones from playerDetails", async () => {
    const f = await loadWclFixture("s1-tank");
    const fb = { keyLevel: 18, affixes: f.run.affixes, encounterID: f.run.encounterID };
    expect(parseRunSignals(f.report, "Mstercheif", fb)!.consumables).toEqual({ potions: 6, healthstones: 3 });
    expect(parseRunSignals(f.report, "Biwaadrood", fb)!.consumables).toEqual({ potions: 1, healthstones: 0 });
  });
  test("player absent from playerDetails → null", async () => {
    const f = await loadWclFixture("s1-tank");
    const fb = { keyLevel: 18, affixes: f.run.affixes, encounterID: f.run.encounterID };
    expect(parseRunSignals(f.report, "Nobody", fb)!.consumables).toBeNull();
    expect(parseRunSignals({ ...f.report, summary: null }, "Biwaadrood", fb)!.consumables).toBeNull();
  });
});

describe("parseRunSignals — self-review details (issue #24 § 3)", () => {
  test("killing hits are the death's events, newest first; cause is unchanged", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    expect(s.deaths.events).toHaveLength(1);
    const d = s.deaths.events[0]!;
    expect(d.cause).toBe("Cosmic Crash");
    expect(d.killingHits).toEqual([
      { ability: "Unstable Singularity", abilityId: 1264188, amount: 15613, overkill: 18667, friendly: false, instakill: false },
      { ability: "Unstable Singularity", abilityId: 1264188, amount: 34279, overkill: 0, friendly: false, instakill: false },
      { ability: "Cosmic Crash", abilityId: 1300372, amount: 56623, overkill: 0, friendly: false, instakill: false },
    ]);
  });

  test("a self-inflicted hit is marked friendly", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Deeprayaa", fb(f))!;
    expect(s.deaths.events[0]!.killingHits![2]).toEqual(
      { ability: "Rune of Void-Tainted Shell", abilityId: 1287955, amount: 763, overkill: 0, friendly: true, instakill: false });
  });

  test("avoidable abilities of the player, the remainder as other", async () => {
    const f = await loadWclFixture("s2-healer");
    expect(parseRunSignals(f.report, "Wazocutie", fb(f))!.avoidableDamage).toMatchObject({
      total: 17051476,
      abilities: [
        { id: 1264188, name: "Unstable Singularity", total: 11592618 },
        { id: 1249712, name: "Venomous Spit", total: 3174069 },
        { id: 1296963, name: "Umbral Rupture", total: 2284789 },
      ],
      other: 0,
    });
    // WCL keeps the top five abilities only: anything above their sum is "other".
    const capped = structuredClone(f.report);
    const entry = capped.avoidable.data.entries.find((e: { name: string }) => e.name === "Muleyoxo");
    entry.total += 5000;
    expect(parseRunSignals(capped, "Muleyoxo", fb(f))!.avoidableDamage!.other).toBe(5000);
  });

  test("enemy casts: attempts, completions, interrupts, the player's own kicks", async () => {
    const f = await loadWclFixture("s2-healer");
    const casts = parseRunSignals(f.report, "Muleyoxo", fb(f))!.interrupts.enemyCasts!;
    expect(casts).toHaveLength(6);
    expect(casts[0]).toEqual({ id: 1228176, name: "Lava Bolt", attempts: 40, completed: 11, interrupted: 27, mine: 1 });
    // A channel: 0 begun, yet completed and interrupted.
    expect(casts.find((c) => c.id === 1310324)).toEqual({ id: 1310324, name: "Mending Void", attempts: 42, completed: 25, interrupted: 17, mine: 0 });
  });
});
