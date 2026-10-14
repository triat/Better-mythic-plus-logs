/**
 * One release in the user-facing changelog (spec docs/superpowers/specs/2026-10-14-whats-new-design.md). `version`
 * is "X.Y.Z", or "next" for the entries not released yet: release.yml stamps "next" with the new version and the
 * date (scripts/changelog-stamp.ts). Items are plain player language, one sentence each.
 */
export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD, absent on "next". */
  date?: string;
  items: string[];
}
