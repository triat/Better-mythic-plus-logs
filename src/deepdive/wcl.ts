import type { GqlFn } from "../signals/enrich.ts";
import type { RawTable } from "../signals/types.ts";
import { REPORT_DEEPDIVE_NO_EVENTS_QUERY, REPORT_DEEPDIVE_QUERY, deathHealthQuery } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import type { DeathHealth, RawDeepDive } from "./types.ts";

export const MAX_EVENT_PAGES = 5;
export const MIN_BUDGET_POINTS = 20;
/** Shown before the click; the real cost is measured after. */
export const estimateDeepdiveCost = (): number => 4;
/** Health window fetched before each death; covers the Deaths table's windows seen so far (2 to 8 s). */
export const DEATH_HEALTH_WINDOW_MS = 10_000;

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
  /** Report-relative timestamps of the character's deaths (the cached Deaths table): one health window each. */
  deathTimes?: number[];
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
  let deathHealth: DeathHealth[] | undefined;
  if (o.deathTimes && o.deathTimes.length > 0) {
    const left = first!.rateLimitData.limitPerHour - lastCounter;
    if (left < MIN_BUDGET_POINTS) throw new BudgetLowError(left);
    const vars: Record<string, unknown> = { code: o.code, fightID: o.fightID, actorID: o.actorID };
    o.deathTimes.forEach((t, i) => { vars[`s${i}`] = t - DEATH_HEALTH_WINDOW_MS; vars[`e${i}`] = t + 1; });
    try {
      const resp = await gql<RateLimitData & { reportData: { report: Record<string, { data?: Array<Record<string, unknown>> } | null> | null } }>(deathHealthQuery(o.deathTimes.length), vars);
      lastCounter = resp.rateLimitData.pointsSpentThisHour;
      const rep = resp.reportData.report ?? {};
      deathHealth = o.deathTimes.map((t, i) => healthOf(t, o.actorID, [...(rep[`d${i}`]?.data ?? []), ...(rep[`h${i}`]?.data ?? [])]));
    } catch {
      // The casts and buffs are paid for: keep them, and the deaths are judged without health (the panel says so).
      deathHealth = o.deathTimes.map((deathTs) => ({ deathTs, maxHp: null, curve: [] }));
    }
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
    ...(deathHealth ? { deathHealth } : {}),
    truncated,
    fetchedAt: Date.now(),
    pointsSpent: o.pointsBefore === undefined ? null : Math.max(0, Math.round((lastCounter - o.pointsBefore) * 10) / 10),
  };
}

/**
 * The player's health curve from raw events: `hitPoints` is the health after the event, and belongs to the event's
 * target when `resourceActor` is 2, to its source when 1 (a heal from another player carries the healer's health).
 */
export function healthOf(deathTs: number, actorID: number, events: Array<Record<string, unknown>>): DeathHealth {
  let maxHp: number | null = null;
  const curve: DeathHealth["curve"] = [];
  const sorted = [...events].filter((e) => typeof e.timestamp === "number").sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  for (const e of sorted) {
    const owner = e.resourceActor === 2 ? e.targetID : e.resourceActor === 1 ? e.sourceID : undefined;
    if (owner !== actorID || typeof e.hitPoints !== "number" || typeof e.maxHitPoints !== "number" || e.maxHitPoints <= 0) continue;
    if ((e.timestamp as number) > deathTs) continue;
    maxHp = e.maxHitPoints;
    curve.push({ ts: e.timestamp as number, hp: e.hitPoints });
  }
  return { deathTs, maxHp, curve };
}
