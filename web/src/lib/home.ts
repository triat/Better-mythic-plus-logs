// The connected home page (redesign spec decision 2, mockup F-Accueil): "Toi cette semaine" and "Ta progression" for
// the main character, read off its season view (GET /api/season, 0 pts), and the two-line rows of "Tes candidats".
// Pure: no React, no fetch.
import { className } from "@shared/wow/classes.ts";
import type { T } from "../i18n/t.ts";
import type { HistoryItem, PillarKey, SeasonView } from "../types.ts";
import { evidenceText } from "./axes.ts";
import type { Locale } from "./locale.ts";
import { PILLAR_ORDER, workOnRows } from "./self.ts";
import type { WorkOnView } from "./self.ts";
import { recentRows } from "./shell.ts";
import type { RecentRow } from "./shell.ts";

export interface WeekView { label: string; runs: number; bestTimed: number | null; timed: number; scored: number }
export interface PointView { kind: "pillar" | "dungeon"; label: string; detail: string; score: number }
export interface HomeSelf {
  /** null when the season has no run. */
  week: WeekView | null;
  workOn: WorkOnView[];
  /** At most 3. */
  strengths: PointView[];
  /** At most 3. */
  costs: PointView[];
  /** The last 4 game weeks, oldest first. */
  bestPerWeek: { week: number; level: number | null }[];
  pillars: { key: PillarKey; label: string; score: number | null }[];
}

export const STRENGTH_MIN = 70;
export const PILLAR_COST_BELOW = 60;
export const DUNGEON_COST_BELOW = 45;
export const POINTS_MAX = 3;
export const PROGRESS_WEEKS = 4;

const bestTimedOf = (runs: SeasonView["runs"]): number | null =>
  runs.reduce<number | null>((best, r) => (r.timed === true && (best === null || r.keyLevel > best) ? r.keyLevel : best), null);

/**
 * The home page's view of the main character's season:
 * - `week`: the current game week if it has runs, else the previous one ("this week" / "last week"); `runs` = runs
 *   of that week, `bestTimed` = the highest key level with `timed === true` (a higher depleted key never counts),
 *   `timed` = runs with `timed === true`, `scored` = runs with `timed !== null`. null when the season has no run.
 * - `workOn`: `workOnRows` of `lib/self.ts` over the season (no lookup payload on the home page).
 * - `pillars`: `season.recent ?? season.season` pillars, in `PILLAR_ORDER`, labels `self.pillars.*`.
 * - `strengths`: pillars ≥ 70 (highest first), then dungeons whose `overall` ≥ 70 (highest first), first 3.
 * - `costs`: pillars < 60 (lowest first), then per dungeon its lowest pillar when < 45 (lowest first), first 3; a
 *   dungeon's detail names that pillar.
 * - `bestPerWeek`: weeks `currentWeek − 3 … currentWeek`, the highest timed key of each, null without one.
 */
export function homeSelf(t: T, locale: Locale, season: SeasonView, titleOf: (source: string) => string): HomeSelf {
  const runsOf = (w: number) => season.runs.filter((r) => r.week === w);
  let week: WeekView | null = null;
  if (season.runs.length > 0) {
    const current = runsOf(season.currentWeek);
    const runs = current.length > 0 ? current : runsOf(season.currentWeek - 1);
    week = {
      label: current.length > 0 ? t("home.self.thisWeek") : t("home.self.lastWeek"),
      runs: runs.length,
      bestTimed: bestTimedOf(runs),
      timed: runs.filter((r) => r.timed === true).length,
      scored: runs.filter((r) => r.timed !== null).length,
    };
  }

  const window = season.recent ?? season.season;
  const pillars = PILLAR_ORDER.map((key) => {
    const p = window?.pillars.find((x) => x.key === key) ?? null;
    return { key, label: t(`self.pillars.${key}`), score: p?.score ?? null, evidence: p?.evidence ?? [] };
  });
  const scored = pillars.filter((p): p is typeof p & { score: number } => p.score !== null);
  const pillarPoint = (p: (typeof scored)[number]): PointView => ({
    kind: "pillar", label: p.label, detail: p.evidence[0] ? evidenceText(t, locale, p.evidence[0]) : "", score: p.score,
  });

  const strengths: PointView[] = [
    ...scored.filter((p) => p.score >= STRENGTH_MIN).sort((a, b) => b.score - a.score).map(pillarPoint),
    ...season.dungeons
      .filter((d): d is typeof d & { overall: number } => d.overall !== null && d.overall >= STRENGTH_MIN)
      .sort((a, b) => b.overall - a.overall)
      .map((d): PointView => ({ kind: "dungeon", label: d.name, detail: t("home.progress.overall"), score: d.overall })),
  ].slice(0, POINTS_MAX);

  const dungeonCosts = season.dungeons.flatMap((d): PointView[] => {
    const lowest = PILLAR_ORDER
      .map((key) => ({ key, score: d.pillars[key] }))
      .filter((x): x is { key: PillarKey; score: number } => x.score !== null)
      .reduce<{ key: PillarKey; score: number } | null>((lo, x) => (lo === null || x.score < lo.score ? x : lo), null);
    return lowest && lowest.score < DUNGEON_COST_BELOW
      ? [{ kind: "dungeon", label: d.name, detail: t(`self.pillars.${lowest.key}`), score: lowest.score }]
      : [];
  });
  const costs: PointView[] = [
    ...scored.filter((p) => p.score < PILLAR_COST_BELOW).sort((a, b) => a.score - b.score).map(pillarPoint),
    ...dungeonCosts.sort((a, b) => a.score - b.score),
  ].slice(0, POINTS_MAX);

  const bestPerWeek = Array.from({ length: PROGRESS_WEEKS }, (_, i) => {
    const w = season.currentWeek - (PROGRESS_WEEKS - 1) + i;
    return { week: w, level: bestTimedOf(season.runs.filter((r) => r.week === w)) };
  });

  return {
    week,
    workOn: workOnRows(t, locale, null, season, titleOf),
    strengths,
    costs,
    bestPerWeek,
    pillars: pillars.map(({ key, label, score }) => ({ key, label, score })),
  };
}

/** The spec's score tone: blue ≥ 70, neutral 50–69, orange < 50 (null: neutral). */
export const scoreTone = (s: number | null): "better" | "neutral" | "worse" =>
  s === null ? "neutral" : s >= 70 ? "better" : s >= 50 ? "neutral" : "worse";

/** "Best timed key: from +18 to +19 over the last 4 weeks." — first and last weeks that have a timed key; null without any. */
export function progressText(t: T, best: HomeSelf["bestPerWeek"]): string {
  const levels = best.map((b) => b.level).filter((l): l is number => l !== null);
  if (levels.length === 0) return t("home.progress.none", { weeks: best.length });
  const from = levels[0]!;
  const to = levels[levels.length - 1]!;
  return from === to
    ? t("home.progress.same", { level: to, weeks: best.length })
    : t("home.progress.fromTo", { from, to, weeks: best.length });
}

export const LINE = { width: 240, height: 64, left: 20, right: 220, top: 18, bottom: 44 } as const;

/** The best-timed-key line in a 240 × 64 viewBox: one point per week with a key, x evenly spread, y scaled between
 *  the lowest and highest level (a flat line sits in the middle). */
export function progressPoints(best: HomeSelf["bestPerWeek"]): { x: number; y: number; level: number }[] {
  const levels = best.map((b) => b.level).filter((l): l is number => l !== null);
  if (levels.length === 0) return [];
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const step = best.length > 1 ? (LINE.right - LINE.left) / (best.length - 1) : 0;
  return best.flatMap((b, i) => (b.level === null ? [] : [{
    x: Math.round(LINE.left + i * step),
    y: hi === lo ? (LINE.top + LINE.bottom) / 2 : Math.round(LINE.bottom - ((b.level - lo) / (hi - lo)) * (LINE.bottom - LINE.top)),
    level: b.level,
  }]));
}

export interface CandidateRow extends RecentRow { sub: string; level: string }

/** "Tes candidats": Récents rows (`recentRows`) with a second line (spec · class · realm) and the key level. */
export function candidateRows(items: HistoryItem[], max = 6): CandidateRow[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  return recentRows(items, null, max).map((r) => {
    const i = byKey.get(r.key)!;
    const realm = i.label.split("-").slice(1).join("-");
    return { ...r, sub: [[i.spec, className(i.charClass)].filter(Boolean).join(" "), realm].filter(Boolean).join(" · "), level: `+${i.targetLevel}` };
  });
}
