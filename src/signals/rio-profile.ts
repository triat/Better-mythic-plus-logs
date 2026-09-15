import type { RioProfile, RioRun, RioSeasonScore } from "./types.ts";

// Two seasons in one field: separate `:current` and `:previous` fields
// collapse to a single entry on Raider.IO's side.
export const RIO_FIELDS =
  "gear,mythic_plus_scores_by_season:current:previous,mythic_plus_recent_runs,mythic_plus_best_runs,mythic_plus_weekly_highest_level_runs";

export const rioProfileUrl = (region: string, realmSlug: string, name: string): string =>
  `https://raider.io/api/v1/characters/profile?region=${region.toLowerCase()}&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}&fields=${RIO_FIELDS}`;

const DAY_MS = 86_400_000;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};

const parseRun = (raw: unknown): RioRun => {
  const r = obj(raw);
  return {
    dungeon: str(r.dungeon) ?? "",
    shortName: str(r.short_name) ?? "",
    level: num(r.mythic_level),
    completedAt: Date.parse(str(r.completed_at) ?? "") || 0,
    clearMs: num(r.clear_time_ms),
    parMs: num(r.par_time_ms),
    chests: num(r.num_keystone_upgrades),
    score: num(r.score),
    affixes: arr(r.affixes).map((a) => str(obj(a).name) ?? "").filter(Boolean),
    url: str(r.url) ?? "",
  };
};

const parseSeason = (raw: unknown): RioSeasonScore => {
  const s = obj(raw);
  const sc = obj(s.scores);
  return {
    slug: str(s.season) ?? "",
    all: num(sc.all),
    dps: num(sc.dps),
    healer: num(sc.healer),
    tank: num(sc.tank),
  };
};

export function parseRioProfile(raw: unknown, now: number): RioProfile {
  const p = obj(raw);
  const gear = obj(p.gear);
  const recentRuns = arr(p.mythic_plus_recent_runs).map(parseRun);
  const lastRunAt = recentRuns.reduce<number | null>(
    (acc, r) => (r.completedAt > 0 && (acc === null || r.completedAt > acc) ? r.completedAt : acc),
    null,
  );
  return {
    fetchedAt: now,
    lastCrawledAt: Date.parse(str(p.last_crawled_at) ?? "") || 0,
    profileUrl: str(p.profile_url) ?? "",
    itemLevel: typeof gear.item_level_equipped === "number" ? gear.item_level_equipped : null,
    activeSpec: str(p.active_spec_name),
    activeRole: str(p.active_spec_role),
    seasons: arr(p.mythic_plus_scores_by_season).map(parseSeason),
    recentRuns,
    bestRuns: arr(p.mythic_plus_best_runs).map(parseRun),
    weeklyBest: arr(p.mythic_plus_weekly_highest_level_runs).map(parseRun),
    derived: {
      recentTimed: recentRuns.filter((r) => r.chests > 0).length,
      recentTotal: recentRuns.length,
      runsLast7d: recentRuns.filter((r) => r.completedAt > 0 && now - r.completedAt <= 7 * DAY_MS).length,
      lastRunAt,
    },
  };
}
