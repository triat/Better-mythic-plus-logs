import type { AxisKey, Confidence, Evaluation } from "../types.ts";

export const AXIS_ORDER: readonly AxisKey[] = ["survival", "utility", "throughput", "consistency", "preparation", "experience"];
export const AXIS_LABELS: Record<AxisKey, string> = {
  survival: "Survival",
  utility: "Utility",
  throughput: "Throughput",
  consistency: "Consistency",
  preparation: "Preparation",
  experience: "Experience",
};

/**
 * What each axis measures — the sub-signals of src/evaluation/default-config.json in plain words.
 * Shown in the expanded axis row ("What's measured") and in the legend under the radar.
 */
export const AXIS_DESCRIPTIONS: Record<AxisKey, string> = {
  survival:
    "Deaths and damage taken over the shown runs: individual deaths per run (scaled by key level), deaths during wipes, avoidable damage and damage taken per second vs the run's peers, teammate deaths (healers only). Once 2+ runs are deep-dived: major defensive usage and deaths with a defensive available.",
  utility:
    "Interrupts and dispels: kick usage vs the run's peers and vs the spec's own kick capacity (fight length / kick cooldown), dispels per run when the kit can dispel.",
  throughput:
    "Warcraft Logs parses: the median parse over the shown runs and the parse on runs at the target level (unranked logs are ignored).",
  consistency:
    "How much parses, deaths and damage-vs-peers vary from run to run (needs 5 runs with stats). Shown, never counted.",
  preparation:
    "Potions and healthstones per run, item level vs what the target key expects this season.",
  experience:
    "Season coverage: share of the season's dungeons run, share at or above the target level, median key vs target, runs in the last 7 days (Raider.IO), plus a bonus for the previous season's score.",
};

/** The axis weight in the verdict, per role, as shown next to each description (default-config.json axisWeights). */
export const AXIS_WEIGHTS: Record<AxisKey, string> = {
  survival: "weight 3 for every role",
  utility: "weight 2 (healer 2.5)",
  throughput: "weight 3 for dps, 2 for healer and tank",
  consistency: "weight 0 · informational",
  preparation: "weight 1",
  experience: "weight 2 (tank 2.5)",
};

export interface VerdictView {
  label: string;
  score: string | null;
  cls: "badge-invite" | "badge-maybe" | "badge-pass" | "badge-insufficient";
  sub: string;
}

const runs = (n: number) => `${n} run${n === 1 ? "" : "s"} scored`;

export function verdictView(ev: Evaluation, autoTarget = false): VerdictView {
  if (ev.verdict === "insufficient" || ev.global === null) {
    return { label: "NOT ENOUGH DATA", score: null, cls: "badge-insufficient", sub: `only ${runs(ev.runsUsed)}` };
  }
  return {
    label: ev.verdict.toUpperCase(),
    score: String(Math.round(ev.global)),
    cls: `badge-${ev.verdict}`,
    sub: `for a +${ev.targetLevel}${autoTarget ? " (auto)" : ""} · ${runs(ev.runsUsed)} · confidence per axis`,
  };
}

export const confidenceColor = (c: Confidence | null): string =>
  c === "high" ? "#56d364" : c === "medium" ? "#e3b341" : c === "low" ? "#f85149" : "#6e7681";
