import type { AxisKey, AxisScore, Confidence, DocsResponse, Evaluation, LookupPayload, Role } from "../types.ts";
import { signed } from "./format.ts";
import { AXIS_LABELS, AXIS_ORDER } from "./verdict.ts";

export interface EvidenceView { label: string; delta: string; tone: "good" | "bad"; source: string }

export interface AxisRowModel {
  key: AxisKey;
  label: string;
  /** What the axis measures and its verdict weight — from GET /api/docs (`axisInfo`); placeholders until it arrives. */
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
  source: e.source,
});

/** The "What's measured" callout text per axis: the registry's summary and the live axis weight. */
export interface AxisInfo { description: string; weight: string }

const ROLES: readonly Role[] = ["dps", "healer", "tank"];
const fmt = (n: number): string => String(n);

/**
 * "weight 3 for every role" / "weight 2 (healer 2.5)" / "weight 3 for dps, 2 for healer and tank" /
 * "dps 1 · healer 2 · tank 3" / "weight 0 · informational" — from the effective `axisWeights`, never a literal.
 */
export function axisWeightLabel(axisWeights: DocsResponse["config"]["axisWeights"], key: AxisKey): string {
  const w = ROLES.map((r) => axisWeights[r][key]);
  const distinct = [...new Set(w)];
  if (distinct.length === 1) return w[0] === 0 ? "weight 0 · informational" : `weight ${fmt(w[0]!)} for every role`;
  if (distinct.length === 3) return ROLES.map((r, i) => `${r} ${fmt(w[i]!)}`).join(" · ");
  const common = distinct.find((v) => w.filter((x) => x === v).length === 2)!;
  const odd = ROLES.filter((_, i) => w[i] !== common);
  const same = ROLES.filter((_, i) => w[i] === common);
  const oddValue = w[ROLES.indexOf(odd[0]!)]!;
  return odd[0] === "dps"
    ? `weight ${fmt(oddValue)} for dps, ${fmt(common)} for ${same.join(" and ")}`
    : `weight ${fmt(common)} (${odd[0]} ${fmt(oddValue)})`;
}

export const axisInfo = (d: Pick<DocsResponse, "docs" | "config">): Record<AxisKey, AxisInfo> =>
  Object.fromEntries(AXIS_ORDER.map((k) => [k, { description: d.docs.axes[k].summary, weight: axisWeightLabel(d.config.axisWeights, k) }])) as Record<AxisKey, AxisInfo>;

export function axisRows(ev: Evaluation, info: Record<AxisKey, AxisInfo> | null = null): AxisRowModel[] {
  const byKey = new Map(ev.axes.map((a) => [a.key, a]));
  return AXIS_ORDER.map((key) => {
    const a = byKey.get(key);
    const sorted = [...(a?.evidence ?? [])].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const all = sorted.map(view);
    const score = a?.score ?? null;
    return {
      key,
      label: AXIS_LABELS[key],
      description: info?.[key].description ?? "",
      weight: info?.[key].weight ?? "…",
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
