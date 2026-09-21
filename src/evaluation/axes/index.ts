import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";
import { scoreConsistency } from "./consistency.ts";
import { scoreExperience } from "./experience.ts";
import { scorePreparation } from "./preparation.ts";
import { scoreSurvival } from "./survival.ts";
import { scoreThroughput } from "./throughput.ts";
import { scoreUtility } from "./utility.ts";

export const scoreAllAxes = (i: EvalInputs, cfg: EvaluationConfig): AxisScore[] => [
  scoreSurvival(i, cfg), scoreUtility(i, cfg), scoreThroughput(i, cfg),
  scoreConsistency(i, cfg), scorePreparation(i, cfg), scoreExperience(i, cfg),
];

/** Every `source` an evidence entry can carry: the config's sub-signals plus the previous-season bonus. The web
 * front keeps one message per entry (`evidence.<source>`); a test checks the list against the default config. */
export const EVIDENCE_SOURCES = [
  "survival.individualDeaths", "survival.wipeDeaths", "survival.avoidableVsPeers", "survival.dtpsVsPeers", "survival.groupDeaths",
  "survival.defensiveUsage", "survival.avoidableDeaths",
  "utility.kicksVsPeers", "utility.kicksAbsolute", "utility.dispels",
  "throughput.medianParse", "throughput.parseAtTarget",
  "consistency.parseSpread", "consistency.deathsSpread", "consistency.damageSpread",
  "preparation.potions", "preparation.healthstones", "preparation.ilvlVsLevel",
  "experience.coverage", "experience.atTarget", "experience.medianVsTarget", "experience.activity", "experience.prevSeasonBonus",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
