// Score drivers: for each sub-signal, how many badge points the player gains or loses against the role's average
// player (the calibration median, `cfg.reference`), and the largest costs, up to three, that together would bring
// the player to the next verdict if brought to that level. Spec: docs/superpowers/specs/2026-09-24-score-drivers-design.md.
import { scoreAllAxes } from "./axes/index.ts";
import type { Override } from "./axis.ts";
import { finalGlobal } from "./global.ts";
import type { EvalInputs } from "./inputs.ts";
import type { AxisScore, Driver, EvaluationConfig, NextVerdict, Verdict } from "./types.ts";

/** At most this many signals in the path to the next verdict. */
export const PATH_MAX = 3;

export function scoreDrivers(inputs: EvalInputs, axes: AxisScore[], global: number, verdict: Verdict, cfg: EvaluationConfig):
  { drivers: Driver[]; nextVerdict: NextVerdict | null } {
  const ref = cfg.reference[inputs.role];
  const globalWith = (override: Override): number => finalGlobal(scoreAllAxes(inputs, cfg, override), inputs.role, cfg) ?? global;
  const drivers: Driver[] = [];
  for (const e of axes.flatMap((a) => a.evidence)) {
    const r = ref[e.source];
    if (!r) continue; // no reference: deep-dive signals, experience.prevSeasonBonus
    const impact = global - globalWith({ [e.source]: r.x });
    if (Math.abs(impact) >= 1) drivers.push({ source: e.source, impact, value: e.value, reference: r.value, label: e.label });
  }
  drivers.sort((a, b) => a.impact - b.impact || a.source.localeCompare(b.source));

  const target = verdict === "pass" ? "maybe" : verdict === "maybe" ? "invite" : null;
  if (!target) return { drivers, nextVerdict: null };
  const costs = drivers.filter((x) => x.impact < 0).slice(0, PATH_MAX);
  if (costs.length === 0) return { drivers, nextVerdict: null }; // nothing costs points: no path to report
  const threshold = cfg.verdict[target];
  const override: Record<string, number> = {};
  const sources: string[] = [];
  let score = global;
  for (const d of costs) {
    override[d.source] = ref[d.source]!.x;
    sources.push(d.source);
    score = globalWith(override);
    if (score >= threshold) return { drivers, nextVerdict: { verdict: target, threshold, sources, score, reachable: true } };
  }
  return { drivers, nextVerdict: { verdict: target, threshold, sources, score, reachable: false } };
}
