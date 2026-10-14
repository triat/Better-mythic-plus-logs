// Test fixture (imported by tests only, never by the app): the mockups' Vachâman, Elemental Shaman, eight best runs
// (docs/design/redesign/F-Runs.dc.html and F-Run.dc.html) with Temple of Sethraliss analysed — 3 deaths at 1:53 / 13:45
// / 17:50, Astral Shift available at 13:45 and on cooldown 41 s / 32 s at the other two, Earth Elemental 94 s at 13:45.
import type { DefensiveUse, LookupPayload, MPlusRun, RunDefensives, RunSignals } from "../types.ts";

export const NOW = Date.UTC(2026, 9, 12, 12);
const H = 3600e3;

export const sig = (over: Partial<RunSignals> = {}): RunSignals => ({
  role: "dps",
  keystone: { level: 20, chests: 1, timed: true, timeMs: 1_831_000, affixes: [] },
  itemLevel: 700,
  consumables: { potions: 1, healthstones: 1 },
  deaths: { count: 0, groupTotal: 0, events: [] },
  damageTaken: { total: 1, dtps: 100_000, peer: { median: 100_000, count: 4 } },
  interrupts: { count: 37, kickCooldownS: 12.5, capacity: 146.2, usage: 37 / 146.2, peer: { median: 0.32, count: 4 } },
  dispels: { count: 8, available: true },
  avoidableDamage: { total: 0, perMinute: 0, peer: { median: 50_000, count: 4 }, spellCount: 5 },
  fightDurationMs: 1_831_000,
  ...over,
});

const death = (atMs: number, cause: string, hits: [string, number, number][]): RunSignals["deaths"]["events"][number] => ({
  atMs, cause, source: null, overkill: 0, inWipe: false,
  killingHits: hits.map(([ability, abilityId, amount]) => ({ ability, abilityId, amount, overkill: 0, friendly: false, instakill: false })),
});

// [code, dungeon, encounterID, level, clear ms, deaths, parse, dtps Δ%, avoidable Δ%, kicks, capacity, age h]
const RUNS: [string, string, number, number, number, number, number, number, number, number, number, number][] = [
  ["TS", "Temple of Sethraliss", 1, 20, 1_831_000, 3, 72.2, 14, -100, 37, 146.2, 22],
  ["VA", "Voidscar Arena", 2, 19, 1_724_000, 0, 68.3, -2, 4, 20, 144, 96],
  ["KR", "Kings' Rest", 3, 20, 1_893_000, 0, 64.4, 1, -10, 24, 158, 24],
  ["AF", "Altar of Fangs", 4, 19, 1_699_000, 0, 61.0, 13, -26, 59, 142, 7],
  ["RL", "Ruby Life Pools", 5, 19, 1_612_000, 0, 56.7, -5, -59, 42, 135, 144],
  ["BV", "The Blinding Vale", 6, 20, 1_718_000, 1, 47.1, -4, -100, 61, 139, 3],
  ["DN", "Den of Nalorakk", 7, 20, 1_882_000, 1, 38.3, 4, 11, 55, 154, 24],
  ["MR", "Murder Row", 8, 20, 1_772_000, 0, 23.0, -6, -40, 85, 142, 23],
];

const TS_DEATHS = [
  death(113_000, "Ground Pound", [["Ground Pound", 1001, 710_000], ["Slither Strike", 1002, 290_000]]),
  death(825_000, "Storm Strikes", [["Storm Strikes", 1003, 900_000]]),
  death(1_070_000, "Spark Step", [["Spark Step", 1004, 620_000], ["Release Charge", 1005, 380_000]]),
];

export const runs: MPlusRun[] = RUNS.map(([code, name, id, level, ms, deaths, parse, dtps, av, kicks, cap, age]) => ({
  encounterID: id, encounterName: name, keyLevel: level, amount: 400_000, parsePercent: parse, spec: "Elemental",
  affixes: [], reportCode: code, fightID: 1, startTime: NOW - age * H, score: 0, timed: true, durationMs: ms,
  signals: sig({
    keystone: { level, chests: 1, timed: true, timeMs: ms, affixes: [] },
    fightDurationMs: ms,
    deaths: {
      count: deaths, groupTotal: deaths + 2,
      events: code === "TS" ? TS_DEATHS : Array.from({ length: deaths }, (_, i) => death(600_000 + i * 60_000, "Lightning", [])),
    },
    damageTaken: { total: 1, dtps: 100_000 * (1 + dtps / 100), peer: { median: 100_000, count: 4 } },
    avoidableDamage: {
      total: 0, perMinute: 50_000 * (1 + av / 100), peer: { median: 50_000, count: 4 }, spellCount: 5,
      ...(code === "TS" ? { abilities: [] } : { abilities: [{ id: 2001, name: "Static Pool", total: 1_200_000 }], other: 300_000 }),
    },
    interrupts: {
      count: kicks, kickCooldownS: 12.5, capacity: cap, usage: kicks / cap, peer: { median: 0.32, count: 4 },
      enemyCasts: [
        { id: 3001, name: "Lightning Bolt", attempts: 12, completed: 4, interrupted: 8, mine: 3 },
        { id: 3002, name: "Healing Wave", attempts: 6, completed: 1, interrupted: 5, mine: 2 },
      ],
    },
    consumables: { potions: code === "TS" ? 0 : 1, healthstones: 1 },
  }),
}));

export const temple: MPlusRun = runs[0]!;

const use = (id: number, name: string, kind: DefensiveUse["kind"], cooldownS: number, casts: number, capacity: number, castsAtMs: number[]): DefensiveUse => ({
  id, name, kind, cooldownS, durationS: kind === "minor" ? 0 : 12, origin: "shipped", casts, capacity, usage: Math.min(1, casts / capacity),
  observedMinIntervalS: null, cdMismatch: false, castsAtMs,
});

export const templeAnalysis: RunDefensives = {
  reportCode: "TS", fightID: 1, character: "Vachâman", className: "Shaman", spec: "Elemental", tableMissing: false, tableVersion: "mn-2.x",
  defensives: [
    use(108271, "Astral Shift", "major", 120, 10, 15, [32_000, 192_000, 330_000, 470_000, 610_000, 950_000, 1_100_000, 1_250_000, 1_430_000, 1_650_000]),
    use(198103, "Earth Elemental", "major", 300, 3, 6, [400_000, 731_000, 1_300_000]),
  ],
  deaths: [
    {
      atMs: 113_000, inWipe: false, killingBlow: "Ground Pound", verdict: "nothing available",
      killingHits: [{ id: 1001, name: "Ground Pound", amount: 710_000, share: 0.71 }, { id: 1002, name: "Slither Strike", amount: 290_000, share: 0.29 }],
      available: [], active: [], onCooldown: [{ name: "Astral Shift", readyInS: 41 }],
    },
    {
      atMs: 825_000, inWipe: false, killingBlow: "Storm Strikes", verdict: "defensive available",
      killingHits: [{ id: 1003, name: "Storm Strikes", amount: 900_000, share: 1 }],
      available: ["Astral Shift"], active: [], onCooldown: [{ name: "Earth Elemental", readyInS: 94 }],
    },
    {
      atMs: 1_070_000, inWipe: false, killingBlow: "Spark Step", verdict: "nothing available",
      killingHits: [{ id: 1004, name: "Spark Step", amount: 620_000, share: 0.62 }, { id: 1005, name: "Release Charge", amount: 380_000, share: 0.38 }],
      available: [], active: [], onCooldown: [{ name: "Astral Shift", readyInS: 32 }],
    },
  ],
  majorUsage: 0.6, avoidableDeaths: 1, countedDeaths: 3, unlisted: [], staleTable: false, truncated: false, fetchedAt: NOW - H, pointsSpent: 3,
};

export const payload = (over: Partial<LookupPayload> = {}): LookupPayload => ({
  character: { id: 1, name: "Vachâman", classID: 9, spec: "Elemental", realmSlug: "ysondre", region: "eu", scoreTop: null },
  metric: "dps",
  targetLevel: 19,
  evaluation: { role: "dps" },
  seasonDungeons: [...runs.map((r) => ({ id: r.encounterID, name: r.encounterName })), { id: 9, name: "Eco-Dome Al'dani" }],
  perDungeon: { runs, dungeonsCovered: 8, totalDungeonsInSeason: 9, dungeonsAtOrAboveTarget: 8, medianLevel: 20, medianAmount: 400_000, medianParse: 58 },
  prevLevelBest: null,
  deepdive: [templeAnalysis],
  ...over,
} as unknown as LookupPayload);
