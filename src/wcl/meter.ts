// Points accounting for the shared WCL client (hosted mode). Every WCL query selects
// `rateLimitData`; the meter charges the counter's delta since the previous response of the same
// window to the request that is running (AsyncLocalStorage) and to that request's user.
// Attribution is exact when calls do not overlap and approximate under concurrency (a delta lands
// on whichever request observed it); the hour's total is always exact.
//
// `windowEnd` is only an estimate (WCL reports `pointsResetIn` as an integer number of seconds,
// possibly 0), so a response is only treated as the start of a new hour when the counter itself
// dropped at/after that estimate — a same-window response landing a few hundred ms late must not be
// charged as if the whole counter were new spend. Anything else with a counter at or above the
// baseline is an in-window delta, and `windowEnd` is refreshed from that response. A computed delta
// above `MAX_CHARGE_PER_OBSERVATION` is treated as a clock-boundary artefact rather than a real
// spend and charges nothing (see `observe()`).
import { AsyncLocalStorage } from "node:async_hooks";
import type { GqlFn } from "../signals/enrich.ts";
import type { RateLimit } from "./client.ts";

/** Estimated cost of one WCL step, checked before spending (WCL only reports after). */
export const ESTIMATE_RANKINGS = 10;
export const ESTIMATE_RUN = 10;
export const ESTIMATE_DEEPDIVE = 3;

/** A single observation charging more than this is treated as a clock-boundary artefact, not a real spend. */
export const MAX_CHARGE_PER_OBSERVATION = 100;

export interface RequestCharge { userId: number | null; spent: number }
export interface RateLimitSnapshot extends RateLimit { observedAt: number; windowEnd: number }
export interface UsageSink { add(userId: number, at: number, points: number): void }

const tenths = (n: number): number => Math.round(n * 10) / 10;

export class PointsMeter {
  private readonly als = new AsyncLocalStorage<RequestCharge>();
  private last: RateLimitSnapshot | null = null;

  constructor(private readonly deps: { usage: UsageSink; now?: () => number }) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** Runs `fn` with its WCL spending attributed to `userId` (null = charged to the request only). */
  run<T>(userId: number | null, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ userId, spent: 0 }, fn);
  }

  /** The running request's charge, or undefined outside `run`. */
  charge(): RequestCharge | undefined { return this.als.getStore(); }

  /** The last rateLimitData seen, or null before the first WCL response. */
  snapshot(): RateLimitSnapshot | null { return this.last; }

  /** Feed one response's rateLimitData. The first observation only primes the baseline. */
  observe(rl: RateLimit): void {
    const at = this.now();
    const prev = this.last;
    const next: RateLimitSnapshot = { ...rl, observedAt: at, windowEnd: at + rl.pointsResetIn * 1000 };
    if (!prev) { this.last = next; return; } // first observation: prime only, charge nobody
    let delta: number;
    if (at >= prev.windowEnd && rl.pointsSpentThisHour < prev.pointsSpentThisHour) {
      // The estimated window has elapsed AND the counter dropped: a genuine new hour started.
      delta = rl.pointsSpentThisHour;
    } else if (rl.pointsSpentThisHour < prev.pointsSpentThisHour) {
      // A late response with a lower counter, still inside the window (the estimate hasn't
      // elapsed): charge nothing and keep the higher baseline, or the next response would double-charge.
      this.last = { ...prev, observedAt: at };
      return;
    } else {
      // In-window: the counter is at or above the baseline, whatever the clock says. Charge only the
      // delta, and refresh windowEnd from this response (the previous estimate may have been wrong).
      delta = Math.max(0, rl.pointsSpentThisHour - prev.pointsSpentThisHour);
    }
    delta = tenths(delta);
    if (delta > MAX_CHARGE_PER_OBSERVATION) {
      // A real new window that already spent this much before its very first observation is far
      // rarer than a clock-boundary artefact; re-prime the baseline to this observation and charge
      // nothing (this only ever undercharges, never overcharges).
      this.last = next;
      return;
    }
    this.last = next;
    if (delta <= 0) return;
    const c = this.als.getStore();
    if (!c) return;
    c.spent = tenths(c.spent + delta);
    if (c.userId !== null) this.deps.usage.add(c.userId, at, delta);
  }

  /** A gql function whose responses feed this meter (tests today; per-user clients later). */
  wrap(gql: GqlFn): GqlFn {
    return async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      const data = await gql<T>(query, variables);
      const rl = (data as { rateLimitData?: RateLimit } | null)?.rateLimitData;
      if (rl && typeof rl.pointsSpentThisHour === "number") this.observe(rl);
      return data;
    };
  }
}
