// The single lookup history of local mode (one person, one browser), kept in bmpl.db so a
// `bmpl serve` restart shows the same tabs. Hosted mode never uses it: every request there
// carries the user's own SQLite-backed store in `ctx.history`.
import { config } from "../config.ts";
import { openUserHistory } from "../hosted/history.ts";
import type { HistoryTables } from "../hosted/history.ts";
import { History } from "../server-history.ts";
import type { HistoryStore } from "../server-history.ts";
import { getStore } from "../signals/store.ts";

export const LOCAL_HISTORY_MAX = 20;
export const LOCAL_HISTORY_TABLES: HistoryTables = { history: "local_history", auto: "local_history_auto" };
const LOCAL_USER_ID = 0;

let current: HistoryStore = new History(LOCAL_HISTORY_MAX);

/** The store in use: the SQLite-backed one once `openLocalHistory()` ran, an empty in-memory one before. */
export const getLocalHistory = (): HistoryStore => current;

/** Bind the local history to the process-wide store (runServer, local mode). Safe to call again after `closeStore()`. */
export async function openLocalHistory(): Promise<HistoryStore> {
  const store = await getStore();
  current = openUserHistory(store._db, LOCAL_HISTORY_MAX, LOCAL_HISTORY_TABLES, config.region).forUser(LOCAL_USER_ID);
  return current;
}
