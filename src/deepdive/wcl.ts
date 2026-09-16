import type { GqlFn } from "../signals/enrich.ts";
import type { RawTable } from "../signals/types.ts";
import { REPORT_DEEPDIVE_NO_EVENTS_QUERY, REPORT_DEEPDIVE_QUERY } from "../wcl/queries.ts";
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

export interface FetchOpts {
  code: string;
  fightID: number;
  character: string;
  actorID: number;
  ids: number[];
  /** `pointsSpentThisHour` read just before this fetch (the PING pre-check); without it `pointsSpent` is null. */
  pointsBefore?: number;
}

/**
 * The one network call of a deep-dive. With no ids to filter on, the cast events are not
 * requested at all. Throws BudgetLowError before requesting a *subsequent* events page when
 * the hour's budget is nearly gone (the caller's PING pre-check guards the first page).
 */
export async function fetchRawDeepDive(gql: GqlFn, o: FetchOpts): Promise<RawDeepDive> {
  const events: RawDeepDive["castEvents"] = [];
  let startTime: number | null = null;
  let pages = 0;
  let truncated = false;
  let first: DeepDiveResponse | null = null;
  let lastCounter = 0;
  const withEvents = o.ids.length > 0;
  for (;;) {
    const resp: DeepDiveResponse = withEvents
      ? await gql<DeepDiveResponse>(REPORT_DEEPDIVE_QUERY, { code: o.code, fightID: o.fightID, actorID: o.actorID, filter: castFilter(o.ids), startTime })
      : await gql<DeepDiveResponse>(REPORT_DEEPDIVE_NO_EVENTS_QUERY, { code: o.code, fightID: o.fightID, actorID: o.actorID });
    const rl = resp.rateLimitData;
    if (!resp.reportData.report) throw new Error(`WCL: report ${o.code} not found`);
    first ??= resp;
    pages++;
    lastCounter = rl.pointsSpentThisHour;
    for (const e of resp.reportData.report.castEvents?.data ?? []) {
      if (typeof e.timestamp === "number" && typeof e.abilityGameID === "number")
        events.push({ timestamp: e.timestamp, abilityGameID: e.abilityGameID, sourceID: e.sourceID as number | undefined, targetID: e.targetID as number | undefined });
    }
    const next: number | null = withEvents ? (resp.reportData.report.castEvents?.nextPageTimestamp ?? null) : null;
    if (next === null) break;
    if (pages >= MAX_EVENT_PAGES) { truncated = true; break; }
    const left = rl.limitPerHour - rl.pointsSpentThisHour;
    if (left < MIN_BUDGET_POINTS) throw new BudgetLowError(left);
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
    pointsSpent: o.pointsBefore === undefined ? null : Math.max(0, Math.round((lastCounter - o.pointsBefore) * 10) / 10),
  };
}
