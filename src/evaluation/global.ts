import { curve } from "./curve.ts";
import type { AxisScore, EvaluationConfig, Role } from "./types.ts";

/** Weighted mean of the axis scores with the role's weights; n/a axes are left out of both sums. */
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

/** The number the badge shows: the weighted mean through the role's `globalCurve`, rounded once. */
export function finalGlobal(axes: AxisScore[], role: Role, cfg: EvaluationConfig): number | null {
  const raw = globalScore(axes, role, cfg);
  return raw === null ? null : Math.round(curve(raw, cfg.globalCurve[role]));
}
