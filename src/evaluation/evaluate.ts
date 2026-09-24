import { scoreAllAxes } from "./axes/index.ts";
import { configVersion } from "./config.ts";
import { scoreDrivers } from "./drivers.ts";
import { finalGlobal } from "./global.ts";
import { collectInputs, type EvalPayload } from "./inputs.ts";
import type { Evaluation, EvaluationConfig, Verdict } from "./types.ts";

export { globalScore, finalGlobal } from "./global.ts";

export function verdictFor(global: number | null, runsUsed: number, cfg: EvaluationConfig): Verdict {
  if (global === null || runsUsed < cfg.verdict.minRuns) return "insufficient";
  if (global >= cfg.verdict.invite) return "invite";
  if (global >= cfg.verdict.maybe) return "maybe";
  return "pass";
}

/** Pure: same payload + same config → same evaluation. */
export function evaluate(payload: EvalPayload, cfg: EvaluationConfig): Evaluation {
  const inputs = collectInputs(payload, cfg);
  const axes = scoreAllAxes(inputs, cfg);
  // Mapped onto the role's percentile, then rounded once here so the verdict threshold and every
  // rendered global (CLI, web) agree.
  const global = finalGlobal(axes, inputs.role, cfg);
  const verdict = verdictFor(global, inputs.runsUsed, cfg);
  const { drivers, nextVerdict } = global === null || verdict === "insufficient"
    ? { drivers: [], nextVerdict: null }
    : scoreDrivers(inputs, axes, global, verdict, cfg);
  return {
    role: inputs.role,
    targetLevel: inputs.targetLevel,
    axes,
    global,
    verdict,
    drivers,
    nextVerdict,
    runsUsed: inputs.runsUsed,
    analyzedRuns: inputs.analyzedRuns,
    configVersion: configVersion(cfg),
  };
}
