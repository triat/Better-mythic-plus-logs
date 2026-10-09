// Game weeks for the self-review trends (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 5).
// One reset per region, taken from Raider.IO's GET /api/v1/periods (period 1084, captured 2026-10-09) and assumed
// fixed in UTC: a daylight-saving shift on Blizzard's side would misplace the runs of one hour, accepted.
import type { Region } from "../wow/regions.ts";

export const WEEK_MS = 7 * 24 * 60 * 60_000;

export const WEEK_ANCHOR: Record<Region, number> = {
  us: Date.UTC(2026, 9, 6, 15), // Tuesday 15:00 UTC
  eu: Date.UTC(2026, 9, 7, 4), // Wednesday 04:00 UTC
  kr: Date.UTC(2026, 9, 7, 23), // Wednesday 23:00 UTC
  tw: Date.UTC(2026, 9, 7, 23),
};

/** The game week `t` (epoch ms) falls in: 0 is the week starting at the anchor, negative before it. */
export const weekOf = (region: Region, t: number): number => Math.floor((t - WEEK_ANCHOR[region]) / WEEK_MS);

/** Epoch ms of the reset that opens `week`. */
export const weekStart = (region: Region, week: number): number => WEEK_ANCHOR[region] + week * WEEK_MS;
