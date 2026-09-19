import { describe, expect, test } from "bun:test";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "../../src/hosted/ratelimit.ts";

describe("RateLimiter", () => {
  test("allows `limit` hits per window, then refuses with the seconds until the oldest hit leaves the window", () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.hit("a", 0)).toEqual({ ok: true, remaining: 2 });
    expect(rl.hit("a", 10_000)).toEqual({ ok: true, remaining: 1 });
    expect(rl.hit("a", 20_000)).toEqual({ ok: true, remaining: 0 });
    expect(rl.hit("a", 30_000)).toEqual({ ok: false, retryAfterS: 30, first: true });
    expect(rl.hit("b", 30_000)).toEqual({ ok: true, remaining: 2 }); // keys are independent
    expect(rl.hit("a", 60_001)).toEqual({ ok: true, remaining: 0 }); // the hit at 0 left the window
    // The window now holds [10_000, 20_000, 60_001]; the oldest leaves at 70_000 → ceil(9_998 / 1000) = 10.
    expect(rl.hit("a", 60_002)).toEqual({ ok: false, retryAfterS: 10, first: true });
  });

  test("a refused hit is not counted: the window frees up when the oldest accepted hit leaves", () => {
    const rl = new RateLimiter({ limit: 2, windowMs: 1_000 });
    rl.hit("a", 0);
    rl.hit("a", 100);
    expect(rl.hit("a", 500)).toEqual({ ok: false, retryAfterS: 1, first: true });
    expect(rl.hit("a", 1_000)).toEqual({ ok: true, remaining: 0 }); // 0 left at 1_000; the refused 500 hit never counted
  });

  test("`first` is true once per burst of refusals: false until a hit is accepted again, true on the next refusal after that", () => {
    const rl = new RateLimiter({ limit: 2, windowMs: 1_000 });
    rl.hit("a", 0);
    rl.hit("a", 100);
    expect(rl.hit("a", 200)).toEqual({ ok: false, retryAfterS: 1, first: true });
    expect(rl.hit("a", 300)).toEqual({ ok: false, retryAfterS: 1, first: false });
    expect(rl.hit("a", 400)).toEqual({ ok: false, retryAfterS: 1, first: false });
    expect(rl.hit("b", 400)).toEqual({ ok: true, remaining: 1 }); // another key's acceptance does not reset `a`
    expect(rl.hit("a", 500)).toEqual({ ok: false, retryAfterS: 1, first: false });
    expect(rl.hit("a", 1_000)).toEqual({ ok: true, remaining: 0 }); // room again: the burst is over
    expect(rl.hit("a", 1_050)).toEqual({ ok: false, retryAfterS: 1, first: true }); // a new burst
    expect(rl.hit("a", 1_060)).toEqual({ ok: false, retryAfterS: 1, first: false });
  });

  test("retryAfterS is never below 1; sweep forgets idle keys", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1_000 });
    rl.hit("a", 0);
    expect(rl.hit("a", 999)).toEqual({ ok: false, retryAfterS: 1, first: true });
    rl.sweep(5_000);
    expect(rl.hit("a", 5_000)).toEqual({ ok: true, remaining: 0 });
    expect(rl.hit("a", 5_001)).toEqual({ ok: false, retryAfterS: 1, first: true }); // a new burst after the sweep
  });

  test("sweep keeps keys that still have a hit inside the window", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1_000 });
    rl.hit("a", 4_500);
    rl.sweep(5_000);
    expect(rl.hit("a", 5_000)).toEqual({ ok: false, retryAfterS: 1, first: true });
  });

  test("the rule is exposed and the defaults are per minute", () => {
    expect(new RateLimiter(DEFAULT_RATE_LIMITS.auth).rule).toEqual({ limit: 10, windowMs: 60_000 });
    expect(DEFAULT_RATE_LIMITS).toEqual({
      auth: { limit: 10, windowMs: 60_000 },
      lookup: { limit: 30, windowMs: 60_000 },
      deepdive: { limit: 60, windowMs: 60_000 },
      security: { limit: 5, windowMs: 60_000 },
      signup: { limit: 5, windowMs: 3_600_000 },
    });
  });
});
