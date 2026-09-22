// The Live panel's sort/role/class choices, server side. Mirrors web/src/lib/live/roster.ts (the front
// imports types only, so the two lists are duplicated); test/hosted/live.test.ts pins that they match.
export type LiveSort = "arrival" | "verdict" | "score" | "role" | "class";
export const LIVE_SORTS: readonly LiveSort[] = ["arrival", "verdict", "score", "role", "class"];
export type LiveRole = "tank" | "healer" | "dps";
export const LIVE_ROLES: readonly LiveRole[] = ["tank", "healer", "dps"];
export const isLiveSort = (v: unknown): v is LiveSort => typeof v === "string" && (LIVE_SORTS as readonly string[]).includes(v);
export const isLiveRole = (v: unknown): v is LiveRole => typeof v === "string" && (LIVE_ROLES as readonly string[]).includes(v);

// The arrays are frozen: DEFAULT_LIVE is a module-scoped singleton, spread into DEFAULT_USER_SETTINGS
// and handed out as-is on the "no row" fast path — a caller that sorted or pushed in place would
// otherwise corrupt the default for the whole process. Callers that need a mutable array already
// copy with `[...DEFAULT_LIVE.liveRoles]`.
export const DEFAULT_LIVE: { liveSort: LiveSort; liveRoles: LiveRole[]; liveClasses: string[] } = {
  liveSort: "arrival",
  liveRoles: Object.freeze([...LIVE_ROLES]) as LiveRole[],
  liveClasses: Object.freeze([] as string[]) as string[],
};
