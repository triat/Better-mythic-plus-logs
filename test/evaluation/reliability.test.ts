import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { LEVEL_MARGIN, levelProof, payloadWithout, scoreRange } from "../../src/evaluation/reliability.ts";
import { deaths, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

const run = (level: number, parse: number, died = 0) => runWith({
  keystone: { level, chests: 1, timed: true, timeMs: 1_500_000, affixes: [] },
  deaths: deaths(died),
  interrupts: { count: 20, kickCooldownS: 15, capacity: 100, usage: 0.2, peer: { median: 0.2, count: 3 } },
}, { parsePercent: parse, keyLevel: level });

describe("levelProof", () => {
  test("proven from a shown run at the target minus the margin; the best key and the runs at the target", () => {
    const runs = [run(14, 60), run(15, 60), run(16, 60)];
    expect(LEVEL_MARGIN).toBe(2);
    expect(levelProof(payloadWith(runs, { targetLevel: 19 }))).toEqual({ floor: 17, best: 16, atTarget: 0, proven: false });
    expect(levelProof(payloadWith(runs, { targetLevel: 18 }))).toEqual({ floor: 16, best: 16, atTarget: 0, proven: true });
    expect(levelProof(payloadWith(runs, { targetLevel: 15 })).atTarget).toBe(2);
    expect(levelProof(payloadWith([], { targetLevel: 15 }))).toEqual({ floor: 13, best: null, atTarget: 0, proven: false });
  });
});

describe("scoreRange", () => {
  test("one score per shown run left out; the run that drags the score down gives the top of the range", () => {
    const bad = run(16, 15, 4);
    const runs = [run(16, 70), run(16, 72), run(16, 68), run(16, 71), bad];
    const p = payloadWith(runs, { targetLevel: 16 });
    const ev = evaluate(p, cfg);
    expect(ev.range!.without.map((w) => w.reportCode)).toEqual(runs.map((r) => r.reportCode));
    const withoutBad = ev.range!.without.find((w) => w.reportCode === bad.reportCode)!.score;
    expect(withoutBad).toBe(ev.range!.high);
    expect(ev.range!.low).toBeLessThanOrEqual(ev.global!);
    expect(ev.range!.high).toBeGreaterThan(ev.global!);
  });

  test("no range when every run is needed for a verdict, or without a score", () => {
    const three = payloadWith([run(16, 70), run(16, 72), run(16, 68)], { targetLevel: 16 });
    expect(evaluate(three, cfg).range).toBeNull();
    expect(scoreRange(three, cfg, 3, 60)).toBeNull();
    expect(scoreRange(three, cfg, 6, null)).toBeNull();
  });

  test("leaving a run out takes it out of the dungeon list, its median parse and the previous level", () => {
    const a = run(16, 20);
    const b = run(16, 60);
    const c = run(16, 80);
    const p = payloadWith([a, b, c], { targetLevel: 17, prevLevelBest: { best: b } } as never);
    const without = payloadWithout(p, b);
    expect(without.perDungeon.runs.map((r) => r.reportCode)).toEqual([a.reportCode, c.reportCode]);
    expect(without.perDungeon.medianParse).toBe(50);
    expect(without.prevLevelBest).toBeNull();
    expect(payloadWithout(p, a).prevLevelBest).toEqual(p.prevLevelBest);
  });
});
