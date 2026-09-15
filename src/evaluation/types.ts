export type Role = "dps" | "healer" | "tank";
export type AxisKey = "survival" | "utility" | "throughput" | "consistency" | "preparation" | "experience";
export const AXIS_KEYS: readonly AxisKey[] = ["survival", "utility", "throughput", "consistency", "preparation", "experience"];
export type Verdict = "invite" | "maybe" | "pass" | "insufficient";
export type Confidence = "high" | "medium" | "low";
export type CurvePoints = [number, number][];

export interface Evidence {
  label: string;
  /** Contribution in axis points vs. neutral 50; sums to score − 50. Comparable across axes. */
  delta: number;
  source: string; // "<axis>.<subSignalId>"
}

export interface AxisScore {
  key: AxisKey;
  score: number | null;
  confidence: Confidence;
  /** Sorted by |delta| descending. */
  evidence: Evidence[];
}

export interface Evaluation {
  role: Role;
  targetLevel: number;
  axes: AxisScore[];
  global: number | null;
  verdict: Verdict;
  runsUsed: number;
  configVersion: string;
}

export interface SubSignalConfig {
  curve: CurvePoints;
  weights: Record<Role, number>;
}
export interface AxisConfig {
  subSignals: Record<string, SubSignalConfig>;
}
export interface EvaluationConfig {
  version: string;
  levelScale: CurvePoints;
  expectedIlvl: Record<string, CurvePoints>; // keyed by Raider.IO season slug
  axes: Record<AxisKey, AxisConfig>;
  axisWeights: Record<Role, Record<AxisKey, number>>;
  verdict: { invite: number; maybe: number; minRuns: number };
  confidence: { high: number; medium: number; consistencyMinRuns: number };
}
