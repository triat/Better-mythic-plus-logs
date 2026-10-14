// The owner profile's Runs tab (redesign phase 3, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 10, mockup docs/design/redesign/F-Moi-Runs.dc.html): the season as one tile per run, the filters (dungeon,
// spec, result, period, key level min–max and the target level), then the runs grouped by game week, newest first,
// a few weeks at a time. Rows reuse the candidate run list's cells (`runRow`), so a run reads the same on both pages.
// Pure: no React, no fetch — the season comes from GET /api/season (0 pts).
import type { MPlusRun, Role, RunDefensives, SeasonRunView, SeasonView } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { costText } from "./deepdive.ts";
import type { MenuItem } from "./header.ts";
import { fmtAge, fmtAmount, wclUrl } from "./format.ts";
import { specWords } from "./profile.ts";
import { kickFigures, vsPeers } from "./runs.ts";
import { runRow, type RunListRow } from "./runList.ts";
import { runDetail, runOf, type RunDetailView } from "./self.ts";

/** A run's result: timed, depleted, or no time at all (`timed: null` — the rankings gave none). */
export type RunResult = "timed" | "depleted" | "none";
export type ResultFilter = "all" | RunResult;

export interface RunFilters {
  /** An `encounterID`; null = every dungeon. */
  dungeon: number | null;
  /** A WCL spec name ("Elemental"); null = every spec. */
  spec: string | null;
  result: ResultFilter;
  /** The last N game weeks, the current one included; null = the whole season. */
  weeks: number | null;
  /** Inclusive bounds; null = open. */
  keyMin: number | null;
  keyMax: number | null;
}

/** The period choices: this week, the last 3, the last 8, the whole season. */
export const WEEK_CHOICES: readonly (number | null)[] = [1, 3, 8, null];
const RESULTS: readonly ResultFilter[] = ["all", "timed", "depleted", "none"];
/** Weeks the list shows at first, and how many more each "load earlier weeks" adds. */
export const WEEKS_PAGE = 3;

export const ALL_RUNS: RunFilters = { dungeon: null, spec: null, result: "all", weeks: null, keyMin: null, keyMax: null };

export const resultOf = (v: { timed: boolean | null }): RunResult => (v.timed === true ? "timed" : v.timed === false ? "depleted" : "none");
const keyOf = (v: { reportCode: string; fightID: number }): string => `${v.reportCode}:${v.fightID}`;

/** The spec most of the season's runs were played in (ties: the newest run's); null without runs. */
export function mainSpec(season: SeasonView): string | null {
  const n = new Map<string, number>();
  for (const r of season.runs) n.set(r.spec, (n.get(r.spec) ?? 0) + 1);
  let best: string | null = null;
  for (const r of season.runs) if (best === null || n.get(r.spec)! > n.get(best)!) best = r.spec;
  return best;
}

export interface FilterOption<V> { value: V; label: string; count?: number }
export interface FilterOptions {
  /** "Dungeon: all" first, then the dungeons present, by name. */
  dungeons: FilterOption<number | null>[];
  /** "Spec: all" first, then the specs present, most runs first. */
  specs: FilterOption<string | null>[];
  results: FilterOption<ResultFilter>[];
  weeks: FilterOption<number | null>[];
  /** The key levels seen this season; null without runs. */
  keys: { min: number; max: number } | null;
  /** `season.targetLevel`: the "target level" button sets `keyMin = keyMax = target`. */
  target: number;
  /** Everything, the key range being the full range seen. */
  defaults: RunFilters;
}

export function filterOptions(t: T, season: SeasonView): FilterOptions {
  const dungeons = new Map<number, { name: string; count: number }>();
  const specs = new Map<string, number>();
  for (const r of season.runs) {
    const d = dungeons.get(r.encounterID);
    dungeons.set(r.encounterID, { name: r.encounterName, count: (d?.count ?? 0) + 1 });
    specs.set(r.spec, (specs.get(r.spec) ?? 0) + 1);
  }
  const levels = season.runs.map((r) => r.keyLevel);
  const keys = levels.length > 0 ? { min: Math.min(...levels), max: Math.max(...levels) } : null;
  return {
    dungeons: [
      { value: null, label: t("owner.runs.filter.dungeonAll") },
      ...[...dungeons].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, d]) => ({ value: id, label: d.name, count: d.count })),
    ],
    specs: [
      { value: null, label: t("owner.runs.filter.specAll") },
      ...[...specs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s, count]) => ({ value: s, label: specWords(s), count })),
    ],
    results: RESULTS.map((value) => ({ value, label: t(`owner.runs.result.${value}`) })),
    weeks: WEEK_CHOICES.map((value) => ({ value, label: value === null ? t("owner.runs.filter.season") : t("owner.runs.filter.weeks", { count: value }) })),
    keys,
    target: season.targetLevel,
    defaults: { ...ALL_RUNS, keyMin: keys?.min ?? null, keyMax: keys?.max ?? null },
  };
}

/** A minimum above the maximum swaps the two. */
export const normFilters = (f: RunFilters): RunFilters =>
  f.keyMin !== null && f.keyMax !== null && f.keyMin > f.keyMax ? { ...f, keyMin: f.keyMax, keyMax: f.keyMin } : f;

/** The − / + steppers: one level at a time, within the range seen, the minimum never above the maximum. */
export function stepKey(f: RunFilters, bound: "min" | "max", by: 1 | -1, keys: FilterOptions["keys"]): RunFilters {
  if (!keys) return f;
  const lo = f.keyMin ?? keys.min;
  const hi = f.keyMax ?? keys.max;
  const clamp = (v: number) => Math.max(keys.min, Math.min(keys.max, v));
  return bound === "min" ? { ...f, keyMin: Math.min(hi, clamp(lo + by)), keyMax: hi } : { ...f, keyMin: lo, keyMax: Math.max(lo, clamp(hi + by)) };
}

/** Whether a stepper moves its bound: false at the season's lowest / highest key, or against the other bound. */
export function canStep(f: RunFilters, bound: "min" | "max", by: 1 | -1, keys: FilterOptions["keys"]): boolean {
  if (!keys) return false;
  const next = stepKey(f, bound, by, keys);
  return bound === "min" ? next.keyMin !== (f.keyMin ?? keys.min) : next.keyMax !== (f.keyMax ?? keys.max);
}

/** "Niveau cible": only the season's target level. */
export const targetFilters = (f: RunFilters, target: number): RunFilters => ({ ...f, keyMin: target, keyMax: target });

/** The two key presets beside the steppers: the target level and every key; `on` when the filters equal it. */
export function keyPresets(t: T, f: RunFilters, o: FilterOptions): { label: string; on: boolean; filters: RunFilters }[] {
  const all: RunFilters = { ...f, keyMin: o.keys?.min ?? null, keyMax: o.keys?.max ?? null };
  const target = targetFilters(f, o.target);
  return [
    { label: t("owner.runs.filter.target", { level: o.target }), on: f.keyMin === o.target && f.keyMax === o.target, filters: target },
    { label: t("owner.runs.filter.allKeys"), on: (f.keyMin ?? o.keys?.min) === o.keys?.min && (f.keyMax ?? o.keys?.max) === o.keys?.max, filters: all },
  ];
}

/** The three select buttons' labels ("Dungeon: all", "Spec: Elemental", "Last 3 weeks"). */
export function filterLabels(t: T, f: RunFilters, o: FilterOptions): { dungeon: string; spec: string; weeks: string } {
  const d = o.dungeons.find((x) => x.value === f.dungeon);
  const s = o.specs.find((x) => x.value === f.spec);
  return {
    dungeon: f.dungeon === null || !d ? t("owner.runs.filter.dungeonAll") : t("owner.runs.filter.dungeon", { name: d.label }),
    spec: f.spec === null || !s ? t("owner.runs.filter.specAll") : t("owner.runs.filter.spec", { name: s.label }),
    weeks: f.weeks === null ? t("owner.runs.filter.season") : t("owner.runs.filter.weeks", { count: f.weeks }),
  };
}

export type FilterMenu = "dungeon" | "spec" | "weeks";

/** The three select menus (`ChipMenu` rows): a value is the option's value as text, "" for "all". */
export function filterMenus(f: RunFilters, o: FilterOptions): Record<FilterMenu, MenuItem[]> {
  const item = <V extends number | string | null>(x: FilterOption<V>, on: boolean): MenuItem =>
    ({ value: x.value === null ? "" : String(x.value), label: x.label, hint: x.count === undefined ? null : String(x.count), on });
  return {
    dungeon: o.dungeons.map((x) => item(x, x.value === f.dungeon)),
    spec: o.specs.map((x) => item(x, x.value === f.spec)),
    weeks: o.weeks.map((x) => item(x, x.value === f.weeks)),
  };
}

/** A pick in one of the select menus: "" is "all" (the whole season for the period). */
export function pickMenu(f: RunFilters, menu: FilterMenu, value: string): RunFilters {
  if (menu === "spec") return { ...f, spec: value === "" ? null : value };
  const n = value === "" ? null : Number(value);
  return menu === "dungeon" ? { ...f, dungeon: n } : { ...f, weeks: n };
}

/** A picked tile: the filters to show its row (unchanged when it passes them, else the defaults) and the weeks to load. */
export function revealRun(season: SeasonView, f: RunFilters, o: FilterOptions, key: string, loaded: number): { filters: RunFilters; loaded: number } {
  const v = season.runs.find((r) => keyOf(r) === key);
  const filters = v && !matches(v, f, season.currentWeek) ? o.defaults : f;
  return { filters, loaded: Math.max(loaded, weeksFor(season, filters, key) ?? 0) };
}

const inPeriod = (v: SeasonRunView, f: RunFilters, currentWeek: number): boolean => f.weeks === null || v.week > currentWeek - f.weeks;

/** Whether a run passes every filter (bounds normalised first). */
export function matches(v: SeasonRunView, filters: RunFilters, currentWeek: number): boolean {
  const f = normFilters(filters);
  return (f.dungeon === null || v.encounterID === f.dungeon)
    && (f.spec === null || v.spec === f.spec)
    && (f.result === "all" || resultOf(v) === f.result)
    && inPeriod(v, f, currentWeek)
    && (f.keyMin === null || v.keyLevel >= f.keyMin)
    && (f.keyMax === null || v.keyLevel <= f.keyMax);
}

/** A season run as the run list's `MPlusRun`, with the rankings' result and duration for a run without signals. */
const listRun = (v: SeasonRunView): MPlusRun => ({
  ...runOf(v),
  ...(v.timed !== null ? { timed: v.timed } : {}),
  ...(v.durationMs !== null ? { durationMs: v.durationMs } : {}),
});

const roleOfRun = (v: SeasonRunView): Role => (v.signals?.role === "healer" ? "healer" : v.signals?.role === "tank" ? "tank" : "dps");

export interface Tile {
  key: string;
  level: number;
  result: RunResult;
  /** Played in another spec than the season's main one (dashed). */
  otherSpec: boolean;
  /** false: the filters hide it (dimmed). */
  shown: boolean;
  open: boolean;
  /** "+19 Temple of Sethraliss · ✓ timed" — the tile's label and tooltip. */
  title: string;
}
export interface TileWeek { week: number; label: string; tiles: Tile[] }

export interface OwnerRunRow extends RunListRow {
  result: RunResult;
  /** "Elemental · 315.7k dps". */
  specLine: string;
  /** "in a wipe" / "2 in wipes"; null when no death was in a wipe. */
  wipe: string | null;
  /** The raw figures under the vs-peers deltas; null when the main text already is the raw figure, or no signals. */
  dtpsAbs: string | null;
  avoidableAbs: string | null;
  /** "peers 24%": the peers' median kick usage; null without it. */
  kicksPeers: string | null;
  /** The last sync got no report from Warcraft Logs (the row's tag tooltip); null otherwise. */
  failed: string | null;
  open: boolean;
}

export interface WeekGroup {
  week: number;
  /** "This week", "2 weeks ago". */
  label: string;
  /** "6 runs · 5 timed · best timed +19", over the shown runs. */
  line: string;
  count: number;
  timed: number;
  bestTimed: number | null;
  rows: OwnerRunRow[];
  /** "No run of this week matches the filters."; null when a row is shown. */
  empty: string | null;
}

export interface ExpandedRun {
  key: string;
  /** Deaths with their hits, avoidable, spells that went through, the kick line, crowd control; null without signals. */
  detail: RunDetailView | null;
  /** Said instead of the detail when the run has no signals yet: not analysed, or no report from Warcraft Logs. */
  note: string | null;
  /** A deep-dive is cached for the run. */
  analysed: boolean;
  /** "Analyze · ~4 pts" when the run has signals and no deep-dive; null otherwise. A click, never automatic. */
  analyse: string | null;
  wcl: { href: string; label: string };
  /** "1 week ago · dispels 13". */
  facts: string;
  /** For the shared `Timeline` (own = true). */
  run: MPlusRun;
  analysis: RunDefensives | null;
}

export interface OwnerRunsView {
  summary: { timed: number; count: number; depleted: number; none: number; label: string; rest: string };
  legend: { timed: string; depleted: string; none: string; dimmed: string; otherSpec: string | null };
  /** Every run of the season, one group per game week, newest first (tiles newest first). */
  tiles: TileWeek[];
  /** The first `loadedWeeks` weeks of the period, newest first. */
  weeks: WeekGroup[];
  /** The util column: dispels for a healer, kicks otherwise. */
  util: "kicks" | "dispels";
  more: { label: string; weeks: number } | null;
  /** "6 runs shown · 24 loaded of 94". */
  footer: string;
  expanded: ExpandedRun | null;
}

export function weekLabel(t: T, week: number, currentWeek: number): string {
  const ago = currentWeek - week;
  return ago <= 0 ? t("owner.runs.week.current") : t("owner.runs.week.ago", { count: ago });
}

/** The weeks the list can show under the period filter, newest first (only weeks with a run). */
const listWeeks = (season: SeasonView, f: RunFilters): number[] =>
  [...new Set(season.runs.filter((v) => inPeriod(v, f, season.currentWeek)).map((v) => v.week))].sort((a, b) => b - a);

/** How many weeks the list must load for `key`'s row to be in it (a tile of an unloaded week was picked); null when
 * the run is not in the list's weeks. */
export function weeksFor(season: SeasonView, filters: RunFilters, key: string): number | null {
  const v = season.runs.find((r) => keyOf(r) === key);
  if (!v) return null;
  const i = listWeeks(season, normFilters(filters)).indexOf(v.week);
  return i < 0 ? null : i + 1;
}

export function ownerRunsView(
  t: T, locale: Locale, season: SeasonView, filters: RunFilters, open: string | null, loadedWeeks: number, now = Date.now(),
): OwnerRunsView {
  const f = normFilters(filters);
  const main = mainSpec(season);
  const shownKeys = new Set(season.runs.filter((v) => matches(v, f, season.currentWeek)).map(keyOf));
  const openKey = open !== null && shownKeys.has(open) ? open : null;
  const shown = season.runs.filter((v) => shownKeys.has(keyOf(v)));
  const count = (r: RunResult, list: SeasonRunView[]) => list.filter((v) => resultOf(v) === r).length;

  const byWeek = new Map<number, SeasonRunView[]>();
  for (const v of season.runs) byWeek.set(v.week, [...(byWeek.get(v.week) ?? []), v]);
  const newest = (a: SeasonRunView, b: SeasonRunView) => b.startTime - a.startTime;

  const tiles: TileWeek[] = [...byWeek.keys()].sort((a, b) => b - a).map((week) => ({
    week,
    label: weekLabel(t, week, season.currentWeek),
    tiles: [...byWeek.get(week)!].sort(newest).map((v) => ({
      key: keyOf(v),
      level: v.keyLevel,
      result: resultOf(v),
      otherSpec: main !== null && v.spec !== main,
      shown: shownKeys.has(keyOf(v)),
      open: keyOf(v) === openKey,
      title: t("owner.runs.tile", { level: v.keyLevel, dungeon: v.encounterName, result: t(`owner.runs.result.${resultOf(v)}`) }),
    })),
  }));

  const row = (v: SeasonRunView): OwnerRunRow => {
    const s = v.signals;
    const base = runRow(t, locale, listRun(v), roleOfRun(v), v.analysis !== null, now);
    const wipes = s?.deaths.events.filter((e) => e.inWipe).length ?? 0;
    const k = s ? kickFigures(s.interrupts) : null;
    const hasPeers = (x: number | null) => x !== null;
    return {
      ...base,
      result: resultOf(v),
      specLine: t("owner.runs.specLine", { spec: specWords(v.spec), amount: fmtAmount(v.amount), metric: v.metric }),
      wipe: wipes > 0 ? t("owner.runs.wipe", { count: wipes }) : null,
      dtpsAbs: s && hasPeers(vsPeers(s.damageTaken.dtps, s.damageTaken.peer)) ? fmtAmount(s.damageTaken.dtps) : null,
      avoidableAbs: s?.avoidableDamage && hasPeers(vsPeers(s.avoidableDamage.perMinute, s.avoidableDamage.peer))
        ? t("cand.run.perMin", { v: fmtAmount(s.avoidableDamage.perMinute) })
        : null,
      kicksPeers: k && k.peerPct !== null && base.util?.label === "kicks"
        ? t("owner.runs.peers", { pct: t("cand.runs.pct", { v: k.peerPct }) })
        : null,
      failed: !s && v.failed ? t("owner.runs.failed") : null,
      open: keyOf(v) === openKey,
    };
  };

  const eligible = listWeeks(season, f);
  const loaded = eligible.slice(0, Math.max(0, loadedWeeks));
  const weeks: WeekGroup[] = loaded.map((week) => {
    const list = byWeek.get(week)!.filter((v) => shownKeys.has(keyOf(v))).sort(newest);
    const timedLevels = list.filter((v) => v.timed === true).map((v) => v.keyLevel);
    const bestTimed = timedLevels.length > 0 ? Math.max(...timedLevels) : null;
    return {
      week,
      label: weekLabel(t, week, season.currentWeek),
      line: t("owner.runs.week.line", { count: list.length, timed: timedLevels.length, best: bestTimed === null ? "—" : `+${bestTimed}` }),
      count: list.length,
      timed: timedLevels.length,
      bestTimed,
      rows: list.map(row),
      empty: list.length === 0 ? t("owner.runs.week.empty") : null,
    };
  });

  const loadedRuns = loaded.reduce((n, w) => n + byWeek.get(w)!.length, 0);
  const rest = eligible.slice(loaded.length);
  // The button counts what loading would add to the list: the earlier weeks' runs the filters show, not all of them.
  const restRuns = rest.reduce((n, w) => n + byWeek.get(w)!.filter((v) => shownKeys.has(keyOf(v))).length, 0);
  const shownInList = weeks.reduce((n, w) => n + w.count, 0);

  const others = [...new Set(season.runs.filter((v) => main !== null && v.spec !== main).map((v) => specWords(v.spec)))];
  const firstWithSignals = season.runs.find((v) => v.signals);
  const ov = openKey !== null ? season.runs.find((v) => keyOf(v) === openKey)! : null;

  return {
    summary: {
      timed: count("timed", shown), count: shown.length, depleted: count("depleted", shown), none: count("none", shown),
      label: t("owner.runs.summary.label"),
      rest: t("owner.runs.summary.rest", { depleted: count("depleted", shown), none: count("none", shown) }),
    },
    legend: {
      timed: t("owner.runs.legend.timed"), depleted: t("owner.runs.legend.depleted"), none: t("owner.runs.legend.none"),
      dimmed: t("owner.runs.legend.dimmed"), otherSpec: others.length > 0 ? others.join(" · ") : null,
    },
    tiles,
    weeks,
    util: firstWithSignals && roleOfRun(firstWithSignals) === "healer" ? "dispels" : "kicks",
    more: restRuns > 0 ? { label: t("owner.runs.more", { count: restRuns }), weeks: Math.min(WEEKS_PAGE, rest.length) } : null,
    footer: t("owner.runs.footer", { shown: shownInList, loaded: loadedRuns, total: season.runs.length }),
    expanded: ov ? expandedRun(t, locale, ov, now) : null,
  };
}

function expandedRun(t: T, locale: Locale, v: SeasonRunView, now: number): ExpandedRun {
  const s = v.signals;
  const when = fmtAge(t, v.startTime, now);
  return {
    key: keyOf(v),
    detail: runDetail(t, locale, v),
    note: s ? null : t(v.failed ? "owner.runs.failed" : "owner.runs.notAnalysed"),
    analysed: v.analysis !== null,
    analyse: s && v.analysis === null ? t("runs.analyze", { cost: costText(t, 1) }) : null,
    wcl: { href: wclUrl(v.reportCode, v.fightID), label: t("owner.runs.wcl") },
    facts: s ? t("owner.runs.facts", { when, dispels: s.dispels.count }) : when,
    run: listRun(v),
    analysis: v.analysis,
  };
}
