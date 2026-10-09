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

/**
 * Rankings a lookup paid for but could not use, because the quota then refused the run enrichment. Rankings are
 * otherwise fetched at every lookup, so without this a member retrying a refused lookup paid for them again each
 * time and never got further. Kept in memory for `TTL_MS`, dropped by the lookup that finally completes; Refresh
 * never reads them.
 */
export class RecentRankings {
  static readonly TTL_MS = 15 * 60_000;
  static readonly MAX = 200;
  private readonly kept = new Map<string, { data: MPlusData; at: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  static key(o: LookupOptions): string {
    return [o.region, realmToSlug(o.realm), o.name.toLowerCase(), o.metric ?? "", o.spec ?? ""].join("|");
  }
  get(key: string): MPlusData | null {
    const hit = this.kept.get(key);
    if (!hit) return null;
    if (this.now() - hit.at > RecentRankings.TTL_MS) { this.kept.delete(key); return null; }
    return hit.data;
  }
  keep(key: string, data: MPlusData): void {
    this.kept.delete(key);
    this.kept.set(key, { data, at: this.now() });
    if (this.kept.size > RecentRankings.MAX) this.kept.delete(this.kept.keys().next().value!);
  }
  drop(key: string): void { this.kept.delete(key); }
}

const recentRankings = new RecentRankings();

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
  /** Rankings kept after an enrichment refusal (tests pass their own). */
  recent?: RecentRankings;
}

/** The whole lookup: rankings → analysis → (WCL enrichment ‖ Raider.IO). */
export async function performLookup(opts: LookupOptions, deps: Deps = {}): Promise<LookupOutcome> {
  const store = deps.store ?? (await getStore());
  const recent = deps.recent ?? recentRankings;
  const recentKey = RecentRankings.key(opts);
  let fetched = opts.refresh ? null : recent.get(recentKey);
  if (!fetched) {
    const refusedRankings = deps.reserve?.(ESTIMATE_RANKINGS);
    if (refusedRankings) return { ok: false, status: 429, error: refusedRankings.message, quota: refusedRankings };
    fetched = await (deps.fetchMplus ?? fetchMplusData)(opts.name, opts.realm, {
      region: opts.region,
      metric: opts.metric,
      specFilter: opts.spec,
    });
  }
  let data = fetched;
  // The rankings list every ranked run of the season (issue #24 § 1): keep them for the season views, 0 extra pts.
  store.upsertSeasonRuns({ region: opts.region, realm: realmToSlug(opts.realm), name: data.character.name }, data.zoneID, data.metric, data.runs);
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
    if (refusedRuns) {
      recent.keep(recentKey, fetched);
      return { ok: false, status: 429, error: refusedRuns.message, quota: refusedRuns };
    }
  }
  recent.drop(recentKey);

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
