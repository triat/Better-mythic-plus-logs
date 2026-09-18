// Points accounting for the shared WCL client (hosted mode). Every WCL query selects
// `rateLimitData`; the meter charges the counter's delta since the previous response of the same
// window to the request that is running (AsyncLocalStorage) and to that request's user.
// Attribution is exact when calls do not overlap and approximate under concurrency (a delta lands
// on whichever request observed it); the hour's total is always exact.
import { AsyncLocalStorage } from "node:async_hooks";
import type { GqlFn } from "../signals/enrich.ts";
import type { RateLimit } from "./client.ts";

/** Estimated cost of one WCL step, checked before spending (WCL only reports after). */
export const ESTIMATE_RANKINGS = 10;
export const ESTIMATE_RUN = 10;
export const ESTIMATE_DEEPDIVE = 3;

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
    let delta = 0;
    if (prev && at >= prev.windowEnd) {
      delta = rl.pointsSpentThisHour; // a new WCL window: everything on the counter is new spend
    } else if (prev) {
      delta = Math.max(0, rl.pointsSpentThisHour - prev.pointsSpentThisHour);
      // A late response with a lower counter must not lower the baseline (the next one would double-charge).
      if (rl.pointsSpentThisHour < prev.pointsSpentThisHour) { this.last = { ...prev, observedAt: at }; return; }
    }
    this.last = next;
    delta = tenths(delta);
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
