import type { AxisKey, Confidence, Evaluation } from "../types.ts";
import type { T } from "../i18n/t.ts";

export const AXIS_ORDER: readonly AxisKey[] = ["survival", "utility", "throughput", "consistency", "preparation", "experience"];
/** "Survival" / "Survie" — the axis name as the UI shows it. */
export const axisTitle = (t: T, key: AxisKey): string => t(`verdict.axes.${key}`);

export interface VerdictView {
  label: string;
  score: string | null;
  cls: "badge-invite" | "badge-maybe" | "badge-pass" | "badge-insufficient";
  sub: string;
}

export function verdictView(t: T, ev: Evaluation, autoTarget = false): VerdictView {
  const runs = t("verdict.runsScored", { count: ev.runsUsed });
  if (ev.verdict === "insufficient" || ev.global === null) {
    return { label: t("verdict.words.insufficient"), score: null, cls: "badge-insufficient", sub: t("verdict.only", { runs }) };
  }
  return {
    label: t(`verdict.words.${ev.verdict}`),
    score: String(Math.round(ev.global)),
    cls: `badge-${ev.verdict}`,
    sub: t("verdict.forLevel", { level: ev.targetLevel, auto: autoTarget ? t("verdict.autoSuffix") : "", runs }),
  };
}

export const confidenceColor = (c: Confidence | null): string =>
  c === "high" ? "#56d364" : c === "medium" ? "#e3b341" : c === "low" ? "#f85149" : "#6e7681";
