import type { LookupPayload } from "../types.ts";
import { deathsTone, fmtAmount, higherTone, lowerTone, parseTier, signed, toneClass } from "./format.ts";

export interface TileModel { label: string; value: string; cls: string; sub?: string; empty: boolean }

const DASH = "—";
const empty = (label: string, value = DASH): TileModel => ({ label, value, cls: "", empty: true });

export function tiles(p: LookupPayload): TileModel[] {
  const sm = p.summary;
  const pd = p.perDungeon;
  const out: TileModel[] = [];
  if (pd.runs.length > 0) {
    out.push({ label: `Median ${p.metric.toUpperCase()}`, value: fmtAmount(pd.medianAmount), cls: "", empty: false });
    out.push({ label: "Median parse", value: pd.medianParse.toFixed(1) + "%", cls: `tier-${parseTier(pd.medianParse)}`, empty: false });
  }
  out.push(sm.timedShown === null
    ? empty("Timed (shown)")
    : { label: "Timed (shown)", value: `${sm.timedShown}/${sm.runsWithSignals}`, cls: sm.timedShown === sm.runsWithSignals ? "tone-good" : "tone-warn", empty: false });
  if (sm.avgDeaths === null) out.push(empty("Avg deaths"));
  else {
    const t: TileModel = { label: "Avg deaths", value: sm.avgDeaths.toFixed(1), cls: toneClass(deathsTone(Math.round(sm.avgDeaths))), empty: false };
    if (sm.deathsInWipes) t.sub = `${sm.deathsInWipes} in wipes`;
    out.push(t);
  }
  out.push(sm.dtpsDeltaPct === null ? empty("Δ DTPS vs peers")
    : { label: "Δ DTPS vs peers", value: signed(sm.dtpsDeltaPct, 0, "%"), cls: toneClass(lowerTone(sm.dtpsDeltaPct)), empty: false });
  out.push(sm.avoidableDeltaPct === null ? empty("Avoidable vs peers")
    : { label: "Avoidable vs peers", value: signed(sm.avoidableDeltaPct, 0, "%"), cls: toneClass(lowerTone(sm.avoidableDeltaPct)), empty: false });
  out.push(sm.kicksDeltaPts === null ? empty("Kicks vs peers")
    : { label: "Kicks vs peers", value: signed(sm.kicksDeltaPts, 0, "pts"), cls: toneClass(higherTone(sm.kicksDeltaPts)), empty: false });
  out.push(sm.ilvl === null ? empty("ilvl") : { label: "ilvl", value: String(Math.round(sm.ilvl)), cls: "", empty: false });
  if (sm.recentTotal === null || sm.recentTimed === null) out.push(empty("RIO recent timed"));
  else {
    const ratio = sm.recentTotal === 0 ? null : sm.recentTimed / sm.recentTotal;
    const cls = ratio === null ? "" : ratio >= 0.8 ? "tone-good" : ratio < 0.5 ? "tone-bad" : "tone-warn";
    out.push({ label: "RIO recent timed", value: `${sm.recentTimed}/${sm.recentTotal}`, cls, empty: false });
  }
  out.push(sm.prevSeason
    ? { label: "Prev season", value: sm.prevSeason.all.toFixed(0), cls: "", sub: sm.prevSeason.best.role, empty: false }
    : empty("Prev season", "— no data (reroll?)"));
  return out;
}
