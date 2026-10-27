import { scoreAxis } from "../axis.ts";
import type { Override } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

export function scoreThroughput(i: EvalInputs, cfg: EvaluationConfig, override?: Override): AxisScore {
  const t = i.throughput;
  return scoreAxis("throughput", [
    { id: "medianParse", n: i.counts["throughput.medianParse"], value: t.medianParse, label: (r) => `median parse ${r.toFixed(0)}%` },
    { id: "parseAtTarget", n: i.counts["throughput.parseAtTarget"], value: t.parseAtTarget, label: (r) => `parse ${r.toFixed(0)}% on target-level keys` },
  ], i.role, cfg, i.runsUsed, override);
}
