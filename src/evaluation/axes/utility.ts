import { confidenceFor, scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

const signed = (v: number, digits = 0) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export function scoreUtility(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const u = i.utility;
  if (!u.hasKick && !u.anyDispel && i.role !== "healer") {
    return { key: "utility", score: null, confidence: confidenceFor(i.runsUsed, cfg), evidence: [] };
  }
  return scoreAxis("utility", [
    { id: "kicksVsPeers", value: u.hasKick ? u.kicksVsPeers : null, label: (r) => `kicks ${signed(r)} pts vs peers` },
    { id: "kicksAbsolute", value: u.hasKick ? u.kicksAbsolute : null, label: (r) => `${(r * 100).toFixed(0)}% of kick capacity used` },
    { id: "dispels", value: u.dispels, label: (r) => `${r.toFixed(1)} dispels/run` },
  ], i.role, cfg, i.runsUsed);
}
