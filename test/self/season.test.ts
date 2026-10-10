import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import {
  MIN_WINDOW_RUNS, RECENT_WEEKS, SAME_BAND, TREND_BEFORE_WEEKS, TREND_RECENT_WEEKS, WEEKLY_BARS, WORK_ON_MAX,
  changeOf, seasonView, trendOf,
} from "../../src/self/season.ts";
import type { SeasonRow } from "../../src/signals/store.ts";
import { loadControlFixture, loadWclFixture } from "../fixtures.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const NOW = Date.UTC(2026, 9, 9, 12); // EU game week 0 opened 2026-10-07 04:00 UTC
const DAY = 86_400_000;

const row = (code: string, startTime: number): SeasonRow => ({
  reportCode: code, fightID: 16, zoneID: 55, encounterID: 12923, encounterName: "Voidscar Arena", startTime, durationMs: 1_796_309,
  keyLevel: 21, timed: true, metric: "hps", parse: 60, amount: 227_611, spec: "Holy", score: 500, affixes: [9, 10, 147],
  discoveredAt: NOW, seenAt: NOW, failedAt: null,
});

async function input() {
  const f = await loadWclFixture("s2-healer");
  // A and B in week 0, C and D in week −1, E (newest) not fetched yet.
  const rows = [row("E", NOW - 1000), row("A", NOW - DAY), row("B", NOW - 2 * DAY), row("C", NOW - 4 * DAY), row("D", NOW - 6 * DAY)];
  return {
    character: { name: "Muleyoxo", realm: "silvermoon", region: "eu" as const },
    zoneID: 55, targetLevel: 21, now: NOW, rows,
    report: (code: string) => (code === "E" ? null : f.report),
    analysis: () => null,
    control: () => null,
    state: { runs: 5, analysed: 4, pending: 1, controlOnly: 0, failed: 0, estimate: 30 },
  };
}

describe("phase-1 numbers (spec, section Numbers)", () => {
  test("windows, floors and bands", () => {
    expect([RECENT_WEEKS, TREND_RECENT_WEEKS, TREND_BEFORE_WEEKS, MIN_WINDOW_RUNS, SAME_BAND, WEEKLY_BARS, WORK_ON_MAX]).toEqual([4, 2, 4, 3, 3, 8, 3]);
  });
  test("trendOf: 3 runs a side, ±3 reads same", () => {
    expect(trendOf([60, 60], [50, 50, 50])).toEqual({ delta: null, direction: null });
    expect(trendOf([53, 53, 53], [50, 50, 50])).toEqual({ delta: 3, direction: "same" });
    expect(trendOf([54, 54, 54], [50, 50, 50])).toEqual({ delta: 4, direction: "up" });
    expect(trendOf([40, 40, 40], [50, 50, 50])).toEqual({ delta: -10, direction: "down" });
  });
  test("changeOf: more than 3 curve points", () => {
    expect(changeOf(54, 50)).toBe("better");
    expect(changeOf(53, 50)).toBe("same");
    expect(changeOf(46, 50)).toBe("worse");
  });
});

describe("seasonView", () => {
  test("runs, weeks, analysed state, per-run pillars", async () => {
    const v = seasonView(await input(), cfg);
    expect(v.currentWeek).toBe(0);
    expect(v.runs.map((r) => [r.reportCode, r.week, r.analysed])).toEqual([["E", 0, false], ["A", 0, true], ["B", 0, true], ["C", -1, true], ["D", -1, true]]);
    expect(v.runs[0]!.signals).toBeNull();
    expect(v.runs[0]!.pillars).toBeNull();
    expect(Object.keys(v.runs[1]!.pillars!)).toEqual(["damage", "survival", "avoidable", "interrupts", "control"]);
    expect(v.runs[1]!.signals!.deaths.events[0]!.killingHits![0]!.ability).toBe("Unstable Singularity");
  });

  test("the 4-week window and the season need 3 analysed runs; no past yet", async () => {
    const v = seasonView(await input(), cfg);
    expect(v.recent!.runs).toBe(4);
    expect(v.season!.runs).toBe(4);
    expect(v.recent!.pillars.map((p) => p.key)).toEqual(["damage", "survival", "avoidable", "interrupts", "control"]);
    for (const w of v.workOn) expect(w.past).toBeNull();
    expect(v.workOn.length).toBeLessThanOrEqual(WORK_ON_MAX);
    const two = await input();
    two.rows = two.rows.slice(0, 3); // E (unfetched), A, B: two analysed runs
    expect(seasonView(two, cfg).recent).toBeNull();
  });

  test("trends: no arrow without 3 runs before; 8 weekly bars, oldest first", async () => {
    const v = seasonView(await input(), cfg);
    const t = v.trends.find((x) => x.key === "survival")!;
    expect(t).toMatchObject({ delta: null, direction: null, recentRuns: 4 });
    expect(t.weekly).toHaveLength(8);
    expect(t.weekly.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(t.weekly[6]).toBe(t.weekly[7]);
  });

  test("dungeon row and its details summed over the analysed runs", async () => {
    const v = seasonView(await input(), cfg);
    expect(v.dungeons).toHaveLength(1);
    const d = v.dungeons[0]!;
    expect(d).toMatchObject({ encounterID: 12923, name: "Voidscar Arena", runs: 5, analysed: 4, best: { level: 21, timed: true } });
    expect(d.details.avoidable).toEqual([{ id: 1264188, name: "Unstable Singularity", total: 4 * 10_724_909 }]);
    expect(d.details.avoidableOther).toBe(0);
    expect(d.details.avoidableTotal).toBe(4 * 10_724_909);
    expect(d.details.killers).toEqual([{ ability: "Unstable Singularity", deaths: 4 }]);
    expect(d.details.casts.slice(0, 2)).toEqual([
      { id: 1310324, name: "Mending Void", attempts: 168, completed: 100, interrupted: 68, mine: 0 },
      { id: 1228176, name: "Lava Bolt", attempts: 160, completed: 44, interrupted: 108, mine: 4 },
    ]);
  });
});

describe("seasonView — a hand-typed name in another case", () => {
  test("is matched to the report's spelling, so the run keeps its deaths", async () => {
    const lower = await input();
    lower.character = { ...lower.character, name: "muleyoxo" };
    const seen: string[] = [];
    lower.analysis = ((_c: string, _f: number, name: string) => { seen.push(name); return null; }) as typeof lower.analysis;
    const v = seasonView(lower, cfg);
    expect(v.runs[1]!.signals!.deaths.count).toBe(1);
    expect(seen[0]).toBe("Muleyoxo");
  });
});

describe("seasonView — overall", () => {
  test("is the uncurved weighted mean of the axes, on the pillars' scale", async () => {
    const v = seasonView(await input(), cfg);
    const scores = v.season!.pillars.map((p) => p.score).filter((x): x is number => x !== null);
    expect(v.season!.overall).not.toBeNull();
    expect(v.season!.overall!).toBeGreaterThanOrEqual(Math.min(...scores) - 25);
    expect(v.dungeons[0]!.overall).toBe(v.season!.overall);
  });
});


describe("seasonView — crowd control", () => {
  async function dk(withControl: boolean) {
    const f = await loadControlFixture("s2-dk-frost");
    const fight = f.report.fights[0];
    const r: SeasonRow = { ...row(f.report.code, NOW - DAY), fightID: fight.id, encounterID: fight.encounterID, encounterName: "Den of Nalorakk", spec: "Frost", metric: "dps" };
    return seasonView({
      character: { name: "Noshiidk", realm: "argent-dawn", region: "eu" }, zoneID: 55, targetLevel: 19, now: NOW, rows: [r],
      report: () => f.report, analysis: () => null, control: () => (withControl ? f.control : null),
      state: { runs: 1, analysed: 1, pending: 0, controlOnly: 0, failed: 0, estimate: 0 },
    }, cfg);
  }
  test("a run with cached crowd control carries it; the dungeon sums it", async () => {
    const v = await dk(true);
    const c = v.runs[0]!.signals!.control!;
    expect(c.uses).toBe(14);
    const d = v.dungeons[0]!.details;
    expect(d.controlRuns).toBe(1);
    expect(d.control.map((s) => [s.name, s.uses, s.enemies])).toEqual([["Gnaw", 8, 8], ["Death Grip", 5, 0], ["Blinding Sleet", 1, 5]]);
  });
  test("without it: no control on the run, an empty list for the dungeon, the same pillars", async () => {
    const without = await dk(false);
    const withIt = await dk(true);
    expect(without.runs[0]!.signals!.control).toBeUndefined();
    expect(without.dungeons[0]!.details).toMatchObject({ control: [], controlRuns: 0 });
    // A Frost death knight has no dispel: without crowd control the Control pillar is n/a; with it, the run is scored
    // against the spec's reference, and the four other pillars do not move.
    const a = without.runs[0]!.pillars!;
    const b = withIt.runs[0]!.pillars!;
    expect(a.control).toBeNull();
    expect(typeof b.control).toBe("number");
    expect({ ...b, control: null as number | null }).toEqual(a);
  });
});
