import type { LookupPayload, MPlusRun } from "../types.ts";
import { radarPoints } from "./axes.ts";
import { defensivesCell } from "./deepdive.ts";
import { deathsTone, fmtAmount, higherTone, lowerTone, parseTier, signed, toneClass } from "./format.ts";
import { AXIS_LABELS, AXIS_ORDER } from "./verdict.ts";

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

export interface CompareCell { text: string; cls: string; best: boolean }
export interface CompareRow { label: string; cells: CompareCell[] }
export interface CompareSection { title: string; rows: CompareRow[] }

const DASH = "—";
const cell = (text: string, cls = ""): Omit<CompareCell, "best"> => ({ text, cls });

function row(label: string, mode: Mode, values: (number | null)[], cells: Omit<CompareCell, "best">[]): CompareRow {
  const best = new Set(bestIndices(values, mode));
  return { label, cells: cells.map((c, i) => ({ ...c, best: best.has(i) })) };
}

const findRun = (p: LookupPayload, encounterID: number): MPlusRun | null =>
  p.perDungeon.runs.find((r) => r.encounterID === encounterID) ?? null;

export function compareSections(ps: LookupPayload[]): CompareSection[] {
  const evs = ps.map((p) => p.evaluation);
  const evaluation: CompareSection = {
    title: "Evaluation",
    rows: [
      row("Score", "higher", evs.map((ev) => ev.global), evs.map((ev) => cell(ev.global === null ? DASH : String(Math.round(ev.global))))),
      ...AXIS_ORDER.map((key, i) =>
        row(AXIS_LABELS[key], "higher", evs.map((ev) => radarPoints(ev)[i] ?? null),
          evs.map((ev) => { const s = radarPoints(ev)[i]; return s === null || s === undefined ? cell("n/a", "faint") : cell(String(Math.round(s))); })),
      ),
    ],
  };

  const sameMetric = ps.every((p) => p.metric === ps[0]!.metric);
  const sm = ps.map((p) => p.summary);
  const pd = ps.map((p) => p.perDungeon);
  const summary: CompareSection = {
    title: "Summary",
    rows: [
      row("Target level", "none", ps.map(() => null), ps.map((p) => cell(`+${p.targetLevel}${p.targetAutoDetected ? " auto" : ""}`))),
      row("Dungeons covered", "higher", pd.map((d) => d.dungeonsCovered), pd.map((d) => cell(`${d.dungeonsCovered}/${d.totalDungeonsInSeason}`))),
      row("Dungeons ≥ target", "higher", pd.map((d) => d.dungeonsAtOrAboveTarget), pd.map((d) => cell(`${d.dungeonsAtOrAboveTarget}/${d.totalDungeonsInSeason}`))),
      row("Median key level", "higher", pd.map((d) => d.medianLevel), pd.map((d) => cell(`+${d.medianLevel}`))),
      row(sameMetric ? `Median ${ps[0]!.metric.toUpperCase()}` : "Median output", sameMetric ? "higher" : "none",
        pd.map((d) => d.medianAmount ?? null),
        ps.map((p) => cell(p.perDungeon.medianAmount == null ? DASH : fmtAmount(p.perDungeon.medianAmount) + (sameMetric ? "" : ` ${p.metric}`)))),
      row("Median parse %", "higher", pd.map((d) => d.medianParse), pd.map((d) => cell(d.medianParse.toFixed(1) + "%", `tier-${parseTier(d.medianParse)}`))),
      row("Avg deaths", "lower", sm.map((s) => s.avgDeaths), sm.map((s) => (s.avgDeaths === null ? cell(DASH, "faint") : cell(s.avgDeaths.toFixed(1), toneClass(deathsTone(Math.round(s.avgDeaths))))))),
      row("Median Δ DTPS vs peers", "lower", sm.map((s) => s.dtpsDeltaPct), sm.map((s) => (s.dtpsDeltaPct === null ? cell(DASH, "faint") : cell(signed(s.dtpsDeltaPct, 0, "%"), toneClass(lowerTone(s.dtpsDeltaPct)))))),
      row("Timed (shown runs)", "higher", sm.map((s) => (s.timedShown === null || s.runsWithSignals === 0 ? null : s.timedShown / s.runsWithSignals)),
        sm.map((s) => (s.timedShown === null ? cell(DASH, "faint") : cell(`${s.timedShown}/${s.runsWithSignals}`)))),
      row("Avoidable dmg vs peers", "lower", sm.map((s) => s.avoidableDeltaPct), sm.map((s) => (s.avoidableDeltaPct === null ? cell(DASH, "faint") : cell(signed(s.avoidableDeltaPct, 0, "%"), toneClass(lowerTone(s.avoidableDeltaPct)))))),
      row("Kicks vs peers", "higher", sm.map((s) => s.kicksDeltaPts), sm.map((s) => (s.kicksDeltaPts === null ? cell(DASH, "faint") : cell(signed(s.kicksDeltaPts, 0, " pts"), toneClass(higherTone(s.kicksDeltaPts)))))),
      row("Defensives", "higher", ps.map((p) => defensivesCell(p).value), ps.map((p) => { const c = defensivesCell(p); return cell(c.text, c.value === null ? "faint" : ""); })),
      row("ilvl", "higher", sm.map((s) => s.ilvl), sm.map((s) => cell(s.ilvl === null ? DASH : String(Math.round(s.ilvl)), s.ilvl === null ? "faint" : ""))),
      row("RIO recent timed", "higher", sm.map((s) => (s.recentTotal === null || s.recentTotal === 0 || s.recentTimed === null ? null : s.recentTimed / s.recentTotal)),
        sm.map((s) => (s.recentTotal === null ? cell(DASH, "faint") : cell(`${s.recentTimed}/${s.recentTotal}`)))),
      row("Prev season", "higher", sm.map((s) => (s.prevSeason ? s.prevSeason.all : null)),
        sm.map((s) => (s.prevSeason ? cell(`${s.prevSeason.all.toFixed(0)} ${s.prevSeason.best.role}`) : cell("— no data (reroll?)", "faint")))),
      row("Best run prev-level", "higher", ps.map((p) => (p.prevLevelBest ? p.prevLevelBest.best.parsePercent : null)),
        ps.map((p) => (p.prevLevelBest ? cell(`+${p.prevLevelBest.level} · ${p.prevLevelBest.best.parsePercent.toFixed(0)}%`, `tier-${parseTier(p.prevLevelBest.best.parsePercent)}`) : cell(DASH, "faint")))),
    ],
  };

  const seasonDungeons = ps.map((p) => p.seasonDungeons).find((s) => s.length > 0) ?? [];
  const dungeonRows: CompareRow[] = [];
  for (const d of seasonDungeons) {
    const runs = ps.map((p) => findRun(p, d.id));
    if (runs.every((r) => r === null)) continue;
    dungeonRows.push(row(d.name, "higher", runs.map((r) => (r ? r.parsePercent : null)), runs.map((r) => {
      if (!r) return cell(DASH, "faint");
      const s = r.signals;
      let text = `+${r.keyLevel} · ${r.parsePercent.toFixed(0)}%`;
      if (s && !s.partial) text = (s.keystone.timed ? "✓ " : "✗ ") + text;
      if (s) {
        text += ` · ${s.deaths.count}d`;
        const peer = s.damageTaken.peer;
        if (peer && peer.median > 0) text += ` · ${signed(((s.damageTaken.dtps - peer.median) / peer.median) * 100, 0, "%")}`;
      }
      return cell(text, `tier-${parseTier(r.parsePercent)}`);
    })));
  }

  return [evaluation, summary, { title: "Per-dungeon (best run)", rows: dungeonRows }];
}
