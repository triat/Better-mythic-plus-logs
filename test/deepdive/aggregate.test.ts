import { describe, expect, test } from "bun:test";
import { deepdiveSummary } from "../../src/deepdive/aggregate.ts";
import type { RunDefensives } from "../../src/deepdive/types.ts";

const run = (majorUsage: number | null, avoidableDeaths: number, countedDeaths: number): RunDefensives => ({
  reportCode: "R", fightID: 1, character: "X", className: "C", spec: "S", tableMissing: false, tableVersion: "t",
  defensives: [], deaths: [], majorUsage, avoidableDeaths, countedDeaths, unlisted: [], staleTable: false, truncated: false, fetchedAt: 0, pointsSpent: null,
});

describe("deepdiveSummary", () => {
  test("median usage over runs that have majors; share over all counted deaths", () => {
    const s = deepdiveSummary([run(0.2, 1, 2), run(0.6, 0, 1), run(null, 1, 1), run(0.4, 0, 0)]);
    expect(s.analyzedRuns).toBe(4);
    expect(s.majorUsage).toBeCloseTo(0.4, 9);
    expect(s.avoidableDeaths).toBe(2);
    expect(s.countedDeaths).toBe(4);
    expect(s.avoidableDeathShare).toBeCloseTo(0.5, 9);
  });
  test("nulls when nothing to aggregate", () => {
    expect(deepdiveSummary([])).toEqual({ analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 });
    const noDeaths = deepdiveSummary([run(0.5, 0, 0), run(null, 0, 0)]);
    expect(noDeaths.avoidableDeathShare).toBeNull();
    expect(noDeaths.majorUsage).toBe(0.5);
  });
});
