// The candidate profile's Méthode tab (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 6, mockup docs/design/redesign/F-Methode.dc.html): how this player's verdict is built — the path, what each
// counted axis brings to the raw score, the axis cards with their signals against the role's average player, the
// raw → percentile curve with the verdict zones, and the rules. Weights, references, the curve and the thresholds
// all come from GET /api/docs; an axis whose role weight is 0 is informational and never part of the raw score.
import type { AxisKey, AxisScore, DocsResponse, Evaluation, Evidence, Role } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { shortValue } from "./drivers.ts";
import { fixed1 } from "./runList.ts";
import { signalHint } from "./signals.ts";
import { scoreBand, sourceTitleOf } from "./synthesis.ts";
import type { Band } from "./synthesis.ts";
import { AXIS_ORDER, axisTitle, verdictView } from "./verdict.ts";

export interface PathStep { label: string; value: string; sub: string }
/** An axis' contribution to the raw score: `pct` = w × score / Σw, so the parts sum to the raw score. */
export interface WaterfallPart { key: AxisKey; label: string; pct: number }
export interface SignalRow {
  name: string; hint: string | null; value: string; ref: string; weight: string; effect: string; tone: "better" | "worse" | "neutral";
  /** No data, scored as the role's average player (canvas "bmpl · Verdict à ton niveau", E option 2): the reason. */
  imputed?: string;
}
export interface AxisCard {
  key: AxisKey; name: string; weightLabel: string; confidence: string; score: string; band: Band; informational: boolean;
  signals: SignalRow[]; note: string | null;
  /** Under the table when a row is imputed: what "average" means there. */
  imputedNote: string | null;
}

/** Why a sub-signal had no data, per source; anything else reads "no data". */
type ImputedWhy = "parseAtTarget" | "medianParse" | "avoidableVsPeers" | "dtpsVsPeers" | "kicksVsPeers" | "kicksAbsolute" | "other";
const IMPUTED_WHY: Record<string, ImputedWhy> = {
  "throughput.parseAtTarget": "parseAtTarget",
  "throughput.medianParse": "medianParse",
  "survival.avoidableVsPeers": "avoidableVsPeers",
  "survival.dtpsVsPeers": "dtpsVsPeers",
  "utility.kicksVsPeers": "kicksVsPeers",
  "utility.kicksAbsolute": "kicksAbsolute",
};
export type ZoneVerdict = "invite" | "maybe" | "pass";
/** `points` the role's raw → percentile curve; `zones` on the final (y) axis; `raw` / `final` mark the player. */
export interface CurveView { points: [number, number][]; raw: number | null; final: number | null; zones: { verdict: ZoneVerdict; from: number; to: number }[] }
export interface MethodView {
  title: string;
  path: PathStep[];
  waterfallCaption: string;
  waterfall: WaterfallPart[];
  raw: string;
  final: string;
  axes: AxisCard[];
  curve: CurveView;
  rules: { invite: number; maybe: number; minRuns: number; high: number; medium: number };
  /** "player's value · average DPS · …", the axes section's legend. */
  axesLegend: string;
  /** "curve of the reference DPS". */
  curveSub: string;
  /** The curve's accessible name: where the player lands, or the bare curve without a verdict. */
  curveLabel: string;
  /** The rules' prose lines after the thresholds line (which the tab renders with coloured verdict words). */
  ruleLines: string[];
}

const DASH = "—";
/** Deep-dive sub-signals: shown, never counted in the score (validity spec 2026-10-27, decision 4). */
const DEEPDIVE_SOURCES = ["survival.defensiveUsage", "survival.avoidableDeaths"];

/**
 * The weighted mean of the axis scores with the role's weights, n/a axes left out of both sums — the same formula as
 * `globalScore` in src/evaluation/global.ts (the front cannot import it at runtime).
 */
export function rawScore(axes: AxisScore[], weights: Record<AxisKey, number>): number | null {
  let num = 0;
  let den = 0;
  for (const a of axes) {
    if (a.score === null) continue;
    const w = weights[a.key] ?? 0;
    num += w * a.score;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** "+16.0" / "−2.0" / "0.0", one decimal in the locale. */
const effectText = (locale: Locale, d: number): string => (d > 0 ? "+" : d < 0 ? "−" : "") + fixed1(locale, Math.abs(d));

export function methodView(t: T, locale: Locale, ev: Evaluation, docs: Pick<DocsResponse, "docs" | "config"> | null): MethodView | null {
  if (!docs) return null;
  const role: Role = ev.role;
  const cfg = docs.config;
  const weights = cfg.axisWeights[role];
  const titleOf = sourceTitleOf(t, docs);
  const known = (k: string): k is AxisKey => (AXIS_ORDER as readonly string[]).includes(k);
  const weightOf = (k: AxisKey): number => weights?.[k] ?? 0;
  // A payload saved before the Experience axis left may still carry it: AXIS_ORDER drops it.
  const axes = ev.axes.filter((a) => known(a.key));
  const scored = axes.filter((a) => a.score !== null && weightOf(a.key) > 0);
  const raw = rawScore(axes, weights);
  const insufficient = ev.verdict === "insufficient" || ev.global === null;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const roleWord = t(`cand.header.role.${role}`);
  const roleMany = t(`cand.method.roleMany.${role}`);
  const v = verdictView(t, ev);

  // Contributions in AXIS_ORDER: w × score / Σw over the scored counted axes (Σ parts = raw).
  const den = scored.reduce((n, a) => n + weightOf(a.key), 0);
  const waterfall: WaterfallPart[] = AXIS_ORDER.flatMap((k) => {
    const a = scored.find((x) => x.key === k);
    return a ? [{ key: k, label: axisTitle(t, k), pct: (weightOf(k) * a.score!) / den }] : [];
  });
  const countedKeys = AXIS_ORDER.filter((k) => weightOf(k) > 0);
  const infoKeys = AXIS_ORDER.filter((k) => weightOf(k) === 0 && axes.some((a) => a.key === k));
  const signals = axes.filter((a) => weightOf(a.key) > 0 && a.score !== null).reduce((n, a) => n + a.evidence.length, 0);
  const list = (keys: readonly AxisKey[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(keys.map((k) => axisTitle(t, k)));

  const path: PathStep[] = [
    { label: t("cand.method.path.runs"), value: String(ev.runsUsed), sub: t("cand.method.path.runsSub", { count: ev.runsUsed, level: ev.targetLevel }) },
    { label: t("cand.method.path.signals"), value: String(signals), sub: t("cand.method.path.signalsSub") },
    {
      label: t("cand.method.path.axes"),
      value: infoKeys.length ? `${scored.length} + ${infoKeys.length}` : String(scored.length),
      sub: infoKeys.length
        ? t("cand.method.path.axesSubInfo", { counted: scored.length, names: list(infoKeys), n: infoKeys.length })
        : t("cand.method.path.axesSub", { counted: scored.length }),
    },
    { label: t("cand.method.path.raw"), value: raw === null ? DASH : fixed1(locale, raw), sub: t("cand.method.path.rawSub", { role: t(`cand.method.roleOne.${role}`) }) },
    insufficient
      ? { label: t("cand.method.path.verdict"), value: DASH, sub: t("cand.method.path.verdictInsufficient", { min: cfg.verdict.minRuns }) }
      : { label: t("cand.method.path.verdict"), value: String(ev.global), sub: t("cand.method.path.verdictSub", { role: roleMany }) },
  ];

  const signalRow = (e: Evidence): SignalRow => {
    const ref = cfg.reference?.[role]?.[e.source];
    return {
      name: titleOf(e.source),
      hint: signalHint(t, e.source),
      value: typeof e.value === "number" ? shortValue(t, locale, e.source, e.value) : DASH,
      ref: ref ? shortValue(t, locale, e.source, ref.value) : DASH,
      weight: e.weight !== undefined ? `×${number.format(e.weight)}` : DASH,
      effect: effectText(locale, e.delta),
      tone: e.delta > 0 ? "better" : e.delta < 0 ? "worse" : "neutral",
    };
  };
  const imputedRow = (source: string): SignalRow => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    const ref = cfg.reference?.[role]?.[source];
    const w = cfg.axes?.[axis]?.subSignals?.[id]?.weights?.[role];
    return {
      name: titleOf(source),
      hint: null,
      value: t("cand.method.imputed.chip"),
      ref: ref ? shortValue(t, locale, source, ref.value) : DASH,
      weight: typeof w === "number" ? `×${number.format(w)}` : DASH,
      effect: effectText(locale, 0),
      tone: "neutral",
      imputed: t(`cand.method.imputed.why.${IMPUTED_WHY[source] ?? ("other" as const)}`, { level: String(ev.targetLevel - 1) }),
    };
  };
  const deepdiveNames = new Intl.ListFormat(locale, { type: "conjunction" })
    .format(DEEPDIVE_SOURCES.map((s) => titleOf(s).toLocaleLowerCase(locale)));
  const cards: AxisCard[] = AXIS_ORDER.filter((k) => axes.some((a) => a.key === k))
    // Heaviest first (the mockup's order), AXIS_ORDER among equals; informational axes last.
    .sort((x, y) => weightOf(y) - weightOf(x))
    .map((k): AxisCard => {
      const a = axes.find((x) => x.key === k)!;
      const w = weightOf(k);
      const informational = w === 0;
      const score = a.score === null ? null : Math.round(a.score);
      let note: string | null = null;
      if (score === null) note = t("verdict.notEnough");
      else if (informational) note = t("cand.method.infoNote");
      else if (k === "survival") note = t("cand.method.deepdiveNote", { names: deepdiveNames });
      return {
        key: k,
        name: axisTitle(t, k),
        weightLabel: informational ? t("cand.method.weightInfo") : t("cand.method.weight", { w: number.format(w) }),
        confidence: score === null ? DASH : t("cand.method.confidence", { c: t(`verdict.confidence.${a.confidence}`), count: ev.runsUsed }),
        score: score === null ? DASH : String(score),
        band: scoreBand(score),
        informational,
        signals: [...a.evidence.map(signalRow), ...(a.imputed ?? []).map(imputedRow)],
        note,
        imputedNote: (a.imputed ?? []).length > 0 ? t("cand.method.imputed.note") : null,
      };
    });

  const { invite, maybe, minRuns } = cfg.verdict;
  return {
    title: insufficient ? t("cand.method.titleInsufficient") : t("cand.method.title", { verdict: v.label, score: String(ev.global) }),
    path,
    waterfallCaption: t("cand.method.caption", {
      role: roleWord,
      weights: countedKeys.map((k) => t("cand.method.weightPart", { axis: axisTitle(t, k), w: number.format(weightOf(k)) })).join(", "),
    }),
    waterfall,
    raw: raw === null ? DASH : fixed1(locale, raw),
    final: insufficient ? DASH : String(ev.global),
    axes: cards,
    curve: {
      points: cfg.globalCurve[role],
      raw,
      final: insufficient ? null : ev.global,
      zones: [
        { verdict: "pass", from: 0, to: maybe },
        { verdict: "maybe", from: maybe, to: invite },
        { verdict: "invite", from: invite, to: 100 },
      ],
    },
    rules: { invite, maybe, minRuns, high: cfg.confidence.high, medium: cfg.confidence.medium },
    axesLegend: t("cand.method.axesLegend", { role: roleWord }),
    curveSub: t("cand.method.curveSub", { role: roleMany }),
    curveLabel: insufficient || raw === null
      ? t("cand.method.curveLabelNone", { role: roleMany })
      : t("cand.method.curveLabel", { raw: fixed1(locale, raw), score: String(ev.global), role: roleMany, verdict: v.label }),
    ruleLines: [
      ...(insufficient ? [] : [t("cand.method.rules.rank", { score: String(ev.global), role: roleMany })]),
      t("cand.method.rules.minRuns", { min: minRuns }),
      t("cand.method.rules.confidence", { high: cfg.confidence.high, medium: cfg.confidence.medium }),
      ...(infoKeys.length ? [t("cand.method.rules.info", { names: list(infoKeys), count: infoKeys.length })] : []),
    ],
  };
}

/** The Méthode curve drawn in a `w` × `h` plot area (SVG units, y down): mockup F-Methode, "Du score brut au verdict". */
export interface CurveGeometry {
  w: number;
  h: number;
  /** The raw score at the plot's left edge: the decade under the curve's first rise (and under the player). */
  xMin: number;
  path: string;
  zones: { verdict: ZoneVerdict; y: number; height: number; at: number }[];
  xTicks: { x: number; value: number }[];
  yTicks: { y: number; value: number }[];
  /** The player: x = the raw score, y = the verdict score; null without a verdict. `anchor` keeps the label inside. */
  marker: { x: number; y: number; anchor: "start" | "end"; verdict: ZoneVerdict } | null;
}

export function curveGeometry(c: CurveView, w = 560, h = 200): CurveGeometry {
  const pts = [...c.points].sort((a, b) => a[0] - b[0]);
  const rise = pts.find(([, y]) => y > 0)?.[0] ?? 0;
  const lowest = Math.min(rise - 5, c.raw ?? Infinity);
  const xMin = Math.max(0, Math.min(90, Math.floor(lowest / 10) * 10));
  const span = 100 - xMin;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const X = (x: number) => r1(((Math.min(100, Math.max(xMin, x)) - xMin) / span) * w);
  const Y = (y: number) => r1(h - (Math.min(100, Math.max(0, y)) / 100) * h);
  // The curve's value at xMin (linear between its two neighbours), then every point right of it.
  const at = (x: number): number => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      if (x <= x1) return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return pts[pts.length - 1]?.[1] ?? 0;
  };
  const shown: [number, number][] = pts.length ? [[xMin, at(xMin)], ...pts.filter(([x]) => x > xMin)] : [];
  const path = shown.map(([x, y], i) => `${i === 0 ? "M" : "L"}${X(x)},${Y(y)}`).join(" ");
  const step = span >= 60 ? 20 : 10;
  const xTicks: CurveGeometry["xTicks"] = [];
  for (let v = xMin; v <= 100; v += step) xTicks.push({ x: X(v), value: v });
  if (xTicks[xTicks.length - 1]?.value !== 100) xTicks.push({ x: X(100), value: 100 });
  const zones = [...c.zones].sort((a, b) => b.from - a.from)
    .map((z) => ({ verdict: z.verdict, y: Y(z.to), height: r1(Y(z.from) - Y(z.to)), at: z.from }));
  const yTicks = [100, ...[...c.zones].sort((a, b) => b.from - a.from).map((z) => z.from)].map((v) => ({ y: Y(v), value: v }));
  const marker = c.raw !== null && c.final !== null
    ? {
      x: X(c.raw), y: Y(c.final), anchor: X(c.raw) > w - 110 ? "end" as const : "start" as const,
      verdict: [...c.zones].sort((a, b) => b.from - a.from).find((z) => c.final! >= z.from)?.verdict ?? "pass",
    }
    : null;
  return { w, h, xMin, path, zones, xTicks, yTicks, marker };
}
