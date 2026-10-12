import { describe, expect, test } from "bun:test";
import type { LookupPayload, MPlusRun } from "../types.ts";
import { missingDungeons } from "./runs.ts";

const run = (over: Partial<MPlusRun> = {}): MPlusRun => ({
  encounterID: 12923, encounterName: "Voidscar Arena", keyLevel: 21, amount: 312_000, parsePercent: 79.4, spec: "Holy",
  affixes: [], reportCode: "ABC", fightID: 3, startTime: 0, score: 0, ...over,
});

describe("missingDungeons", () => {
  test("the season dungeons without a run", () => {
    const p = ({ seasonDungeons: [{ id: 12923, name: "Voidscar Arena" }, { id: 12825, name: "Den of Nalorakk" }],
      perDungeon: { runs: [run()] } }) as unknown as LookupPayload;
    expect(missingDungeons(p)).toEqual(["Den of Nalorakk"]);
  });
});
