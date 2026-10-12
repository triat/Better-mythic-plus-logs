import { describe, expect, test } from "bun:test";
import type { DungeonRow, PillarKey, SeasonView } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { ownerDungeons, pillarHeat } from "./ownerDungeons.ts";

const tFr = makeT(fr, "fr");
type Five = [number | null, number | null, number | null, number | null, number | null];
const KEYS: PillarKey[] = ["damage", "survival", "avoidable", "interrupts", "control"];
const rec = (v: Five) => Object.fromEntries(KEYS.map((k, i) => [k, v[i]])) as Record<PillarKey, number | null>;

const NO_DETAILS = { avoidable: [], avoidableOther: 0, avoidableTotal: 0, killers: [], casts: [], control: [], controlRuns: 0 };
const dungeon = (id: number, name: string, pillars: Five, overall: number | null, runs: number, over: Partial<DungeonRow> = {}): DungeonRow => ({
  encounterID: id, name, runs, analysed: runs, overall, best: null, pillars: rec(pillars), details: NO_DETAILS, ...over,
});

// The mockup's grid (F-Moi-Donjons), given in a shuffled order.
const KR = dungeon(1, "Kings' Rest", [43, 89, 72, 58, 64], 63, 8, {
  details: {
    avoidable: [{ id: 11, name: "Hunting Leap", total: 43 }, { id: 12, name: "Whirling Axe", total: 12 }], avoidableOther: 45, avoidableTotal: 100,
    killers: [{ id: 21, ability: "Barrel Through", deaths: 1 }],
    casts: [{ id: 31, name: "Spectral Bolt", attempts: 183, completed: 59, interrupted: 124, mine: 36 }, { id: 32, name: "Hex", attempts: 0, completed: 0, interrupted: 0, mine: 0 }],
    control: [{ id: 41, name: "Capacitor Totem", category: "stun", uses: 34, enemies: 176 }, { id: 42, name: "Thunderstorm", category: "knock", uses: 21, enemies: 0 }],
    controlRuns: 8,
  },
});
const DUNGEONS = [
  dungeon(2, "Murder Row", [56, 84, 89, 84, 86], 73, 18),
  dungeon(3, "The Blinding Vale", [39, 83, 82, 77, 81], 66, 8),
  dungeon(4, "Unplayed Depths", [null, null, null, null, null], null, 1, { analysed: 0 }),
  KR,
  dungeon(5, "Voidscar Arena", [69, 92, 55, 62, 38], 70, 17),
  dungeon(6, "Ruby Life Pools", [49, 91, 90, 71, 63], 70, 10),
];

const season = (over: Partial<SeasonView> = {}): SeasonView => ({
  character: { name: "Biwaasham", realm: "hyjal", region: "eu" }, zoneID: 55, targetLevel: 19, currentWeek: 10, checkedAt: 0,
  state: { runs: 94, analysed: 94, pending: 0, controlOnly: 0, failed: 0, estimate: 0 },
  runs: [], recent: null,
  season: { runs: 94, pillars: KEYS.map((key, i) => ({ key, score: [64, 64, 79, 71, 70][i]!, evidence: [] })), overall: 66.4 },
  trends: [], workOn: [], dungeons: DUNGEONS,
  ...over,
});

describe("pillarHeat", () => {
  test("thresholds 45 / 55 / 70 / 85, none for null", () => {
    expect([44, 45, 54, 55, 69, 70, 84, 85].map(pillarHeat)).toEqual(["heat-1", "heat-2", "heat-2", "heat-3", "heat-3", "heat-4", "heat-4", "heat-5"]);
    expect(pillarHeat(0)).toBe("heat-1");
    expect(pillarHeat(100)).toBe("heat-5");
    expect(pillarHeat(null)).toBe("");
  });
});

describe("ownerDungeons · grid", () => {
  test("weakest overall first, a dungeon without overall last", () => {
    const v = ownerDungeons(tEn, "en", season(), null);
    expect(v.rows.map((r) => [r.abbr, r.overall, r.runs])).toEqual([
      ["KR", "63", "8"], ["BV", "66", "8"], ["VA", "70", "17"], ["RL", "70", "10"], ["MR", "73", "18"], ["UD", "—", "1"],
    ]);
  });
  test("the season row: the whole season's pillars, overall and runs, never ringed", () => {
    const v = ownerDungeons(tFr, "fr", season(), null);
    expect(v.season).toEqual({
      cells: [
        { key: "damage", text: "64", heat: "heat-3", weakest: false }, { key: "survival", text: "64", heat: "heat-3", weakest: false },
        { key: "avoidable", text: "79", heat: "heat-4", weakest: false }, { key: "interrupts", text: "71", heat: "heat-4", weakest: false },
        { key: "control", text: "70", heat: "heat-4", weakest: false },
      ],
      overall: "66",
      runs: "94",
    });
    expect(v.columns.map((c) => c.label)).toEqual(["Dégâts", "Survie", "Évitable", "Kicks", "Contrôle"]);
    const empty = ownerDungeons(tEn, "en", season({ season: null, dungeons: [] }), null);
    expect(empty.season.cells.map((c) => [c.text, c.heat])).toEqual(Array(5).fill(["—", ""]));
    expect(empty.season.overall).toBe("—");
    expect(empty.rows).toEqual([]);
    expect(empty.detail).toBeNull();
  });
  test("the ring sits on the row's lowest pillar, the first one on a tie", () => {
    const v = ownerDungeons(tEn, "en", season(), null);
    const ring = (abbr: string) => v.rows.find((r) => r.abbr === abbr)!.cells.filter((c) => c.weakest).map((c) => c.key);
    expect(ring("KR")).toEqual(["damage"]);
    expect(ring("VA")).toEqual(["control"]);
    expect(ring("UD")).toEqual([]);
    const tie = ownerDungeons(tEn, "en", season({ dungeons: [dungeon(9, "Tie Hall", [60, 50, 50, null, 70], 58, 3)] }), null);
    expect(tie.rows[0]!.cells.map((c) => [c.text, c.heat, c.weakest])).toEqual([
      ["60", "heat-3", false], ["50", "heat-2", true], ["50", "heat-2", false], ["—", "", false], ["70", "heat-4", false],
    ]);
  });
  test("the selected dungeon, else the first row", () => {
    expect(ownerDungeons(tEn, "en", season(), null).rows.filter((r) => r.selected).map((r) => r.abbr)).toEqual(["KR"]);
    expect(ownerDungeons(tEn, "en", season(), 2).rows.filter((r) => r.selected).map((r) => r.abbr)).toEqual(["MR"]);
    expect(ownerDungeons(tEn, "en", season(), 999).detail!.title).toBe("Kings' Rest");
  });
});

describe("ownerDungeons · detail", () => {
  test("the mockup's Kings' Rest (French): sub, weak point, the comparison with the season", () => {
    const d = ownerDungeons(tFr, "fr", season(), 1).detail!;
    expect(d).toMatchObject({ encounterID: 1, abbr: "KR", title: "Kings' Rest", sub: "8 runs · global 63" });
    expect(d.weak).toEqual({ text: "Point faible : Dégâts 43", heat: "heat-1" });
    expect(d.compare).toEqual({ lead: "Dégâts 43 ici", rest: ", 21 points sous ta moyenne saison (64). Ton meilleur pilier y est Survie (89)." });
    expect(d.runs).toEqual({ label: "Les 8 runs", encounterID: 1 });
    expect(d.empty).toBeNull();
  });
  test("the blocks: dungeonPanel's, and the spells as through / cast bars", () => {
    const d = ownerDungeons(tFr, "fr", season(), 1).detail!;
    expect(d.panel.avoidable.map((a) => [a.name, a.width])).toEqual([["Hunting Leap", 43], ["Whirling Axe", 12]]);
    expect(d.panel.other).toMatchObject({ width: 45 });
    expect(d.panel.killers).toEqual([{ id: 21, ability: "Barrel Through", deaths: "1 mort" }]);
    expect(d.panel.control.map((c) => [c.name, c.uses, c.enemies])).toEqual([["Capacitor Totem", "34 utilisations", "176 ennemis"], ["Thunderstorm", "21 utilisations", ""]]);
    expect(d.panel.controlNote).toBe(tFr("self.panel.controlOver", { runs: 8 }));
    expect(d.casts).toEqual([
      { id: 31, name: "Spectral Bolt", width: 32, passed: "59 / 183", mine: "36" },
      { id: 32, name: "Hex", width: 0, passed: "0 / 0", mine: "0" },
    ]);
  });
  test("above, equal to and without the season's pillar; no best sentence when the best is the weakest", () => {
    const one = (pillars: Five, seasonDamage: number | null) => ownerDungeons(tEn, "en", season({
      season: seasonDamage === null ? null : { runs: 40, pillars: [{ key: "damage", score: seasonDamage, evidence: [] }], overall: 60 },
      dungeons: [dungeon(1, "Kings' Rest", pillars, 70, 1)],
    }), null).detail!.compare;
    expect(one([71, 80, null, null, null], 64)).toEqual({ lead: "Damage 71 here", rest: ", 7 points over your season average (64). Your best pillar there is Survival (80)." });
    expect(one([63, null, null, null, null], 64)).toEqual({ lead: "Damage 63 here", rest: ", 1 point under your season average (64)." });
    expect(one([64, 64, null, null, null], 64)).toEqual({ lead: "Damage 64 here", rest: ", like your season average (64)." });
    expect(one([50, 90, null, null, null], null)).toEqual({ lead: "Damage 50 here", rest: ". Your best pillar there is Survival (90)." });
  });
  test("no scored pillar and no analysed run: no weak point, no comparison, the empty text", () => {
    const d = ownerDungeons(tEn, "en", season(), 4).detail!;
    expect(d.sub).toBe("1 run");
    expect(d.weak).toBeNull();
    expect(d.compare).toBeNull();
    expect(d.runs.label).toBe("The run");
    expect(d.empty).toBe("No analysed run in this dungeon yet.");
  });
});
