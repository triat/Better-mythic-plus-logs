import { median } from "../evaluation/curve.ts";
import type { DeepdiveSummary, RunDefensives } from "./types.ts";

/** Cross-run aggregate of analyzed runs; `warning` = the override file's load error, if any. Pure. */
export function deepdiveSummary(runs: RunDefensives[], warning?: string): DeepdiveSummary {
  const usages = runs.map((r) => r.majorUsage).filter((u): u is number => u !== null);
  const avoidableDeaths = runs.reduce((s, r) => s + r.avoidableDeaths, 0);
  const countedDeaths = runs.reduce((s, r) => s + r.countedDeaths, 0);
  return {
    tableWarning: warning ?? null,
    analyzedRuns: runs.length,
    majorUsage: usages.length > 0 ? (median(usages) ?? null) : null,
    avoidableDeathShare: countedDeaths > 0 ? avoidableDeaths / countedDeaths : null,
    avoidableDeaths,
    countedDeaths,
  };
}
