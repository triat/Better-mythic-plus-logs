import { describe, expect, test } from "bun:test";
import { analyzeRun, type AnalyzeInput } from "../../src/deepdive/analyze.ts";
import { SHIPPED, specDefensives } from "../../src/deepdive/table.ts";
import type { RawDeepDive, SpecDefensives } from "../../src/deepdive/types.ts";
import type { RawRunReport, RunSignals } from "../../src/signals/types.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadDeepdiveFixture } from "../fixtures.ts";

async function fixtureInput(name: "s2-healer" | "s2-rogue"): Promise<AnalyzeInput> {
  const f = await loadDeepdiveFixture(name);
  const signals = parseRunSignals(f.report, f.character, { keyLevel: f.run.keyLevel, affixes: f.run.affixes, encounterID: f.run.encounterID })!;
  const comp = f.report.summary.data.composition.find((c: { name: string }) => c.name === f.character);
  const className = comp.type as string;
  const spec = comp.specs[0].spec as string;
  return { raw: f.deepdive, report: f.report, signals, character: f.character, className, spec, table: specDefensives(SHIPPED, {}, className, spec), tableVersion: SHIPPED.version, denylist: SHIPPED.denylist };
}

// --- synthetic scaffolding -------------------------------------------------
const FIGHT_START = 10_000;
const FIGHT_MS = 600_000; // 10 min
const table: SpecDefensives = {
  key: "Test:Spec",
  tableMissing: false,
  ignored: [],
  entries: [
    { id: 1, name: "Wall", cooldownS: 120, durationS: 10, kind: "major", origin: "shipped" },
    { id: 2, name: "Bubble", cooldownS: 300, durationS: 8, kind: "immunity", origin: "shipped" },
    { id: 3, name: "Sip", cooldownS: 30, durationS: 0, kind: "minor", origin: "shipped" },
  ],
};
const synthetic = (casts: Array<[id: number, atS: number]>, deathsAtS: number[], opts: { wipe?: boolean; buffs?: Array<[number, string, number]>; castsTable?: Array<[number, string, number]> } = {}): AnalyzeInput => {
  const raw: RawDeepDive = {
    code: "SYN", fightID: 1, character: "Me", actorID: 1, fightStart: FIGHT_START, fightEnd: FIGHT_START + FIGHT_MS,
    casts: { data: { entries: (opts.castsTable ?? []).map(([guid, name, total]) => ({ name, guid, total })) } },
    buffs: { data: { auras: (opts.buffs ?? []).map(([guid, name, totalUses]) => ({ guid, name, totalUses, totalUptime: totalUses * 5000 })) } },
    castEvents: casts.map(([id, atS]) => ({ timestamp: FIGHT_START + atS * 1000, abilityGameID: id })),
    tableIds: [1, 2, 3], truncated: false, fetchedAt: 0, pointsSpent: 3,
  };
  const others = opts.wipe ? ["A", "B"] : [];
  const entries = deathsAtS.flatMap((atS) => [
    { name: "Me", timestamp: FIGHT_START + atS * 1000, overkill: 100, killingBlow: { name: "Big Hit", guid: 77 },
      damage: { abilities: [{ name: "Big Hit", guid: 77, total: 600 }, { name: "Dot", guid: 78, total: 300 }, { name: "Tick", guid: 79, total: 50 }, { name: "Splash", guid: 80, total: 50 }], sources: [] }, events: [] },
    ...others.map((name) => ({ name, timestamp: FIGHT_START + atS * 1000 + 500, damage: { abilities: [], sources: [] } })),
  ]);
  const report: RawRunReport = {
    code: "SYN",
    fights: [{ id: 1, startTime: FIGHT_START, endTime: FIGHT_START + FIGHT_MS, keystoneLevel: 15, keystoneBonus: 1, keystoneTime: FIGHT_MS }],
    summary: { data: { totalTime: FIGHT_MS, composition: [{ name: "Me", id: 1, type: "Test", specs: [{ spec: "Spec", role: "dps" }] }] } },
    deaths: { data: { entries } },
  };
  const signals: RunSignals = parseRunSignals(report, "Me", { keyLevel: 15, affixes: [], encounterID: 1 })!;
  return { raw, report, signals, character: "Me", className: "Test", spec: "Spec", table, tableVersion: "t", denylist: [] };
};

describe("analyzeRun — usage vs capacity", () => {
  test("capacity, usage capped at 1, min interval, cdMismatch", () => {
    const r = analyzeRun(synthetic([[1, 10], [1, 100], [1, 250], [2, 30], [3, 5], [3, 20]], []));
    const wall = r.defensives.find((d) => d.id === 1)!;
    expect(wall.capacity).toBe(5);              // ceil(600 / 120)
    expect(wall.casts).toBe(3);
    expect(wall.usage).toBeCloseTo(0.6, 9);
    expect(wall.observedMinIntervalS).toBe(90);  // 100 − 10
    expect(wall.cdMismatch).toBe(true);          // 90 < 0.9 × 120
    const bubble = r.defensives.find((d) => d.id === 2)!;
    expect(bubble.capacity).toBe(2);
    expect(bubble.observedMinIntervalS).toBeNull();
    expect(bubble.cdMismatch).toBe(false);
    const sip = r.defensives.find((d) => d.id === 3)!;
    expect(sip.capacity).toBe(20);
    expect(sip.observedMinIntervalS).toBe(15);
    // majorUsage = mean over major+immunity only: (0.6 + 0.5) / 2
    expect(r.majorUsage).toBeCloseTo(0.55, 9);
    const many = analyzeRun(synthetic(Array.from({ length: 9 }, (_, i) => [1, i * 65] as [number, number]), []));
    expect(many.defensives.find((d) => d.id === 1)!.usage).toBe(1);
  });
  test("capacity floors at 1 on a fight shorter than the cooldown; majorUsage null with no major", () => {
    const long = { id: 9, name: "Long", cooldownS: 900, durationS: 5, kind: "minor" as const, origin: "shipped" as const };
    const r = analyzeRun({ ...synthetic([], []), table: { ...table, entries: [long] } });
    expect(r.defensives[0]!.capacity).toBe(1);   // 600 s fight, 900 s cooldown
    expect(r.majorUsage).toBeNull();
  });
});

describe("analyzeRun — deaths", () => {
  test("killing hits are the top 3 abilities with shares; killing blow named", () => {
    const r = analyzeRun(synthetic([], [300]));
    const d = r.deaths[0]!;
    expect(d.atMs).toBe(300_000);
    expect(d.killingBlow).toBe("Big Hit");
    expect(d.killingHits.map((h) => h.name)).toEqual(["Big Hit", "Dot", "Tick"]);
    expect(d.killingHits[0]!.share).toBeCloseTo(0.6, 9);
    expect(d.killingHits[2]!.share).toBeCloseTo(0.05, 9);
  });
  test("availability windows are inclusive and use the table cooldown", () => {
    // Wall cast exactly 120 s before death → available again; Bubble cast 100 s before → on cooldown (200 s left).
    const r = analyzeRun(synthetic([[1, 180], [2, 200]], [300]));
    const d = r.deaths[0]!;
    expect(d.available).toContain("Wall");
    expect(d.onCooldown).toEqual([{ name: "Bubble", readyInS: 200 }]);
    expect(d.verdict).toBe("defensive available");
  });
  test("active if cast within durationS before death; instant (durationS 0) is never active", () => {
    const r = analyzeRun(synthetic([[1, 295], [3, 299]], [300]));
    const d = r.deaths[0]!;
    expect(d.active).toEqual(["Wall"]);
    expect(d.available).not.toContain("Wall");
    expect(d.onCooldown.map((c) => c.name)).toEqual(["Sip"]); // Sip: cast 1 s ago, 30 s cd
    expect(d.verdict).toBe("immunity available"); // Bubble never cast → available
  });
  test("verdict precedence: covered beats nothing, minors never drive it", () => {
    const covered = analyzeRun(synthetic([[1, 295], [2, 100]], [300])).deaths[0]!;
    expect(covered.verdict).toBe("covered");
    const nothing = analyzeRun(synthetic([[1, 250], [2, 100]], [300])).deaths[0]!;
    expect(nothing.verdict).toBe("nothing available");
    expect(nothing.available).toContain("Sip"); // listed, but does not change the verdict
  });
  test("wipe deaths are analyzed but not counted", () => {
    const r = analyzeRun(synthetic([], [300], { wipe: true }));
    expect(r.deaths[0]!.inWipe).toBe(true);
    expect(r.deaths[0]!.verdict).toBe("immunity available");
    expect(r.countedDeaths).toBe(0);
    expect(r.avoidableDeaths).toBe(0);
    const solo = analyzeRun(synthetic([], [300, 500]));
    expect(solo.countedDeaths).toBe(2);
    expect(solo.avoidableDeaths).toBe(2);
  });
});

describe("analyzeRun — audit", () => {
  test("unlisted = self-cast buffs not in table, not ignored, not denylisted, not consumables", () => {
    const r = analyzeRun(synthetic([], [], {
      buffs: [[1, "Wall", 2], [50, "Mystery Buff", 3], [51, "Tempered Potion", 2], [52, "Offensive", 1], [53, "Ignored", 1], [54, "Received Only", 4]],
      castsTable: [[1, "Wall", 2], [50, "Mystery Buff", 3], [51, "Tempered Potion", 2], [52, "Offensive", 1], [53, "Ignored", 1]],
    }));
    expect(r.unlisted.map((u) => u.id)).toEqual([50, 52, 53]);
    const ignored = analyzeRun({ ...synthetic([], [], { buffs: [[53, "Ignored", 1]], castsTable: [[53, "Ignored", 1]] }), table: { ...table, ignored: [53] }, denylist: [52] });
    expect(ignored.unlisted).toEqual([]);
    expect(r.unlisted[0]).toEqual({ id: 50, name: "Mystery Buff", casts: 3, uptimeS: 15 });
  });
  test("staleTable when the table gained an id the raw row was not filtered on", () => {
    const extra = { id: 77, name: "New", cooldownS: 60, durationS: 5, kind: "major" as const, origin: "override" as const };
    expect(analyzeRun(synthetic([], [])).staleTable).toBe(false);
    expect(analyzeRun({ ...synthetic([], []), table: { ...table, entries: [...table.entries, extra] } }).staleTable).toBe(true);
  });
  test("tableMissing still audits", () => {
    const r = analyzeRun({ ...synthetic([], [], { buffs: [[50, "X", 1]], castsTable: [[50, "X", 1]] }), table: { key: "Test:Spec", entries: [], ignored: [], tableMissing: true } });
    expect(r.tableMissing).toBe(true);
    expect(r.defensives).toEqual([]);
    expect(r.majorUsage).toBeNull();
    expect(r.unlisted.length).toBe(1);
  });
});

describe("analyzeRun — real fixtures", () => {
  test("Muleyoxo (Holy Paladin, Voidscar Arena)", async () => {
    const r = analyzeRun(await fixtureInput("s2-healer"));
    expect(r.className).toBe("Paladin");
    expect(r.spec).toBe("Holy");
    expect(r.tableMissing).toBe(false);
    const dp = r.defensives.find((d) => d.id === 498)!;
    expect(dp.casts).toBe(27);
    expect(dp.capacity).toBe(30); // ceil(1775 / 60)
    expect(r.defensives.find((d) => d.id === 642)!.casts).toBe(5);
    expect(r.deaths.length).toBe(1);
    expect(r.deaths[0]!.killingHits[0]!.name).toBe("Cosmic Crash");
    expect(r.deaths[0]!.killingBlow).toBe("Unstable Singularity");
    expect(r.countedDeaths).toBe(1);
    expect(r.unlisted.map((u) => u.name)).not.toContain("Light's Potential"); // denylisted
  });
  test("Casualaddict (Assassination Rogue, Temple of Sethraliss)", async () => {
    const r = analyzeRun(await fixtureInput("s2-rogue"));
    expect(r.className).toBe("Rogue");
    expect(r.deaths.length).toBe(2);
    expect(r.countedDeaths).toBe(2);
    for (const d of r.deaths) expect(["immunity available", "defensive available", "covered", "nothing available"]).toContain(d.verdict);
    expect(r.defensives.some((d) => d.id === 31224)).toBe(true); // Cloak of Shadows listed
  });
});
