import { describe, expect, test } from "bun:test";
import { EVIDENCE_SOURCES } from "../../src/evaluation/axes/index.ts";
import { scoreAxis } from "../../src/evaluation/axis.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { collectInputs } from "../../src/evaluation/inputs.ts";
import { CONTEXT_SOURCES, PILLAR_SOURCES, pillarOf } from "../../src/evaluation/pillars.ts";
import { PILLAR_KEYS } from "../../src/evaluation/types.ts";
import { deaths, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const kicks = { count: 6, kickCooldownS: 15, capacity: 10, usage: 0.6, peer: { median: 0.5, count: 3 } };
const pillar = (ev: ReturnType<typeof evaluate>, key: string) => ev.pillars!.find((p) => p.key === key)!;

describe("pillar mapping", () => {
  test("every evidence source belongs to exactly one pillar or to context", () => {
    for (const source of EVIDENCE_SOURCES) {
      const homes = PILLAR_KEYS.filter((k) => (PILLAR_SOURCES[k] as readonly string[]).includes(source)).length
        + ((CONTEXT_SOURCES as readonly string[]).includes(source) ? 1 : 0);
      expect(`${source}:${homes}`).toBe(`${source}:1`);
    }
    expect(pillarOf("utility.dispels")).toBe("control");
    expect(pillarOf("preparation.potions")).toBeNull();
  });
});

describe("pillarScores", () => {
  const runs = () => [1, 2, 3].map(() => runWith({ deaths: deaths(1), interrupts: kicks }));

  test("Damage equals the throughput axis (same two sub-signals)", () => {
    const ev = evaluate(payloadWith(runs()), cfg);
    expect(pillar(ev, "damage").score).toBe(ev.axes.find((a) => a.key === "throughput")!.score);
  });

  test("Interrupts equals scoreAxis over the two kick sub-signals", () => {
    const p = payloadWith(runs());
    const i = collectInputs(p, cfg);
    const expected = scoreAxis("utility", [
      { id: "kicksVsPeers", value: i.utility.kicksVsPeers, label: String },
      { id: "kicksAbsolute", value: i.utility.kicksAbsolute, label: String },
    ], i.role, cfg, i.runsUsed).score;
    expect(pillar(evaluate(p, cfg), "interrupts").score).toBe(expected);
  });

  test("Control is n/a for a kit with no dispel, never 0", () => {
    const p = payloadWith([1, 2, 3].map(() => runWith({ dispels: { count: 0, available: false } })));
    expect(pillar(evaluate(p, cfg), "control").score).toBeNull();
  });

  test("evidence carries its weight and curve score; the global is untouched", () => {
    const ev = evaluate(payloadWith(runs()), cfg);
    const e = ev.axes.find((a) => a.key === "survival")!.evidence.find((x) => x.source === "survival.individualDeaths")!;
    expect(e.weight).toBe(3);
    expect(typeof e.score).toBe("number");
    expect(ev.pillars!.map((x) => x.key)).toEqual(["damage", "survival", "avoidable", "interrupts", "control"]);
  });
});
