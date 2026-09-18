// Hosted-mode in-app rate limits (issue #9): a sliding window of hit timestamps per key, one
// limiter per protected surface (`/auth/*` per IP, `POST /api/lookup` and `POST /api/deepdive` per
// user). Nothing here spends WCL points or touches the database; the server answers 429 with
// `Retry-After` on a refusal and records `rate_limited` in the audit log.

export interface RateLimitRule { limit: number; windowMs: number }

export const DEFAULT_RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60_000 },
  lookup: { limit: 30, windowMs: 60_000 },
  deepdive: { limit: 60, windowMs: 60_000 },
} as const;

export type RateLimits = { [K in keyof typeof DEFAULT_RATE_LIMITS]: RateLimitRule };

export type RateLimitVerdict = { ok: true; remaining: number } | { ok: false; retryAfterS: number };

export class RateLimiter {
  /** Accepted hit timestamps per key, ascending; a hit at `t` leaves the window once `t <= now - windowMs`. */
  private readonly hits = new Map<string, number[]>();

  constructor(readonly rule: RateLimitRule) {}

  /** Records a hit for `key` at `now`; refuses (without recording) when the window already holds `limit` hits. */
  hit(key: string, now: number): RateLimitVerdict {
    const { limit, windowMs } = this.rule;
    const floor = now - windowMs;
    let list = this.hits.get(key);
    if (list) {
      let drop = 0;
      while (drop < list.length && list[drop]! <= floor) drop++;
      if (drop > 0) list.splice(0, drop);
    } else {
      list = [];
      this.hits.set(key, list);
    }
    if (list.length >= limit) {
      const oldest = list[0]!;
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
    }
    list.push(now);
    return { ok: true, remaining: limit - list.length };
  }

  /** Drops keys with no hit inside the window (call from the hourly sweep). */
  sweep(now: number): void {
    const floor = now - this.rule.windowMs;
    for (const [key, list] of this.hits) {
      if (list.length === 0 || list[list.length - 1]! <= floor) this.hits.delete(key);
    }
  }
}
