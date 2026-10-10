// Season sync (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 3): one batch of raw run
// reports and their crowd control (docs/superpowers/specs/2026-10-10-self-review-control-design.md, decision 4) per
// request, newest first, so a member's own WCL secret only lives for one request and an interrupted sync resumes from
// the cache. The caller decides which WCL client runs it (src/server/season.ts).
import { BudgetLowError, MIN_BUDGET_POINTS } from "../deepdive/wcl.ts";
import { fetchMplusData, type MPlusRun } from "../mplus.ts";
import { CC_TABLE } from "../signals/control/table.ts";
import { fetchRunControl, fetchRunReport, type GqlFn } from "../signals/enrich.ts";
import type { CharacterKey, SeasonRow, Store } from "../signals/store.ts";
import { realmToSlug } from "../util.ts";
import { gql as realGql } from "../wcl/client.ts";
import { ESTIMATE_CONTROL, ESTIMATE_RANKINGS, ESTIMATE_RUN } from "../wcl/meter.ts";
import { PING_QUERY } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import type { Region } from "../wow/regions.ts";

export const SYNC_BATCH = 10;
export const SYNC_RETRY_MS = 24 * 60 * 60_000;

export interface SyncState {
  runs: number;
  /** Raw report cached: the run is analysed on read. */
  analysed: number;
  /** Runs with something to fetch: the raw report, the crowd control, or both. */
  pending: number;
  /** Pending runs whose raw report is cached: only their crowd control is fetched (~3 pts each). */
  controlOnly: number;
  /** WCL returned no report in the last 24 h (private or deleted log). */
  failed: number;
  /** Points a full sync would cost now: the rankings, `ESTIMATE_RUN` per run not analysed and `ESTIMATE_CONTROL` per run
   * without crowd control at the current table version (0 when nothing is pending). */
  estimate: number;
}

const recentlyFailed = (r: SeasonRow, now: number): boolean => r.failedAt !== null && now - r.failedAt < SYNC_RETRY_MS;

export const rowToRun = (r: SeasonRow): MPlusRun => ({
  encounterID: r.encounterID, encounterName: r.encounterName, keyLevel: r.keyLevel, amount: r.amount, parsePercent: r.parse,
  spec: r.spec, affixes: r.affixes, reportCode: r.reportCode, fightID: r.fightID, startTime: r.startTime, score: r.score,
  ...(r.timed === null ? {} : { timed: r.timed }),
  ...(r.durationMs === null ? {} : { durationMs: r.durationMs }),
});

const needsRaw = (store: Store, r: SeasonRow): boolean => !store.hasWclRun(r.reportCode, r.fightID);
const needsControl = (store: Store, r: SeasonRow): boolean => !store.hasRunControl(r.reportCode, r.fightID, CC_TABLE.version);
const costOf = (store: Store, r: SeasonRow): number =>
  (needsRaw(store, r) ? ESTIMATE_RUN : 0) + (needsControl(store, r) ? ESTIMATE_CONTROL : 0);

export function syncState(store: Store, rows: SeasonRow[], now: number): SyncState {
  let analysed = 0;
  let failed = 0;
  let pending = 0;
  let controlOnly = 0;
  let cost = 0;
  for (const r of rows) {
    const raw = !needsRaw(store, r);
    if (raw) analysed++;
    const c = costOf(store, r);
    if (c === 0) continue;
    if (recentlyFailed(r, now)) { failed++; continue; }
    pending++;
    if (raw) controlOnly++;
    cost += c;
  }
  return { runs: rows.length, analysed, pending, controlOnly, failed, estimate: pending > 0 ? ESTIMATE_RANKINGS + cost : 0 };
}

/** The runs a sync still has to fetch, in the rows' order (newest first from `Store.seasonRuns`). */
export const pendingRows = (store: Store, rows: SeasonRow[], now: number): SeasonRow[] =>
  rows.filter((r) => costOf(store, r) > 0 && !recentlyFailed(r, now));

export type SyncBatchOutcome = { ok: true; fetched: number; failed: number } | { ok: false; status: 402; error: string };

/**
 * Fetches up to `SYNC_BATCH` pending runs: the raw report when it is missing, then the crowd control when it is
 * missing. Refuses before spending when the client has less than `MIN_BUDGET_POINTS` + the batch's cost left. A
 * report or crowd control WCL does not return marks the run failed (retried after `SYNC_RETRY_MS`); a thrown fetch is
 * not marked, and a batch where every fetch threw rethrows the first error.
 */
export async function syncBatch(store: Store, key: CharacterKey, rows: SeasonRow[], deps: { gql?: GqlFn; now?: number } = {}): Promise<SyncBatchOutcome> {
  const gql = deps.gql ?? realGql;
  const now = deps.now ?? Date.now();
  const batch = pendingRows(store, rows, now).slice(0, SYNC_BATCH);
  if (batch.length === 0) return { ok: true, fetched: 0, failed: 0 };
  const ping = await gql<RateLimitData>(PING_QUERY);
  const left = ping.rateLimitData.limitPerHour - ping.rateLimitData.pointsSpentThisHour;
  const batchCost = batch.reduce((n, r) => n + costOf(store, r), 0);
  if (left < MIN_BUDGET_POINTS + batchCost) return { ok: false, status: 402, error: new BudgetLowError(left).message };
  const work = async (r: SeasonRow): Promise<"ok" | "missing"> => {
    if (needsRaw(store, r)) {
      const raw = await fetchRunReport(rowToRun(r), gql);
      if (!raw) return "missing";
      store.putWclRun(r.reportCode, r.fightID, raw);
    }
    if (needsControl(store, r)) {
      const control = await fetchRunControl(r, gql);
      if (!control) return "missing";
      store.putRunControl(r.reportCode, r.fightID, control);
    }
    return "ok";
  };
  const results = await Promise.allSettled(batch.map(work));
  let fetched = 0;
  let failed = 0;
  let firstError: unknown = null;
  results.forEach((res, i) => {
    const r = batch[i]!;
    if (res.status === "rejected") {
      firstError ??= res.reason;
      return;
    }
    if (res.value === "ok") {
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
  const ping = await gql<RateLimitData>(PING_QUERY);
  const before = ping.rateLimitData.pointsSpentThisHour;
  let zoneID = deps.store.latestSeasonZone(key);
  if (req.refresh || zoneID === null) {
    // The rankings come first and cost ~20 pts: refused before spending, like a batch.
    const left = ping.rateLimitData.limitPerHour - before;
    if (left < MIN_BUDGET_POINTS + ESTIMATE_RANKINGS) return { ok: false, status: 402, error: new BudgetLowError(left).message };
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
    // A lower counter means WCL's hour turned during the request: what it reports now was all spent since.
    pointsSpent: Math.round((after >= before ? after - before : after) * 10) / 10,
  };
}
