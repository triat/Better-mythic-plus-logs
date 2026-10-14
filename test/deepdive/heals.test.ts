import { describe, expect, test } from "bun:test";
import { analyzeRun, type AnalyzeInput } from "../../src/deepdive/analyze.ts";
import { dangerStart, hpAt, judgeHeals } from "../../src/deepdive/heals.ts";
import { SHIPPED, specDefensives } from "../../src/deepdive/table.ts";
import type { DeathHealth, HealRules, RawDeepDive } from "../../src/deepdive/types.ts";
import { healthOf } from "../../src/deepdive/wcl.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadDeepdiveFixture } from "../fixtures.ts";

const rules: HealRules = {
  dangerHpShare: 0.5,
  reactionMs: 700,
  tools: [
    { name: "Health potion", ids: [10], cooldownS: 300, flat: 400 },
    { name: "Healthstone", ids: [20], cooldownS: 60, maxHpShare: 0.25, groupClass: "Warlock" },
  ],
};
const raw = (casts: Array<[id: number, ts: number]> = []): RawDeepDive => ({
  code: "SYN", fightID: 1, character: "Me", actorID: 1, fightStart: 0, fightEnd: 600_000, casts: null, buffs: null,
  castEvents: casts.map(([abilityGameID, timestamp]) => ({ abilityGameID, timestamp })), tableIds: [10, 20], truncated: false, fetchedAt: 0, pointsSpent: null,
});
// maxHp 1000, death at 100 000; health after each event.
const health = (points: Array<[ts: number, hp: number]>): DeathHealth & { maxHp: number } =>
  ({ deathTs: 100_000, maxHp: 1000, curve: points.map(([ts, hp]) => ({ ts, hp })) });
const judge = (h: DeathHealth & { maxHp: number }, opts: { overkill?: number; casts?: Array<[number, number]>; group?: string[] } = {}) =>
  judgeHeals({ rules, raw: raw(opts.casts), health: h, overkill: opts.overkill ?? 100, groupClasses: opts.group ?? ["Rogue"] });

describe("dangerStart / hpAt", () => {
  test("the last stretch under the line, the killing hit excluded", () => {
    const h = health([[96_000, 400], [97_000, 800], [98_000, 450], [99_000, 200], [100_000, 0]]);
    expect(dangerStart(h, 500)).toBe(98_000);
    expect(hpAt(h, 98_500, 1000)).toBe(450);
    expect(hpAt(h, 100_000, 1000)).toBe(200);
    expect(hpAt(health([]), 99_000, 1000)).toBe(1000);
  });
  test("never under the line before the killing hit → null", () => {
    expect(dangerStart(health([[99_000, 900], [100_000, 0]]), 500)).toBeNull();
  });
});

describe("judgeHeals", () => {
  test("in danger long enough, ready, heal over the overkill → saves", () => {
    const r = judge(health([[98_000, 300], [100_000, 0]]), { overkill: 250 });
    expect(r.dangerMs).toBe(2000);
    expect(r.heals).toEqual([
      { name: "Health potion", status: "saves", heal: 400 },
      { name: "Healthstone", status: "not in group", heal: null },
    ]);
  });
  test("danger less than the reaction time before death → no time", () => {
    const r = judge(health([[99_500, 300], [100_000, 0]]));
    expect(r.dangerMs).toBe(500);
    expect(r.heals[0]).toEqual({ name: "Health potion", status: "no time", heal: null });
  });
  test("from full to dead in one hit → no time", () => {
    expect(judge(health([[100_000, 0]])).heals[0]!.status).toBe("no time");
  });
  test("the danger restarts when health goes back over the line; a heal under the overkill → not enough", () => {
    const h = health([[95_000, 450], [96_000, 300], [96_600, 900], [98_700, 450], [100_000, 0]]);
    expect(judge(h).dangerMs).toBe(1300);
    expect(judge(h, { overkill: 450 }).heals[0]).toEqual({ name: "Health potion", status: "not enough", heal: 400 });
  });
  test("the heal is capped by the room under max health", () => {
    const big: HealRules = { ...rules, dangerHpShare: 0.9, tools: [{ name: "Big", ids: [10], cooldownS: 300, flat: 5000 }] };
    const r = judgeHeals({ rules: big, raw: raw(), health: health([[98_000, 850], [100_000, 0]]), overkill: 100, groupClasses: [] });
    expect(r.heals[0]).toEqual({ name: "Big", status: "saves", heal: 150 });
  });
  test("used within its cooldown → on cooldown; the healthstone with a Warlock is a share of max health", () => {
    const r = judge(health([[98_000, 300], [100_000, 0]]), { casts: [[10, 50_000]], group: ["Rogue", "Warlock"], overkill: 200 });
    expect(r.heals).toEqual([
      { name: "Health potion", status: "on cooldown", heal: null, readyInS: 251 },
      { name: "Healthstone", status: "saves", heal: 250 },
    ]);
  });
  test("a tool whose ids were not in the cast filter is not judged", () => {
    const r = judgeHeals({ rules, raw: { ...raw(), tableIds: [10] }, health: health([[98_000, 300]]), overkill: 100, groupClasses: ["Warlock"] });
    expect(r.heals.map((h) => h.name)).toEqual(["Health potion"]);
  });
});

describe("healthOf — real events (Temple of Sethraliss, Casualaddict's first death)", () => {
  test("health after each event, the healer's own health ignored, max health", async () => {
    const f = JSON.parse(await Bun.file(new URL("../fixtures/death-health-s2-rogue.json", import.meta.url)).text());
    const h = healthOf(f.deathTs, f.actorID, [...f.damage, ...f.healing]);
    expect(h.maxHp).toBe(771120);
    expect(h.curve.at(-1)).toEqual({ ts: 7593415, hp: 0 });
    expect(h.curve.every((p) => p.hp <= 771120)).toBe(true);
    expect(dangerStart(h, 0.5 * 771120)).toBe(7593415 - 1526); // 551 757 → 219 270 on Ticking Time Bomb
  });
  test("the analysis: one health potion ready 1.5 s into danger, enough for the 121k overkill", async () => {
    const f = await loadDeepdiveFixture("s2-rogue");
    const hf = JSON.parse(await Bun.file(new URL("../fixtures/death-health-s2-rogue.json", import.meta.url)).text());
    const signals = parseRunSignals(f.report, f.character, { keyLevel: f.run.keyLevel, affixes: f.run.affixes, encounterID: f.run.encounterID })!;
    const deathHealth = [healthOf(hf.deathTs, hf.actorID, [...hf.damage, ...hf.healing])];
    const input: AnalyzeInput = {
      raw: { ...f.deepdive, deathHealth, tableIds: [...f.deepdive.tableIds, 1234768, 1295247, 6262, 452930] },
      report: f.report, signals, character: f.character, className: "Rogue", spec: "Assassination",
      table: specDefensives(SHIPPED, {}, "Rogue", "Assassination"), tableVersion: SHIPPED.version, denylist: SHIPPED.denylist, heals: SHIPPED.heals,
    };
    const r = analyzeRun(input);
    const d = r.deaths.find((x) => x.atMs === hf.deathTs - f.deepdive.fightStart)!;
    expect(d.health).toEqual({ maxHp: 771120, hpBefore: 48308, killingHit: 169660, overkill: 121352, dangerMs: 1526, oneShot: false });
    expect(d.heals![0]).toEqual({ name: "Health potion", status: "saves", heal: 370000 });
    expect(d.heals![1]).toEqual({ name: "Healthstone", status: "not in group", heal: null });
    // The second death has no health window in this fixture: judged by the defensives alone, and the panel says so.
    expect(r.deaths.find((x) => x !== d)!.health).toBeUndefined();
    expect(r.healthMissing).toBe(true);
    expect(analyzeRun({ ...input, raw: { ...input.raw, deathHealth: [...deathHealth, healthOf(8547657, 5, [{ timestamp: 8547657, type: "damage", targetID: 5, resourceActor: 2, hitPoints: 0, maxHitPoints: 771120 }])] } }).healthMissing).toBeUndefined();
    expect(analyzeRun({ ...input, raw: f.deepdive }).healthMissing).toBe(true);
  });
});
