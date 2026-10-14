// The member-activity marker: the collector (`bmpl calibrate --hourly`) is another process than the server, whose meter
// keeps its last observation in memory only, so the server touches a file next to `.env` whenever a member's request
// reaches WCL on the instance's client, and the collector reads its mtime (spec
// docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md, decision 5: "pauses 5 minutes after a member
// request reached WCL").
import { closeSync, openSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveEnvPath } from "../setup.ts";

export const MARKER_FILE = "last-member-wcl";
/** At most one write a minute: the collector only needs minute precision for a 5-minute pause. */
const TOUCH_EVERY_MS = 60_000;

export const resolveMarkerPath = async (): Promise<string> => join(dirname(await resolveEnvPath()), MARKER_FILE);

/**
 * A toucher bound to `path` (or the resolved one): sets the file's mtime to now, at most once a minute, never throws.
 * It never creates the file: the collector does (`ensureMarker`), so an instance without the recalibration (or a test
 * run) leaves nothing behind.
 */
export function memberMarker(path: Promise<string> | string = resolveMarkerPath(), now: () => number = Date.now): () => void {
  let last = 0;
  return () => {
    const t = now();
    if (t - last < TOUCH_EVERY_MS) return;
    last = t;
    void Promise.resolve(path).then((p) => {
      const d = new Date(t);
      try { utimesSync(p, d, d); } catch { /* no collector on this instance */ }
    }).catch(() => { /* .env path unresolved: no collector either */ });
  };
}

/** Creates the marker (mtime: the epoch, "no member yet") when missing. The collector calls it at start. */
export function ensureMarker(path: string): void {
  try { statSync(path); } catch { closeSync(openSync(path, "a")); utimesSync(path, new Date(0), new Date(0)); }
}

/** The marker's mtime in ms (0 before any member request), or null when the file is missing. */
export function memberMarkerAt(path: string): number | null {
  try { return statSync(path).mtimeMs; } catch { return null; }
}
