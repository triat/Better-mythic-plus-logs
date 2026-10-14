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
import { fitGlobal } from "../../src/calibration/fit.ts";
import type { EvaluationConfig } from "../../src/evaluation/types.ts";
import { loadSamples } from "./analyze.ts";

const { globalCurve, reference, n } = fitGlobal(loadSamples(), defaultConfig as unknown as EvaluationConfig);
console.log(n);
console.log(JSON.stringify({ globalCurve, reference }));
