// What's new (spec docs/superpowers/specs/2026-10-14-whats-new-design.md): which changelog entries a member has not
// seen yet, and whether the version line carries the mark. Pure.
import type { ChangelogEntry } from "../changelog/types.ts";

const VERSION = /^\d+\.\d+\.\d+$/;
export const isVersion = (v: unknown): v is string => typeof v === "string" && VERSION.test(v);

/** Semver order on X.Y.Z: negative when a < b. Never a string compare ("0.10.2" > "0.9.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface WhatsNew {
  /** The dot on the version line: lastSeen is known and older than the running version. */
  mark: boolean;
  /** Entries newer than lastSeen, up to the running version, newest first. */
  since: ChangelogEntry[];
  /** Every released entry up to the running version, newest first ("All changes"). */
  all: ChangelogEntry[];
}

/** `lastSeen` null = first visit (nothing is new); a lastSeen newer than `running` (a rollback) shows nothing. */
export function whatsNew(entries: ChangelogEntry[], lastSeen: string | null, running: string | null): WhatsNew {
  if (!isVersion(running)) return { mark: false, since: [], all: [] };
  const all = entries
    .filter((e) => isVersion(e.version) && compareVersions(e.version, running) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  if (!isVersion(lastSeen) || compareVersions(lastSeen, running) >= 0) return { mark: false, since: [], all };
  // A technical release has no entry of its own: the mark lights only when something new is listed.
  const since = all.filter((e) => compareVersions(e.version, lastSeen) > 0);
  return { mark: since.length > 0, since, all };
}
