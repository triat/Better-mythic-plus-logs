// The season views of the self-review (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decisions
// 4 and 5, section "Numbers"): every stored run of a character, its cached raw report re-parsed and re-scored on each
// read, 0 WCL pts. Pure: the caller hands in the rows, a raw-report reader and a deep-dive reader.
import type { RunDefensives } from "../deepdive/types.ts";
import { evaluate } from "../evaluation/evaluate.ts";
import type { EvalPayload } from "../evaluation/inputs.ts";
import { pillarOf } from "../evaluation/pillars.ts";
import { PILLAR_KEYS, type Evaluation, type EvaluationConfig, type PillarKey, type PillarScore } from "../evaluation/types.ts";
import type { MPlusRun } from "../mplus.ts";
import type { Metric } from "../roles.ts";
import { median } from "../signals/peers.ts";
import type { SeasonRow } from "../signals/store.ts";
import { signalSummary } from "../signals/summary.ts";
import type { RawRunReport, RunSignals } from "../signals/types.ts";
import { parseRunSignals } from "../signals/wcl-run.ts";
import type { Region } from "../wow/regions.ts";
import { SYNC_RETRY_MS, rowToRun, type SyncState } from "./sync.ts";
import { weekOf } from "./weeks.ts";

export const RECENT_WEEKS = 4;
export const PAST_WEEKS = 4;
export const TREND_RECENT_WEEKS = 2;
export const TREND_BEFORE_WEEKS = 4;
export const MIN_WINDOW_RUNS = 3;
export const SAME_BAND = 3;
export const WEEKLY_BARS = 8;
export const WORK_ON_MAX = 3;
const TOP_DETAILS = 5;

export type PillarRecord = Record<PillarKey, number | null>;

export interface SeasonRunView {
  key: string;
  reportCode: string;
  fightID: number;
  encounterID: number;
  encounterName: string;
  keyLevel: number;
  startTime: number;
  durationMs: number | null;
  timed: boolean | null;
  parse: number;
  amount: number;
  metric: Metric;
  spec: string;
  affixes: number[];
  score: number;
  /** Game week (src/self/weeks.ts). */
  week: number;
  /** Its raw report is cached. */
  analysed: boolean;
  /** The last sync got no report from WCL; retried after 24 h. */
  failed: boolean;
  signals: RunSignals | null;
  /** The cached deep-dive of this run, if any. */
  analysis: RunDefensives | null;
  pillars: PillarRecord | null;
}

export interface WindowView { runs: number; pillars: PillarScore[]; global: number | null }

export interface PillarTrend {
  key: PillarKey;
  /** Median per-run score of the last 2 weeks minus the 4 before, rounded; null under 3 runs on a side. */
  delta: number | null;
  direction: "up" | "down" | "same" | null;
  /** Scored runs in the last 2 weeks (what "not enough runs" shows). */
  recentRuns: number;
  /** Median per-run score of each of the last 8 weeks, oldest first; null for a week without a run. */
  weekly: (number | null)[];
}

export interface WorkOnRow {
  source: string;
  pillar: PillarKey | null;
  /** Badge points vs the average player (negative: costs). */
  impact: number;
  value: number;
  reference: number;
  /** The English evidence line, for the CLI. */
  label: string;
  /** The same sub-signal over the 4 weeks before the window; null without 3 analysed runs there. */
  past: { value: number; change: "better" | "same" | "worse" } | null;
}

export interface DungeonDetails {
  /** Top five avoidable abilities over the dungeon's analysed runs, the rest in `avoidableOther`. */
  avoidable: { id: number; name: string; total: number }[];
  avoidableOther: number;
  avoidableTotal: number;
  /** The killing blow (newest killing hit, else the death's top ability) of each of the player's deaths. */
  killers: { ability: string; deaths: number }[];
  /** Enemy spells the group kicked at least once, most completed first. */
  casts: { id: number; name: string; attempts: number; completed: number; interrupted: number; mine: number }[];
}

export interface DungeonRow {
  encounterID: number;
  name: string;
  runs: number;
  analysed: number;
  pillars: PillarRecord;
  /** The badge score of the dungeon's analysed runs. */
  overall: number | null;
  best: { level: number; timed: boolean | null } | null;
  details: DungeonDetails;
}

export interface SeasonView {
  character: { name: string; realm: string; region: Region };
  zoneID: number;
  targetLevel: number;
  currentWeek: number;
  /** Last time a rankings fetch listed the character's runs. */
  checkedAt: number | null;
  state: SyncState;
  /** Newest first. */
  runs: SeasonRunView[];
  /** The last 4 game weeks; null under 3 analysed runs. */
  recent: WindowView | null;
  /** Every analysed run of the season; null under 3. */
  season: WindowView | null;
  trends: PillarTrend[];
  /** The window's costliest sub-signals vs the average player (at most 3); [] without a window. */
  workOn: WorkOnRow[];
  /** Worst overall first; a dungeon without an analysed run last. */
  dungeons: DungeonRow[];
}

export interface SeasonInput {
  character: { name: string; realm: string; region: Region };
  zoneID: number;
  targetLevel: number;
  now: number;
  /** Newest first (`Store.seasonRuns`). */
  rows: SeasonRow[];
  report: (code: string, fightID: number) => RawRunReport | null;
  analysis: (code: string, fightID: number) => RunDefensives | null;
  state: SyncState;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const record = (pillars: PillarScore[] | undefined): PillarRecord =>
  Object.fromEntries(PILLAR_KEYS.map((k) => [k, pillars?.find((p) => p.key === k)?.score ?? null])) as PillarRecord;

/** An evaluation payload over any set of runs: the lookup's engine, without Raider.IO (so no ilvl, no activity). */
export function payloadOf(runs: MPlusRun[], analyses: RunDefensives[], targetLevel: number, metric: Metric, totalDungeons: number): EvalPayload {
  const ranked = runs.filter((r) => r.parsePercent > 0).map((r) => r.parsePercent);
  return {
    metric,
    targetLevel,
    perDungeon: {
      runs,
      dungeonsCovered: new Set(runs.map((r) => r.encounterID)).size,
      totalDungeonsInSeason: totalDungeons,
      dungeonsAtOrAboveTarget: new Set(runs.filter((r) => r.keyLevel >= targetLevel).map((r) => r.encounterID)).size,
      medianLevel: median(runs.map((r) => r.keyLevel)) ?? 0,
      medianParse: median(ranked) ?? 0,
    },
    prevLevelBest: null,
    rio: null,
    summary: signalSummary(runs, null),
    deepdive: analyses,
  };
}

export function trendOf(recent: number[], before: number[]): { delta: number | null; direction: PillarTrend["direction"] } {
  if (recent.length < MIN_WINDOW_RUNS || before.length < MIN_WINDOW_RUNS) return { delta: null, direction: null };
  const delta = Math.round(median(recent)! - median(before)!);
  return { delta, direction: Math.abs(delta) <= SAME_BAND ? "same" : delta > 0 ? "up" : "down" };
}

/** Curve scores (higher is better for every sub-signal), so no per-signal direction table is needed. */
export const changeOf = (now: number, before: number): "better" | "same" | "worse" =>
  now - before > SAME_BAND ? "better" : now - before < -SAME_BAND ? "worse" : "same";

export function dungeonDetails(signals: RunSignals[]): DungeonDetails {
  const avoid = new Map<number, { id: number; name: string; total: number }>();
  const killers = new Map<string, number>();
  const casts = new Map<number, DungeonDetails["casts"][number]>();
  let other = 0;
  let total = 0;
  for (const s of signals) {
    const a = s.avoidableDamage;
    if (a) {
      total += a.total;
      other += a.other ?? 0;
      for (const x of a.abilities ?? []) {
        const cur = avoid.get(x.id) ?? { id: x.id, name: x.name, total: 0 };
        cur.total += x.total;
        avoid.set(x.id, cur);
      }
    }
    for (const d of s.deaths.events) {
      const ability = d.killingHits?.[0]?.ability ?? d.cause;
      if (ability) killers.set(ability, (killers.get(ability) ?? 0) + 1);
    }
    for (const c of s.interrupts.enemyCasts ?? []) {
      const cur = casts.get(c.id) ?? { id: c.id, name: c.name, attempts: 0, completed: 0, interrupted: 0, mine: 0 };
      cur.attempts += c.attempts;
      cur.completed += c.completed;
      cur.interrupted += c.interrupted;
      cur.mine += c.mine;
      casts.set(c.id, cur);
    }
  }
  const abilities = [...avoid.values()].sort((a, b) => b.total - a.total);
  return {
    avoidable: abilities.slice(0, TOP_DETAILS),
    avoidableOther: other + abilities.slice(TOP_DETAILS).reduce((s, a) => s + a.total, 0),
    avoidableTotal: total,
    killers: [...killers].map(([ability, deaths]) => ({ ability, deaths }))
      .sort((a, b) => b.deaths - a.deaths || a.ability.localeCompare(b.ability)).slice(0, TOP_DETAILS),
    casts: [...casts.values()].sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name)).slice(0, TOP_DETAILS),
  };
}

interface Item { run: MPlusRun; view: SeasonRunView }

export function seasonView(input: SeasonInput, cfg: EvaluationConfig): SeasonView {
  const { character, now } = input;
  const currentWeek = weekOf(character.region, now);
  const metric: Metric = input.rows[0]?.metric ?? "dps";
  const totalDungeons = new Set(input.rows.map((r) => r.encounterID)).size;
  const evalOf = (list: Item[], targetLevel: number): Evaluation =>
    evaluate(payloadOf(list.map((i) => i.run), list.flatMap((i) => (i.view.analysis ? [i.view.analysis] : [])), targetLevel, metric, totalDungeons), cfg);

  const items = input.rows.map((row): Item => {
    const raw = input.report(row.reportCode, row.fightID);
    const run = rowToRun(row);
    const signals = raw ? parseRunSignals(raw, character.name, { keyLevel: row.keyLevel, affixes: row.affixes, encounterID: row.encounterID }) : null;
    if (signals) run.signals = signals;
    const analysis = signals ? input.analysis(row.reportCode, row.fightID) : null;
    const view: SeasonRunView = {
      key: `${row.reportCode}:${row.fightID}`, reportCode: row.reportCode, fightID: row.fightID, encounterID: row.encounterID,
      encounterName: row.encounterName, keyLevel: row.keyLevel, startTime: row.startTime, durationMs: row.durationMs, timed: row.timed,
      parse: row.parse, amount: row.amount, metric: row.metric, spec: row.spec, affixes: row.affixes, score: row.score,
      week: weekOf(character.region, row.startTime),
      analysed: raw !== null,
      failed: raw === null && row.failedAt !== null && now - row.failedAt < SYNC_RETRY_MS,
      signals, analysis, pillars: null,
    };
    const item = { run, view };
    // A single run, at its own key level: the per-run score the trends and weekly bars are made of.
    if (signals) view.pillars = record(evalOf([item], row.keyLevel).pillars);
    return item;
  });

  const scored = items.filter((i) => i.view.signals !== null);
  const inWeeks = (from: number, to: number): Item[] => scored.filter((i) => i.view.week >= from && i.view.week <= to);
  const windowOf = (list: Item[]): { view: WindowView; ev: Evaluation } | null => {
    if (list.length < MIN_WINDOW_RUNS) return null;
    const ev = evalOf(list, input.targetLevel);
    return { ev, view: { runs: list.length, pillars: ev.pillars ?? [], global: ev.global } };
  };
  const recent = windowOf(inWeeks(currentWeek - RECENT_WEEKS + 1, currentWeek));
  const past = windowOf(inWeeks(currentWeek - RECENT_WEEKS - PAST_WEEKS + 1, currentWeek - RECENT_WEEKS));
  const season = windowOf(scored);

  const trends: PillarTrend[] = PILLAR_KEYS.map((key) => {
    const scores = (from: number, to: number): number[] => inWeeks(from, to).map((i) => i.view.pillars![key]).filter(isNum);
    const r = scores(currentWeek - TREND_RECENT_WEEKS + 1, currentWeek);
    const b = scores(currentWeek - TREND_RECENT_WEEKS - TREND_BEFORE_WEEKS + 1, currentWeek - TREND_RECENT_WEEKS);
    const weekly = Array.from({ length: WEEKLY_BARS }, (_, n) => {
      const w = currentWeek - WEEKLY_BARS + 1 + n;
      const m = median(scores(w, w));
      return m === null ? null : Math.round(m);
    });
    return { key, ...trendOf(r, b), recentRuns: r.length, weekly };
  });

  const evidenceOf = (ev: Evaluation | null, source: string) => ev?.axes.flatMap((a) => a.evidence).find((e) => e.source === source) ?? null;
  const workOn: WorkOnRow[] = !recent ? [] : (recent.ev.drivers ?? []).filter((d) => d.impact < 0).slice(0, WORK_ON_MAX).map((d) => {
    const nowE = evidenceOf(recent.ev, d.source);
    const pastE = evidenceOf(past?.ev ?? null, d.source);
    return {
      source: d.source, pillar: pillarOf(d.source), impact: d.impact, value: d.value, reference: d.reference, label: d.label,
      past: nowE && pastE && isNum(nowE.score) && isNum(pastE.score) ? { value: pastE.value, change: changeOf(nowE.score, pastE.score) } : null,
    };
  });

  const byEncounter = new Map<number, Item[]>();
  for (const i of items) byEncounter.set(i.view.encounterID, [...(byEncounter.get(i.view.encounterID) ?? []), i]);
  const dungeons: DungeonRow[] = [...byEncounter.values()].map((list) => {
    const withSig = list.filter((i) => i.view.signals !== null);
    const ev = withSig.length > 0 ? evalOf(withSig, input.targetLevel) : null;
    let best: Item | null = null;
    for (const i of list) {
      if (!best || i.view.keyLevel > best.view.keyLevel || (i.view.keyLevel === best.view.keyLevel && i.view.timed === true && best.view.timed !== true)) best = i;
    }
    return {
      encounterID: list[0]!.view.encounterID,
      name: list[0]!.view.encounterName,
      runs: list.length,
      analysed: withSig.length,
      pillars: record(ev?.pillars),
      overall: ev?.global ?? null,
      best: best ? { level: best.view.keyLevel, timed: best.view.timed } : null,
      details: dungeonDetails(withSig.map((i) => i.view.signals!)),
    };
  }).sort((a, b) => (a.overall ?? Number.POSITIVE_INFINITY) - (b.overall ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name));

  return {
    character, zoneID: input.zoneID, targetLevel: input.targetLevel, currentWeek,
    checkedAt: input.rows.length > 0 ? Math.max(...input.rows.map((r) => r.seenAt)) : null,
    state: input.state,
    runs: items.map((i) => i.view),
    recent: recent?.view ?? null,
    season: season?.view ?? null,
    trends, workOn, dungeons,
  };
}
