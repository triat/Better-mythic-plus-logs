import { describe, expect, test } from "bun:test";
import type { MPlusRun } from "../../src/mplus.ts";
import { parseRioProfile } from "../../src/signals/rio-profile.ts";
import { signalSummary } from "../../src/signals/summary.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadRioFixture, loadWclFixture } from "../fixtures.ts";

describe("signalSummary", () => {
  test("no signals, no rio → all null", () => {
    const s = signalSummary([{ signals: undefined } as MPlusRun], null);
    expect(s.runsWithSignals).toBe(0);
    expect(s.timedShown).toBeNull();
    expect(s.avgDeaths).toBeNull();
    expect(s.kicksDeltaPts).toBeNull();
    expect(s.avoidableDeltaPct).toBeNull();
    expect(s.ilvl).toBeNull();
    expect(s.prevSeason).toBeNull();
  });

  test("aggregates over runs with signals and rio", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const s2 = await loadWclFixture("s2-healer");
    const runs: MPlusRun[] = [
      { ...s1.run, signals: parseRunSignals(s1.report, "Mstercheif", { keyLevel: 18, affixes: s1.run.affixes, encounterID: s1.run.encounterID })! },
      { ...s2.run, signals: parseRunSignals(s2.report, "Muleyoxo", { keyLevel: 21, affixes: s2.run.affixes, encounterID: s2.run.encounterID })! },
      { ...s2.run, signals: undefined },
    ];
    const rio = parseRioProfile(await loadRioFixture(), Date.parse("2026-09-15T12:00:00Z"));
    const s = signalSummary(runs, rio);
    expect(s.runsWithSignals).toBe(2);
    expect(s.timedShown).toBe(2);
    expect(s.avgDeaths).toBe(2);         // 3 + 1 over 2 runs
    expect(s.deathsInWipes).toBe(1);
    expect(s.avoidableDeltaPct).not.toBeNull(); // only the S2 run contributes
    expect(s.kicksDeltaPts).not.toBeNull();     // only Mstercheif has a usage
    expect(s.ilvl).toBe(322);
    expect(s.recentTimed).toBe(9);
    expect(s.recentTotal).toBe(10);
    expect(s.prevSeason).toEqual({ slug: "season-mn-1", all: 4152.7, best: { role: "dps", score: 4152.7 } });
  });

  test("prevSeason is null when rio has fewer than two seasons", async () => {
    const raw = await loadRioFixture();
    const rio = parseRioProfile({ ...raw, mythic_plus_scores_by_season: [raw.mythic_plus_scores_by_season[0]] }, 0);
    expect(signalSummary([], rio).prevSeason).toBeNull();
  });
});
