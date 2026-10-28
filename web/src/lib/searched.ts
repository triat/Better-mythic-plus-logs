// /admin/characters (canvas "bmpl · Personnages recherchés": A the table, B the overview, C the cloud, one tab each).
// Pure: everything the three tabs show, from `GET /api/admin/characters`.
import { CLASS_NAMES, classHex } from "@shared/wow/classes.ts";
import type { T } from "../i18n/t.ts";
import type { AdminCharacter, CharacterRole } from "../types.ts";
import { rangeText } from "./admin.ts";

export type SearchedTab = "table" | "overview" | "cloud";
export const SEARCHED_TABS: readonly SearchedTab[] = ["table", "overview", "cloud"];
export type VerdictFilter = "all" | "invite" | "maybe" | "pass" | "none";
export type RoleFilter = "all" | CharacterRole;
export type SearchedSort = "recent" | "score" | "rio" | "members";
export const SEARCHED_PER_PAGE = 20;
export const ROLES: readonly CharacterRole[] = ["tank", "healer", "dps"];
export interface Thresholds { invite: number; maybe: number }

const DAY = 86_400_000;
const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const CLASS_BY_NAME = new Map(Object.entries(CLASS_NAMES).map(([id, n]) => [n, Number(id)]));

/** The class colour from the WCL class id, else Raider.IO's class name; null when neither is known. */
export function classColorOf(c: AdminCharacter): string | null {
  const id = c.classId ?? (c.className ? CLASS_BY_NAME.get(c.className) : undefined);
  return id === undefined || id === null ? null : classHex(id);
}

/** The tab from `?tab=`, the table by default. */
export const tabOf = (search: string): SearchedTab => {
  const v = new URLSearchParams(search).get("tab");
  return (SEARCHED_TABS as readonly string[]).includes(v ?? "") ? (v as SearchedTab) : "table";
};

export interface SearchedFilters { query: string; verdict: VerdictFilter; role: RoleFilter; region: string }
export const NO_FILTERS: SearchedFilters = { query: "", verdict: "all", role: "all", region: "all" };

const matches = (c: AdminCharacter, f: SearchedFilters, withVerdict: boolean): boolean => {
  if (f.role !== "all" && c.role !== f.role) return false;
  if (f.region !== "all" && c.region !== f.region) return false;
  if (withVerdict && f.verdict !== "all" && (c.verdict ?? "none") !== f.verdict) return false;
  const q = fold(f.query.trim());
  if (!q) return true;
  return [c.displayName, c.displayRealm, `${c.displayName}-${c.displayRealm}`, c.className ?? "", c.spec ?? ""].some((s) => fold(s).includes(q));
};

/** The verdict chips' counts under the other filters. */
export function verdictCounts(list: AdminCharacter[], f: SearchedFilters): Record<VerdictFilter, number> {
  const out: Record<VerdictFilter, number> = { all: 0, invite: 0, maybe: 0, pass: 0, none: 0 };
  for (const c of list) {
    if (!matches(c, f, false)) continue;
    out.all++;
    out[c.verdict ?? "none"]++;
  }
  return out;
}

/** The regions present, for the region filter (sorted). */
export const regionsOf = (list: AdminCharacter[]): string[] => [...new Set(list.map((c) => c.region))].sort();

const cmp: Record<SearchedSort, (a: AdminCharacter, b: AdminCharacter) => number> = {
  recent: (a, b) => (b.lookedUpAt ?? 0) - (a.lookedUpAt ?? 0),
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  rio: (a, b) => (b.rio ?? -1) - (a.rio ?? -1),
  members: (a, b) => b.members - a.members || (b.lookedUpAt ?? 0) - (a.lookedUpAt ?? 0),
};

export interface SearchedTable { rows: AdminCharacter[]; total: number; page: number; pages: number; range: string }

/** Tab A: filtered, sorted, paged; the page brought back into range when the filters leave fewer. */
export function searchedTable(t: T, list: AdminCharacter[], f: SearchedFilters, sort: SearchedSort, page: number, perPage = SEARCHED_PER_PAGE): SearchedTable {
  const shown = list.filter((c) => matches(c, f, true)).sort((a, b) => cmp[sort](a, b) || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: shown.slice((p - 1) * perPage, p * perPage), total: shown.length, page: p, pages, range: rangeText(t, p, perPage, shown.length, f.query.trim()) };
}

/** "il y a 3 min" style age, for the last-search column. */
export function ageText(t: T, at: number | null, now: number): string {
  if (at === null) return t("searched.never");
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return t("searched.age.min", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("searched.age.hour", { n: h });
  return t("searched.age.day", { n: Math.round(h / 24) });
}

export type OverviewPeriod = 7 | 30 | 0;
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

export interface Overview {
  count: number;
  thisWeek: number;
  median: number | null;
  medianByRole: Record<CharacterRole, number | null>;
  verdicts: { invite: number; maybe: number; pass: number; none: number };
  /** Each verdict's share of the characters with one, in %, summing to 100 (or all 0). */
  shares: { invite: number; maybe: number; pass: number };
  levelMode: number | null;
  levelMin: number | null;
  levelMax: number | null;
  /** Ten bins of 10 points; `verdict` is where the bin's middle falls against the thresholds. */
  bins: { from: number; n: number; height: number; verdict: "invite" | "maybe" | "pass" }[];
  /** The six specs with the most characters. */
  specs: { spec: string; color: string | null; n: number; width: number }[];
}

/** Tab B, over the characters looked up in the period (0 = all of them). */
export function overview(list: AdminCharacter[], period: OverviewPeriod, th: Thresholds, now: number): Overview {
  const inPeriod = period === 0 ? list : list.filter((c) => c.lookedUpAt !== null && now - c.lookedUpAt <= period * DAY);
  const scored = inPeriod.filter((c) => c.score !== null);
  const verdicts = { invite: 0, maybe: 0, pass: 0, none: 0 };
  for (const c of inPeriod) verdicts[c.verdict ?? "none"]++;
  const withVerdict = verdicts.invite + verdicts.maybe + verdicts.pass;
  const pct = (n: number) => (withVerdict === 0 ? 0 : Math.round((n / withVerdict) * 100));
  const shares = { invite: pct(verdicts.invite), maybe: pct(verdicts.maybe), pass: 0 };
  shares.pass = withVerdict === 0 ? 0 : 100 - shares.invite - shares.maybe;
  const levels = new Map<number, number>();
  for (const c of scored) if (c.targetLevel !== null) levels.set(c.targetLevel, (levels.get(c.targetLevel) ?? 0) + 1);
  const lv = [...levels.keys()];
  const levelMode = lv.length === 0 ? null : [...levels.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
  const counts = Array.from({ length: 10 }, () => 0);
  for (const c of scored) counts[Math.min(9, Math.max(0, Math.floor(c.score! / 10)))]!++;
  const top = Math.max(1, ...counts);
  const bins = counts.map((n, i) => {
    const mid = i * 10 + 5;
    return { from: i * 10, n, height: Math.round((n / top) * 100), verdict: mid >= th.invite ? "invite" as const : mid >= th.maybe ? "maybe" as const : "pass" as const };
  });
  const bySpec = new Map<string, { n: number; color: string | null }>();
  for (const c of inPeriod) {
    if (!c.spec) continue;
    const e = bySpec.get(c.spec) ?? { n: 0, color: classColorOf(c) };
    e.n++;
    bySpec.set(c.spec, e);
  }
  const specRows = [...bySpec.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 6);
  const specTop = Math.max(1, ...specRows.map(([, e]) => e.n));
  return {
    count: inPeriod.length,
    thisWeek: list.filter((c) => c.lookedUpAt !== null && now - c.lookedUpAt <= 7 * DAY).length,
    median: median(scored.map((c) => c.score!)),
    medianByRole: {
      tank: median(scored.filter((c) => c.role === "tank").map((c) => c.score!)),
      healer: median(scored.filter((c) => c.role === "healer").map((c) => c.score!)),
      dps: median(scored.filter((c) => c.role === "dps").map((c) => c.score!)),
    },
    verdicts,
    shares,
    levelMode,
    levelMin: lv.length ? Math.min(...lv) : null,
    levelMax: lv.length ? Math.max(...lv) : null,
    bins,
    specs: specRows.map(([spec, e]) => ({ spec, color: e.color, n: e.n, width: Math.round((e.n / specTop) * 100) })),
  };
}

export interface CloudPoint { key: string; x: number; y: number; color: string | null; character: AdminCharacter }
export interface Cloud {
  points: CloudPoint[];
  /** The Raider.IO axis: its low and high ends and four tick values, bottom to top. */
  rioMin: number;
  rioMax: number;
  ticks: number[];
  /** The verdict bands' edges along the score axis, in %. */
  maybeAt: number;
  inviteAt: number;
  /** The characters whose bmpl score and Raider.IO score disagree most (rank against rank), five at most. */
  gaps: AdminCharacter[];
  /** Characters left out for lack of a score or a Raider.IO score. */
  missing: number;
}

export const charKey = (c: AdminCharacter): string => `${c.region}|${c.realm}|${c.name}`;

/** Tab C: one point per character with both scores; x = the bmpl score, y = Raider.IO (top = highest). */
export function cloud(list: AdminCharacter[], role: RoleFilter, th: Thresholds): Cloud {
  const pool = list.filter((c) => role === "all" || c.role === role);
  const both = pool.filter((c) => c.score !== null && c.rio !== null);
  const rios = both.map((c) => c.rio!);
  const lo = rios.length ? Math.floor(Math.min(...rios) / 100) * 100 : 0;
  const hi = rios.length ? Math.max(lo + 100, Math.ceil(Math.max(...rios) / 100) * 100) : 100;
  const y = (r: number) => Math.round((1 - (r - lo) / (hi - lo)) * 1000) / 10;
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    order.forEach(([, i], r) => { out[i] = both.length > 1 ? r / (both.length - 1) : 0.5; });
    return out;
  };
  const rs = rank(both.map((c) => c.score!));
  const rr = rank(rios);
  const gaps = both.map((c, i) => ({ c, d: Math.abs(rs[i]! - rr[i]!) })).filter((g) => g.d >= 0.25)
    .sort((a, b) => b.d - a.d).slice(0, 5).map((g) => g.c);
  return {
    points: both.map((c) => ({ key: charKey(c), x: Math.max(0, Math.min(100, c.score!)), y: y(c.rio!), color: classColorOf(c), character: c })),
    rioMin: lo,
    rioMax: hi,
    ticks: [0, 1, 2, 3].map((i) => Math.round(lo + ((hi - lo) * i) / 3)),
    maybeAt: th.maybe,
    inviteAt: th.invite,
    gaps,
    missing: pool.length - both.length,
  };
}

/** ← → Home End on the tab strip; null for any other key. */
export function tabStep(tab: SearchedTab, key: string): SearchedTab | null {
  const i = SEARCHED_TABS.indexOf(tab);
  const n = SEARCHED_TABS.length;
  if (key === "ArrowRight") return SEARCHED_TABS[(i + 1) % n]!;
  if (key === "ArrowLeft") return SEARCHED_TABS[(i + n - 1) % n]!;
  if (key === "Home") return SEARCHED_TABS[0]!;
  if (key === "End") return SEARCHED_TABS[n - 1]!;
  return null;
}
