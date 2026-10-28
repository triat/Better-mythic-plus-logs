// The candidate profile's Synthèse tab (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 6, mockup docs/design/redesign/F-Synthese.dc.html): the verdict block, "what would flip it", strengths and
// weaknesses, the informational axes and the axes table. An axis whose role weight is 0 is informational: never a
// strength, a weakness or a step towards the next verdict.
import type { AxisKey, AxisScore, DocsResponse, Driver, Evaluation, Evidence, Role } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { evidenceText } from "./axes.ts";
import { driverValues } from "./drivers.ts";
import { signalHint, signalName } from "./signals.ts";
import { AXIS_ORDER, axisTitle, verdictView } from "./verdict.ts";

const MAX_PROS = 4;
const MAX_CONS = 5;
const MAX_SUMMARY = 2;
/** |impact| in badge points that fills a strength / weakness bar. */
const FULL_BAR_POINTS = 10;

/** The narrow pieces of GET /api/docs the tab reads (`synthesisDocs` picks them). */
export interface SynthesisDocs {
  titleOf: (source: string) => string;
  axisWeights: DocsResponse["config"]["axisWeights"];
  verdict: Pick<DocsResponse["config"]["verdict"], "invite" | "maybe" | "minRuns">;
  confidence: Pick<DocsResponse["config"]["confidence"], "high">;
  /** Each axis's sub-signals in registry order ("survival.individualDeaths" …), for the Compare ranking's axis lines. */
  subSignals?: Partial<Record<AxisKey, readonly string[]>>;
}

/**
 * A sub-signal's name in the UI language ("survival.individualDeaths" → "Deaths outside wipes", `lib/signals.ts`),
 * then the registry's title, then the source itself when unknown.
 */
export const sourceTitleOf = (t: T, d: Pick<DocsResponse, "docs"> | null) => (source: string): string => signalName(t, source, d);

export const synthesisDocs = (t: T, d: Pick<DocsResponse, "docs" | "config">): SynthesisDocs => ({
  titleOf: sourceTitleOf(t, d),
  axisWeights: d.config.axisWeights,
  verdict: d.config.verdict,
  confidence: d.config.confidence,
  subSignals: Object.fromEntries(
    Object.entries(d.docs.axes).map(([axis, a]) => [axis, Object.keys(a?.subSignals ?? {}).map((id) => `${axis}.${id}`)]),
  ) as Partial<Record<AxisKey, readonly string[]>>,
});

export interface VerdictBlock {
  cls: string;
  label: string;
  score: string | null;
  /** "for a +11". */
  target: string;
  /** "Verdict for a +11". */
  title: string;
  barPct: number | null;
  /** The MAYBE and INVITE ticks on the 0–100 bar. */
  thresholds: { label: string; at: number }[];
  summary: string;
  confidence: string | null;
}
export interface FlipRow { name: string; hint: string | null; gain: string; gap: string }
export interface FlipView { title: string; rows: FlipRow[]; reachable: boolean; note: string | null }
/** A strength or a weakness: `detail` is the evidence line, `avg` the average player's value it is measured against. */
export interface ForceRow { name: string; hint: string | null; pts: string; axis: string; detail: string; avg: string; widthPct: number }
export type Band = "better" | "neutral" | "worse";
export interface AxisLine { key: AxisKey; name: string; score: number | null; band: Band; why: string; informational: boolean }
export interface SynthesisView {
  verdict: VerdictBlock;
  flip: FlipView | null;
  pros: ForceRow[];
  cons: ForceRow[];
  informational: { name: string; text: string }[];
  axes: AxisLine[];
}

/** A score bar's colour: blue ≥ 70, neutral 50–69, orange < 50 (spec "Colour meanings"). */
export const scoreBand = (score: number | null): Band =>
  score === null ? "neutral" : score >= 70 ? "better" : score >= 50 ? "neutral" : "worse";

/** "+4" / "−10": a driver's whole badge points. */
const signedPts = (n: number): string => (n < 0 ? "−" : "+") + Math.abs(Math.round(n));

const axisOf = (source: string): string => source.split(".")[0]!;

export function synthesisView(t: T, locale: Locale, ev: Evaluation, docs: SynthesisDocs, runsIndexed: number): SynthesisView {
  const role: Role = ev.role;
  const known = (k: string): k is AxisKey => (AXIS_ORDER as readonly string[]).includes(k);
  const weight = (k: AxisKey): number => docs.axisWeights[role]?.[k] ?? 0;
  const counted = (k: string): boolean => known(k) && weight(k) > 0;
  // A payload saved before the Experience axis left may still carry it: AXIS_ORDER drops it.
  const byKey = new Map<AxisKey, AxisScore>(ev.axes.filter((a) => known(a.key)).map((a) => [a.key, a]));
  const text = (e: Evidence) => evidenceText(t, locale, e);
  const topTexts = (a: AxisScore | undefined): string[] =>
    [...(a?.evidence ?? [])].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 2).map(text);

  // Strengths and weaknesses: the drivers, each signal's effect on the badge against the role's average player (the same
  // reference as "what would flip it", user 2026-10-28), on the counted axes, largest first. A signal less than a point
  // away from the average player is neither: an item level 7 above the expected one is no strength when the average
  // player is 8 above it.
  const evidenceOf = new Map([...byKey.values()].flatMap((a) => a.evidence.map((e) => [e.source, e] as const)));
  const drivers = (ev.drivers ?? []).filter((d) => counted(axisOf(d.source)));
  const force = (d: Driver): ForceRow => {
    const e = evidenceOf.get(d.source);
    const { value, reference } = driverValues(t, locale, d);
    return {
      name: docs.titleOf(d.source),
      hint: signalHint(t, d.source),
      pts: signedPts(d.impact),
      axis: axisTitle(t, axisOf(d.source) as AxisKey),
      detail: e ? text(e) : value,
      avg: reference,
      widthPct: Math.min(100, Math.round((Math.abs(d.impact) / FULL_BAR_POINTS) * 100)),
    };
  };
  const pros = drivers.filter((d) => d.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, MAX_PROS).map(force);
  const cons = drivers.filter((d) => d.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, MAX_CONS).map(force);

  const insufficient = ev.verdict === "insufficient" || ev.global === null;
  const v = verdictView(t, ev);
  const list = (rows: ForceRow[]) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(rows.slice(0, MAX_SUMMARY).map((r) => r.name.toLocaleLowerCase(locale)));
  const summary = insufficient ? t("cand.synth.summary.insufficient", { min: docs.verdict.minRuns })
    : pros.length && cons.length ? t("cand.synth.summary.both", { pros: list(pros), cons: list(cons) })
    : pros.length ? t("cand.synth.summary.pros", { pros: list(pros) })
    : cons.length ? t("cand.synth.summary.cons", { cons: list(cons) })
    : t("cand.synth.summary.none");
  const low = !insufficient && ev.runsUsed < docs.confidence.high;
  const confidence = runsIndexed === 0 ? null
    : t(low ? "cand.synth.confidence.scoredLow" : "cand.synth.confidence.scored", { count: ev.runsUsed, indexed: runsIndexed });
  const level = String(ev.targetLevel);
  const verdict: VerdictBlock = {
    cls: v.cls,
    label: v.label,
    score: v.score,
    target: t("cand.header.target", { level }),
    title: t("cand.synth.verdictFor", { level }),
    barPct: insufficient ? null : Math.max(0, Math.min(100, ev.global!)),
    thresholds: [
      { label: `${t("verdict.words.maybe")} ${docs.verdict.maybe}`, at: docs.verdict.maybe },
      { label: `${t("verdict.words.invite")} ${docs.verdict.invite}`, at: docs.verdict.invite },
    ],
    summary,
    confidence,
  };

  return {
    verdict,
    flip: insufficient ? null : flipView(t, locale, ev, docs),
    pros,
    cons,
    informational: AXIS_ORDER.filter((k) => !counted(k) && byKey.get(k)?.score != null && byKey.get(k)!.evidence.length > 0)
      .map((k) => ({ name: axisTitle(t, k), text: t("cand.synth.info", { why: topTexts(byKey.get(k)).join(" · ") }) })),
    axes: AXIS_ORDER.map((key): AxisLine => {
      const a = byKey.get(key);
      const score = a?.score == null ? null : Math.round(a.score);
      const why = topTexts(a);
      return {
        key,
        name: axisTitle(t, key),
        score,
        band: scoreBand(score),
        why: score === null ? t("verdict.notEnough") : why.length ? why.join(" · ") : t("verdict.noEvidence"),
        informational: !counted(key),
      };
    }),
  };
}

/** The drivers on the shortest path to the next verdict, in its order, without weight-0 or unknown axes. */
export function flipDrivers(ev: Evaluation, docs: Pick<SynthesisDocs, "axisWeights">): Driver[] {
  const counted = (k: string): boolean => (AXIS_ORDER as readonly string[]).includes(k) && (docs.axisWeights[ev.role]?.[k as AxisKey] ?? 0) > 0;
  return (ev.nextVerdict?.sources ?? []).flatMap((source) => {
    const d = (ev.drivers ?? []).find((x) => x.source === source);
    return d && counted(axisOf(source)) ? [d] : [];
  });
}

/** "To reach INVITE: +11 pts" and one row per source of the shortest path; null for INVITE (no next verdict). */
function flipView(t: T, locale: Locale, ev: Evaluation, docs: SynthesisDocs): FlipView | null {
  const nv = ev.nextVerdict;
  if (!nv || ev.global === null) return null;
  const rows = flipDrivers(ev, docs).map((d): FlipRow => {
    const axis = axisOf(d.source) as AxisKey;
    const { value, reference } = driverValues(t, locale, d);
    return {
      name: docs.titleOf(d.source),
      hint: signalHint(t, d.source),
      gain: t("cand.synth.flip.gain", { axis: axisTitle(t, axis), pts: String(Math.abs(Math.round(d.impact))) }),
      gap: t("cand.synth.flip.gap", { value, reference }),
    };
  });
  if (rows.length === 0) return null;
  return {
    title: t("cand.synth.flip.title", { verdict: t(`verdict.words.${nv.verdict}`), pts: String(Math.max(0, nv.threshold - Math.round(ev.global))) }),
    rows,
    reachable: nv.reachable,
    note: nv.reachable ? null : t("cand.synth.flip.out", { count: rows.length }),
  };
}
