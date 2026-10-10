import { describe, expect, test } from "bun:test";
import { EVIDENCE_SOURCES } from "../../src/evaluation/axes/index.ts";
import { scoreAxis } from "../../src/evaluation/axis.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { collectInputs } from "../../src/evaluation/inputs.ts";
import { CONTEXT_SOURCES, PILLAR_SOURCES, pillarOf, pillarScores } from "../../src/evaluation/pillars.ts";
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

describe("pillar-only sub-signals", () => {
  test("utility.crowdControl is in the Control pillar and never in the axis score", () => {
    const cfg = validateConfig(DEFAULT_CONFIG);
    const subs = [
      { id: "dispels", value: 10, label: (r: number) => `${r} dispels/run` },
      { id: "crowdControl", value: 30, label: (r: number) => `crowd control ${r}`, extra: { rate: 4.2 } },
    ];
    const withCc = scoreAxis("utility", subs, "dps", cfg, 8);
    const without = scoreAxis("utility", subs.slice(0, 1), "dps", cfg, 8);
    expect(withCc.score).toBe(without.score);
    expect(withCc.evidence).toEqual(without.evidence);
    expect(withCc.pillarOnly).toEqual([{ label: "crowd control 30", delta: 0, source: "utility.crowdControl", value: 30, extra: { rate: 4.2 }, weight: 2, score: 85 }]);
    const control = pillarScores([withCc]).find((p) => p.key === "control")!;
    expect(control.evidence.map((e) => e.source)).toEqual(["utility.dispels", "utility.crowdControl"]);
    // dispels: weight 1, curve(10) = 85; crowd control: weight 2, curve(30) = 85 → 85.
    expect(control.score).toBe(85);
  });
  test("runs with crowd control: the Control pillar moves, the axes, global and verdict do not", () => {
    const cfg = validateConfig(DEFAULT_CONFIG);
    const control = (vsReference: number) => ({ uses: 10, enemies: 12, perTenMin: 4, reference: 4, vsReference, stale: false, spells: [] });
    const plain = payloadWith([1, 2, 3].map(() => runWith({})));
    const withCc = payloadWith([-40, -30, -20].map((v) => runWith({ control: control(v) })));
    const a = evaluate(plain, cfg);
    const b = evaluate(withCc, cfg);
    expect(b.axes).toEqual(a.axes.map((x) => (x.key === "utility" ? { ...x, pillarOnly: b.axes.find((y) => y.key === "utility")!.pillarOnly } : x)));
    expect(b.global).toBe(a.global);
    expect(b.verdict).toBe(a.verdict);
    expect(b.drivers).toEqual(a.drivers);
    const cc = b.pillars!.find((p) => p.key === "control")!.evidence.find((e) => e.source === "utility.crowdControl")!;
    expect(cc.value).toBe(-30);
    expect(cc.extra).toEqual({ rate: 4 });
    expect(cc.label).toBe("crowd control −30% vs spec median (4 per 10 min)");
  });
});
