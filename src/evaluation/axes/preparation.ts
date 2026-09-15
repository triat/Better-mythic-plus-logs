import { curve } from "../curve.ts";
import { scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

const signed = (v: number, digits = 0) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export function scorePreparation(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const p = i.preparation;
  const firstKey = Object.keys(cfg.expectedIlvl)[0]!;
  const slug = i.seasonSlug !== null && i.seasonSlug in cfg.expectedIlvl ? i.seasonSlug : firstKey;
  const expected = curve(i.targetLevel, cfg.expectedIlvl[slug]!);
  const ilvlVsLevel = p.ilvl === null ? null : p.ilvl - expected;
  return scoreAxis("preparation", [
    { id: "potions", value: p.potions, label: (r) => `${r.toFixed(1)} potions/run` },
    { id: "healthstones", value: p.healthstones, label: (r) => `${r.toFixed(1)} healthstones/run` },
    { id: "ilvlVsLevel", value: ilvlVsLevel, label: (r) => `ilvl ${signed(r)} vs expected` },
  ], i.role, cfg, i.runsUsed);
}
