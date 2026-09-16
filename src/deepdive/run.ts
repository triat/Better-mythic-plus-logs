import type { GqlFn } from "../signals/enrich.ts";
import type { Store } from "../signals/store.ts";
import { gql as realGql } from "../wcl/client.ts";
import { PING_QUERY } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import { analyzeCached } from "./attach.ts";
import { playerOf } from "./player.ts";
import { specDefensives } from "./table.ts";
import type { LoadedTables, RunDefensives } from "./types.ts";
import { BudgetLowError, MIN_BUDGET_POINTS, fetchRawDeepDive } from "./wcl.ts";

export interface DeepdiveRequest { reportCode: string; fightID: number; character: string; force?: boolean }
export interface RunDeps { store: Store; tables: LoadedTables; gql?: GqlFn }
export type DeepdiveOutcome =
  | { ok: true; result: RunDefensives; fromCache: boolean; pointsSpent: number | null }
  | { ok: false; status: 402 | 404 | 502; error: string };

/**
 * Analyze one run for one character: cached raw row → 0 pts; otherwise a budget pre-check
 * (PING, negligible) then the one deep-dive request (~3 pts), stored forever.
 */
export async function runDeepdive(req: DeepdiveRequest, deps: RunDeps): Promise<DeepdiveOutcome> {
  const gql = deps.gql ?? realGql;
  const report = deps.store.getWclRun(req.reportCode, req.fightID);
  if (!report) return { ok: false, status: 404, error: `run ${req.reportCode}:${req.fightID} is not in the cache — look the character up first` };
  const player = playerOf(report, req.character);
  if (!player) return { ok: false, status: 404, error: `${req.character} is not in the cached run ${req.reportCode}:${req.fightID}` };
  const table = specDefensives(deps.tables.shipped, deps.tables.override, player.className, player.spec);
  const ids = table.entries.map((e) => e.id);

  const cached = deps.store.getDeepDive(req.reportCode, req.fightID, req.character);
  if (cached && !req.force) {
    const result = analyzeCached(deps.store, deps.tables, req, req.character);
    if (result) return { ok: true, result, fromCache: true, pointsSpent: null };
  }
  try {
    const ping = await gql<RateLimitData>(PING_QUERY);
    const left = ping.rateLimitData.limitPerHour - ping.rateLimitData.pointsSpentThisHour;
    if (left < MIN_BUDGET_POINTS) return { ok: false, status: 402, error: new BudgetLowError(left).message };
    const raw = await fetchRawDeepDive(gql, { code: req.reportCode, fightID: req.fightID, character: req.character, actorID: player.actorID, ids });
    deps.store.putDeepDive(req.reportCode, req.fightID, req.character, raw);
    const result = analyzeCached(deps.store, deps.tables, req, req.character);
    if (!result) return { ok: false, status: 502, error: "analysis failed on the fetched data" };
    return { ok: true, result, fromCache: false, pointsSpent: raw.pointsSpent };
  } catch (e) {
    if (e instanceof BudgetLowError) return { ok: false, status: 402, error: e.message };
    return { ok: false, status: 502, error: e instanceof Error ? e.message : String(e) };
  }
}
