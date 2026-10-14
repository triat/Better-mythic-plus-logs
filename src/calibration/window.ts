// When and how much the collector may spend (spec docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md,
// decision 5). Pure: every input is passed in, so the summer/winter-time cases and every branch are testable.
import type { RateLimit } from "../wcl/client.ts";

/** Points kept free for the members in every hour (`BMPL_CALIBRATION_RESERVE`), about 30 member lookups. */
export const DEFAULT_RESERVE = 3000;
/** The reserve inside Wednesday 03:00–06:00 Europe/Paris, when nobody plays. */
export const WINDOW_RESERVE = 300;
/** A member's request reached WCL less than this ago: the collector waits. */
export const MEMBER_PAUSE_MS = 5 * 60_000;
/** One lookup start at most every this often: WCL also limits per IP, and the collector shares the VPS address. */
export const PACE_MS = 16_000;
/** Never start a lookup that could push the hour past the reserve: a fresh character's worst case. */
export const LOOKUP_HEADROOM = 250;

const PARIS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", hourCycle: "h23" });

/** Whether `now` falls on a Wednesday between 03:00 and 06:00, Paris time (summer or winter). */
export function inWednesdayWindow(now: number): boolean {
  const parts = Object.fromEntries(PARIS.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  return parts.weekday === "Wed" && hour >= 3 && hour < 6;
}

/** The points to keep free at `now`: `reserve` (the configured one), or the window's when inside it. */
export const reserveAt = (now: number, reserve = DEFAULT_RESERVE): number => (inWednesdayWindow(now) ? Math.min(reserve, WINDOW_RESERVE) : reserve);

/** `BMPL_CALIBRATION_RESERVE`, a non-negative integer, else the default. */
export function reserveFromEnv(raw: string | undefined): number {
  const v = (raw ?? "").trim();
  return /^\d+$/.test(v) ? Number(v) : DEFAULT_RESERVE;
}

export type Decision = { go: true } | { go: false; waitMs: number; why: string } | { go: false; stop: true; why: string };

export interface GovernorInput {
  now: number;
  /** The counter as WCL reported it just now (it includes the members' spend). */
  rl: RateLimit;
  /** The last time a member's request reached WCL (the marker the server touches), or null. */
  memberAt: number | null;
  /** The previous lookup's start, or null for the first one. */
  lastStartAt: number | null;
  reserve: number;
}

/** Whether the next lookup may start: go, wait (a member just played, or the pace), or stop for this hour. */
export function decide(i: GovernorInput): Decision {
  const left = i.rl.limitPerHour - i.rl.pointsSpentThisHour;
  const keep = reserveAt(i.now, i.reserve);
  if (left < keep + LOOKUP_HEADROOM) return { go: false, stop: true, why: `${Math.round(left)} pts left this hour, ${keep} kept for the members` };
  if (i.memberAt !== null && i.now - i.memberAt < MEMBER_PAUSE_MS) {
    return { go: false, waitMs: i.memberAt + MEMBER_PAUSE_MS - i.now, why: "a member used WCL less than 5 minutes ago" };
  }
  if (i.lastStartAt !== null && i.now - i.lastStartAt < PACE_MS) return { go: false, waitMs: i.lastStartAt + PACE_MS - i.now, why: "pace" };
  return { go: true };
}
