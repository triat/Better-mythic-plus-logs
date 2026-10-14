import { describe, expect, test } from "bun:test";
import { decide, DEFAULT_RESERVE, inWednesdayWindow, LOOKUP_HEADROOM, MEMBER_PAUSE_MS, PACE_MS, reserveAt, reserveFromEnv, WINDOW_RESERVE } from "../../src/calibration/window.ts";

const at = (iso: string) => Date.parse(iso);

describe("Wednesday window, Paris time", () => {
  test("summer time (UTC+2): 03:00–06:00 Paris is 01:00–04:00 UTC", () => {
    expect(inWednesdayWindow(at("2026-07-15T00:59:00Z"))).toBe(false); // Wed 02:59 Paris
    expect(inWednesdayWindow(at("2026-07-15T01:00:00Z"))).toBe(true); // Wed 03:00
    expect(inWednesdayWindow(at("2026-07-15T03:59:00Z"))).toBe(true); // Wed 05:59
    expect(inWednesdayWindow(at("2026-07-15T04:00:00Z"))).toBe(false); // Wed 06:00
  });
  test("winter time (UTC+1): 03:00–06:00 Paris is 02:00–05:00 UTC", () => {
    expect(inWednesdayWindow(at("2026-12-16T01:59:00Z"))).toBe(false);
    expect(inWednesdayWindow(at("2026-12-16T02:00:00Z"))).toBe(true);
    expect(inWednesdayWindow(at("2026-12-16T04:59:00Z"))).toBe(true);
    expect(inWednesdayWindow(at("2026-12-16T05:00:00Z"))).toBe(false);
  });
  test("another day at the same hour is not the window", () => {
    expect(inWednesdayWindow(at("2026-12-17T03:00:00Z"))).toBe(false); // Thursday
  });
  test("the reserve drops to 300 inside the window only; the env value is read or defaulted", () => {
    expect(reserveAt(at("2026-12-16T03:00:00Z"))).toBe(WINDOW_RESERVE);
    expect(reserveAt(at("2026-12-16T12:00:00Z"))).toBe(DEFAULT_RESERVE);
    expect(reserveAt(at("2026-12-16T12:00:00Z"), 1000)).toBe(1000);
    expect(reserveAt(at("2026-12-16T03:00:00Z"), 100)).toBe(100);
    expect(reserveFromEnv("1500")).toBe(1500);
    expect(reserveFromEnv(undefined)).toBe(DEFAULT_RESERVE);
    expect(reserveFromEnv("-3")).toBe(DEFAULT_RESERVE);
  });
});

describe("governor", () => {
  const now = at("2026-12-16T12:00:00Z");
  const rl = (spent: number) => ({ limitPerHour: 18000, pointsSpentThisHour: spent, pointsResetIn: 1200 });
  const base = { now, memberAt: null, lastStartAt: null, reserve: DEFAULT_RESERVE };

  test("go with budget, no member, no previous lookup", () => {
    expect(decide({ ...base, rl: rl(1000) })).toEqual({ go: true });
  });
  test("stop when the counter reaches the limit minus the reserve (and the headroom)", () => {
    expect(decide({ ...base, rl: rl(18000 - DEFAULT_RESERVE - LOOKUP_HEADROOM) })).toEqual({ go: true });
    expect(decide({ ...base, rl: rl(18000 - DEFAULT_RESERVE - LOOKUP_HEADROOM + 1) })).toMatchObject({ go: false, stop: true });
    // The limit is read, never assumed: a 3,600 pts/h client keeps its reserve too.
    expect(decide({ ...base, rl: { ...rl(400), limitPerHour: 3600 } })).toMatchObject({ go: false, stop: true });
  });
  test("inside the Wednesday window the same counter still goes", () => {
    const wed = at("2026-12-16T03:00:00Z");
    expect(decide({ ...base, now: wed, rl: rl(17000) })).toEqual({ go: true });
  });
  test("wait 5 minutes after a member request, then go", () => {
    const d = decide({ ...base, rl: rl(0), memberAt: now - 60_000 });
    expect(d).toMatchObject({ go: false, waitMs: MEMBER_PAUSE_MS - 60_000 });
    expect(decide({ ...base, rl: rl(0), memberAt: now - MEMBER_PAUSE_MS })).toEqual({ go: true });
  });
  test("pace: one start every 16 s", () => {
    expect(decide({ ...base, rl: rl(0), lastStartAt: now - 10_000 })).toMatchObject({ go: false, waitMs: PACE_MS - 10_000 });
    expect(decide({ ...base, rl: rl(0), lastStartAt: now - PACE_MS })).toEqual({ go: true });
  });
});
