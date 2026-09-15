import { scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

export function scoreConsistency(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const c = i.consistency;
  if (c.sample < cfg.confidence.consistencyMinRuns) {
    return { key: "consistency", score: null, confidence: "low", evidence: [] };
  }
  return scoreAxis("consistency", [
    { id: "parseSpread", value: c.parseSpread, label: (r) => `parse spread ±${r.toFixed(0)}%` },
    { id: "deathsSpread", value: c.deathsSpread, label: (r) => `deaths spread ±${r.toFixed(1)}` },
    { id: "damageSpread", value: c.damageSpread, label: (r) => `damage-vs-peers spread ±${r.toFixed(0)}%` },
  ], i.role, cfg, i.runsUsed);
}
