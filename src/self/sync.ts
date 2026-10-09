// Season sync (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 3): one batch of raw run
// reports per request, newest first, so a member's own WCL secret only lives for one request and an interrupted sync
// resumes from the cache. The caller decides which WCL client runs it (src/server/season.ts).
import { BudgetLowError, MIN_BUDGET_POINTS } from "../deepdive/wcl.ts";
import { fetchMplusData, type MPlusRun } from "../mplus.ts";
import { fetchRunReport, type GqlFn } from "../signals/enrich.ts";
import type { CharacterKey, SeasonRow, Store } from "../signals/store.ts";
import { realmToSlug } from "../util.ts";
import { gql as realGql } from "../wcl/client.ts";
import { ESTIMATE_RANKINGS, ESTIMATE_RUN } from "../wcl/meter.ts";
import { PING_QUERY } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import type { Region } from "../wow/regions.ts";

export const SYNC_BATCH = 10;
export const SYNC_RETRY_MS = 24 * 60 * 60_000;

export interface SyncState {
  runs: number;
  /** Raw report cached: the run is analysed on read. */
  analysed: number;
  /** Still to fetch. */
  pending: number;
  /** WCL returned no report in the last 24 h (private or deleted log). */
  failed: number;
  /** Points a full sync would cost now: the rankings plus `ESTIMATE_RUN` per pending run (0 when nothing is pending). */
  estimate: number;
}

const recentlyFailed = (r: SeasonRow, now: number): boolean => r.failedAt !== null && now - r.failedAt < SYNC_RETRY_MS;

export const rowToRun = (r: SeasonRow): MPlusRun => ({
  encounterID: r.encounterID, encounterName: r.encounterName, keyLevel: r.keyLevel, amount: r.amount, parsePercent: r.parse,
  spec: r.spec, affixes: r.affixes, reportCode: r.reportCode, fightID: r.fightID, startTime: r.startTime, score: r.score,
  ...(r.timed === null ? {} : { timed: r.timed }),
  ...(r.durationMs === null ? {} : { durationMs: r.durationMs }),
});

export function syncState(store: Store, rows: SeasonRow[], now: number): SyncState {
  let analysed = 0;
  let failed = 0;
  for (const r of rows) {
    if (store.hasWclRun(r.reportCode, r.fightID)) analysed++;
    else if (recentlyFailed(r, now)) failed++;
  }
  const pending = rows.length - analysed - failed;
  return { runs: rows.length, analysed, pending, failed, estimate: pending > 0 ? ESTIMATE_RANKINGS + pending * ESTIMATE_RUN : 0 };
}

/** The runs a sync still has to fetch, in the rows' order (newest first from `Store.seasonRuns`). */
export const pendingRows = (store: Store, rows: SeasonRow[], now: number): SeasonRow[] =>
  rows.filter((r) => !store.hasWclRun(r.reportCode, r.fightID) && !recentlyFailed(r, now));

export type SyncBatchOutcome = { ok: true; fetched: number; failed: number } | { ok: false; status: 402; error: string };

/**
 * Fetches up to `SYNC_BATCH` pending reports. Refuses before spending when the client has less than
 * `MIN_BUDGET_POINTS` + `ESTIMATE_RUN` per run left. A report WCL does not return is marked failed (retried after
 * `SYNC_RETRY_MS`); a thrown fetch is not marked, and a batch where every fetch threw rethrows the first error.
 */
export async function syncBatch(store: Store, key: CharacterKey, rows: SeasonRow[], deps: { gql?: GqlFn; now?: number } = {}): Promise<SyncBatchOutcome> {
  const gql = deps.gql ?? realGql;
  const now = deps.now ?? Date.now();
  const batch = pendingRows(store, rows, now).slice(0, SYNC_BATCH);
  if (batch.length === 0) return { ok: true, fetched: 0, failed: 0 };
  const ping = await gql<RateLimitData>(PING_QUERY);
  const left = ping.rateLimitData.limitPerHour - ping.rateLimitData.pointsSpentThisHour;
  if (left < MIN_BUDGET_POINTS + batch.length * ESTIMATE_RUN) return { ok: false, status: 402, error: new BudgetLowError(left).message };
  const results = await Promise.allSettled(batch.map((r) => fetchRunReport(rowToRun(r), gql)));
  let fetched = 0;
  let failed = 0;
  let firstError: unknown = null;
  results.forEach((res, i) => {
    const r = batch[i]!;
    if (res.status === "rejected") {
      firstError ??= res.reason;
      return;
    }
    if (res.value) {
      store.putWclRun(r.reportCode, r.fightID, res.value);
      fetched++;
    } else {
      store.markSeasonRunFailed(key, r.reportCode, r.fightID, now);
      failed++;
    }
  });
  if (fetched === 0 && failed === 0 && firstError !== null) throw firstError;
  return { ok: true, fetched, failed };
}

export interface SeasonSyncRequest { name: string; realm: string; region: Region; refresh?: boolean }
export interface SeasonSyncDeps { store: Store; gql?: GqlFn; fetchMplus?: typeof fetchMplusData; now?: number }
export type SeasonSyncOutcome =
  | { ok: true; fetched: number; failed: number; state: SyncState; pointsSpent: number }
  | { ok: false; status: 402; error: string };

/**
 * One sync request: the rankings when asked (`refresh`, the first batch) or when nothing is stored yet, then one
 * batch. `pointsSpent` is the client's counter difference between two PINGs (0 pts each). Throws what
 * `fetchMplusData` and `syncBatch` throw (`CharacterNotFoundError`, `WclError`): the route maps them.
 */
export async function runSeasonSync(req: SeasonSyncRequest, deps: SeasonSyncDeps): Promise<SeasonSyncOutcome> {
  const gql = deps.gql ?? realGql;
  const now = deps.now ?? Date.now();
  const key: CharacterKey = { region: req.region, realm: realmToSlug(req.realm), name: req.name };
  const spent = async (): Promise<number> => (await gql<RateLimitData>(PING_QUERY)).rateLimitData.pointsSpentThisHour;
  const before = await spent();
  let zoneID = deps.store.latestSeasonZone(key);
  if (req.refresh || zoneID === null) {
    const data = await (deps.fetchMplus ?? fetchMplusData)(req.name, req.realm, { region: req.region });
    deps.store.upsertSeasonRuns(key, data.zoneID, data.metric, data.runs, now);
    zoneID = data.zoneID;
  }
  const out = await syncBatch(deps.store, key, deps.store.seasonRuns(key, zoneID), { gql, now });
  if (!out.ok) return out;
  const after = await spent();
  return {
    ok: true,
    fetched: out.fetched,
    failed: out.failed,
    state: syncState(deps.store, deps.store.seasonRuns(key, zoneID), now),
    pointsSpent: Math.max(0, Math.round((after - before) * 10) / 10),
  };
}
