// Hosted-mode in-app rate limits (issue #9): a sliding window of hit timestamps per key, one
// limiter per protected surface (`/auth/*` per IP, `POST /api/lookup` and `POST /api/deepdive` per
// user, plus `security`, which only throttles the `origin_rejected` audit rows per IP). Nothing
// here spends WCL points or touches the database; the server answers 429 with `Retry-After` on a
// refusal and records `rate_limited` in the audit log — once per key per burst (`first`), so a
// flood of refused requests cannot flood the audit table.

export interface RateLimitRule { limit: number; windowMs: number }

export const DEFAULT_RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60_000 },
  lookup: { limit: 30, windowMs: 60_000 },
  deepdive: { limit: 60, windowMs: 60_000 },
  /** Not a request limit: how many `origin_rejected` audit rows one IP may write per window (the 403 itself is unconditional). */
  security: { limit: 5, windowMs: 60_000 },
} as const;

export type RateLimits = { [K in keyof typeof DEFAULT_RATE_LIMITS]: RateLimitRule };

/** `first` is true on the first refusal since the key last had room (reset by the next accepted hit) — the one worth auditing. */
export type RateLimitVerdict = { ok: true; remaining: number } | { ok: false; retryAfterS: number; first: boolean };

export class RateLimiter {
  /** Accepted hit timestamps per key, ascending; a hit at `t` leaves the window once `t <= now - windowMs`. */
  private readonly hits = new Map<string, number[]>();
  /** Keys whose last verdict was a refusal; membership decides `first` on the next one. */
  private readonly refusing = new Set<string>();

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
      const first = !this.refusing.has(key);
      this.refusing.add(key);
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)), first };
    }
    this.refusing.delete(key);
    list.push(now);
    return { ok: true, remaining: limit - list.length };
  }

  /** Drops keys with no hit inside the window (call from the hourly sweep). */
  sweep(now: number): void {
    const floor = now - this.rule.windowMs;
    for (const [key, list] of this.hits) {
      if (list.length === 0 || list[list.length - 1]! <= floor) {
        this.hits.delete(key);
        this.refusing.delete(key);
      }
    }
  }
}
