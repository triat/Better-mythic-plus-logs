import { clamp, signed } from "../curve.ts";
import { scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig, Evidence } from "../types.ts";

export function scoreExperience(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const e = i.experience;
  const result = scoreAxis("experience", [
    { id: "coverage", value: e.coverage, label: (r) => `${(r * 100).toFixed(0)}% dungeons covered` },
    { id: "atTarget", value: e.atTarget, label: (r) => `${(r * 100).toFixed(0)}% dungeons at/above target` },
    { id: "medianVsTarget", value: e.medianVsTarget, label: (r) => `median key ${signed(r)} vs target` },
    { id: "activity", value: e.activity, label: (r) => `${r} runs in last 7 days` },
  ], i.role, cfg, i.runsUsed);

  if (e.prevSeasonAll === null || result.score === null) return result;

  const bonus = Math.min(10, e.prevSeasonAll / 400);
  const score = Math.round(clamp(result.score + bonus, 0, 100));
  const evidence: Evidence[] = [
    ...result.evidence,
    { label: `previous season ${e.prevSeasonAll.toFixed(0)}`, delta: Math.round(bonus * 10) / 10, source: "experience.prevSeasonBonus" },
  ];
  evidence.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { ...result, score, evidence };
}
