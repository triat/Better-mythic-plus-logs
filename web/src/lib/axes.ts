import type { AxisKey, AxisScore, Confidence, DocsResponse, Evaluation, Evidence, EvidenceSource, LookupPayload, Role } from "../types.ts";
import type { MessageKey, T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { signed } from "./format.ts";
import { AXIS_ORDER, axisTitle } from "./verdict.ts";

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

/** `toFixed` output localized: U+2212 for a negative, the decimal comma in French. Never groups thousands (the server does not). */
const localizeFixed = (locale: Locale, s: string): string => {
  const abs = s.startsWith("-") ? "−" + s.slice(1) : s;
  return locale === "fr" ? abs.replace(".", ",") : abs;
};
type ValueFormat = (locale: Locale, v: number) => string;
const fixed = (digits: number): ValueFormat => (locale, v) => localizeFixed(locale, v.toFixed(digits));
const signed0: ValueFormat = (_locale, v) => signed(v, 0);
/** `(r * 100).toFixed(0)` on the server. */
const pctFixed: ValueFormat = (locale, v) => localizeFixed(locale, (v * 100).toFixed(0));
/** `Math.round(r * 100)` on the server. */
const pctRound: ValueFormat = (locale, v) => localizeFixed(locale, String(Math.round(v * 100)));

/** How each source rounds its `value` — the same rounding the server's English label applies, so `evidenceText`
 * in English is byte-identical to `Evidence.label`. Passed to `t` as a string so the locale never re-rounds it. */
const VALUE_FORMAT: Record<EvidenceSource, ValueFormat> = {
  "survival.individualDeaths": fixed(1),
  "survival.wipeDeaths": fixed(1),
  "survival.avoidableVsPeers": signed0,
  "survival.dtpsVsPeers": signed0,
  "survival.groupDeaths": fixed(1),
  "survival.defensiveUsage": pctRound,
  "survival.avoidableDeaths": fixed(0),
  "utility.kicksVsPeers": signed0,
  "utility.kicksAbsolute": pctFixed,
  "utility.dispels": fixed(1),
  "throughput.medianParse": fixed(0),
  "throughput.parseAtTarget": fixed(0),
  "consistency.parseSpread": fixed(0),
  "consistency.deathsSpread": fixed(1),
  "consistency.damageSpread": fixed(0),
  "preparation.potions": fixed(1),
  "preparation.healthstones": fixed(1),
  "preparation.ilvlVsLevel": signed0,
  "experience.coverage": pctFixed,
  "experience.atTarget": pctFixed,
  "experience.medianVsTarget": signed0,
  "experience.activity": fixed(0),
  "experience.prevSeasonBonus": fixed(0),
};

const isKnownSource = (s: string): s is EvidenceSource => s in VALUE_FORMAT;

/**
 * The evidence line in the UI language, rebuilt from `value` / `extra` (message `evidence.<source>`). An unknown
 * source — or a payload saved before `value` existed — falls back to the server's English `label`.
 */
export function evidenceText(t: T, locale: Locale, e: Evidence): string {
  if (!isKnownSource(e.source) || typeof e.value !== "number") return e.label;
  const key = `evidence.${e.source}` as MessageKey;
  const out = t(key, { value: VALUE_FORMAT[e.source](locale, e.value), ...e.extra });
  return out === key ? e.label : out;
}

const view = (t: T, locale: Locale, e: AxisScore["evidence"][number]): EvidenceView => ({
  label: evidenceText(t, locale, e),
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
export function axisWeightLabel(t: T, axisWeights: DocsResponse["config"]["axisWeights"], key: AxisKey): string {
  const w = ROLES.map((r) => axisWeights[r][key]);
  const distinct = [...new Set(w)];
  const role = (r: Role) => t(`verdict.role.${r}`);
  if (distinct.length === 1) return w[0] === 0 ? t("verdict.weight.info") : t("verdict.weight.all", { w: fmt(w[0]!) });
  if (distinct.length === 3) return ROLES.map((r, i) => t("verdict.weight.each", { role: role(r), w: fmt(w[i]!) })).join(" · ");
  const common = distinct.find((v) => w.filter((x) => x === v).length === 2)!;
  const odd = ROLES.filter((_, i) => w[i] !== common);
  const same = ROLES.filter((_, i) => w[i] === common);
  const oddValue = w[ROLES.indexOf(odd[0]!)]!;
  return odd[0] === "dps"
    ? t("verdict.weight.dpsOdd", { odd: fmt(oddValue), common: fmt(common), others: same.map(role).join(t("verdict.weight.and")) })
    : t("verdict.weight.oneOdd", { common: fmt(common), role: role(odd[0]!), odd: fmt(oddValue) });
}

export const axisInfo = (t: T, d: Pick<DocsResponse, "docs" | "config">): Record<AxisKey, AxisInfo> =>
  Object.fromEntries(AXIS_ORDER.map((k) => [k, { description: d.docs.axes[k].summary, weight: axisWeightLabel(t, d.config.axisWeights, k) }])) as Record<AxisKey, AxisInfo>;

export function axisRows(t: T, locale: Locale, ev: Evaluation, info: Record<AxisKey, AxisInfo> | null = null): AxisRowModel[] {
  const byKey = new Map(ev.axes.map((a) => [a.key, a]));
  return AXIS_ORDER.map((key) => {
    const a = byKey.get(key);
    const sorted = [...(a?.evidence ?? [])].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const all = sorted.map((e) => view(t, locale, e));
    const score = a?.score ?? null;
    return {
      key,
      label: axisTitle(t, key),
      description: info?.[key].description ?? "",
      weight: info?.[key].weight ?? "…",
      score,
      confidence: score === null ? null : a?.confidence ?? null,
      top: all.slice(0, 2),
      all,
      note: score === null ? t("verdict.notEnough") : all.length === 0 ? t("verdict.noEvidence") : null,
      badge: key === "survival" && ev.analyzedRuns > 0 ? t("verdict.analyzed", { count: ev.analyzedRuns }) : null,
    };
  });
}

/** Six scores in AXIS_ORDER; null = not applicable. No prose, hence no `t`. */
export const radarPoints = (ev: Evaluation): (number | null)[] => {
  const byKey = new Map(ev.axes.map((a) => [a.key, a.score ?? null]));
  return AXIS_ORDER.map((key) => byKey.get(key) ?? null);
};

export interface HeroStat { label: string; value: string; sub?: string }

export function heroStats(t: T, p: LookupPayload): HeroStat[] {
  const out: HeroStat[] = [];
  const s = p.character.scoreTop;
  if (s) out.push({ label: t("verdict.stats.score", { metric: p.metric.toUpperCase() }), value: s.points.toFixed(0) });
  if (p.summary.ilvl !== null) out.push({ label: t("verdict.stats.ilvl"), value: String(Math.round(p.summary.ilvl)) });
  if (s) out.push({ label: t("verdict.stats.region"), value: `#${s.regionRank}` }, { label: t("verdict.stats.server"), value: `#${s.serverRank}` });
  if (p.summary.prevSeason) {
    out.push({ label: t("verdict.stats.prevSeason"), value: p.summary.prevSeason.all.toFixed(0), sub: t(`verdict.role.${p.summary.prevSeason.best.role}`) });
  }
  return out;
}
