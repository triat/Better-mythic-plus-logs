export type Role = "dps" | "healer" | "tank";
export type AxisKey = "survival" | "utility" | "throughput" | "consistency" | "preparation" | "experience";
export const AXIS_KEYS: readonly AxisKey[] = ["survival", "utility", "throughput", "consistency", "preparation", "experience"];
export type Verdict = "invite" | "maybe" | "pass" | "insufficient";
export type Confidence = "high" | "medium" | "low";
export type CurvePoints = [number, number][];

export interface Evidence {
  /** English line as the CLI prints it; the web front rebuilds it per locale from `value` / `extra`. */
  label: string;
  /** Contribution in axis points vs. neutral 50; sums to score − 50. Comparable across axes. */
  delta: number;
  source: string; // "<axis>.<subSignalId>"
  /** The raw number behind `label` (the unscaled mean when one exists), unrounded. */
  value: number;
  /** Extra numbers a few labels need: analyzed runs (survival.defensiveUsage), death counts (survival.avoidableDeaths). */
  extra?: EvidenceExtra;
}
export interface EvidenceExtra { runs?: number; count?: number; total?: number }

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
  /** The weighted mean of the axes through the role's `globalCurve`, rounded: a percentile among real players. */
  global: number | null;
  verdict: Verdict;
  runsUsed: number;
  analyzedRuns: number;
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
  /**
   * Per role, the weighted mean of the axes → its percentile among real players of that role
   * (docs/superpowers/specs/2026-09-24-scoring-calibration-design.md). Monotone, so it never reorders
   * two players; `[[0, 0], [100, 100]]` turns it off.
   */
  globalCurve: Record<Role, CurvePoints>;
  verdict: { invite: number; maybe: number; minRuns: number };
  confidence: { high: number; medium: number; consistencyMinRuns: number; deepdiveMinRuns: number };
}
