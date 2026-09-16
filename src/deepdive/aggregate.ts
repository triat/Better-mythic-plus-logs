import { median } from "../evaluation/curve.ts";
import type { DeepdiveSummary, RunDefensives } from "./types.ts";

/** Cross-run aggregate of analyzed runs. Pure. */
export function deepdiveSummary(runs: RunDefensives[]): DeepdiveSummary {
  const usages = runs.map((r) => r.majorUsage).filter((u): u is number => u !== null);
  const avoidableDeaths = runs.reduce((s, r) => s + r.avoidableDeaths, 0);
  const countedDeaths = runs.reduce((s, r) => s + r.countedDeaths, 0);
  return {
    analyzedRuns: runs.length,
    majorUsage: usages.length > 0 ? (median(usages) ?? null) : null,
    avoidableDeathShare: countedDeaths > 0 ? avoidableDeaths / countedDeaths : null,
    avoidableDeaths,
    countedDeaths,
  };
}
