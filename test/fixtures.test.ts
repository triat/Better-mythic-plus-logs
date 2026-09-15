import { describe, expect, test } from "bun:test";
import { loadRioFixture, loadWclFixture } from "./fixtures.ts";

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
});
