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
