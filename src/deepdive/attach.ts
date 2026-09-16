import { evaluate } from "../evaluation/evaluate.ts";
import { evalRuns } from "../evaluation/inputs.ts";
import type { EvaluationConfig } from "../evaluation/types.ts";
import type { LookupPayload } from "../lookup.ts";
import type { Store } from "../signals/store.ts";
import { parseRunSignals } from "../signals/wcl-run.ts";
import { deepdiveSummary } from "./aggregate.ts";
import { analyzeRun } from "./analyze.ts";
import { playerOf } from "./player.ts";
import { specDefensives } from "./table.ts";
import type { LoadedTables, RunDefensives } from "./types.ts";

/** Analysis from the two cached rows (run report + raw deep-dive); null when either is missing. 0 pts. */
export function analyzeCached(store: Store, tables: LoadedTables, run: { reportCode: string; fightID: number }, character: string): RunDefensives | null {
  const raw = store.getDeepDive(run.reportCode, run.fightID, character);
  const report = store.getWclRun(run.reportCode, run.fightID);
  if (!raw || !report) return null;
  const player = playerOf(report, character);
  if (!player) return null;
  // The fallback is only used when the fight is missing from the report; a cached run has it.
  const signals = parseRunSignals(report, character, { keyLevel: 0, affixes: [], encounterID: 0 });
  if (!signals) return null;
  const table = specDefensives(tables.shipped, tables.override, player.className, player.spec);
  return analyzeRun({ raw, report, signals, character, className: player.className, spec: player.spec, table, tableVersion: tables.shipped.version, denylist: tables.shipped.denylist });
}

/** New payload with `deepdive` for every displayed run that has a cached analysis, its summary, and a re-run evaluation. */
export function attachDeepdive(payload: LookupPayload, store: Store, tables: LoadedTables, cfg: EvaluationConfig): LookupPayload {
  const character = payload.character.name;
  const deepdive = evalRuns(payload)
    .map((r) => analyzeCached(store, tables, r, character))
    .filter((d): d is RunDefensives => d !== null);
  const next = { ...payload, deepdive, deepdiveSummary: deepdiveSummary(deepdive) };
  return { ...next, evaluation: evaluate(next, cfg) };
}
