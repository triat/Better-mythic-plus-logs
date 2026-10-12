// The Compare page (redesign phase 4, plan docs/superpowers/plans/2026-10-12-ui-redesign-phase-4.md task 2, mockups
// docs/design/redesign/F-Comparer-Duel.dc.html and F-Comparer-Multi.dc.html): two profiles get the duel, three to five
// the ranking. Both share the facts (`compareFacts`) and the best key per dungeon (`dungeonCompare`).
import { CLASS_NAMES, classHex } from "@shared/wow/classes.ts";
import type { AxisKey, LookupPayload, MPlusRun } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { defensivesCell } from "./deepdive.ts";
import type { ParseTier } from "./format.ts";
import { fmtAmount, parseTier, realmName, signed } from "./format.ts";
import { candidateHref } from "./hostedMode.ts";
import { classInitials, classToken, specWords } from "./profile.ts";
import { dungeonAbbr, fixed1, parseCell, signedPct } from "./runList.ts";
import type { Band, SynthesisDocs } from "./synthesis.ts";
import { scoreBand, synthesisView } from "./synthesis.ts";
import { AXIS_ORDER, axisTitle, verdictView } from "./verdict.ts";

export type Mode = "higher" | "lower" | "none";

/** Indices of the best value(s); null never wins; a row where everyone is equal highlights nothing. */
export function bestIndices(values: readonly (number | null)[], mode: Mode): number[] {
  if (mode === "none") return [];
  const valid = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
  if (valid.length === 0) return [];
  const best = valid.reduce((acc, x) => (mode === "higher" ? Math.max(acc, x.v) : Math.min(acc, x.v)), valid[0]!.v);
  if (valid.every((x) => x.v === valid[0]!.v) && valid.length === values.length) return [];
  return valid.filter((x) => x.v === best).map((x) => x.i);
}

const DASH = "—";

const findRun = (p: LookupPayload, encounterID: number): MPlusRun | null =>
  p.perDungeon.runs.find((r) => r.encounterID === encounterID) ?? null;

// ---------------------------------------------------------------------------------------------------------------------
// Redesign phase 4: the duel (two profiles) and the ranking (three to five).

export interface CompareEntry { key: string; payload: LookupPayload }

export type FactId = "rio" | "prevSeason" | "ilvl" | "recentTimed" | "deaths" | "avoidable" | "kicks" | "output" | "parse"
  | "atTarget" | "regionRank" | "covered" | "medianKey" | "timedShown" | "dtps" | "defensives" | "bestPrev";
export interface FactCell { text: string; best: boolean; tier: ParseTier | null }
export interface FactRow { id: FactId; label: string; cells: FactCell[] }

/** The decimal comma in French ("312.0k" → "312,0k"). */
const decimal = (locale: Locale, s: string): string => (locale === "fr" ? s.replace(".", ",") : s);
const ratio = (n: number | null, d: number | null): number | null => (n === null || d === null || d === 0 ? null : n / d);
const rioOf = (p: LookupPayload): number | null => {
  const v = p.rio?.seasons[0]?.all;
  return typeof v === "number" && v > 0 ? v : null;
};

interface FactSpec { id: FactId; label: string; mode: Mode; values: (number | null)[]; cells: { text: string; tier?: ParseTier | null }[] }

function factRow(f: FactSpec): FactRow {
  const best = new Set(bestIndices(f.values, f.mode));
  return { id: f.id, label: f.label, cells: f.cells.map((c, i) => ({ text: c.text, best: best.has(i), tier: c.tier ?? null })) };
}

/**
 * Every fact both layouts show, in the duel mockup's order then the rest of the old compare summary. Each row's best
 * keeps the old rule (lower for deaths, avoidable damage, DTPS and the region rank); a row where everyone is equal has none.
 */
export function compareFacts(t: T, locale: Locale, ps: LookupPayload[]): FactRow[] {
  const sm = ps.map((p) => p.summary);
  const pd = ps.map((p) => p.perDungeon);
  const pct = (d: number | null) => (d === null ? DASH : signedPct(t, d));
  const sameMetric = ps.every((p) => p.metric === ps[0]!.metric);
  const ranks = ps.map((p) => p.character.scoreTop?.regionRank ?? null);
  const rows: (FactSpec | null)[] = [
    { id: "rio", label: t("compare.facts.rio"), mode: "higher", values: ps.map(rioOf),
      cells: ps.map((p) => ({ text: rioOf(p) === null ? DASH : rioOf(p)!.toFixed(0) })) },
    { id: "prevSeason", label: t("compare.facts.prevSeason"), mode: "higher", values: sm.map((s) => s.prevSeason?.all ?? null),
      cells: sm.map((s) => ({ text: s.prevSeason ? `${s.prevSeason.all.toFixed(0)} ${t(`verdict.role.${s.prevSeason.best.role}`)}` : t("compare.facts.noData") })) },
    { id: "ilvl", label: t("compare.facts.ilvl"), mode: "higher", values: sm.map((s) => s.ilvl),
      cells: sm.map((s) => ({ text: s.ilvl === null ? DASH : fixed1(locale, s.ilvl) })) },
    { id: "recentTimed", label: t("compare.facts.recentTimed"), mode: "higher", values: sm.map((s) => ratio(s.recentTimed, s.recentTotal)),
      cells: sm.map((s) => ({ text: s.recentTotal === null ? DASH : `${s.recentTimed ?? 0}/${s.recentTotal}` })) },
    { id: "deaths", label: t("compare.facts.deaths"), mode: "lower", values: sm.map((s) => s.avgDeaths),
      cells: sm.map((s) => ({ text: s.avgDeaths === null ? DASH : fixed1(locale, s.avgDeaths) })) },
    { id: "avoidable", label: t("compare.facts.avoidable"), mode: "lower", values: sm.map((s) => s.avoidableDeltaPct),
      cells: sm.map((s) => ({ text: pct(s.avoidableDeltaPct) })) },
    { id: "kicks", label: t("compare.facts.kicks"), mode: "higher", values: sm.map((s) => s.kicksDeltaPts),
      cells: sm.map((s) => ({ text: s.kicksDeltaPts === null ? DASH : t("compare.facts.pts", { v: signed(s.kicksDeltaPts, 0) }) })) },
    { id: "output", label: sameMetric ? t("compare.facts.output", { metric: ps[0]!.metric.toUpperCase() }) : t("compare.facts.outputMixed"),
      mode: sameMetric ? "higher" : "none", values: pd.map((d) => d.medianAmount ?? null),
      cells: ps.map((p) => ({
        text: p.perDungeon.medianAmount == null ? DASH : decimal(locale, fmtAmount(p.perDungeon.medianAmount)) + (sameMetric ? "" : ` ${p.metric}`),
      })) },
    { id: "parse", label: t("compare.facts.parse"), mode: "higher", values: pd.map((d) => d.medianParse),
      cells: pd.map((d) => parseCell(t, locale, d.medianParse)) },
    { id: "atTarget", label: t("compare.facts.atTarget"), mode: "higher", values: pd.map((d) => d.dungeonsAtOrAboveTarget),
      cells: pd.map((d) => ({ text: `${d.dungeonsAtOrAboveTarget}/${d.totalDungeonsInSeason}` })) },
    ranks.every((r) => r === null) ? null
      : { id: "regionRank", label: t("compare.facts.regionRank"), mode: "lower", values: ranks,
        cells: ranks.map((r) => ({ text: r === null ? DASH : `#${r}` })) },
    { id: "covered", label: t("compare.facts.covered"), mode: "higher", values: pd.map((d) => d.dungeonsCovered),
      cells: pd.map((d) => ({ text: `${d.dungeonsCovered}/${d.totalDungeonsInSeason}` })) },
    { id: "medianKey", label: t("compare.facts.medianKey"), mode: "higher", values: pd.map((d) => d.medianLevel),
      cells: pd.map((d) => ({ text: `+${d.medianLevel}` })) },
    { id: "timedShown", label: t("compare.facts.timedShown"), mode: "higher",
      values: sm.map((s) => (s.runsWithSignals === 0 ? null : ratio(s.timedShown, s.runsWithSignals))),
      cells: sm.map((s) => ({ text: s.timedShown === null ? DASH : `${s.timedShown}/${s.runsWithSignals}` })) },
    { id: "dtps", label: t("compare.facts.dtps"), mode: "lower", values: sm.map((s) => s.dtpsDeltaPct),
      cells: sm.map((s) => ({ text: pct(s.dtpsDeltaPct) })) },
    { id: "defensives", label: t("compare.facts.defensives"), mode: "higher", values: ps.map((p) => defensivesCell(t, p).value),
      cells: ps.map((p) => ({ text: defensivesCell(t, p).text })) },
    { id: "bestPrev", label: t("compare.facts.bestPrev"), mode: "higher", values: ps.map((p) => p.prevLevelBest?.best.parsePercent ?? null),
      cells: ps.map((p) => {
        const b = p.prevLevelBest;
        if (!b) return { text: DASH };
        const parse = b.best.parsePercent;
        return { text: t("compare.facts.bestPrevCell", { level: String(b.level), parse: t("cand.runs.pct", { v: parse.toFixed(0) }) }), tier: parse > 0 ? parseTier(parse) : null };
      }) },
  ];
  return rows.filter((r): r is FactSpec => r !== null).map(factRow);
}

export interface DungeonCell { level: string; timed: boolean | null; parse: { text: string; tier: ParseTier | null }; sub: string; top: boolean }
export interface DungeonCompareRow { id: number; name: string; abbr: string; cells: (DungeonCell | null)[] }

/** The deaths and the DTPS delta vs peers of a run ("1 death · +14% DTPS"); empty without signals. */
function dungeonSub(t: T, r: MPlusRun): string {
  const s = r.signals;
  if (!s) return "";
  const parts = [t("compare.dungeon.deaths", { count: s.deaths.count })];
  const peer = s.damageTaken.peer;
  if (peer && peer.median > 0) parts.push(t("compare.dungeon.dtps", { pct: signedPct(t, ((s.damageTaken.dtps - peer.median) / peer.median) * 100) }));
  return parts.join(" · ");
}

/**
 * One row per season dungeon where someone has a run (`null` = no run). `top` marks the highest *timed* key of the row,
 * every tie included, nothing when nothing is timed: the same rule in both layouts.
 */
export function dungeonCompare(t: T, locale: Locale, ps: LookupPayload[]): DungeonCompareRow[] {
  const seasonDungeons = ps.map((p) => p.seasonDungeons).find((s) => s.length > 0) ?? [];
  const out: DungeonCompareRow[] = [];
  for (const d of seasonDungeons) {
    const runs = ps.map((p) => findRun(p, d.id));
    if (runs.every((r) => r === null)) continue;
    const timedOf = (r: MPlusRun): boolean | null => (r.signals && !r.signals.partial ? r.signals.keystone.timed : null);
    const timedLevels = runs.flatMap((r) => (r && timedOf(r) === true ? [r.keyLevel] : []));
    const top = timedLevels.length ? Math.max(...timedLevels) : null;
    out.push({
      id: d.id,
      name: d.name,
      abbr: dungeonAbbr(d.name),
      cells: runs.map((r) => {
        if (!r) return null;
        const timed = timedOf(r);
        return { level: `+${r.keyLevel}`, timed, parse: parseCell(t, locale, r.parsePercent), sub: dungeonSub(t, r), top: timed === true && r.keyLevel === top };
      }),
    });
  }
  return out;
}

/** Null when every target key is the same, else the line that warns each score is relative to its own key. */
export function targetWarning(t: T, ps: LookupPayload[]): string | null {
  const levels = ps.map((p) => p.evaluation.targetLevel);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  return min === max ? null : t("compare.warning", { min: String(min), max: String(max) });
}

const insufficientOf = (p: LookupPayload): boolean => p.evaluation.verdict === "insufficient" || p.evaluation.global === null;
const weightOf = (docs: SynthesisDocs, p: LookupPayload, k: AxisKey): number => docs.axisWeights[p.evaluation.role]?.[k] ?? 0;
/** An axis whose weight is 0 for any compared player's role is informational: never a winner nor a best. */
const informationalFor = (docs: SynthesisDocs, ps: LookupPayload[], k: AxisKey): boolean => ps.some((p) => weightOf(docs, p, k) === 0);
const axisScore = (p: LookupPayload, k: AxisKey): number | null => {
  if (insufficientOf(p)) return null;
  const s = p.evaluation.axes.find((a) => a.key === k)?.score;
  return s == null ? null : Math.round(s);
};
const classNameOf = (t: T, p: LookupPayload): string =>
  CLASS_NAMES[p.character.classID] ?? t("cand.header.unknownClass", { id: String(p.character.classID) });
const specClass = (t: T, p: LookupPayload): string => {
  const klass = classNameOf(t, p);
  return p.character.spec ? `${specWords(p.character.spec)} ${klass}` : klass;
};
const lower = (locale: Locale, s: string): string => s.toLocaleLowerCase(locale);
const listOf = (locale: Locale, items: string[]): string => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);

// Duel ------------------------------------------------------------------------------------------------------------------

export interface DuelNote { sign: "+" | "−"; tone: "better" | "worse"; text: string }
export interface DuelHead {
  key: string; href: string; name: string; classId: number; classColor: string; iconUrl: string | null; initials: string;
  /** "Elemental Shaman · Ysondre EU · RIO 3650" (the RIO part only when present). */
  sub: string;
  verdict: { cls: string; label: string; score: string | null };
  /** "+18 · 9 runs scored" (target, auto suffix, evaluation.runsUsed). */
  runs: string;
  /** ≤ 3: the two strongest pros then the strongest con, filled from the other list when one is short. */
  notes: DuelNote[];
}
export interface MirrorSide { score: number | null; text: string; band: Band; wins: boolean; why: string }
export interface MirrorRow {
  key: AxisKey; name: string; informational: boolean; left: MirrorSide; right: MirrorSide;
  win: { text: string; side: "left" | "right" | null };
}
export interface DuelView {
  summary: { title: string; lead: string; detail: string };
  warning: string | null;
  heads: [DuelHead, DuelHead];
  axes: MirrorRow[];
  facts: FactRow[];
  dungeons: DungeonCompareRow[];
}

/** A score gap of this much or less is a tie. */
const TIE = 2;
const MAX_NOTES = 3;

function duelHead(t: T, locale: Locale, e: CompareEntry, docs: SynthesisDocs): DuelHead {
  const p = e.payload;
  const c = p.character;
  const ev = p.evaluation;
  const v = verdictView(t, ev);
  const token = classToken(c.classID);
  const rio = rioOf(p);
  const base = { spec: specClass(t, p), realm: realmName(c.realmSlug), region: c.region.toUpperCase() };
  const syn = synthesisView(t, locale, ev, docs, p.runsIndexed);
  // Two pros then one con; a short list leaves its places to the other one.
  const pros = syn.pros.slice(0, 2);
  const cons = syn.cons.slice(0, MAX_NOTES - pros.length);
  const morePros = syn.pros.slice(pros.length, pros.length + MAX_NOTES - pros.length - cons.length);
  const notes: DuelNote[] = [
    ...[...pros, ...morePros].map((r): DuelNote => ({ sign: "+", tone: "better", text: r.detail })),
    ...cons.map((r): DuelNote => ({ sign: "−", tone: "worse", text: r.detail })),
  ];
  return {
    key: e.key,
    href: candidateHref(e.key),
    name: c.name,
    classId: c.classID,
    classColor: classHex(c.classID),
    iconUrl: token ? `https://wow.zamimg.com/images/wow/icons/medium/classicon_${token}.jpg` : null,
    initials: classInitials(c.classID),
    sub: rio === null ? t("compare.duel.sub", base) : t("compare.duel.subRio", { ...base, rio: rio.toFixed(0) }),
    verdict: { cls: v.cls, label: v.label, score: v.score },
    runs: t("compare.duel.runs", {
      level: String(ev.targetLevel),
      auto: p.targetAutoDetected ? t("compare.duel.auto") : "",
      runs: t("verdict.runsScored", { count: ev.runsUsed }),
    }),
    notes,
  };
}

/** The headline fact of an axis in the summary's gaps sentence; null when that fact is missing on either side. */
function headlineFact(t: T, locale: Locale, k: AxisKey, a: LookupPayload, b: LookupPayload): { fact: string; a: string; b: string } | null {
  const pair = (fa: string | null, fb: string | null) => (fa === null || fb === null ? null : { a: fa, b: fb });
  let values: { a: string; b: string } | null = null;
  if (k === "survival") {
    const f = (p: LookupPayload) => (p.summary.avgDeaths === null ? null : fixed1(locale, p.summary.avgDeaths));
    values = pair(f(a), f(b));
  } else if (k === "utility") {
    const f = (p: LookupPayload) => (p.summary.kicksDeltaPts === null ? null : t("compare.facts.pts", { v: signed(p.summary.kicksDeltaPts, 0) }));
    values = pair(f(a), f(b));
  } else if (k === "throughput") {
    const f = (p: LookupPayload) => t("cand.runs.pct", { v: p.perDungeon.medianParse.toFixed(0) });
    values = pair(f(a), f(b));
  } else if (k === "preparation") {
    const f = (p: LookupPayload) => (p.summary.ilvl === null ? null : fixed1(locale, p.summary.ilvl));
    values = pair(f(a), f(b));
  } else {
    return null;
  }
  return values && { fact: t(`compare.duel.axisFact.${k}`), ...values };
}

export function duelView(t: T, locale: Locale, entries: CompareEntry[], docs: SynthesisDocs): DuelView {
  const [ea, eb] = entries as [CompareEntry, CompareEntry];
  const a = ea.payload;
  const b = eb.payload;
  const ps = [a, b];
  const synA = synthesisView(t, locale, a.evaluation, docs, a.runsIndexed);
  const synB = synthesisView(t, locale, b.evaluation, docs, b.runsIndexed);
  const whyOf = (syn: typeof synA, k: AxisKey) => (syn.axes.find((x) => x.key === k)?.why ?? "").split(" · ")[0]!;

  const axes = AXIS_ORDER.map((k): MirrorRow => {
    const informational = informationalFor(docs, ps, k);
    const l = axisScore(a, k);
    const r = axisScore(b, k);
    let win: MirrorRow["win"];
    if (informational) win = { text: t("compare.duel.informational"), side: null };
    else if (l === null || r === null) win = { text: DASH, side: null };
    else if (Math.abs(l - r) <= TIE) win = { text: t("compare.duel.tie"), side: null };
    else if (l > r) win = { text: t("compare.duel.winLeft", { name: a.character.name, d: String(l - r) }), side: "left" };
    else win = { text: t("compare.duel.winRight", { name: b.character.name, d: String(r - l) }), side: "right" };
    const side = (score: number | null, wins: boolean, why: string): MirrorSide =>
      ({ score, text: score === null ? DASH : String(score), band: scoreBand(score), wins, why });
    return {
      key: k, name: axisTitle(t, k), informational,
      left: side(l, win.side === "left", whyOf(synA, k)),
      right: side(r, win.side === "right", whyOf(synB, k)),
      win,
    };
  });

  // The summary: who wins which counted axes, the verdicts, then the two largest real gaps through their headline facts.
  const sameTarget = a.evaluation.targetLevel === b.evaluation.targetLevel;
  const title = sameTarget ? t("compare.duel.summary.title", { level: String(a.evaluation.targetLevel) }) : t("compare.duel.summary.titlePlain");
  const counted = axes.filter((x) => !x.informational && x.left.score !== null && x.right.score !== null);
  const names = (side: "left" | "right") => listOf(locale, counted.filter((x) => x.win.side === side).map((x) => lower(locale, x.name)));
  const leftWins = counted.filter((x) => x.win.side === "left").length;
  const rightWins = counted.filter((x) => x.win.side === "right").length;
  const short = [a, b].find(insufficientOf);
  let lead: string;
  if (short) lead = t("compare.duel.summary.insufficient", { name: short.character.name });
  else if (leftWins && rightWins) lead = t("compare.duel.summary.both", { a: a.character.name, aAxes: names("left"), b: b.character.name, bAxes: names("right") });
  else if (!leftWins && !rightWins) lead = t("compare.duel.summary.none");
  else {
    const [who, side, n] = leftWins ? [a.character.name, "left" as const, leftWins] : [b.character.name, "right" as const, rightWins];
    lead = n === counted.length ? t("compare.duel.summary.all", { name: who }) : t("compare.duel.summary.some", { name: who, axes: names(side) });
  }
  const verdictWord = (p: LookupPayload) => verdictView(t, p.evaluation).label;
  const verdictLine = verdictWord(a) === verdictWord(b)
    ? t("compare.duel.summary.sameVerdict", { verdict: verdictWord(a) })
    : t("compare.duel.summary.verdicts", { a: a.character.name, va: verdictWord(a), b: b.character.name, vb: verdictWord(b) });
  const gaps = counted
    .filter((x) => Math.abs(x.left.score! - x.right.score!) > TIE)
    .sort((x, y) => Math.abs(y.left.score! - y.right.score!) - Math.abs(x.left.score! - x.right.score!))
    .slice(0, 2)
    .map((x) => {
      const f = headlineFact(t, locale, x.key, a, b);
      return f ? t("compare.duel.gap", f) : t("compare.duel.gap", { fact: lower(locale, x.name), a: x.left.text, b: x.right.text });
    });
  const gapLine = gaps.length === 0 ? null : t(gaps.length === 1 ? "compare.duel.summary.gapOne" : "compare.duel.summary.gapMany", { gaps: listOf(locale, gaps) });

  return {
    summary: { title, lead, detail: gapLine ? `${verdictLine} ${gapLine}` : verdictLine },
    warning: targetWarning(t, ps),
    heads: [duelHead(t, locale, ea, docs), duelHead(t, locale, eb, docs)],
    axes,
    facts: compareFacts(t, locale, ps),
    dungeons: dungeonCompare(t, locale, ps),
  };
}

// Ranking ---------------------------------------------------------------------------------------------------------------

export interface RankBar { key: AxisKey; short: string; value: number | null; band: Band; informational: boolean }
export interface RankCard {
  key: string; href: string; rank: number;
  /** The selection order, stable when the ranking changes: the column's `--series-n` square. */
  series: 1 | 2 | 3 | 4 | 5;
  name: string; classColor: string;
  /** "Elemental Shaman · Hyjal". */
  spec: string;
  /** "+18". */
  target: string;
  score: string | null; verdict: { cls: string; label: string };
  /** Rank 1: its border takes the verdict's border token. */
  top: boolean;
  bars: RankBar[];
  /** "Survival 80, Utility 80, …". */
  aria: string;
  /** "+ {first pro} · − {first con}", either part alone, the verdict summary when both are missing. */
  line: string;
}
export interface AxisGridRow {
  key: AxisKey; name: string; sub: string; informational: boolean;
  cells: { text: string; value: number | null; band: Band; best: boolean }[];
}
export interface RankingView {
  warning: string | null;
  cards: RankCard[];
  columns: { key: string; name: string; series: number }[];
  axes: AxisGridRow[];
  main: FactRow[];
  more: FactRow[];
  dungeons: DungeonCompareRow[];
}

/** The ranking's three headline facts (mockup F-Comparer-Multi); every other fact sits under a disclosure. */
const MAIN_FACTS: readonly FactId[] = ["rio", "parse", "recentTimed"];
const SUB_SIGNALS_SHOWN = 3;

export function rankingView(t: T, locale: Locale, entries: CompareEntry[], docs: SynthesisDocs): RankingView {
  // Global score descending, insufficient (null) last; ties keep the selection order.
  const ranked = entries
    .map((e, i) => ({ e, series: (i + 1) as RankCard["series"] }))
    .sort((x, y) => {
      const gx = insufficientOf(x.e.payload) ? null : x.e.payload.evaluation.global;
      const gy = insufficientOf(y.e.payload) ? null : y.e.payload.evaluation.global;
      if (gx === null || gy === null) return gx === gy ? 0 : gx === null ? 1 : -1;
      return gy - gx;
    });
  const ps = ranked.map((x) => x.e.payload);

  const cards = ranked.map(({ e, series }, i): RankCard => {
    const p = e.payload;
    const ev = p.evaluation;
    const v = verdictView(t, ev);
    const syn = synthesisView(t, locale, ev, docs, p.runsIndexed);
    const bars = AXIS_ORDER.map((k): RankBar => {
      const value = axisScore(p, k);
      return { key: k, short: t(`compare.multi.short.${k}`), value, band: scoreBand(value), informational: weightOf(docs, p, k) === 0 };
    });
    const pro = syn.pros[0]?.detail;
    const con = syn.cons[0]?.detail;
    const line = pro && con ? t("compare.multi.line", { pro, con })
      : pro ? t("compare.multi.linePro", { pro })
      : con ? t("compare.multi.lineCon", { con })
      : syn.verdict.summary;
    return {
      key: e.key,
      href: candidateHref(e.key),
      rank: i + 1,
      series,
      name: p.character.name,
      classColor: classHex(p.character.classID),
      spec: t("compare.multi.spec", { spec: specClass(t, p), realm: realmName(p.character.realmSlug) }),
      target: `+${ev.targetLevel}`,
      score: v.score,
      verdict: { cls: v.cls, label: v.label },
      top: i === 0,
      bars,
      aria: AXIS_ORDER.map((k, j) => `${axisTitle(t, k)} ${bars[j]!.value ?? DASH}`).join(", "),
      line,
    };
  });

  const axes = AXIS_ORDER.map((k): AxisGridRow => {
    const informational = informationalFor(docs, ps, k);
    const values = ps.map((p) => axisScore(p, k));
    const best = new Set(bestIndices(values, informational ? "none" : "higher"));
    const sources = (docs.subSignals?.[k] ?? []).slice(0, SUB_SIGNALS_SHOWN);
    return {
      key: k,
      name: axisTitle(t, k),
      sub: informational ? t("compare.duel.informational") : sources.map((s) => lower(locale, docs.titleOf(s))).join(", "),
      informational,
      cells: values.map((v, i) => ({ text: v === null ? DASH : String(v), value: v, band: scoreBand(v), best: best.has(i) })),
    };
  });

  const facts = compareFacts(t, locale, ps);
  return {
    warning: targetWarning(t, ps),
    cards,
    columns: ranked.map(({ e, series }) => ({ key: e.key, name: e.payload.character.name, series })),
    axes,
    main: MAIN_FACTS.map((id) => facts.find((f) => f.id === id)).filter((f): f is FactRow => f !== undefined),
    more: facts.filter((f) => !MAIN_FACTS.includes(f.id)),
    dungeons: dungeonCompare(t, locale, ps),
  };
}
