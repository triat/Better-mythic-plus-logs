import { curve } from "../curve.ts";
import { scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

const signed = (v: number, digits = 0) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export function scoreSurvival(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const scale = curve(i.targetLevel, cfg.levelScale);
  const s = i.survival;
  return scoreAxis("survival", [
    { id: "individualDeaths", value: s.individualDeaths, x: (r) => r * scale, label: (r) => `${r.toFixed(1)} individual deaths/run` },
    { id: "wipeDeaths", value: s.wipeDeaths, label: (r) => `${r.toFixed(1)} deaths in wipes/run` },
    { id: "avoidableVsPeers", value: s.avoidableVsPeers, label: (r) => `avoidable ${signed(r)}% vs peers` },
    { id: "dtpsVsPeers", value: s.dtpsVsPeers, label: (r) => `DTPS ${signed(r)}% vs peers` },
    { id: "groupDeaths", value: s.groupDeaths, x: (r) => r * scale, label: (r) => `${r.toFixed(1)} teammate deaths/run` },
  ], i.role, cfg, i.runsUsed);
}
