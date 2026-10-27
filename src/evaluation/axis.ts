import { curve } from "./curve.ts";
import type { AxisKey, AxisScore, Confidence, CurvePoints, EvaluationConfig, Evidence, EvidenceExtra, Role, SubSignalConfig } from "./types.ts";

export interface SubSignalInput {
  id: string;
  value: number | null;
  label: (raw: number) => string;
  x?: (raw: number) => number;
  /** Value handed to `label` instead of `value` when present (e.g. an unscaled mean kept for display). */
  raw?: number;
  /** Extra numbers the label uses besides the value; copied onto the evidence for the front. */
  extra?: EvidenceExtra;
  /** False when the kit cannot have this sub-signal at all (no interrupt, no dispel): left out, never imputed. */
  applies?: boolean;
  /** Runs the value was measured on, for the config's shrinkage (`EvaluationConfig.shrinkage`); absent: no pull. */
  n?: number;
}

/** The sub-signal's curve for a role: its per-role curve when the config has one (decision 8), else the shared one. */
export const curveFor = (sc: SubSignalConfig, role: Role): CurvePoints => sc.curves?.[role] ?? sc.curve;

/**
 * A curve input pulled toward the role's average player by k / (n + k) (validity spec 2026-10-27, decision 7): with n
 * runs measured, the value keeps n / (n + k) of its distance to the reference. k = 0, no reference or no n: unchanged.
 */
export function shrink(x: number, n: number | undefined, k: number | undefined, ref: number | undefined): number {
  if (n === undefined || k === undefined || ref === undefined || k <= 0 || n <= 0) return x;
  return (n * x + k * ref) / (n + k);
}

/** Curve inputs to use instead of the player's, by source ("survival.individualDeaths"): the score drivers'
 * "what if this signal were the average player's" (docs/superpowers/specs/2026-09-24-score-drivers-design.md). */
export type Override = Readonly<Record<string, number>>;

export const confidenceFor = (runsUsed: number, cfg: EvaluationConfig): Confidence =>
  runsUsed >= cfg.confidence.high ? "high" : runsUsed >= cfg.confidence.medium ? "medium" : "low";

/**
 * Weighted mean of curved sub-signal scores, plus one Evidence per measured sub-signal.
 * Two passes: first the contributing set and Σw, then each delta = w × (s − 50) / Σw so
 * deltas are in axis points (comparable across axes); with the imputed sources' share they sum to score − 50.
 *
 * A sub-signal the player could have but whose data is missing scores as the role's average player
 * (`cfg.reference`, docs/superpowers/specs/2026-10-27-evaluation-validity-design.md, decision 3): unknown data neither
 * helps nor hurts. It is listed in `imputed`, never as evidence. An axis with no measured sub-signal stays n/a.
 */
export function scoreAxis(key: AxisKey, subs: SubSignalInput[], role: Role, cfg: EvaluationConfig, runsUsed: number, override?: Override): AxisScore {
  const conf = cfg.axes[key].subSignals;
  const contributing: { source: string; w: number; s: number; label: string; value: number; extra?: EvidenceExtra }[] = [];
  const pillarOnly: Evidence[] = [];
  const imputed: string[] = [];
  let den = 0;
  let imputedNum = 0;
  for (const sub of subs) {
    const sc = conf[sub.id];
    if (!sc) throw new Error(`no config for ${key}.${sub.id}`);
    const w = sc.weights[role];
    if (sub.applies === false || w <= 0) continue;
    const source = `${key}.${sub.id}`;
    if (sub.value === null) {
      const ref = cfg.reference[role]?.[source];
      if (sc.pillarOnly || !ref) continue;
      imputed.push(source);
      imputedNum += w * curve(override?.[source] ?? ref.x, curveFor(sc, role));
      den += w;
      continue;
    }
    const measured = sub.x ? sub.x(sub.value) : sub.value;
    const x = override?.[source] ?? shrink(measured, sub.n, cfg.shrinkage?.[role]?.[source], cfg.reference[role]?.[source]?.x);
    const s = curve(x, curveFor(sc, role));
    const value = sub.raw ?? sub.value;
    // Scored for its pillar only (src/evaluation/pillars.ts): never in Σw, so never in the axis score.
    if (sc.pillarOnly) {
      pillarOnly.push({ label: sub.label(value), delta: 0, source, value, ...(sub.extra ? { extra: sub.extra } : {}), weight: w, score: s });
      continue;
    }
    contributing.push({ source, w, s, label: sub.label(value), value, ...(sub.extra ? { extra: sub.extra } : {}) });
    den += w;
  }
  let num = imputedNum;
  const evidence: Evidence[] = [];
  for (const { source, w, s, label, value, extra } of contributing) {
    num += w * s;
    evidence.push({ label, delta: Math.round(((w * (s - 50)) / den) * 10) / 10, source, value, ...(extra ? { extra } : {}), weight: w, score: s });
  }
  evidence.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    key, score: contributing.length > 0 ? Math.round(num / den) : null, confidence: confidenceFor(runsUsed, cfg), evidence,
    ...(pillarOnly.length > 0 ? { pillarOnly } : {}),
    ...(imputed.length > 0 && contributing.length > 0 ? { imputed } : {}),
  };
}
