// The owner page's Donjons tab (redesign phase 3, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 10, mockup docs/design/redesign/F-Moi-Donjons.dc.html): the five pillars per dungeon on the heat scale,
// weakest dungeon first, the season row on top, then the selected dungeon's detail (its weak point against the
// season, and `dungeonPanel`'s blocks). Read off the season view (GET /api/season, 0 pts). Pure: no React, no fetch.
import type { DungeonRow, PillarKey, SeasonView } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import type { HeatCls } from "./dungeonGrid.ts";
import { dungeonAbbr } from "./runList.ts";
import { PILLAR_ORDER, dungeonPanel } from "./self.ts";
import type { PanelView } from "./self.ts";

/** A pillar score on the heat scale: < 45 heat-1 · 45–54 heat-2 · 55–69 heat-3 · 70–84 heat-4 · ≥ 85 heat-5; "" for none. */
export const pillarHeat = (s: number | null): HeatCls | "" =>
  s === null ? "" : s < 45 ? "heat-1" : s < 55 ? "heat-2" : s < 70 ? "heat-3" : s < 85 ? "heat-4" : "heat-5";

/** `weakest`: the row's lowest pillar (the first one on a tie), ringed. */
export interface HeatCell { key: PillarKey; text: string; heat: HeatCls | ""; weakest: boolean }
export interface OwnerDungeonRow {
  encounterID: number;
  abbr: string;
  name: string;
  cells: HeatCell[];
  overall: string;
  runs: string;
  selected: boolean;
}
export interface OwnerDungeonDetail {
  encounterID: number;
  abbr: string;
  title: string;
  /** "8 runs · overall 63". */
  sub: string;
  /** "Weak point: Damage 43", tinted like its cell; null when no pillar is scored. */
  weak: { text: string; heat: HeatCls | "" } | null;
  /** "Damage 43 here" (emphasised) and the rest: ", 21 points under your season average (64). Your best pillar there is
   *  Survival (89)."; null when no pillar is scored. */
  compare: { lead: string; rest: string } | null;
  /** What hits, what kills, the enemy spells, the crowd control (`dungeonPanel` of lib/self.ts). */
  panel: PanelView;
  /** The enemy spells as the mockup's bars: through / cast. */
  casts: { id: number; name: string; width: number; passed: string; mine: string }[];
  /** "The 8 runs": the Runs tab filtered on this dungeon. */
  runs: { label: string; encounterID: number };
  /** The empty text when no run of the dungeon is analysed. */
  empty: string | null;
}
export interface OwnerDungeonsView {
  columns: { key: PillarKey; label: string }[];
  season: { cells: HeatCell[]; overall: string; runs: string };
  /** Weakest overall first, a dungeon without an overall last. */
  rows: OwnerDungeonRow[];
  /** The selected dungeon, else the first row; null without any dungeon. */
  detail: OwnerDungeonDetail | null;
}

const round = (s: number | null | undefined): number | null => (s == null ? null : Math.round(s));

/** The lowest (`dir` 1) or highest (`dir` −1) scored pillar of a record, the first one on a tie. */
function extreme(scores: Record<PillarKey, number | null>, dir: 1 | -1): { key: PillarKey; score: number } | null {
  let out: { key: PillarKey; score: number } | null = null;
  for (const key of PILLAR_ORDER) {
    const s = round(scores[key]);
    if (s !== null && (out === null || (s - out.score) * dir < 0)) out = { key, score: s };
  }
  return out;
}

const recordOf = (season: SeasonView): Record<PillarKey, number | null> =>
  Object.fromEntries(PILLAR_ORDER.map((k) => [k, season.season?.pillars.find((p) => p.key === k)?.score ?? null])) as Record<PillarKey, number | null>;

function cellsOf(t: T, scores: Record<PillarKey, number | null>, ring: boolean): HeatCell[] {
  const low = ring ? extreme(scores, 1) : null;
  return PILLAR_ORDER.map((key) => {
    const s = round(scores[key]);
    return { key, text: s === null ? t("owner.dungeons.na") : String(s), heat: pillarHeat(s), weakest: low?.key === key };
  });
}

function detailOf(t: T, locale: Locale, d: DungeonRow, seasonScores: Record<PillarKey, number | null>): OwnerDungeonDetail {
  const overall = round(d.overall);
  const low = extreme(d.pillars, 1);
  const high = extreme(d.pillars, -1);
  const name = (k: PillarKey) => t(`self.pillars.${k}`);
  let compare: OwnerDungeonDetail["compare"] = null;
  if (low) {
    const s = round(seasonScores[low.key]);
    const gap = s === null ? 0 : s - low.score;
    const rest = s === null ? t("owner.dungeons.noSeason")
      : gap > 0 ? t("owner.dungeons.below", { gap, season: s })
      : gap < 0 ? t("owner.dungeons.above", { gap: -gap, season: s })
      : t("owner.dungeons.same", { season: s });
    const best = high && high.key !== low.key ? t("owner.dungeons.best", { pillar: name(high.key), score: high.score }) : "";
    compare = { lead: t("owner.dungeons.lead", { pillar: name(low.key), score: low.score }), rest: rest + best };
  }
  const panel = dungeonPanel(t, locale, d);
  return {
    encounterID: d.encounterID,
    abbr: dungeonAbbr(d.name),
    title: d.name,
    sub: overall === null ? t("owner.dungeons.subRuns", { count: d.runs }) : t("owner.dungeons.sub", { count: d.runs, overall }),
    weak: low ? { text: t("owner.dungeons.weak", { pillar: name(low.key), score: low.score }), heat: pillarHeat(low.score) } : null,
    compare,
    panel,
    casts: d.details.casts.map((c) => ({
      id: c.id,
      name: c.name,
      width: c.attempts > 0 ? Math.round((c.completed / c.attempts) * 100) : 0,
      passed: t("owner.dungeons.passed", { completed: c.completed, attempts: c.attempts }),
      mine: String(c.mine),
    })),
    runs: { label: t("owner.dungeons.runsLink", { count: d.runs }), encounterID: d.encounterID },
    empty: panel.empty ? t("self.panel.empty") : null,
  };
}

export function ownerDungeons(t: T, locale: Locale, season: SeasonView, selected: number | null): OwnerDungeonsView {
  const sorted = [...season.dungeons].sort((a, b) =>
    a.overall === null ? (b.overall === null ? 0 : 1) : b.overall === null ? -1 : a.overall - b.overall);
  const chosen = sorted.find((d) => d.encounterID === selected) ?? sorted[0] ?? null;
  const seasonScores = recordOf(season);
  const overall = round(season.season?.overall);
  return {
    columns: PILLAR_ORDER.map((key) => ({ key, label: t(`owner.dungeons.col.${key}`) })),
    season: {
      cells: cellsOf(t, seasonScores, false),
      overall: overall === null ? t("owner.dungeons.na") : String(overall),
      runs: String(season.state.runs),
    },
    rows: sorted.map((d) => {
      const o = round(d.overall);
      return {
        encounterID: d.encounterID,
        abbr: dungeonAbbr(d.name),
        name: d.name,
        cells: cellsOf(t, d.pillars, true),
        overall: o === null ? t("owner.dungeons.na") : String(o),
        runs: String(d.runs),
        selected: d === chosen,
      };
    }),
    detail: chosen ? detailOf(t, locale, chosen, seasonScores) : null,
  };
}
