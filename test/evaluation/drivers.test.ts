import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, deepMerge, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { deaths, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const run = (d: number, parse: number) => runWith({
  deaths: deaths(d), consumables: { potions: 4, healthstones: 1 },
  avoidableDamage: { total: 0, perMinute: 100, peer: { median: 100, count: 4 }, spellCount: 10 },
}, { parsePercent: parse, keyLevel: 16 });
const payload = (d: number, parse: number) => payloadWith(Array.from({ length: 8 }, () => run(d, parse)), { targetLevel: 16 });

describe("score drivers", () => {
  test("dying more than the average player costs points, dying less earns them", () => {
    const bad = evaluate(payload(3, 60), cfg).drivers!.find((d) => d.source === "survival.individualDeaths")!;
    const good = evaluate(payload(0, 60), cfg).drivers!.find((d) => d.source === "survival.individualDeaths")!;
    expect(bad.impact).toBeLessThan(0);
    expect(good.impact).toBeGreaterThan(0);
    expect(bad.value).toBeCloseTo(3, 6);
    expect(bad.reference).toBe(cfg.reference.dps["survival.individualDeaths"]!.value);
    expect(bad.label).toContain("individual deaths");
  });

  test("no impact when the reference is where the curve cannot tell the difference", () => {
    // A flat curve scores every input the same, so replacing the input by the reference changes nothing.
    const flat = validateConfig(deepMerge(DEFAULT_CONFIG, { axes: { survival: { subSignals: { individualDeaths: { curve: [[0, 60], [10, 60]] } } } } }));
    expect(evaluate(payload(3, 60), flat).drivers!.some((d) => d.source === "survival.individualDeaths")).toBe(false);
  });

  test("sorted costs first, only |impact| ≥ 1, no deep-dive or informational source", () => {
    const ds = evaluate(payload(3, 30), cfg).drivers!;
    expect(ds.length).toBeGreaterThan(0);
    for (let i = 1; i < ds.length; i++) expect(ds[i]!.impact).toBeGreaterThanOrEqual(ds[i - 1]!.impact);
    for (const d of ds) {
      expect(Math.abs(d.impact)).toBeGreaterThanOrEqual(1);
      expect(d.source.startsWith("consistency.")).toBe(false); // weight 0 → impact 0
    }
  });

  test("the path is the shortest prefix of the costs that reaches the next verdict", () => {
    const e = evaluate(payload(3, 30), cfg);
    expect(e.verdict).not.toBe("invite");
    const nv = e.nextVerdict!;
    expect(nv.verdict).toBe(e.verdict === "pass" ? "maybe" : "invite");
    expect(nv.threshold).toBe(nv.verdict === "maybe" ? cfg.verdict.maybe : cfg.verdict.invite);
    const costs = e.drivers!.filter((d) => d.impact < 0).map((d) => d.source);
    expect(nv.sources).toEqual(costs.slice(0, nv.sources.length));
    expect(nv.sources.length).toBeLessThanOrEqual(3);
    if (nv.reachable) expect(nv.score).toBeGreaterThanOrEqual(nv.threshold);
    else expect(nv.score).toBeLessThan(nv.threshold);
  });

  test("unreachable when three signals cannot get there", () => {
    const hard = validateConfig(deepMerge(DEFAULT_CONFIG, { verdict: { invite: 100, maybe: 99 } }));
    const nv = evaluate(payload(3, 30), hard).nextVerdict!;
    expect(nv.reachable).toBe(false);
    expect(nv.sources.length).toBeLessThanOrEqual(3);
  });

  test("no path for INVITE or INSUFFICIENT DATA", () => {
    const top = evaluate(payload(0, 99), cfg);
    expect(top.verdict).toBe("invite");
    expect(top.nextVerdict).toBeNull();
    const few = evaluate(payloadWith([run(3, 30)], { targetLevel: 16 }), cfg);
    expect(few.verdict).toBe("insufficient");
    expect(few.drivers).toEqual([]);
    expect(few.nextVerdict).toBeNull();
  });
});
