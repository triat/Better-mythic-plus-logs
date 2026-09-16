import { describe, expect, test } from "bun:test";
import { selectRuns } from "../src/cli.ts";

const runs = [
  { reportCode: "A", fightID: 1 },
  { reportCode: "B", fightID: 2 },
  { reportCode: "C", fightID: 3 },
];
const analyzed = new Set(["A:1", "C:3"]);

describe("selectRuns (bmpl analyze)", () => {
  test("--all keeps analyzed runs in wanted (shown from the cache) and only fetches the rest", () => {
    const s = selectRuns(runs, analyzed, [], true, false);
    expect(s.wanted).toEqual(runs);
    expect(s.toFetch).toEqual([runs[1]]);
    expect(s.unknown).toEqual([]);
  });
  test("--all on a fully analyzed character: everything wanted, nothing to fetch", () => {
    const s = selectRuns(runs, new Set(["A:1", "B:2", "C:3"]), [], true, false);
    expect(s.wanted).toEqual(runs);
    expect(s.toFetch).toEqual([]);
  });
  test("--run selects by key in shown order; an analyzed one is wanted but not fetched", () => {
    const s = selectRuns(runs, analyzed, ["C:3", "B:2"], false, false);
    expect(s.wanted).toEqual([runs[1], runs[2]]);
    expect(s.toFetch).toEqual([runs[1]]);
    expect(s.unknown).toEqual([]);
  });
  test("--force re-fetches analyzed runs too", () => {
    const s = selectRuns(runs, analyzed, ["A:1"], false, true);
    expect(s.wanted).toEqual([runs[0]]);
    expect(s.toFetch).toEqual([runs[0]]);
  });
  test("--run keys not among the shown runs are reported as unknown", () => {
    const s = selectRuns(runs, analyzed, ["A:1", "Z:9"], false, false);
    expect(s.unknown).toEqual(["Z:9"]);
    expect(s.wanted).toEqual([runs[0]]);
  });
});
