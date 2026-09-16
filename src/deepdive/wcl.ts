import type { GqlFn } from "../signals/enrich.ts";
import type { RawTable } from "../signals/types.ts";
import { REPORT_DEEPDIVE_QUERY } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import type { RawDeepDive } from "./types.ts";

export const MAX_EVENT_PAGES = 5;
export const MIN_BUDGET_POINTS = 20;
/** Shown before the click; the real cost is measured after. */
export const estimateDeepdiveCost = (): number => 3;

export class BudgetLowError extends Error {
  constructor(public readonly pointsLeft: number) {
    super(`WCL budget low (${Math.round(pointsLeft)} pts left this hour)`);
    this.name = "BudgetLowError";
  }
}

interface DeepDiveResponse extends RateLimitData {
  reportData: {
    report: {
      fights?: Array<{ startTime?: number; endTime?: number }>;
      casts?: RawTable | null;
      buffs?: RawDeepDive["buffs"];
      castEvents?: { data?: Array<Record<string, unknown>>; nextPageTimestamp?: number | null };
    } | null;
  };
}

export const castFilter = (ids: number[]): string => `ability.id in (${ids.join(", ")})`;

// Points spent by the previous deep-dive query in this process; the counter WCL returns is
// cumulative for the hour, so the difference between two consecutive answers is one query's cost.
let lastSpent: number | null = null;

export interface FetchOpts { code: string; fightID: number; character: string; actorID: number; ids: number[] }

/** The one network call of a deep-dive. Throws BudgetLowError before spending when the hour's budget is nearly gone. */
export async function fetchRawDeepDive(gql: GqlFn, o: FetchOpts): Promise<RawDeepDive> {
  const events: RawDeepDive["castEvents"] = [];
  let startTime: number | null = null;
  let pages = 0;
  let truncated = false;
  let first: DeepDiveResponse | null = null;
  let spentBefore = lastSpent;
  for (;;) {
    const resp: DeepDiveResponse = await gql<DeepDiveResponse>(REPORT_DEEPDIVE_QUERY, { code: o.code, fightID: o.fightID, actorID: o.actorID, filter: castFilter(o.ids), startTime });
    const rl = resp.rateLimitData;
    if (rl.limitPerHour - rl.pointsSpentThisHour < MIN_BUDGET_POINTS) throw new BudgetLowError(rl.limitPerHour - rl.pointsSpentThisHour);
    if (!resp.reportData.report) throw new Error(`WCL: report ${o.code} not found`);
    first ??= resp;
    pages++;
    for (const e of resp.reportData.report.castEvents?.data ?? []) {
      if (typeof e.timestamp === "number" && typeof e.abilityGameID === "number")
        events.push({ timestamp: e.timestamp, abilityGameID: e.abilityGameID, sourceID: e.sourceID as number | undefined, targetID: e.targetID as number | undefined });
    }
    const next: number | null = resp.reportData.report.castEvents?.nextPageTimestamp ?? null;
    lastSpent = rl.pointsSpentThisHour;
    if (next === null) break;
    if (pages >= MAX_EVENT_PAGES) { truncated = true; break; }
    startTime = next;
  }
  const report = first!.reportData.report!;
  const fight = report.fights?.[0];
  return {
    code: o.code,
    fightID: o.fightID,
    character: o.character,
    actorID: o.actorID,
    fightStart: fight?.startTime ?? 0,
    fightEnd: fight?.endTime ?? 0,
    casts: report.casts ?? null,
    buffs: report.buffs ?? null,
    castEvents: events,
    tableIds: [...o.ids],
    truncated,
    fetchedAt: Date.now(),
    pointsSpent: spentBefore === null || lastSpent === null ? null : Math.max(0, Math.round((lastSpent - spentBefore) * 10) / 10),
  };
}
