import { scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

export function scoreThroughput(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const t = i.throughput;
  return scoreAxis("throughput", [
    { id: "medianParse", value: t.medianParse, label: (r) => `median parse ${r.toFixed(0)}%` },
    { id: "parseAtTarget", value: t.parseAtTarget, label: (r) => `parse ${r.toFixed(0)}% at target level` },
  ], i.role, cfg, i.runsUsed);
}
