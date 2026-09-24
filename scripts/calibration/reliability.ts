// Dev-only, 0 WCL points: which sub-signals measure the player, and which measure luck?
// Split-half reliability — each character's runs are split by date, every sub-signal is computed on
// each half, and the two are rank-correlated across characters. A signal that does not repeat from one
// half to the other is mostly noise, and a steep percentile curve on it would amplify that noise.
//
//   bun scripts/calibration/reliability.ts
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import defaultConfig from "../../src/evaluation/default-config.json" with { type: "json" };
import type { EvaluationConfig, Role } from "../../src/evaluation/types.ts";
import { curveInputs, loadSamples, quantile, type Sample } from "./analyze.ts";
import { spearman } from "./calibrate.ts";

interface Run { startTime: number; parsePercent: number; signals?: unknown }

/** The payload restricted to a subset of its runs, with perDungeon.medianParse recomputed from them. */
function withRuns(s: Sample, runs: Run[]): Sample {
  const p = structuredClone(s.payload) as unknown as { perDungeon: { runs: Run[]; medianParse: number | null } };
  p.perDungeon.runs = runs;
  const parses = runs.map((r) => r.parsePercent).filter((x) => x > 0);
  p.perDungeon.medianParse = parses.length ? quantile(parses, 0.5) : null;
  return { study: s.study, payload: p as unknown as Sample["payload"] };
}

const base = defaultConfig as unknown as EvaluationConfig;
const pairs = new Map<string, { role: Role; a: number; b: number }[]>();
for (const s of loadSamples()) {
  const runs = [...(s.payload as unknown as { perDungeon: { runs: Run[] } }).perDungeon.runs].filter((r) => r.signals).sort((a, b) => a.startTime - b.startTime);
  if (runs.length < 6) continue;
  const cut = Math.floor(runs.length / 2);
  const xa = curveInputs(withRuns(s, runs.slice(0, cut)).payload, base);
  const xb = curveInputs(withRuns(s, runs.slice(cut)).payload, base);
  for (const src of Object.keys(xa)) {
    if (xb[src] === undefined) continue;
    (pairs.get(src) ?? pairs.set(src, []).get(src)!).push({ role: s.study.role, a: xa[src]!, b: xb[src]! });
  }
}

const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
console.log("| Sub-signal | all | dps | healer | tank | n |");
console.log("|---|---|---|---|---|---|");
const rows = [...pairs.entries()].map(([src, ps]) => {
  const r = (xs: typeof ps) => (xs.length >= 20 ? spearman(xs.map((x) => x.a), xs.map((x) => x.b)) : NaN);
  return { src, all: r(ps), dps: r(ps.filter((x) => x.role === "dps")), healer: r(ps.filter((x) => x.role === "healer")), tank: r(ps.filter((x) => x.role === "tank")), n: ps.length };
}).sort((a, b) => b.all - a.all);
for (const x of rows) console.log(`| ${x.src} | ${f(x.all)} | ${f(x.dps)} | ${f(x.healer)} | ${f(x.tank)} | ${x.n} |`);
