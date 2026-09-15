import { scoreAxis } from "../axis.ts";
import { signed } from "../curve.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

/** Level scaling is applied per run (in inputs.ts) using each run's own key level, not the target. */
export function scoreSurvival(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const s = i.survival;
  return scoreAxis("survival", [
    { id: "individualDeaths", value: s.individualDeathsScaled, raw: s.individualDeaths ?? undefined, label: (r) => `${r.toFixed(1)} individual deaths/run` },
    { id: "wipeDeaths", value: s.wipeDeaths, label: (r) => `${r.toFixed(1)} deaths in wipes/run` },
    { id: "avoidableVsPeers", value: s.avoidableVsPeers, label: (r) => `avoidable ${signed(r)}% vs peers` },
    { id: "dtpsVsPeers", value: s.dtpsVsPeers, label: (r) => `DTPS ${signed(r)}% vs peers` },
    { id: "groupDeaths", value: s.groupDeathsScaled, raw: s.groupDeaths ?? undefined, label: (r) => `${r.toFixed(1)} teammate deaths/run` },
  ], i.role, cfg, i.runsUsed);
}
