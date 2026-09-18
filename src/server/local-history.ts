// The single process-wide history of local mode (one person, one browser). Hosted mode never
// uses it: every request there carries the user's own SQLite-backed store in `ctx.history`.
import { History } from "../server-history.ts";

export const localHistory = new History(20);
