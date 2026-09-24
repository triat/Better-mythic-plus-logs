// Dev-only, 0 WCL points: the recommended candidate. Today's rubric untouched, plus one curve per role
// that maps its raw global score onto the population's percentile. A monotone mapping cannot change who
// ranks above whom, so it spreads the scores at exactly today's ranking quality.
//
//   bun scripts/calibration/global-only.ts
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import defaultConfig from "../../src/evaluation/default-config.json" with { type: "json" };
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { curve } from "../../src/evaluation/curve.ts";
import type { EvaluationConfig, Role } from "../../src/evaluation/types.ts";
import { loadSamples, quantile } from "./analyze.ts";
import { isFit, percentileCurve, spearman } from "./calibrate.ts";
const base = defaultConfig as unknown as EvaluationConfig;
const all = loadSamples().map((s) => ({ s, g: evaluate(s.payload, base).global })).filter((x): x is { s: typeof x.s; g: number } => x.g !== null);
const fit = all.filter((x) => isFit(x.s)), test = all.filter((x) => !isFit(x.s));
for (const role of ["dps", "healer", "tank"] as Role[]) {
  const c = percentileCurve(fit.filter((x) => x.s.study.role === role).map((x) => x.g), true);
  const t = test.filter((x) => x.s.study.role === role).map((x) => ({ ...x, p: Math.round(curve(x.g, c)) }));
  const ps = t.map((x) => x.p);
  const share = (lo: number, hi: number) => Math.round(100 * ps.filter((p) => p >= lo && p < hi).length / ps.length);
  console.log(role, "n", t.length, "p5..p95", [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => quantile(ps, q).toFixed(0)).join("/"),
    "WCL rho", spearman(ps, t.map((x) => 1 - x.s.study.percentile)).toFixed(2),
    "INV/MAY/PASS", share(70, 101), share(30, 70), share(0, 30),
    "raw→pct anchors", JSON.stringify(c.filter((_, i) => i % 2 === 0)));
}
