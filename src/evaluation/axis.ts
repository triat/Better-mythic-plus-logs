import { curve } from "./curve.ts";
import type { AxisKey, AxisScore, Confidence, EvaluationConfig, Evidence, Role } from "./types.ts";

export interface SubSignalInput {
  id: string;
  value: number | null;
  label: (raw: number) => string;
  x?: (raw: number) => number;
  /** Value handed to `label` instead of `value` when present (e.g. an unscaled mean kept for display). */
  raw?: number;
}

export const confidenceFor = (runsUsed: number, cfg: EvaluationConfig): Confidence =>
  runsUsed >= cfg.confidence.high ? "high" : runsUsed >= cfg.confidence.medium ? "medium" : "low";

/**
 * Weighted mean of curved sub-signal scores, plus one Evidence per contributing sub-signal.
 * Two passes: first the contributing set and Σw, then each delta = w × (s − 50) / Σw so
 * deltas are in axis points and sum to score − 50 (comparable across axes).
 */
export function scoreAxis(key: AxisKey, subs: SubSignalInput[], role: Role, cfg: EvaluationConfig, runsUsed: number): AxisScore {
  const conf = cfg.axes[key].subSignals;
  const contributing: { source: string; w: number; s: number; label: string }[] = [];
  let den = 0;
  for (const sub of subs) {
    const sc = conf[sub.id];
    if (!sc) throw new Error(`no config for ${key}.${sub.id}`);
    const w = sc.weights[role];
    if (sub.value === null || w <= 0) continue;
    const s = curve(sub.x ? sub.x(sub.value) : sub.value, sc.curve);
    contributing.push({ source: `${key}.${sub.id}`, w, s, label: sub.label(sub.raw ?? sub.value) });
    den += w;
  }
  let num = 0;
  const evidence: Evidence[] = [];
  for (const { source, w, s, label } of contributing) {
    num += w * s;
    evidence.push({ label, delta: Math.round(((w * (s - 50)) / den) * 10) / 10, source });
  }
  evidence.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { key, score: den > 0 ? Math.round(num / den) : null, confidence: confidenceFor(runsUsed, cfg), evidence };
}
