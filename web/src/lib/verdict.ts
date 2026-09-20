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
