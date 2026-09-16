import { confidenceFor, scoreAxis } from "../axis.ts";
import { signed } from "../curve.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

export function scoreUtility(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const u = i.utility;
  if (!u.hasKick && !u.hasDispel && i.role !== "healer") {
    return { key: "utility", score: null, confidence: confidenceFor(i.runsUsed, cfg), evidence: [] };
  }
  return scoreAxis("utility", [
    { id: "kicksVsPeers", value: u.hasKick ? u.kicksVsPeers : null, label: (r) => `kicks ${signed(r)} pts vs peers` },
    { id: "kicksAbsolute", value: u.hasKick ? u.kicksAbsolute : null, label: (r) => `${(r * 100).toFixed(0)}% of kick capacity used` },
    { id: "dispels", value: u.hasDispel ? u.dispels : null, label: (r) => `${r.toFixed(1)} dispels/run` },
  ], i.role, cfg, i.runsUsed);
}
