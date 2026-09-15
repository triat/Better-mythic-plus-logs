import { scoreAllAxes } from "./axes/index.ts";
import { configVersion } from "./config.ts";
import { collectInputs, type EvalPayload } from "./inputs.ts";
import type { AxisScore, Evaluation, EvaluationConfig, Role, Verdict } from "./types.ts";

export function globalScore(axes: AxisScore[], role: Role, cfg: EvaluationConfig): number | null {
  let num = 0;
  let den = 0;
  for (const a of axes) {
    if (a.score === null) continue;
    const w = cfg.axisWeights[role][a.key];
    num += w * a.score;
    den += w;
  }
  return den > 0 ? num / den : null;
}

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
  const rawGlobal = globalScore(axes, inputs.role, cfg);
  // Rounded once here so the verdict threshold and every rendered global (CLI, web) agree.
  const global = rawGlobal === null ? null : Math.round(rawGlobal);
  return {
    role: inputs.role,
    targetLevel: inputs.targetLevel,
    axes,
    global,
    verdict: verdictFor(global, inputs.runsUsed, cfg),
    runsUsed: inputs.runsUsed,
    configVersion: configVersion(cfg),
  };
}
