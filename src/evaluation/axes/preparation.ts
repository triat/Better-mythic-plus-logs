import { curve, signed } from "../curve.ts";
import { scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

export function scorePreparation(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const p = i.preparation;
  // Object key order in expectedIlvl follows deep-merge order: defaults first, then the user's
  // override keys appended last — so the last key is the newest known season.
  const lastKey = Object.keys(cfg.expectedIlvl).at(-1)!;
  const slug = i.seasonSlug !== null && i.seasonSlug in cfg.expectedIlvl ? i.seasonSlug : lastKey;
  const expected = curve(i.targetLevel, cfg.expectedIlvl[slug]!);
  const ilvlVsLevel = p.ilvl === null ? null : p.ilvl - expected;
  return scoreAxis("preparation", [
    { id: "potions", value: p.potions, label: (r) => `${r.toFixed(1)} potions/run` },
    { id: "healthstones", value: p.healthstones, label: (r) => `${r.toFixed(1)} healthstones/run` },
    { id: "ilvlVsLevel", value: ilvlVsLevel, label: (r) => `ilvl ${signed(r)} vs expected` },
  ], i.role, cfg, i.runsUsed);
}
