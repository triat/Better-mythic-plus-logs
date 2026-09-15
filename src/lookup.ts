import { config } from "./config.ts";
import {
  type LookupResult,
  type MPlusData,
  analyzeLookup,
  fetchMplusData,
  filterBySpec,
  inferTargetLevel,
  uniqueSpecs,
} from "./mplus.ts";
import type { Metric } from "./roles.ts";
import { type GqlFn, displayedRuns, enrichRuns } from "./signals/enrich.ts";
import { fetchRioProfile } from "./signals/rio-client.ts";
import { type Store, getStore } from "./signals/store.ts";
import { type SignalSummary, signalSummary } from "./signals/summary.ts";
import type { RioProfile } from "./signals/types.ts";
import { realmToSlug } from "./util.ts";

export interface LookupOptions {
  name: string;
  realm: string;
  level: number | null;
  spec: string | null;
  metric?: Metric;
  enrich: boolean;
  refresh?: boolean;
}

export type LookupOutcome =
  | {
      ok: true;
      data: MPlusData;
      result: LookupResult;
      rio: RioProfile | null;
      rioError?: string;
      summary: SignalSummary;
    }
  | { ok: false; status: 404; error: string };

interface Deps {
  store?: Store;
  gql?: GqlFn;
  fetchFn?: typeof fetch;
}

/** The whole lookup: rankings → analysis → (WCL enrichment ‖ Raider.IO). */
export async function performLookup(opts: LookupOptions, deps: Deps = {}): Promise<LookupOutcome> {
  const store = deps.store ?? (await getStore());
  let data = await fetchMplusData(opts.name, opts.realm, {
    metric: opts.metric,
    specFilter: opts.spec,
  });

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

  const [, rioRes] = await Promise.all([
    opts.enrich
      ? enrichRuns(displayedRuns(result), data.character.name, store, { gql: deps.gql })
      : Promise.resolve(),
    fetchRioProfile(config.region, opts.realm, data.character.name, store, {
      refresh: opts.refresh,
      fetchFn: deps.fetchFn,
    }),
  ]);

  return {
    ok: true,
    data,
    result,
    rio: rioRes.profile,
    ...(rioRes.error ? { rioError: rioRes.error } : {}),
    summary: signalSummary(displayedRuns(result), rioRes.profile),
  };
}

export type LookupPayload = ReturnType<typeof buildLookupPayload>;

/** JSON emitted by `/api/lookup` and `bmpl lookup --json`. */
export function buildLookupPayload(o: Extract<LookupOutcome, { ok: true }>, realm: string) {
  const { data, result } = o;
  return {
    character: { ...data.character, realmSlug: realmToSlug(realm), region: config.region },
    zone: { id: data.zoneID, name: data.zoneName, partition: data.partition },
    metric: data.metric,
    metricAutoSelected: data.metricAutoSelected,
    alternateMetricHasData: data.alternateMetricHasData,
    specFilter: data.specFilter,
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
  };
}
