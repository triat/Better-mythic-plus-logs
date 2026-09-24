// Dev-only, 0 WCL points: re-scores the collected payloads offline and reports how the rubric
// behaves on the real population. Run it as often as needed — nothing here touches the network.
//
//   bun scripts/calibration/analyze.ts [--config path.json]   → .calibration/report-<version>.md
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import defaultConfig from "../../src/evaluation/default-config.json" with { type: "json" };
import { evaluate } from "../../src/evaluation/evaluate.ts";
import type { EvalPayload } from "../../src/evaluation/inputs.ts";
import type { Evaluation, EvaluationConfig, Role } from "../../src/evaluation/types.ts";
import { DIR } from "./discover.ts";
import type { Candidate } from "./collect.ts";

export interface Sample { study: Candidate; payload: EvalPayload }

export function loadSamples(): Sample[] {
  const dir = `${DIR}/payloads`;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Sample);
}

const SLOPE = 1000;
/**
 * The value each sub-signal feeds its curve, per axis — recovered without touching production code.
 * A probe config turns every curve into a straight line of slope 1000 and every weight into 1, so
 * `scoreAxis`'s delta = (1000·x − 50) / n with n = the axis's contributing sub-signals; inverting gives
 * x to within 0.05·n / 1000. `Evidence.value` is not enough: it is the display value, not the level-
 * scaled number the curve actually reads.
 */
export function curveInputs(payload: EvalPayload, cfg: EvaluationConfig): Record<string, number> {
  const probe = structuredClone(cfg) as EvaluationConfig;
  for (const axis of Object.values(probe.axes)) {
    for (const sub of Object.values(axis.subSignals)) {
      sub.curve = [[-1e9, -1e9 * SLOPE], [1e9, 1e9 * SLOPE]];
      sub.weights = { dps: 1, healer: 1, tank: 1 };
    }
  }
  const ev = evaluate(payload, probe);
  const out: Record<string, number> = {};
  for (const axis of ev.axes) {
    // Only configured sub-signals share the axis's Σw; an extra such as experience.prevSeasonBonus
    // shows up as evidence without being one of them, and counting it would skew every inversion.
    const configured = probe.axes[axis.key].subSignals;
    const subs = axis.evidence.filter((e) => e.source.split(".")[1]! in configured);
    for (const e of subs) out[e.source] = (e.delta * subs.length + 50) / SLOPE;
  }
  return out;
}

export const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};

const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const pct = (n: number, total: number) => (total ? `${Math.round((100 * n) / total)} %` : "—");
const QS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

export function report(samples: Sample[], cfg: EvaluationConfig): string {
  const scored = samples.map((s) => ({ s, ev: evaluate(s.payload, cfg) as Evaluation }));
  const lines: string[] = [];
  lines.push(`# Calibration report — config ${cfg.version}`, "", `${samples.length} characters (EU, +15 to +20).`, "");

  lines.push("## Global score and verdicts", "", "| Role | Level | n | p5 | p10 | p25 | median | p75 | p90 | p95 | INVITE | MAYBE | PASS | insufficient |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const roles: (Role | "all")[] = ["all", "dps", "healer", "tank"];
  const bands: (number | "all")[] = ["all", 15, 16, 17, 18, 19, 20];
  for (const role of roles) {
    for (const level of bands) {
      if (role !== "all" && level !== "all") continue; // role rows and level rows, not the full grid
      const rows = scored.filter(({ s }) => (role === "all" || s.study.role === role) && (level === "all" || s.study.level === level));
      if (rows.length === 0) continue;
      const g = rows.map((r) => r.ev.global).filter((x): x is number => x !== null);
      const count = (v: string) => rows.filter((r) => r.ev.verdict === v).length;
      lines.push(`| ${role} | ${level === "all" ? "all" : `+${level}`} | ${rows.length} | ${QS.map((q) => fmt(quantile(g, q))).join(" | ")} | ${pct(count("invite"), rows.length)} | ${pct(count("maybe"), rows.length)} | ${pct(count("pass"), rows.length)} | ${pct(count("insufficient"), rows.length)} |`);
    }
  }

  lines.push("", "## Global score by the sample's own performance quintile", "", "q0 = best fifth of its (dungeon, spec, level) band in WCL's order, q4 = worst fifth. A rubric that separates players should climb from q4 to q0.", "", "| Role | q0 | q1 | q2 | q3 | q4 |", "|---|---|---|---|---|---|");
  for (const role of ["dps", "healer", "tank"] as Role[]) {
    const cells = [0, 1, 2, 3, 4].map((q) => {
      const g = scored.filter(({ s }) => s.study.role === role && s.study.quintile === q).map((r) => r.ev.global).filter((x): x is number => x !== null);
      return g.length ? `${fmt(quantile(g, 0.5))} (n=${g.length})` : "—";
    });
    lines.push(`| ${role} | ${cells.join(" | ")} |`);
  }

  lines.push("", "## Axis scores (median, p10 → p90)", "", "| Role | Axis | n | p10 | median | p90 |", "|---|---|---|---|---|---|");
  for (const role of ["dps", "healer", "tank"] as Role[]) {
    for (const axis of ["survival", "utility", "throughput", "consistency", "preparation", "experience"]) {
      const v = scored.filter(({ s }) => s.study.role === role).map(({ ev }) => ev.axes.find((a) => a.key === axis)?.score).filter((x): x is number => typeof x === "number");
      if (v.length) lines.push(`| ${role} | ${axis} | ${v.length} | ${fmt(quantile(v, 0.1))} | ${fmt(quantile(v, 0.5))} | ${fmt(quantile(v, 0.9))} |`);
    }
  }

  lines.push("", "## Curve inputs vs current curves", "", "The value each sub-signal feeds its curve across the population, and the score the current curve gives at those percentiles. A curve that maps p10 and p90 to nearly the same score cannot separate anyone.", "", "| Role | Sub-signal | n | p10 | p25 | median | p75 | p90 | score @p10 | @median | @p90 |", "|---|---|---|---|---|---|---|---|---|---|---|");
  const inputs = samples.map((s) => ({ s, x: curveInputs(s.payload, cfg) }));
  for (const role of ["dps", "healer", "tank"] as Role[]) {
    for (const [axis, ac] of Object.entries(cfg.axes)) {
      for (const [id, sc] of Object.entries(ac.subSignals)) {
        if (sc.weights[role] <= 0) continue;
        const src = `${axis}.${id}`;
        const xs = inputs.filter(({ s }) => s.study.role === role).map(({ x }) => x[src]).filter((v): v is number => typeof v === "number");
        if (xs.length < 5) continue;
        const at = (q: number) => fmt(curveAt(quantile(xs, q), sc.curve));
        lines.push(`| ${role} | ${src} | ${xs.length} | ${[0.1, 0.25, 0.5, 0.75, 0.9].map((q) => fmt(quantile(xs, q), 2)).join(" | ")} | ${at(0.1)} | ${at(0.5)} | ${at(0.9)} |`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

function curveAt(x: number, pts: [number, number][]): number {
  if (x <= pts[0]![0]) return pts[0]![1];
  const last = pts[pts.length - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0 || 1)) * (y1 - y0);
  }
  return last[1];
}

async function main(): Promise<void> {
  const i = process.argv.indexOf("--config");
  const cfg = (i > 0 ? JSON.parse(readFileSync(process.argv[i + 1]!, "utf8")) : defaultConfig) as EvaluationConfig;
  const samples = loadSamples();
  const md = report(samples, cfg);
  const out = `${DIR}/report-${cfg.version}.md`;
  writeFileSync(out, md);
  console.log(md.split("\n").slice(0, 40).join("\n"));
  console.log(`\n… full report: ${out}`);
}

if (import.meta.main) await main();
