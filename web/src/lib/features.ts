// Features switched off for now: the front's copy of `src/features.ts` (the types-only rule keeps the front from
// importing it); change both together.

/**
 * The Live panel is off until it works well enough (decided 2026-11-03): `/live` is the home page, and no navigation
 * item, palette action, home link or help section leads to it. The code stays; `true` restores everything.
 */
export const LIVE_ENABLED = false;
