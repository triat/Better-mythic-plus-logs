import type { LookupResult, MPlusData, MPlusRun } from "../mplus.ts";
import { gql as realGql } from "../wcl/client.ts";
import {
  REPORT_RUN_SUMMARY_QUERY,
  REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY,
} from "../wcl/queries.ts";
import { avoidableFilterExpression, avoidableSpellIdsFor } from "./avoidable/index.ts";
import type { Store } from "./store.ts";
import type { RawRunReport } from "./types.ts";
import { parseRunSignals } from "./wcl-run.ts";

export type GqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

interface Deps {
  gql?: GqlFn;
}

const runKey = (r: MPlusRun) => `${r.reportCode}:${r.fightID}`;

/** The runs a lookup shows: prev-level best + per-dungeon bests, de-duplicated. */
export const displayedRuns = (result: LookupResult): MPlusRun[] => {
  const all: MPlusRun[] = [];
  if (result.prevLevelBest) all.push(result.prevLevelBest.best);
  all.push(...result.perDungeon.runs);
  return [...new Map(all.map((r) => [runKey(r), r])).values()];
};

async function fetchRaw(run: MPlusRun, gql: GqlFn): Promise<RawRunReport | null> {
  const ids = avoidableSpellIdsFor(run.encounterID);
  const variables: Record<string, unknown> = { code: run.reportCode, fightID: run.fightID };
  let query = REPORT_RUN_SUMMARY_QUERY;
  if (ids) {
    query = REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY;
    variables.avoidFilter = avoidableFilterExpression(ids);
  }
  const resp = await gql<{ reportData: { report: RawRunReport | null } }>(query, variables);
  return resp.reportData.report;
}

/**
 * Attach `signals` to each run: store hit → parse; miss → WCL → store → parse.
 * Runs in parallel. A failure on one run leaves that run's `signals`
 * undefined and never throws. ~10 pts per uncached run.
 */
export async function enrichRuns(
  runs: MPlusRun[],
  characterName: string,
  store: Store,
  deps: Deps = {},
): Promise<void> {
  const gql = deps.gql ?? realGql;
  const byKey = new Map<string, MPlusRun[]>();
  for (const r of runs) {
    const k = runKey(r);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }

  await Promise.all(
    [...byKey.values()].map(async (group) => {
      const first = group[0]!;
      try {
        let raw = store.getWclRun(first.reportCode, first.fightID);
        if (!raw) {
          raw = await fetchRaw(first, gql);
          if (raw) store.putWclRun(first.reportCode, first.fightID, raw);
        }
        const signals = parseRunSignals(raw, characterName, {
          keyLevel: first.keyLevel,
          affixes: first.affixes,
          encounterID: first.encounterID,
        });
        if (signals) for (const r of group) r.signals = signals;
      } catch {
        /* leave signals undefined for this run */
      }
    }),
  );
}

export const enrichLookupResult = (
  data: MPlusData,
  result: LookupResult,
  store: Store,
  deps: Deps = {},
): Promise<void> => enrichRuns(displayedRuns(result), data.character.name, store, deps);
