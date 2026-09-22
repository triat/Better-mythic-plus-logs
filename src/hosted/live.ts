// The Live panel's sort/role/class choices, server side. Mirrors web/src/lib/live/roster.ts (the front
// imports types only, so the two lists are duplicated); test/hosted/live.test.ts pins that they match.
export type LiveSort = "arrival" | "verdict" | "score" | "role" | "class";
export const LIVE_SORTS: readonly LiveSort[] = ["arrival", "verdict", "score", "role", "class"];
export type LiveRole = "tank" | "healer" | "dps";
export const LIVE_ROLES: readonly LiveRole[] = ["tank", "healer", "dps"];
export const isLiveSort = (v: unknown): v is LiveSort => typeof v === "string" && (LIVE_SORTS as readonly string[]).includes(v);
export const isLiveRole = (v: unknown): v is LiveRole => typeof v === "string" && (LIVE_ROLES as readonly string[]).includes(v);

export const DEFAULT_LIVE: { liveSort: LiveSort; liveRoles: LiveRole[]; liveClasses: string[] } = {
  liveSort: "arrival",
  liveRoles: [...LIVE_ROLES],
  liveClasses: [],
};
