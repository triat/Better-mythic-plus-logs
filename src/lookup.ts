import { deepdiveSummary } from "./deepdive/aggregate.ts";
import { analyzeCached } from "./deepdive/attach.ts";
import { getDefensives } from "./deepdive/table.ts";
import type { DeepdiveSummary, LoadedTables, RunDefensives } from "./deepdive/types.ts";
import { getEvalConfig } from "./evaluation/config.ts";
import { evaluate } from "./evaluation/evaluate.ts";
import type { EvalPayload } from "./evaluation/inputs.ts";
import type { Evaluation, EvaluationConfig } from "./evaluation/types.ts";
import {
  type LookupResult,
  type MPlusData,
  type MPlusRun,
  analyzeLookup,
  fetchMplusData,
  filterBySpec,
  inferTargetLevel,
  uniqueSpecs,
} from "./mplus.ts";
import { type Metric, metricForSpec } from "./roles.ts";
import { type GqlFn, displayedRuns, enrichRuns } from "./signals/enrich.ts";
import { fetchRioProfile } from "./signals/rio-client.ts";
import { type Store, getStore } from "./signals/store.ts";
import { type SignalSummary, signalSummary } from "./signals/summary.ts";
import type { RioProfile } from "./signals/types.ts";
import { realmToSlug } from "./util.ts";
import { ESTIMATE_RANKINGS, ESTIMATE_RUN } from "./wcl/meter.ts";
import type { Region } from "./wow/regions.ts";
import type { QuotaRefusal, Reserve } from "./hosted/quota.ts";

export interface LookupOptions {
  name: string;
  realm: string;
  /** Lower-case; the WCL and Raider.IO calls, the history key and the payload all carry it. */
  region: Region;
  level: number | null;
  spec: string | null;
  metric?: Metric;
  enrich: boolean;
  refresh?: boolean;
}

/** One spec the character has indexed runs on this season (before any spec filter). */
export interface SpecSeen {
  spec: string;
  runs: number;
  metric: Metric;
}

/** Every indexed run's spec with its run count, sorted by runs desc then name. */
export const specsSeen = (runs: MPlusRun[]): SpecSeen[] => {
  const counts = new Map<string, number>();
  for (const r of runs) counts.set(r.spec, (counts.get(r.spec) ?? 0) + 1);
  return [...counts]
    .map(([spec, n]) => ({ spec, runs: n, metric: metricForSpec(spec) }))
    .sort((a, b) => b.runs - a.runs || a.spec.localeCompare(b.spec));
};

export type LookupOutcome =
  | {
      ok: true;
      region: Region;
      data: MPlusData;
      /** Specs on the unfiltered rankings — what the spec picker offers. */
      specsSeen: SpecSeen[];
      result: LookupResult;
      rio: RioProfile | null;
      rioError?: string;
      summary: SignalSummary;
      evaluation: Evaluation;
      deepdive: RunDefensives[];
      deepdiveSummary: DeepdiveSummary;
    }
  | { ok: false; status: 404 | 429; error: string; quota?: QuotaRefusal };

interface Deps {
  store?: Store;
  gql?: GqlFn;
  fetchFn?: typeof fetch;
  evalConfig?: EvaluationConfig;
  tables?: LoadedTables;
  /** Test hook: replaces the rankings fetch (`fetchMplusData`). */
  fetchMplus?: typeof fetchMplusData;
  /** Hosted quota gate: consulted with an estimate before each WCL step; absent locally. */
  reserve?: Reserve;
}

/** The whole lookup: rankings → analysis → (WCL enrichment ‖ Raider.IO). */
export async function performLookup(opts: LookupOptions, deps: Deps = {}): Promise<LookupOutcome> {
  const store = deps.store ?? (await getStore());
  const refusedRankings = deps.reserve?.(ESTIMATE_RANKINGS);
  if (refusedRankings) return { ok: false, status: 429, error: refusedRankings.message, quota: refusedRankings };
  let data = await (deps.fetchMplus ?? fetchMplusData)(opts.name, opts.realm, {
    region: opts.region,
    metric: opts.metric,
    specFilter: opts.spec,
  });
  const seen = specsSeen(data.runs);

  if (opts.spec) {
    const runs = filterBySpec(data.runs, opts.spec);
    if (runs.length === 0) {
      const avail = uniqueSpecs(data.runs);
      return {
        ok: false,
        status: 404,
        error:
          `No runs found for spec "${opts.spec}". ` +
          (avail.length > 0
            ? `Specs seen on this character: ${avail.join(", ")}.`
            : "This character has no runs this season."),
      };
    }
    data = { ...data, runs, specFilter: opts.spec };
  }

  const effective = opts.level ?? inferTargetLevel(data.runs);
  if (effective === null) {
    return {
      ok: false,
      status: 404,
      error: "No runs found — cannot auto-detect target level. Pass --level <N> explicitly.",
    };
  }
  const result = analyzeLookup(data.runs, effective, data.seasonDungeons, opts.level === null);
  const shown = displayedRuns(result);

  if (opts.enrich && deps.reserve) {
    const uncached = new Set(shown.filter((r) => !store.getWclRun(r.reportCode, r.fightID)).map((r) => `${r.reportCode}:${r.fightID}`)).size;
    const refusedRuns = uncached > 0 ? deps.reserve(uncached * ESTIMATE_RUN) : null;
    if (refusedRuns) return { ok: false, status: 429, error: refusedRuns.message, quota: refusedRuns };
  }

  const [, rioRes] = await Promise.all([
    opts.enrich
      ? enrichRuns(shown, data.character.name, store, { gql: deps.gql })
      : Promise.resolve(),
    fetchRioProfile(opts.region, opts.realm, data.character.name, store, {
      refresh: opts.refresh,
      fetchFn: deps.fetchFn,
    }),
  ]);

  const tables = deps.tables ?? (await getDefensives());
  const deepdive = shown
    .map((r) => analyzeCached(store, tables, r, data.character.name))
    .filter((d): d is RunDefensives => d !== null);

  const summary = signalSummary(shown, rioRes.profile);
  const payloadForEval = {
    metric: data.metric,
    targetLevel: result.targetLevel,
    perDungeon: result.perDungeon,
    prevLevelBest: result.prevLevelBest,
    rio: rioRes.profile,
    summary,
    deepdive,
  };

  return {
    ok: true,
    region: opts.region,
    data,
    specsSeen: seen,
    result,
    rio: rioRes.profile,
    ...(rioRes.error ? { rioError: rioRes.error } : {}),
    summary,
    evaluation: evaluate(payloadForEval, deps.evalConfig ?? (await getEvalConfig())),
    deepdive,
    deepdiveSummary: deepdiveSummary(deepdive, tables.warning),
  };
}

export type LookupPayload = ReturnType<typeof buildLookupPayload>;

// Compile-time contract: the JSON emitted for `bmpl lookup --json` (and /api/lookup) must
// remain a valid `bmpl evaluate` input. If this stops type-checking, either buildLookupPayload
// dropped/renamed a field evaluate() needs, or EvalPayload grew a field lookup doesn't provide.
const _evalPayloadContract: EvalPayload = null as unknown as LookupPayload;
void _evalPayloadContract;

/** JSON emitted by `/api/lookup` and `bmpl lookup --json`. */
export function buildLookupPayload(o: Extract<LookupOutcome, { ok: true }>, realm: string) {
  const { data, result } = o;
  return {
    character: { ...data.character, realmSlug: realmToSlug(realm), region: o.region },
    zone: { id: data.zoneID, name: data.zoneName, partition: data.partition },
    metric: data.metric,
    metricAutoSelected: data.metricAutoSelected,
    alternateMetricHasData: data.alternateMetricHasData,
    specFilter: data.specFilter,
    specsSeen: o.specsSeen,
    runsIndexed: data.runs.length,
    seasonDungeons: data.seasonDungeons,
    targetLevel: result.targetLevel,
    targetAutoDetected: result.targetAutoDetected,
    atOrAboveTargetCount: result.atOrAboveTarget.length,
    prevLevelBest: result.prevLevelBest,
    perDungeon: result.perDungeon,
    rio: o.rio,
    rioError: o.rioError ?? null,
    summary: o.summary,
    deepdive: o.deepdive,
    deepdiveSummary: o.deepdiveSummary,
    evaluation: o.evaluation,
  };
}
