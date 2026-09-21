import { describe, expect, test } from "bun:test";
import type { LookupPayload, MPlusRun, RunSignals } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { missingDungeons, runRows, runsHeadline, signalParts } from "./runs.ts";

const tFr = makeT(fr, "fr");

const sig = (over: Partial<RunSignals> = {}): RunSignals => ({
  role: "healer",
  keystone: { level: 21, chests: 1, timed: true, timeMs: 1_796_000, affixes: [] },
  itemLevel: 322,
  consumables: { potions: 5, healthstones: 1 },
  deaths: { count: 1, groupTotal: 4, events: [{ atMs: 1, cause: null, source: null, overkill: 0, inWipe: true }] },
  damageTaken: { total: 1, dtps: 9_000, peer: { median: 10_000, count: 3 } },
  interrupts: { count: 0, kickCooldownS: null, capacity: null, usage: null, peer: null },
  dispels: { count: 9, available: true },
  avoidableDamage: { total: 1, perMinute: 362_000, peer: { median: 390_000, count: 4 }, spellCount: 3 },
  fightDurationMs: 1_796_000,
  ...over,
});

const run = (over: Partial<MPlusRun> = {}): MPlusRun => ({
  encounterID: 12923, encounterName: "Voidscar Arena", keyLevel: 21, amount: 312_000, parsePercent: 79.4, spec: "Holy",
  affixes: [], reportCode: "ABC", fightID: 3, startTime: 0, score: 0, ...over,
});

const NOW = 10 * 86400e3; // 10 days after epoch

describe("signalParts", () => {
  test("healer without kick", () => {
    expect(signalParts(tEn, sig())).toEqual([
      { text: "1 death (1 in wipe)", cls: "tone-warn" },
      { text: "9.0k dtps −10% vs 3 dps", cls: "tone-good" },
      { text: "avoidable 362.0k/min (−7%)", cls: "" },
      { text: "kicks 0 (no kick on spec)", cls: "faint" },
      { text: "dispels 9", cls: "" },
      { text: "5 pots · 1 hs", cls: "" },
    ]);
  });
  test("no dispel on spec", () => {
    const parts = signalParts(tEn, sig({ dispels: { count: 0, available: false } }));
    expect(parts.find((p) => p.text.startsWith("dispels"))).toEqual({ text: "dispels 0 (no dispel on spec)", cls: "faint" });
  });
  test("dps with kicks and no peers", () => {
    const s = sig({
      deaths: { count: 0, groupTotal: 0, events: [] },
      damageTaken: { total: 1, dtps: 5_000, peer: null },
      interrupts: { count: 8, kickCooldownS: 15, capacity: 20, usage: 0.4, peer: { median: 0.3, count: 3 } },
      avoidableDamage: null,
      consumables: null,
    });
    expect(signalParts(tEn, s)).toEqual([
      { text: "0 deaths", cls: "tone-good" },
      { text: "5.0k dtps", cls: "" },
      { text: "kicks 8/20 (peer 30%)", cls: "tone-good" },
      { text: "dispels 9", cls: "" },
    ]);
  });
  test("French", () => {
    expect(signalParts(tFr, sig()).map((p) => p.text)).toEqual([
      "1 mort (1 en wipe)", "9.0k dtps −10% vs 3 dps", "évitable 362.0k/min (−7%)", "kicks 0 (pas de kick sur cette spec)", "dispels 9", "5 pots · 1 hs",
    ]);
    const s = sig({ deaths: { count: 0, groupTotal: 0, events: [] }, interrupts: { count: 8, kickCooldownS: 15, capacity: 20, usage: 0.4, peer: { median: 0.3, count: 3 } } });
    expect(signalParts(tFr, s).map((p) => p.text)).toContain("0 mort");
    expect(signalParts(tFr, s).map((p) => p.text)).toContain("kicks 8/20 (pairs 30 %)");
  });
});

describe("runRows", () => {
  const payload = (runs: MPlusRun[]): LookupPayload =>
    ({ metric: "hps", targetLevel: 21, seasonDungeons: [{ id: 12923, name: "Voidscar Arena" }, { id: 12825, name: "Den of Nalorakk" }],
       perDungeon: { runs, dungeonsCovered: runs.length, totalDungeonsInSeason: 2, dungeonsAtOrAboveTarget: 1, medianLevel: 21, medianAmount: 312_000, medianParse: 79.4 } }) as unknown as LookupPayload;

  test("row with signals", () => {
    const r = runRows(tEn, payload([run({ signals: sig(), startTime: NOW - 2 * 86400e3 })]), NOW)[0]!;
    expect(r).toMatchObject({
      key: "ABC:3", level: 21, keystone: { timed: true, text: "✓+1 29:56" }, dungeon: "Voidscar Arena",
      amount: "312.0k", metric: "hps", parse: "79.4%", parseCls: "tier-magenta", spec: "Holy", age: "2d ago", stale: false,
      url: "https://www.warcraftlogs.com/reports/ABC#fight=3",
    });
    expect(r.parts).toHaveLength(6);
  });
  test("a 0% parse renders as unranked", () => {
    const r = runRows(tEn, payload([run({ parsePercent: 0 })]), NOW)[0]!;
    expect(r.parse).toBe("unranked");
    expect(r.parseCls).toBe("faint");
  });
  test("depleted, stale, partial and no signals", () => {
    const rows = runRows(tEn, payload([
      run({ signals: sig({ keystone: { level: 20, chests: 0, timed: false, timeMs: 2_080_000, affixes: [] } }), startTime: NOW - 20 * 86400e3 }),
      run({ signals: sig({ partial: true }), reportCode: "P", startTime: NOW }),
      run({ reportCode: "N", startTime: NOW }),
    ]), NOW);
    expect(rows[0]!.keystone).toEqual({ timed: false, text: "✗ depleted 34:40" });
    expect(rows[0]!.stale).toBe(true);
    expect(rows[1]!.keystone).toBeNull();
    expect(rows[2]!.keystone).toBeNull();
    expect(rows[2]!.parts).toEqual([]);
  });
  test("missing dungeons and headline", () => {
    const p = payload([run()]);
    expect(missingDungeons(p)).toEqual(["Den of Nalorakk"]);
    expect(runsHeadline(tEn, p)).toBe("1/2 dungeons · median +21, 312.0k hps, 79.4% · 1/2 at or above +21");
    expect(runsHeadline(tFr, p)).toBe("1/2 donjons · médiane +21, 312.0k hps, 79.4 % · 1/2 au niveau +21 ou plus");
  });
  test("French rows: keystone, unranked, age", () => {
    const rows = runRows(tFr, payload([
      run({ signals: sig(), startTime: NOW - 2 * 86400e3 }),
      run({ signals: sig({ keystone: { level: 20, chests: 0, timed: false, timeMs: 2_080_000, affixes: [] } }), reportCode: "D", parsePercent: 0, startTime: NOW }),
    ]), NOW);
    expect(rows[0]).toMatchObject({ keystone: { timed: true, text: "✓+1 29:56" }, age: "il y a 2 j" });
    expect(rows[1]).toMatchObject({ keystone: { timed: false, text: "✗ depleted 34:40" }, parse: "non classé" });
  });
});
