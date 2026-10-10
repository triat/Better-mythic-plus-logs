import { describe, expect, test } from "bun:test";
import { loadRankingsFixture, loadRioFixture, loadWclFixture } from "./fixtures.ts";

describe("fixtures", () => {
  test("S1 tank run fixture has the tables the parser needs", async () => {
    const f = await loadWclFixture("s1-tank");
    expect(f.character).toBe("Biwaadrood");
    expect(f.report.fights[0].keystoneBonus).toBe(1);
    for (const t of ["summary", "damageTaken", "deaths", "interrupts", "dispels"]) {
      expect(f.report[t]?.data).toBeDefined();
    }
    expect(f.report.avoidable).toBeUndefined();
  });

  test("S2 healer run fixture has an avoidable table", async () => {
    const f = await loadWclFixture("s2-healer");
    expect(f.character).toBe("Muleyoxo");
    expect(f.report.avoidable.data.entries.length).toBe(5);
  });

  test("RIO fixture has two seasons and ten recent runs", async () => {
    const r = await loadRioFixture();
    expect(r.mythic_plus_scores_by_season.map((s: any) => s.season)).toEqual(["season-mn-2", "season-mn-1"]);
    expect(r.mythic_plus_recent_runs.length).toBe(10);
  });

  // Issue #24 § 1, captured 2026-10-09: byBracket rankings list every ranked run, not the best per level.
  test("rankings fixture lists every ranked run of the season, depleted ones included", async () => {
    const f = await loadRankingsFixture();
    const perDungeon = f.zoneRankings.rankings.map((_: unknown, i: number) => f.encounterRankings[`e${i}`]);
    expect(perDungeon.length).toBe(8);
    const ranks = perDungeon.flatMap((e: any) => e.ranks);
    expect(ranks.length).toBe(108);
    for (const e of perDungeon) expect(e.ranks.length).toBe(e.totalKills);
    const levels = perDungeon[0].ranks.map((r: any) => r.bracketData);
    expect(new Set(levels).size).toBeLessThan(levels.length);
    expect(ranks.filter((r: any) => r.medal === "none").length).toBe(9);
    expect(new Set(ranks.map((r: any) => `${r.report.code}:${r.report.fightID}`)).size).toBe(108);
    for (const r of ranks) {
      expect(r.startTime).toBeGreaterThan(Date.UTC(2026, 0, 1));
      expect(r.startTime).toBeGreaterThanOrEqual(r.report.startTime);
    }
  });
});
