import type { AxisKey, AxisScore, Confidence, Evaluation, LookupPayload } from "../types.ts";
import { signed } from "./format.ts";
import { AXIS_DESCRIPTIONS, AXIS_LABELS, AXIS_ORDER, AXIS_WEIGHTS } from "./verdict.ts";

export interface EvidenceView { label: string; delta: string; tone: "good" | "bad" }

export interface AxisRowModel {
  key: AxisKey;
  label: string;
  /** What the axis measures (AXIS_DESCRIPTIONS) and its verdict weight (AXIS_WEIGHTS). */
  description: string;
  weight: string;
  score: number | null;
  confidence: Confidence | null;
  /** Up to two strongest evidence entries (by |delta|). */
  top: EvidenceView[];
  all: EvidenceView[];
  note: string | null;
  badge: string | null;
}

const view = (e: AxisScore["evidence"][number]): EvidenceView => ({
  label: e.label,
  delta: signed(e.delta),
  tone: e.delta >= 0 ? "good" : "bad",
});

export function axisRows(ev: Evaluation): AxisRowModel[] {
  const byKey = new Map(ev.axes.map((a) => [a.key, a]));
  return AXIS_ORDER.map((key) => {
    const a = byKey.get(key);
    const sorted = [...(a?.evidence ?? [])].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const all = sorted.map(view);
    const score = a?.score ?? null;
    return {
      key,
      label: AXIS_LABELS[key],
      description: AXIS_DESCRIPTIONS[key],
      weight: AXIS_WEIGHTS[key],
      score,
      confidence: score === null ? null : a?.confidence ?? null,
      top: all.slice(0, 2),
      all,
      note: score === null ? "not enough data for this axis" : all.length === 0 ? "no evidence" : null,
      badge: key === "survival" && ev.analyzedRuns > 0 ? `${ev.analyzedRuns} run${ev.analyzedRuns === 1 ? "" : "s"} analyzed` : null,
    };
  });
}

export const radarPoints = (ev: Evaluation): (number | null)[] => axisRows(ev).map((r) => r.score);

export interface HeroStat { label: string; value: string; sub?: string }

export function heroStats(p: LookupPayload): HeroStat[] {
  const out: HeroStat[] = [];
  const s = p.character.scoreTop;
  if (s) out.push({ label: `${p.metric.toUpperCase()} score`, value: s.points.toFixed(0) });
  if (p.summary.ilvl !== null) out.push({ label: "ilvl", value: String(Math.round(p.summary.ilvl)) });
  if (s) out.push({ label: "region", value: `#${s.regionRank}` }, { label: "server", value: `#${s.serverRank}` });
  if (p.summary.prevSeason) out.push({ label: "prev season", value: p.summary.prevSeason.all.toFixed(0), sub: p.summary.prevSeason.best.role });
  return out;
}
