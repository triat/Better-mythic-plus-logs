import { curve } from "./curve.ts";
import type { AxisKey, AxisScore, Confidence, EvaluationConfig, Evidence, Role } from "./types.ts";

export interface SubSignalInput {
  id: string;
  value: number | null;
  label: (raw: number) => string;
  x?: (raw: number) => number;
}

export const confidenceFor = (runsUsed: number, cfg: EvaluationConfig): Confidence =>
  runsUsed >= cfg.confidence.high ? "high" : runsUsed >= cfg.confidence.medium ? "medium" : "low";

export function scoreAxis(key: AxisKey, subs: SubSignalInput[], role: Role, cfg: EvaluationConfig, runsUsed: number): AxisScore {
  const conf = cfg.axes[key].subSignals;
  let num = 0;
  let den = 0;
  const evidence: Evidence[] = [];
  for (const sub of subs) {
    const sc = conf[sub.id];
    if (!sc) throw new Error(`no config for ${key}.${sub.id}`);
    const w = sc.weights[role];
    if (sub.value === null || w <= 0) continue;
    const s = curve(sub.x ? sub.x(sub.value) : sub.value, sc.curve);
    num += w * s;
    den += w;
    evidence.push({ label: sub.label(sub.value), delta: w * (s - 50), source: `${key}.${sub.id}` });
  }
  evidence.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { key, score: den > 0 ? num / den : null, confidence: confidenceFor(runsUsed, cfg), evidence };
}
