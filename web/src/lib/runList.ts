// The candidate profile's Runs list (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 7, mockup docs/design/redesign/F-Runs.dc.html, top card): one grid row per displayed run, the two filters,
// the sort and the batch-analyse line. The numbers are the ones today's run rows show (`runs.ts`), laid out in cells.
import type { LookupPayload, MPlusRun, Role } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { analysisFor, costText, unanalyzedRuns } from "./deepdive.ts";
import { STALE_DAYS, ageDays, fmtAge, fmtAmount, fmtDuration, lowerTone, parseTier, signed, wclUrl } from "./format.ts";
import type { ParseTier, Tone } from "./format.ts";
import { kickFigures, missingDungeons, vsPeers } from "./runs.ts";

/** "Tous les runs" is not offered for a candidate: the payload holds the best run per dungeon only (spec delta 3). */
export type RunFilter = "best" | "deaths";
export type RunSort = "parse" | "key" | "deaths" | "when";
export type DeltaTone = "better" | "worse" | "neutral";

export interface RunListRow {
  /** "<report code>:<fight id>", the `run` of the profile's URL state. */
  key: string;
  abbr: string;
  dungeon: string;
  analysed: boolean;
  hasSignals: boolean;
  /** "+20". */
  level: string;
  /** "✓ +1" / "✗ depleted"; null when neither the signals nor the rankings say. */
  upgrade: { text: string; timed: boolean } | null;
  /** Clear time "30:31", "—" when unknown. */
  time: string;
  deaths: { text: string; tone: "pass" | "neutral" | "dim" };
  /** Signed percent vs the peers' median ("+14 %"); the raw DTPS when there are no peers; null without signals. */
  dtps: { text: string; tone: DeltaTone } | null;
  avoidable: { text: string; tone: DeltaTone } | null;
  /** Healers: dispels; everyone else: kicks, count/capacity when the spec has a kick. */
  util: { label: "kicks" | "dispels"; text: string } | null;
  parse: { text: string; tier: ParseTier | null };
  when: string;
  stale: boolean;
  url: string;
}

export interface RunListView {
  rows: RunListRow[];
  /** The utility column's header: dispels for a healer, kicks otherwise. */
  util: "kicks" | "dispels";
  /** "1/8 analysé". */
  analysedLine: string;
  /** Runs that can still be analysed (`unanalyzedRuns`). */
  pending: number;
  /** "Analyser les 7 autres · ~21 pts"; null when nothing is left. */
  batchLabel: string | null;
  missing: string[];
}

const STOP_WORDS = new Set(["of", "the", "and", "a", "an"]);

/** Two-letter tile of a dungeon: "Temple of Sethraliss" → "TS", "The Blinding Vale" → "BV", "Murder Row" → "MR". */
export function dungeonAbbr(name: string): string {
  const words = name.split(/[\s\-,:]+/).filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

const toDelta = (t: Tone): DeltaTone => (t === "good" ? "better" : t === "neutral" ? "neutral" : "worse");

/** One decimal, always shown, in the locale: 72.2 → "72,2" in French. */
export const fixed1 = (locale: Locale, n: number): string =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

/** "72,2 %"; WCL's 0 % means the log is not ranked and is never shown as a percentile. */
export const parseCell = (t: T, locale: Locale, pct: number): { text: string; tier: ParseTier | null } =>
  pct > 0 ? { text: t("cand.runs.pct", { v: fixed1(locale, pct) }), tier: parseTier(pct) } : { text: t("runs.unranked"), tier: null };

/** A signed whole percent vs peers ("+14 %", "−100 %"), the sign as the run rows write it. */
/**
 * "+12 %", "−3 %": rounded (as `toFixed`, half away from zero, like the tiles) before the sign is chosen, so −0.3 reads
 * "+0 %", never "−0 %".
 */
export const signedPct = (t: T, d: number): string => t("cand.runs.pct", { v: signed(Number(d.toFixed(0)) || 0, 0) });

export function upgradeOf(t: T, r: MPlusRun): { text: string; timed: boolean } | null {
  const s = r.signals;
  if (s && !s.partial) {
    return s.keystone.timed
      ? { text: t("cand.runs.upgrade.timed", { chests: s.keystone.chests }), timed: true }
      : { text: t("cand.runs.upgrade.depleted"), timed: false };
  }
  if (r.timed === undefined) return null;
  return r.timed ? { text: t("cand.runs.upgrade.timedNoChests"), timed: true } : { text: t("cand.runs.upgrade.depleted"), timed: false };
}

/** The clear time: the keystone's when the signals have it, else the rankings' fight duration. */
export function clearTime(r: MPlusRun): string {
  const s = r.signals;
  if (s && !s.partial) return fmtDuration(s.keystone.timeMs);
  return r.durationMs !== undefined ? fmtDuration(r.durationMs) : "—";
}

export function runListRow(t: T, locale: Locale, p: LookupPayload, r: MPlusRun, role: Role, now: number): RunListRow {
  const s = r.signals;
  let dtps: RunListRow["dtps"] = null;
  let avoidable: RunListRow["avoidable"] = null;
  let util: RunListRow["util"] = null;
  if (s) {
    const dd = vsPeers(s.damageTaken.dtps, s.damageTaken.peer);
    dtps = dd !== null ? { text: signedPct(t, dd), tone: toDelta(lowerTone(dd)) } : { text: fmtAmount(s.damageTaken.dtps), tone: "neutral" };
    const a = s.avoidableDamage;
    if (a) {
      const ad = vsPeers(a.perMinute, a.peer);
      avoidable = ad !== null
        ? { text: signedPct(t, ad), tone: toDelta(lowerTone(ad)) }
        : { text: t("cand.run.perMin", { v: fmtAmount(a.perMinute) }), tone: "neutral" };
    }
    if (role === "healer") util = { label: "dispels", text: String(s.dispels.count) };
    else {
      const k = kickFigures(s.interrupts);
      util = { label: "kicks", text: k.cap !== null ? `${k.count}/${k.cap}` : String(k.count) };
    }
  }
  const n = s?.deaths.count ?? null;
  return {
    key: `${r.reportCode}:${r.fightID}`,
    abbr: dungeonAbbr(r.encounterName),
    dungeon: r.encounterName,
    analysed: analysisFor(p, r) !== null,
    hasSignals: s !== undefined,
    level: `+${r.keyLevel}`,
    upgrade: upgradeOf(t, r),
    time: clearTime(r),
    deaths: n === null ? { text: "—", tone: "dim" } : { text: t("runs.deaths", { count: n }), tone: n >= 2 ? "pass" : n === 1 ? "neutral" : "dim" },
    dtps,
    avoidable,
    util,
    parse: parseCell(t, locale, r.parsePercent),
    when: fmtAge(t, r.startTime, now),
    stale: ageDays(r.startTime, now) >= STALE_DAYS,
    url: wclUrl(r.reportCode, r.fightID),
  };
}

const deathsOf = (r: MPlusRun): number => r.signals?.deaths.count ?? -1;

const SORTS: Record<RunSort, (a: MPlusRun, b: MPlusRun) => number> = {
  parse: (a, b) => b.parsePercent - a.parsePercent,
  key: (a, b) => b.keyLevel - a.keyLevel || b.parsePercent - a.parsePercent,
  deaths: (a, b) => deathsOf(b) - deathsOf(a) || b.parsePercent - a.parsePercent,
  when: (a, b) => b.startTime - a.startTime,
};

/** The role whose utility column the list shows: the evaluation's, else the run signals' own. */
export const roleOf = (p: LookupPayload, r: MPlusRun): Role =>
  p.evaluation?.role ?? (r.signals?.role === "healer" ? "healer" : r.signals?.role === "tank" ? "tank" : "dps");

export function runListView(t: T, locale: Locale, p: LookupPayload, filter: RunFilter, sort: RunSort, now = Date.now()): RunListView {
  const all = p.perDungeon.runs;
  const kept = filter === "deaths" ? all.filter((r) => (r.signals?.deaths.count ?? 0) > 0) : all;
  const rows = [...kept].sort(SORTS[sort]).map((r) => runListRow(t, locale, p, r, roleOf(p, r), now));
  const analysed = all.filter((r) => analysisFor(p, r) !== null).length;
  const pending = unanalyzedRuns(p).length;
  const batchLabel = pending === 0
    ? null
    : t(analysed === 0 ? "cand.runs.analyseAll" : "cand.runs.analyseOthers", { count: pending, cost: costText(t, pending) });
  return {
    rows,
    util: (p.evaluation?.role ?? (all[0] ? roleOf(p, all[0]) : "dps")) === "healer" ? "dispels" : "kicks",
    analysedLine: t("cand.runs.analysed", { n: analysed, total: all.length }),
    pending,
    batchLabel,
    missing: missingDungeons(p),
  };
}

/** The run the panel shows: the one `key` names when the payload holds it, else the list's first row; null for none. */
export function pickRun(p: LookupPayload, rows: readonly RunListRow[], key: string | null): MPlusRun | null {
  const byKey = (k: string) => p.perDungeon.runs.find((r) => `${r.reportCode}:${r.fightID}` === k) ?? null;
  return (key !== null ? byKey(key) : null) ?? (rows[0] ? byKey(rows[0].key) : null);
}
