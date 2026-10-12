// The candidate profile's Donjons tab (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 6, mockup docs/design/redesign/F-Donjons.dc.html): one row per dungeon's best run with role-aware two-line
// cells tinted on the heat scale, the inline detail, and the notes strip that replaces the signal tiles on the
// candidate page. The figures are the run rows' (`runs.ts`, `runList.ts`) and the tiles' (`tiles.ts`) own.
import type { LookupPayload, MPlusRun, Role } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { analysisFor, panelModel } from "./deepdive.ts";
import { fmtAmount, higherTone, lowerTone, signed } from "./format.ts";
import type { ParseTier, Tone } from "./format.ts";
import { specWords } from "./profile.ts";
import { kickFigures, missingDungeons, vsPeers } from "./runs.ts";
import { clearTime, fixed1, parseCell, roleOf, signedPct, upgradeOf } from "./runList.ts";

export type HeatCls = `heat-${1 | 2 | 3 | 4 | 5}`;
/** A tinted cell; `cls` "" = no tint (no peer reference, no data). */
export interface Tint { text: string; cls: HeatCls | "" }
export interface DungeonRow {
  /** "<report code>:<fight id>", the `run` of the profile's URL state. */
  key: string;
  name: string;
  /** "3 Sept" or "3 Sept · Discipline" when the run was played in another spec than the profile's. */
  sub: string;
  level: string;
  upgrade: { text: string; timed: boolean } | null;
  time: string;
  /** "own / group". */
  deaths: Tint;
  /** Kicks (dispels for a healer): the count and its bar against the best dungeon; null without signals. */
  util: { text: string; barPct: number } | null;
  avoidable: Tint | null;
  dtps: Tint | null;
  /** `tier` null: the log is not ranked (WCL's 0 %). */
  parse: { text: string; tier: ParseTier | null; amount: string };
  /** The inline detail's facts. */
  facts: { label: string; value: string }[];
  note: string;
  analysed: boolean;
  hasSignals: boolean;
}
export interface DungeonNote { label: string; value: string; sub: string; tone: "better" | "worse" | "neutral" | `tier-${ParseTier}` }
export interface DungeonGridView {
  /** The utility column's header: "Kicks", or "Dispels" for a healer. */
  utilLabel: string;
  rows: DungeonRow[];
  notes: DungeonNote[];
  /** The footnote under the grid (what "peers" are, what the utility bar compares). */
  legend: string;
  missing: string[];
}

/**
 * A "vs peers" percentage on the heat scale, lower is better: ≤ −20 % → heat-5, ≤ −5 % → heat-4, < +20 % → heat-3
 * (neutral), < +50 % → heat-2, else heat-1.
 */
export const heatOfDelta = (d: number): HeatCls =>
  d <= -20 ? "heat-5" : d <= -5 ? "heat-4" : d < 20 ? "heat-3" : d < 50 ? "heat-2" : "heat-1";

/** Deaths on the heat scale: group ≥ 8 → heat-1, group ≥ 5 or any own death → heat-2, else neutral. */
export const heatOfDeaths = (own: number, group: number): HeatCls =>
  group >= 8 ? "heat-1" : group >= 5 || own > 0 ? "heat-2" : "heat-3";

const toDelta = (t: Tone): "better" | "worse" | "neutral" => (t === "good" ? "better" : t === "neutral" ? "neutral" : "worse");

const utilCount = (r: MPlusRun, role: Role): number | null =>
  r.signals ? (role === "healer" ? r.signals.dispels.count : r.signals.interrupts.count) : null;

const peerTint = (t: T, mine: number, peer: Parameters<typeof vsPeers>[1], raw: string): Tint => {
  const d = vsPeers(mine, peer);
  return d !== null ? { text: signedPct(t, d), cls: heatOfDelta(d) } : { text: raw, cls: "" };
};

function rowOf(t: T, locale: Locale, p: LookupPayload, r: MPlusRun, role: Role, best: number): DungeonRow {
  const s = r.signals;
  const metric = p.metric.toUpperCase();
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(r.startTime));
  const otherSpec = p.character.spec && r.spec && r.spec !== p.character.spec ? specWords(r.spec) : null;
  const parse = parseCell(t, locale, r.parsePercent);
  const amount = fmtAmount(r.amount);
  const pair = (a: string, b: string) => t("cand.dungeons.pair", { a, b });
  const amountParse = { label: t("cand.dungeons.fact.amountParse", { metric }), value: pair(amount, parse.text) };
  const analysis = analysisFor(p, r);
  let note = t("cand.dungeons.notAnalysed");
  if (analysis) {
    const m = panelModel(t, analysis);
    note = [m.majorsText, m.deathsHeadline].filter((x): x is string => x !== null).join(" · ");
  }
  const base = {
    key: `${r.reportCode}:${r.fightID}`,
    name: r.encounterName,
    sub: otherSpec ? pair(date, otherSpec) : date,
    level: `+${r.keyLevel}`,
    upgrade: upgradeOf(t, r),
    time: clearTime(r),
    parse: { text: parse.text, tier: parse.tier, amount },
    note,
    analysed: analysis !== null,
    hasSignals: s !== undefined,
  };
  if (!s) {
    return { ...base, deaths: { text: "—", cls: "" }, util: null, avoidable: null, dtps: null, facts: [amountParse] };
  }
  const deaths: Tint = {
    text: t("cand.dungeons.deaths", { own: s.deaths.count, group: s.deaths.groupTotal }),
    cls: heatOfDeaths(s.deaths.count, s.deaths.groupTotal),
  };
  const count = utilCount(r, role)!;
  const k = kickFigures(s.interrupts);
  const a = s.avoidableDamage;
  const avoidable = a ? peerTint(t, a.perMinute, a.peer, t("cand.run.perMin", { v: fmtAmount(a.perMinute) })) : null;
  const dtps = peerTint(t, s.damageTaken.dtps, s.damageTaken.peer, fmtAmount(s.damageTaken.dtps));
  const facts = [
    { label: t("cand.dungeons.fact.deaths"), value: deaths.text },
    role === "healer"
      ? { label: t("cand.dungeons.util.dispels"), value: String(s.dispels.count) }
      : { label: t("cand.dungeons.util.kicks"), value: k.cap !== null ? `${k.count}/${k.cap}` : String(k.count) },
    ...(avoidable ? [{ label: t("cand.dungeons.fact.avoidable"), value: avoidable.text }] : []),
    { label: t("cand.dungeons.fact.dtps"), value: dtps.text },
    amountParse,
    ...(s.consumables
      ? [{ label: t("cand.dungeons.fact.consumables"), value: pair(String(s.consumables.potions), String(s.consumables.healthstones)) }]
      : []),
  ];
  return {
    ...base,
    deaths,
    util: { text: String(count), barPct: best > 0 ? Math.round((count / best) * 100) : 0 },
    avoidable,
    dtps,
    facts,
  };
}

function notesOf(t: T, locale: Locale, p: LookupPayload, role: Role): DungeonNote[] {
  const sm = p.summary;
  const pd = p.perDungeon;
  const withSignals = pd.runs.filter((r) => r.signals !== undefined);
  const n = withSignals.length;
  const perRun = (v: number | null) => (v === null ? "—" : t("cand.dungeons.notes.perRun", { v: fixed1(locale, v) }));
  const mean = (f: (r: MPlusRun) => number) => (n > 0 ? withSignals.reduce((x, r) => x + f(r), 0) / n : null);
  const maxBy = (f: (r: MPlusRun) => number) => withSignals.reduce<MPlusRun | null>((m, r) => (m === null || f(r) > f(m) ? r : m), null);
  const join = (parts: (string | null)[]) => parts.filter((x): x is string => x !== null && x !== "").join(" · ");
  const metric = p.metric.toUpperCase();

  // 1 · Group deaths per run, the dungeon with the most, the timed count and Raider.IO's recent runs (the tiles').
  const groupOf = (r: MPlusRun) => r.signals!.deaths.groupTotal;
  const groupMean = mean(groupOf);
  const worst = maxBy(groupOf);
  const group: DungeonNote = {
    label: t("cand.dungeons.notes.groupDeaths"),
    value: perRun(groupMean),
    sub: join([
      worst && groupOf(worst) > 0
        ? t("cand.dungeons.notes.worst", { dungeon: worst.encounterName, level: worst.keyLevel, count: groupOf(worst) }) : null,
      sm.timedShown !== null ? t("cand.dungeons.notes.timed", { n: sm.timedShown, total: sm.runsWithSignals }) : null,
      sm.recentTotal !== null && sm.recentTimed !== null
        ? t("cand.dungeons.notes.rioRecent", { n: sm.recentTimed, total: sm.recentTotal }) : null,
    ]),
    tone: groupMean !== null && groupMean >= 5 ? "worse" : "neutral",
  };

  // 2 · Kicks (dispels for a healer) per run, the peak dungeon, the kicks' median gap vs peers (the tiles').
  const utilOf = (r: MPlusRun) => utilCount(r, role)!;
  const peak = maxBy(utilOf);
  const kicksVs = sm.kicksDeltaPts === null ? null : t("cand.dungeons.notes.kicksVsPeers", { delta: signed(sm.kicksDeltaPts, 0, "pts") });
  const util: DungeonNote = {
    label: t(role === "healer" ? "cand.dungeons.util.dispels" : "cand.dungeons.util.kicks"),
    value: perRun(mean(utilOf)),
    sub: join([peak ? t("cand.dungeons.notes.peak", { n: utilOf(peak), dungeon: peak.encounterName }) : null, kicksVs]),
    tone: role !== "healer" && sm.kicksDeltaPts !== null ? toDelta(higherTone(sm.kicksDeltaPts)) : "neutral",
  };

  // 3 · Own deaths per run, avoidable damage and DTPS vs peers (medians, the tiles'), the worst avoidable dungeon.
  let avoidable: string | null = null;
  if (sm.avoidableDeltaPct !== null) {
    const deltaOf = (r: MPlusRun) => (r.signals?.avoidableDamage ? vsPeers(r.signals.avoidableDamage.perMinute, r.signals.avoidableDamage.peer) : null);
    const outlier = withSignals.map((r) => ({ r, d: deltaOf(r) })).filter((x): x is { r: MPlusRun; d: number } => x.d !== null && x.d >= 20)
      .sort((x, y) => y.d - x.d)[0];
    avoidable = t("cand.dungeons.notes.avoidable", { delta: signedPct(t, sm.avoidableDeltaPct) })
      + (outlier && sm.avoidableDeltaPct < 20 ? t("cand.dungeons.notes.except", { dungeon: outlier.r.encounterName, delta: signedPct(t, outlier.d) }) : "");
  }
  const own: DungeonNote = {
    label: t("cand.dungeons.notes.ownDeaths"),
    value: perRun(sm.avgDeaths),
    sub: join([
      avoidable,
      sm.dtpsDeltaPct !== null ? t("cand.dungeons.notes.dtps", { delta: signedPct(t, sm.dtpsDeltaPct) }) : null,
      sm.deathsInWipes ? t("cand.dungeons.notes.wipes", { n: sm.deathsInWipes }) : null,
    ]),
    tone: sm.avoidableDeltaPct !== null ? toDelta(lowerTone(sm.avoidableDeltaPct)) : "neutral",
  };

  // 4 · Median parse and amount (the tiles'), last in line for a healer.
  const parse = pd.runs.length > 0 ? parseCell(t, locale, pd.medianParse) : null;
  const median: DungeonNote = {
    label: t("cand.dungeons.notes.medianParse", { metric }),
    value: parse?.text ?? "—",
    sub: join([
      pd.runs.length > 0 ? t("cand.dungeons.notes.medianAmount", { metric, amount: fmtAmount(pd.medianAmount) }) : null,
      role === "healer" ? t("cand.dungeons.notes.healer") : null,
    ]),
    tone: parse?.tier ? `tier-${parse.tier}` : "neutral",
  };
  return [group, util, own, median];
}

export function dungeonGrid(t: T, locale: Locale, p: LookupPayload): DungeonGridView {
  const runs = p.perDungeon.runs;
  const role: Role = p.evaluation?.role ?? (runs[0] ? roleOf(p, runs[0]) : "dps");
  const best = Math.max(0, ...runs.map((r) => utilCount(r, role) ?? 0));
  const utilLabel = t(role === "healer" ? "cand.dungeons.util.dispels" : "cand.dungeons.util.kicks");
  return {
    utilLabel,
    rows: [...runs].sort((a, b) => b.keyLevel - a.keyLevel || b.parsePercent - a.parsePercent)
      .map((r) => rowOf(t, locale, p, r, role, best)),
    notes: notesOf(t, locale, p, role),
    legend: t("cand.dungeons.legend", { util: utilLabel.toLocaleLowerCase(locale) }),
    missing: missingDungeons(p),
  };
}
