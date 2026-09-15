import { describe, expect, test } from "bun:test";
import { renderRunSignals, renderSummaryLine } from "../src/format-mplus.ts";
import type { SignalSummary } from "../src/signals/summary.ts";
import { parseRunSignals } from "../src/signals/wcl-run.ts";
import { formatDuration } from "../src/util.ts";
import { loadWclFixture } from "./fixtures.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("formatDuration", () => {
  test("mm:ss", () => {
    expect(formatDuration(1751502)).toBe("29:11");
    expect(formatDuration(59_000)).toBe("0:59");
    expect(formatDuration(3_600_000)).toBe("60:00");
  });
});

describe("renderRunSignals", () => {
  test("tank line: deaths, dtps without peers, kicks with usage, dispels, no avoidable", async () => {
    const f = await loadWclFixture("s1-tank");
    const s = parseRunSignals(f.report, "Biwaadrood", { keyLevel: 18, affixes: [], encounterID: f.run.encounterID })!;
    const line = strip(renderRunSignals(s));
    expect(line).toContain("0 deaths");
    expect(line).toContain("dtps");
    expect(line).not.toContain("vs ");
    expect(line).toMatch(/kicks 23\/113 \(peer \d+%\)/);
    expect(line).toContain("dispels 0");
    expect(line).not.toContain("avoidable");
  });

  test("healer line: death in wipe, avoidable delta, no kick capacity", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", { keyLevel: 21, affixes: [], encounterID: f.run.encounterID })!;
    const line = strip(renderRunSignals(s));
    expect(line).toContain("1 death (1 in wipe)");
    expect(line).toMatch(/avoidable [\d.]+k\/min \(-?\d+%\)/);
    expect(line).toContain("kicks 1 (no kick on spec)");
    expect(line).toContain("dispels 9");
  });
});

describe("renderSummaryLine", () => {
  const baseSummary: SignalSummary = {
    runsWithSignals: 0,
    timedShown: null,
    avgDeaths: null,
    deathsInWipes: null,
    dtpsDeltaPct: null,
    kicksDeltaPts: null,
    avoidableDeltaPct: null,
    ilvl: null,
    recentTimed: null,
    recentTotal: null,
    prevSeason: null,
  };

  test("recentTotal 0 (profile fetched, zero recent runs) renders 0/0, not —", () => {
    const summary: SignalSummary = { ...baseSummary, recentTimed: 0, recentTotal: 0 };
    const line = strip(renderSummaryLine(summary));
    expect(line).toContain("RIO recent timed 0/0");
  });

  test("recentTotal null (no RIO data) renders —", () => {
    const summary: SignalSummary = { ...baseSummary, recentTimed: null, recentTotal: null };
    const line = strip(renderSummaryLine(summary));
    expect(line).toContain("RIO recent timed —");
  });
});
