import type { LookupResult, MPlusRun } from "../mplus.ts";
import { gql as realGql } from "../wcl/client.ts";
import {
  REPORT_RUN_CONTROL_QUERY,
  REPORT_RUN_SUMMARY_QUERY,
  REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY,
} from "../wcl/queries.ts";
import { avoidableFilterExpression, avoidableSpellIdsFor } from "./avoidable/index.ts";
import { CC_TABLE, ccFilterExpression } from "./control/table.ts";
import type { Store } from "./store.ts";
import type { RawControlEvent, RawRunControl, RawRunReport } from "./types.ts";
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

/** One run's raw report (~10 pts): the summary tables, plus the avoidable table when the dungeon has a list. */
export async function fetchRunReport(run: MPlusRun, gql: GqlFn): Promise<RawRunReport | null> {
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

const CONTROL_MAX_PAGES = 5;

interface RawControlAnswer {
  reportData: { report: {
    masterData?: { actors?: Array<{ id: number; petOwner?: number | null }> };
    cc?: { data?: RawControlEvent[]; nextPageTimestamp?: number | null };
  } | null };
}

/** One run's crowd-control events (~3 pts, spec decision 3); null when WCL returns no report. */
export async function fetchRunControl(run: { reportCode: string; fightID: number }, gql: GqlFn): Promise<RawRunControl | null> {
  const filter = ccFilterExpression();
  const events: RawControlEvent[] = [];
  let pets: RawRunControl["pets"] | null = null;
  let startTime: number | undefined;
  for (let page = 0; page < CONTROL_MAX_PAGES; page++) {
    const resp = await gql<RawControlAnswer>(REPORT_RUN_CONTROL_QUERY, { code: run.reportCode, fightID: run.fightID, filter, ...(startTime === undefined ? {} : { startTime }) });
    const report = resp.reportData.report;
    if (!report) return null;
    pets ??= (report.masterData?.actors ?? []).filter((a) => typeof a.petOwner === "number").map((a) => ({ id: a.id, petOwner: a.petOwner! }));
    events.push(...(report.cc?.data ?? []));
    const next = report.cc?.nextPageTimestamp;
    if (typeof next !== "number") break;
    startTime = next;
  }
  return { tableVersion: CC_TABLE.version, pets: pets ?? [], events };
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
          raw = await fetchRunReport(first, gql);
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
