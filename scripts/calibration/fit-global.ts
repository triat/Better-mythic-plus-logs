// Dev-only, 0 WCL points: fits `globalCurve` in default-config.json from the collected payloads —
// per role, today's weighted mean of the axes → its percentile in the population, with [0, 0] and
// [100, 100] as end points. Refit when the season or the axis weights/curves change, and paste the
// printed JSON into `globalCurve`. It reads globalScore(), which is taken before the curve, so the
// curve already in the config does not bias the fit.
//
//   bun scripts/calibration/fit-global.ts
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import defaultConfig from "../../src/evaluation/default-config.json" with { type: "json" };
import { collectInputs } from "../../src/evaluation/inputs.ts";
import { scoreAllAxes } from "../../src/evaluation/axes/index.ts";
import { globalScore } from "../../src/evaluation/evaluate.ts";
import type { EvaluationConfig, Role } from "../../src/evaluation/types.ts";
import { loadSamples } from "./analyze.ts";
import { percentileCurve } from "./calibrate.ts";
const cfg = defaultConfig as unknown as EvaluationConfig;
const out: Record<string, unknown> = {};
for (const role of ["dps", "healer", "tank"] as Role[]) {
  const raw = loadSamples().filter((s) => s.study.role === role).map((s) => { const i = collectInputs(s.payload, cfg); return globalScore(scoreAllAxes(i, cfg), i.role, cfg); }).filter((g): g is number => g !== null);
  const c = percentileCurve(raw, true).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y)]);
  out[role] = [[0, 0], ...c, [100, 100]];
  console.log(role, raw.length);
}
console.log(JSON.stringify(out));
