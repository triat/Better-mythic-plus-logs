// Dev-only, 0 WCL points: fits `globalCurve` and `reference` in default-config.json from the collected
// payloads — per role, today's weighted mean of the axes → its percentile in the population (with
// [0, 0] and [100, 100] as end points), and the calibration population's median curve input (`x`) and
// median display value (`value`) of every scored sub-signal, at least 40 samples deep. Refit when the
// season or the axis weights/curves change, and paste the printed `globalCurve` / `reference` into
// default-config.json. It reads globalScore(), which is taken before the curve, so the curve already
// in the config does not bias the fit.
//
//   bun scripts/calibration/fit-global.ts
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import defaultConfig from "../../src/evaluation/default-config.json" with { type: "json" };
import { collectInputs } from "../../src/evaluation/inputs.ts";
import { scoreAllAxes } from "../../src/evaluation/axes/index.ts";
import { evaluate, globalScore } from "../../src/evaluation/evaluate.ts";
import type { EvaluationConfig, Role } from "../../src/evaluation/types.ts";
import { curveInputs, loadSamples, quantile } from "./analyze.ts";
import { percentileCurve } from "./calibrate.ts";

const cfg = defaultConfig as unknown as EvaluationConfig;
const MIN_N = 40;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

const globalCurve: Record<string, unknown> = {};
for (const role of ["dps", "healer", "tank"] as Role[]) {
  const raw = loadSamples().filter((s) => s.study.role === role).map((s) => { const i = collectInputs(s.payload, cfg); return globalScore(scoreAllAxes(i, cfg), i.role, cfg); }).filter((g): g is number => g !== null);
  const c = percentileCurve(raw, true).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y)]);
  globalCurve[role] = [[0, 0], ...c, [100, 100]];
  console.log(role, raw.length);
}

const reference: Record<string, Record<string, { x: number; value: number }>> = {};
for (const role of ["dps", "healer", "tank"] as Role[]) {
  const samples = loadSamples().filter((s) => s.study.role === role);
  const xsBySource = new Map<string, number[]>();
  const valuesBySource = new Map<string, number[]>();
  for (const s of samples) {
    for (const [src, x] of Object.entries(curveInputs(s.payload, cfg))) (xsBySource.get(src) ?? xsBySource.set(src, []).get(src)!).push(x);
    for (const e of evaluate(s.payload, cfg).axes.flatMap((a) => a.evidence)) (valuesBySource.get(e.source) ?? valuesBySource.set(e.source, []).get(e.source)!).push(e.value);
  }
  reference[role] = {};
  for (const [src, xs] of xsBySource) {
    const values = valuesBySource.get(src) ?? [];
    if (xs.length < MIN_N || values.length < MIN_N) continue;
    reference[role]![src] = { x: round4(quantile(xs, 0.5)), value: round4(quantile(values, 0.5)) };
  }
}

console.log(JSON.stringify({ globalCurve, reference }));
