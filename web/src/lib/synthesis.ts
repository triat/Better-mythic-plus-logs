// The candidate profile's Synthèse tab (redesign phase 2, spec docs/superpowers/specs/2026-10-11-ui-redesign-design.md
// decision 6, mockup docs/design/redesign/F-Synthese.dc.html): the verdict block, "what would flip it", strengths and
// weaknesses, the informational axes and the axes table. An axis whose role weight is 0 is informational: never a
// strength, a weakness or a step towards the next verdict.
import type { AxisKey, AxisScore, DocsResponse, Evaluation, Evidence, Role } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { evidenceText } from "./axes.ts";
import { driverValues } from "./drivers.ts";
import { AXIS_ORDER, axisTitle, verdictView } from "./verdict.ts";

const MAX_PROS = 4;
const MAX_CONS = 5;
const MAX_SUMMARY = 2;
/** |delta| that fills a strength / weakness bar. */
const FULL_BAR_DELTA = 20;

/** The narrow pieces of GET /api/docs the tab reads (`synthesisDocs` picks them). */
export interface SynthesisDocs {
  titleOf: (source: string) => string;
  axisWeights: DocsResponse["config"]["axisWeights"];
  verdict: Pick<DocsResponse["config"]["verdict"], "invite" | "maybe" | "minRuns">;
  confidence: Pick<DocsResponse["config"]["confidence"], "high">;
}

/** A sub-signal's title from the registry ("survival.individualDeaths" → "Individual deaths"), the source itself when unknown. */
export const sourceTitleOf = (d: Pick<DocsResponse, "docs">) => (source: string): string => {
  const [axis, id] = source.split(".") as [AxisKey, string];
  return d.docs.axes[axis]?.subSignals[id]?.title ?? source;
};

export const synthesisDocs = (d: Pick<DocsResponse, "docs" | "config">): SynthesisDocs => ({
  titleOf: sourceTitleOf(d),
  axisWeights: d.config.axisWeights,
  verdict: d.config.verdict,
  confidence: d.config.confidence,
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
export interface FlipRow { name: string; gain: string; gap: string }
export interface FlipView { title: string; rows: FlipRow[]; reachable: boolean; note: string | null }
export interface ForceRow { name: string; pts: string; axis: string; detail: string; widthPct: number }
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

/** "+9.2" / "−10.3", one decimal, the decimal comma in French. */
const signedPts = (locale: Locale, n: number): string => {
  const s = (n < 0 ? "−" : "+") + Math.abs(n).toFixed(1);
  return locale === "fr" ? s.replace(".", ",") : s;
};

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

  // Strengths and weaknesses: the counted axes' evidence, largest effect first.
  const evidence = [...byKey.values()].filter((a) => counted(a.key) && a.score !== null).flatMap((a) => a.evidence.map((e) => ({ e, axis: a.key })));
  const force = ({ e, axis }: { e: Evidence; axis: AxisKey }): ForceRow => ({
    name: docs.titleOf(e.source),
    pts: signedPts(locale, e.delta),
    axis: axisTitle(t, axis),
    detail: text(e),
    widthPct: Math.min(100, Math.round((Math.abs(e.delta) / FULL_BAR_DELTA) * 100)),
  });
  const pros = evidence.filter((x) => x.e.delta > 0).sort((a, b) => b.e.delta - a.e.delta).slice(0, MAX_PROS).map(force);
  const cons = evidence.filter((x) => x.e.delta < 0).sort((a, b) => a.e.delta - b.e.delta).slice(0, MAX_CONS).map(force);

  const insufficient = ev.verdict === "insufficient" || ev.global === null;
  const v = verdictView(t, ev);
  const list = (rows: ForceRow[]) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(rows.slice(0, MAX_SUMMARY).map((r) => r.name.toLocaleLowerCase(locale)));
  const summary = insufficient ? t("cand.synth.summary.insufficient", { min: docs.verdict.minRuns })
    : pros.length && cons.length ? t("cand.synth.summary.both", { pros: list(pros), cons: list(cons) })
    : pros.length ? t("cand.synth.summary.pros", { pros: list(pros) })
    : cons.length ? t("cand.synth.summary.cons", { cons: list(cons) })
    : t("cand.synth.summary.none");
  const scored = t("cand.synth.confidence.scored", { count: ev.runsUsed, indexed: runsIndexed });
  const confidence = runsIndexed === 0 ? null
    : !insufficient && ev.runsUsed < docs.confidence.high ? `${scored}${t("cand.synth.confidence.low")}` : scored;
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
    flip: insufficient ? null : flipView(t, locale, ev, docs, counted),
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

/** "To reach INVITE: +11 pts" and one row per source of the shortest path; null for INVITE (no next verdict). */
function flipView(t: T, locale: Locale, ev: Evaluation, docs: SynthesisDocs, counted: (axis: string) => boolean): FlipView | null {
  const nv = ev.nextVerdict;
  if (!nv || ev.global === null) return null;
  const rows = nv.sources.flatMap((source): FlipRow[] => {
    const d = (ev.drivers ?? []).find((x) => x.source === source);
    const axis = axisOf(source);
    if (!d || !counted(axis)) return [];
    const { value, reference } = driverValues(t, locale, d);
    return [{
      name: docs.titleOf(source),
      gain: t("cand.synth.flip.gain", { axis: axisTitle(t, axis as AxisKey), pts: String(Math.abs(Math.round(d.impact))) }),
      gap: t("cand.synth.flip.gap", { value, reference }),
    }];
  });
  if (rows.length === 0) return null;
  return {
    title: t("cand.synth.flip.title", { verdict: t(`verdict.words.${nv.verdict}`), pts: String(Math.max(0, nv.threshold - Math.round(ev.global))) }),
    rows,
    reachable: nv.reachable,
    note: nv.reachable ? null : t("cand.synth.flip.out", { count: rows.length }),
  };
}
