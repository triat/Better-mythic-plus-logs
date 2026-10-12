// The owner page's "Ma forme" tab (redesign phase 3, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decisions 3, 10, mockup docs/design/redesign/F-Moi-Forme.dc.html): the last game week, the five pillars, the season's
// key level per run, the "work on" checklist (before → now) and the group leader's card. Everything is read off the
// season view (GET /api/season, 0 pts) and the lookup payload's evaluation. Pure: no React, no fetch.
import type { Evaluation, PillarKey, SeasonRunView, SeasonView } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { driverValues, shortValue } from "./drivers.ts";
import { fmtDuration, signed } from "./format.ts";
import { bestTimedOf, playWeek } from "./home.ts";
import { ownerHref } from "./profile.ts";
import { dungeonAbbr } from "./runList.ts";
import { PILLAR_ORDER, trendView, workOnSource } from "./self.ts";
import { flipDrivers, scoreBand, synthesisView } from "./synthesis.ts";
import type { Band, SynthesisDocs } from "./synthesis.ts";
import { verdictView } from "./verdict.ts";

export type RunResult = "timed" | "depleted" | "none";
export interface WeekChip { level: string; abbr: string; result: RunResult; title: string }
export interface FormWeek {
  /** "Your last game week" / "Your current game week". */
  label: string;
  runs: string;
  /** "+19"; null without a timed key. */
  bestTimed: string | null;
  /** "4/6": timed runs over the week's runs. */
  timed: string;
  /** The week's runs, newest first. */
  chips: WeekChip[];
  /** "First +20 attempted (Temple of Sethraliss, depleted 32:55)." when the week holds the season's highest key so far. */
  note: string | null;
}
export interface FormPillarRow { key: PillarKey; name: string; score: number | null; band: Band; trend: string | null }
export interface FormChart {
  /** Week columns, oldest left, in the CHART viewBox. */
  weeks: { label: string; x: number }[];
  dots: { x: number; y: number; timed: boolean | null; title: string }[];
  target: { y: number; label: string } | null;
  /** The y axis' level labels, highest first. */
  levels: { y: number; label: string }[];
  /** The chart's accessible name. */
  aria: string;
}
export interface ChecklistRow { title: string; goal: string; before: string | null; now: string; nowTone: "better" | "worse" | "neutral"; cost: string }
export interface ChefCard {
  verdict: { cls: string; label: string; score: string | null };
  /** "How a group leader sees you at +19". */
  title: string;
  /** "INVITE at 70: raise median parse (57) and item level vs target (−3)"; null for INVITE or not enough data. */
  path: string | null;
  vettingHref: string;
}
export interface FormView {
  week: FormWeek | null;
  pillars: { global: string | null; rows: FormPillarRow[]; note: string };
  chart: FormChart | null;
  checklist: ChecklistRow[];
  /** What the checklist compares: the last 4 weeks against the 4 before, or the verdict's runs without a window. */
  checklistNote: string;
  chef: ChefCard;
}

/** The key chart's viewBox and plot area (the mockup's: grid from y 40 to 240, labels left of x 50). */
export const CHART = { width: 1000, height: 300, left: 50, right: 990, top: 40, bottom: 240 } as const;
/** Weeks with runs the chart shows. */
export const CHART_WEEKS = 4;
/** Horizontal gap between runs at the same level in a week (the mockup's 20), narrowed to stay in the column. */
const DOT_SPREAD = 20;
const DOT_MARGIN = 10;
/** At most this many level labels on the y axis. */
const MAX_LEVEL_LABELS = 5;
/** The trend rule's run count on each side (src/self/season.ts MIN_WINDOW_RUNS; the front cannot import it). */
const TREND_MIN_RUNS = 3;
const CHECKLIST_MAX = 3;
const PATH_ITEMS = 2;

export const resultOf = (r: Pick<SeasonRunView, "timed">): RunResult => (r.timed === true ? "timed" : r.timed === false ? "depleted" : "none");

const weekLabel = (t: T, current: number, week: number): string => {
  const ago = current - week;
  return ago <= 0 ? t("owner.form.chart.thisWeek") : ago === 1 ? t("owner.form.chart.lastWeek") : t("owner.form.chart.weeksAgo", { n: ago });
};

function weekView(t: T, season: SeasonView): FormWeek | null {
  const played = playWeek(season);
  if (!played) return null;
  const { runs } = played;
  const best = bestTimedOf(runs);
  const resultText = (r: SeasonRunView) => t(`owner.form.week.result.${resultOf(r)}`);
  // The season's highest key attempted so far: higher than every run of the weeks before (none before: no note).
  let note: string | null = null;
  const earlier = season.runs.filter((r) => r.week < played.week);
  if (runs.length > 0 && earlier.length > 0) {
    const top = Math.max(...runs.map((r) => r.keyLevel));
    if (top > Math.max(...earlier.map((r) => r.keyLevel))) {
      const first = runs.filter((r) => r.keyLevel === top).at(-1)!; // newest first: the last one is the first played
      const result = first.durationMs !== null ? t("owner.form.week.resultTime", { result: resultText(first), time: fmtDuration(first.durationMs) }) : resultText(first);
      note = t("owner.form.week.first", { level: top, dungeon: first.encounterName, result });
    }
  }
  return {
    label: t(played.current ? "owner.form.week.current" : "owner.form.week.last"),
    runs: String(runs.length),
    bestTimed: best === null ? null : `+${best}`,
    timed: t("owner.form.week.ratio", { timed: runs.filter((r) => r.timed === true).length, runs: runs.length }),
    chips: runs.map((r) => ({
      level: `+${r.keyLevel}`,
      abbr: dungeonAbbr(r.encounterName),
      result: resultOf(r),
      title: t("owner.form.week.chip", { level: r.keyLevel, dungeon: r.encounterName, result: resultText(r) }),
    })),
    note,
  };
}

function pillarsView(t: T, season: SeasonView | null): FormView["pillars"] {
  const window = season?.recent ?? season?.season ?? null;
  const trends = season?.trends ?? [];
  const rows = PILLAR_ORDER.map((key): FormPillarRow & { missing: boolean } => {
    const p = window?.pillars.find((x) => x.key === key);
    const score = p?.score == null ? null : Math.round(p.score);
    const tr = trendView(t, trends.find((x) => x.key === key));
    return { key, name: t(`self.pillars.${key}`), score, band: scoreBand(score), trend: tr.missing ? null : tr.text, missing: tr.missing === true };
  });
  // Only a scored pillar without a trend calls for the rule (an unmeasured Control pillar has neither).
  const missing = rows.some((r) => r.score !== null && r.missing);
  const most = (f: (x: SeasonView["trends"][number]) => number) => trends.reduce((m, x) => Math.max(m, f(x)), 0);
  return {
    global: window?.overall == null ? null : t("owner.form.pillars.global", { score: Math.round(window.overall) }),
    rows: rows.map(({ missing: _m, ...r }) => r),
    note: missing
      ? t("owner.form.pillars.noteTrends", { min: TREND_MIN_RUNS, recent: most((x) => x.recentRuns), before: most((x) => x.beforeRuns) })
      : t("owner.form.pillars.note"),
  };
}

/**
 * The last 4 game weeks that have runs, evenly spaced; one dot per run at its key level (y between the lowest and the
 * highest level seen, the target included, ±1 when they are all equal); runs of one week at the same level spread
 * sideways in play order (0, −20, +20, −40 …, narrowed to stay inside the column).
 */
function chartView(t: T, season: SeasonView): FormChart | null {
  if (season.runs.length === 0) return null;
  const weeks = [...new Set(season.runs.map((r) => r.week))].sort((a, b) => b - a).slice(0, CHART_WEEKS).reverse();
  const shown = season.runs.filter((r) => weeks.includes(r.week));
  const target = season.targetLevel > 0 ? season.targetLevel : null;
  const levels = [...shown.map((r) => r.keyLevel), ...(target !== null ? [target] : [])];
  let lo = Math.min(...levels);
  let hi = Math.max(...levels);
  if (lo === hi) { lo -= 1; hi += 1; }
  const y = (l: number) => Math.round(CHART.bottom - ((l - lo) / (hi - lo)) * (CHART.bottom - CHART.top));
  const col = (CHART.right - CHART.left) / weeks.length;
  const dots: FormChart["dots"] = [];
  const columns = weeks.map((w, i) => {
    const x = Math.round(CHART.left + (i + 0.5) * col);
    const runs = shown.filter((r) => r.week === w).reverse(); // oldest first
    const perLevel = new Map<number, number>();
    for (const r of runs) perLevel.set(r.keyLevel, (perLevel.get(r.keyLevel) ?? 0) + 1);
    const crowd = Math.max(1, ...[...perLevel.values()].map((n) => Math.floor(n / 2)));
    const spread = Math.min(DOT_SPREAD, (col / 2 - DOT_MARGIN) / crowd);
    const seen = new Map<number, number>();
    for (const r of runs) {
      const k = (seen.get(r.keyLevel) ?? 0) + 1;
      seen.set(r.keyLevel, k);
      const off = (k % 2 ? 1 : -1) * Math.floor(k / 2) * spread;
      dots.push({
        x: Math.round(x + off),
        y: y(r.keyLevel),
        timed: r.timed,
        title: t("owner.form.chart.dot", { level: r.keyLevel, dungeon: r.encounterName, result: t(`owner.form.week.result.${resultOf(r)}`) }),
      });
    }
    return { label: weekLabel(t, season.currentWeek, w), x };
  });
  const step = Math.max(1, Math.ceil((hi - lo) / MAX_LEVEL_LABELS));
  const ticks: FormChart["levels"] = [];
  for (let l = lo; l <= hi; l += step) ticks.unshift({ y: y(l), label: t("owner.form.chart.level", { level: l }) });
  return {
    weeks: columns,
    dots,
    target: target === null ? null : { y: y(target), label: t("owner.form.chart.target", { level: target }) },
    levels: ticks,
    aria: t("owner.form.chart.aria", { count: weeks.length }),
  };
}

function checklistView(t: T, locale: Locale, ev: Evaluation, season: SeasonView | null, docs: SynthesisDocs): ChecklistRow[] {
  return [...workOnSource(ev, season)].sort((a, b) => a.impact - b.impact).slice(0, CHECKLIST_MAX).map((w) => ({
    title: docs.titleOf(w.source),
    // The goal is the average player's value with its unit ("1.6 / run"); before / now read short ("0.7").
    goal: t("owner.form.check.goal", { value: driverValues(t, locale, { source: w.source, value: w.reference, reference: w.reference }).value }),
    before: w.past ? t("owner.form.check.before", { value: shortValue(t, locale, w.source, w.past.value) }) : null,
    now: t("owner.form.check.now", { value: shortValue(t, locale, w.source, w.value) }),
    nowTone: w.past?.change === "better" ? "better" : w.past?.change === "worse" ? "worse" : "neutral",
    cost: signed(Math.round(w.impact)),
  }));
}

function chefView(t: T, locale: Locale, ev: Evaluation, docs: SynthesisDocs, key: string): ChefCard {
  const v = verdictView(t, ev);
  const nv = ev.nextVerdict;
  let path: string | null = null;
  // synthesisView's "what would flip it": none for INVITE, not enough data, or a path without a counted signal.
  if (nv && synthesisView(t, locale, ev, docs, 0).flip) {
    const verdict = t(`verdict.words.${nv.verdict}`);
    if (!nv.reachable) path = t("owner.form.chef.out", { verdict, threshold: nv.threshold });
    else {
      const items = flipDrivers(ev, docs).slice(0, PATH_ITEMS).map((d) =>
        t("owner.form.chef.item", { name: docs.titleOf(d.source).toLocaleLowerCase(locale), value: driverValues(t, locale, d).value }));
      path = t("owner.form.chef.path", { verdict, threshold: nv.threshold, list: new Intl.ListFormat(locale, { type: "conjunction" }).format(items) });
    }
  }
  return {
    verdict: { cls: v.cls, label: v.label, score: v.score },
    title: t("owner.form.chef.title", { level: ev.targetLevel }),
    path,
    vettingHref: ownerHref(key, { vetting: true }),
  };
}

/** Ma forme for the owner page `key` (its history key: the chef card links to `as=vetting` on it). Without a season
 * (none stored yet): no week, no chart, unscored pillars, the checklist from the lookup's verdict. */
export function formView(t: T, locale: Locale, ev: Evaluation, season: SeasonView | null, docs: SynthesisDocs, key: string): FormView {
  return {
    week: season ? weekView(t, season) : null,
    pillars: pillarsView(t, season),
    chart: season ? chartView(t, season) : null,
    checklist: checklistView(t, locale, ev, season, docs),
    checklistNote: t(season?.recent ? "owner.form.check.recent" : "owner.form.check.lookup"),
    chef: chefView(t, locale, ev, docs, key),
  };
}
