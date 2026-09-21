import type { LookupPayload } from "../types.ts";
import type { T } from "../i18n/t.ts";
import { deathsTone, fmtAmount, higherTone, lowerTone, parseTier, signed, toneClass } from "./format.ts";

export interface TileModel { label: string; value: string; cls: string; sub?: string; empty: boolean }

const DASH = "—";
const empty = (label: string, value = DASH): TileModel => ({ label, value, cls: "", empty: true });

export function tiles(t: T, p: LookupPayload): TileModel[] {
  const sm = p.summary;
  const pd = p.perDungeon;
  const out: TileModel[] = [];
  if (pd.runs.length > 0) {
    out.push({ label: t("tiles.median", { metric: p.metric.toUpperCase() }), value: fmtAmount(pd.medianAmount), cls: "", empty: false });
    out.push({ label: t("tiles.medianParse"), value: pd.medianParse.toFixed(1) + "%", cls: `tier-${parseTier(pd.medianParse)}`, empty: false });
  }
  out.push(sm.timedShown === null
    ? empty(t("tiles.timed"))
    : { label: t("tiles.timed"), value: `${sm.timedShown}/${sm.runsWithSignals}`, cls: sm.timedShown === sm.runsWithSignals ? "tone-good" : "tone-warn", empty: false });
  if (sm.avgDeaths === null) out.push(empty(t("tiles.avgDeaths")));
  else {
    const tile: TileModel = { label: t("tiles.avgDeaths"), value: sm.avgDeaths.toFixed(1), cls: toneClass(deathsTone(Math.round(sm.avgDeaths))), empty: false };
    if (sm.deathsInWipes) tile.sub = t("tiles.inWipes", { n: sm.deathsInWipes });
    out.push(tile);
  }
  out.push(sm.dtpsDeltaPct === null ? empty(t("tiles.dtps"))
    : { label: t("tiles.dtps"), value: signed(sm.dtpsDeltaPct, 0, "%"), cls: toneClass(lowerTone(sm.dtpsDeltaPct)), empty: false });
  out.push(sm.avoidableDeltaPct === null ? empty(t("tiles.avoidable"))
    : { label: t("tiles.avoidable"), value: signed(sm.avoidableDeltaPct, 0, "%"), cls: toneClass(lowerTone(sm.avoidableDeltaPct)), empty: false });
  out.push(sm.kicksDeltaPts === null ? empty(t("tiles.kicks"))
    : { label: t("tiles.kicks"), value: signed(sm.kicksDeltaPts, 0, "pts"), cls: toneClass(higherTone(sm.kicksDeltaPts)), empty: false });
  out.push(sm.ilvl === null ? empty(t("tiles.ilvl")) : { label: t("tiles.ilvl"), value: String(Math.round(sm.ilvl)), cls: "", empty: false });
  if (sm.recentTotal === null || sm.recentTimed === null) out.push(empty(t("tiles.rioRecent")));
  else {
    const ratio = sm.recentTotal === 0 ? null : sm.recentTimed / sm.recentTotal;
    const cls = ratio === null ? "" : ratio >= 0.8 ? "tone-good" : ratio < 0.5 ? "tone-bad" : "tone-warn";
    out.push({ label: t("tiles.rioRecent"), value: `${sm.recentTimed}/${sm.recentTotal}`, cls, empty: false });
  }
  out.push(sm.prevSeason
    ? { label: t("tiles.prevSeason"), value: sm.prevSeason.all.toFixed(0), cls: "", sub: t(`verdict.role.${sm.prevSeason.best.role}`), empty: false }
    : empty(t("tiles.prevSeason"), t("tiles.noData")));
  return out;
}
