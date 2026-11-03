// Features switched off for now. The front keeps its own copy (`web/src/lib/features.ts`, the types-only rule keeps it
// from importing this file); change both together.

/**
 * The Live panel (game-integration spec 2026-09-22) is off until it works well enough (decided 2026-11-03): no
 * `POST /api/live/cached` route, `/live` redirects to `/`, and the front shows no link to it. The code, the addon and
 * the members' Live settings stay; turning this back on (here and in the front) restores everything.
 */
export const LIVE_ENABLED = false;
