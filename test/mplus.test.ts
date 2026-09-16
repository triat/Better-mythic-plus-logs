import { describe, expect, test } from "bun:test";
import { analyzeLookup, inferTargetLevel, isRanked, type MPlusRun } from "../src/mplus.ts";

let seq = 0;
const run = (encounterID: number, keyLevel: number, parsePercent: number): MPlusRun => ({
  encounterID, encounterName: `D${encounterID}`, keyLevel, amount: 1000, parsePercent, spec: "Holy", affixes: [],
  reportCode: `R${++seq}`, fightID: 1, startTime: 0, score: 0,
});

describe("inferTargetLevel", () => {
  test("null without runs", () => {
    expect(inferTargetLevel([])).toBeNull();
  });
  test("median of the best run per dungeon, not the single highest key", () => {
    // Best per dungeon: D1 +21 (a lone depleted push), D2..D8 +20 → median 20.
    const runs = [run(1, 21, 1), run(1, 20, 90), ...[2, 3, 4, 5, 6, 7, 8].map((d) => run(d, 20, 80))];
    expect(inferTargetLevel(runs)).toBe(20);
  });
  test("even count rounds the half up", () => {
    expect(inferTargetLevel([run(1, 21, 50), run(2, 20, 50)])).toBe(21); // median 20.5 → 21
  });
});

describe("isRanked / analyzeLookup parse handling", () => {
  test("a 0% parse is an unranked log, not a worst-in-bracket run", () => {
    expect(isRanked(run(1, 21, 0))).toBe(false);
    expect(isRanked(run(1, 21, 0.4))).toBe(true);
  });
  test("perDungeon.medianParse ignores unranked runs", () => {
    const r = analyzeLookup([run(1, 21, 0), run(2, 21, 80), run(3, 21, 60)], 21, [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }]);
    expect(r.perDungeon.medianParse).toBe(70);
    expect(r.perDungeon.runs).toHaveLength(3); // the run itself still shows
  });
  test("all runs unranked → medianParse 0", () => {
    const r = analyzeLookup([run(1, 21, 0)], 21, [{ id: 1, name: "a" }]);
    expect(r.perDungeon.medianParse).toBe(0);
  });
});
