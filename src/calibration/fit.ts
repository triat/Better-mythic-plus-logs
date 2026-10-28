// The calibration fit, 0 WCL points: per role, the global percentile curve (`globalCurve`, raw weighted mean of the
// axes → its percentile in the population) and the average player (`reference`, the median curve input `x` and display
// value `value` of every scored sub-signal); and, for every role at once, the item level the players of each key level
// wear (`expectedIlvl`, user 2026-10-28). The parts the weekly run refits (spec
// docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md, non-goals).
import { curve } from "../evaluation/curve.ts";
import { globalScore } from "../evaluation/evaluate.ts";
import { scoreAllAxes } from "../evaluation/axes/index.ts";
import { collectInputs, type EvalPayload } from "../evaluation/inputs.ts";
import type { CurvePoints, EvaluationConfig, Role } from "../evaluation/types.ts";
import type { Candidate } from "./discover.ts";

export interface Sample { study: Candidate; payload: EvalPayload }

export const ROLES: Role[] = ["dps", "healer", "tank"];
/** Below this many samples, a role's curve or a sub-signal's reference is not fitted (today's is kept). */
export const MIN_N = 40;
/** Quantiles a curve is anchored on; ties collapse onto one point at their mid-rank. */
const ANCHOR_QS = [0.02, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.98];

export const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- fit / test split: a character is in one half only, whatever its spec ----------
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
export const isFit = (s: { study: { name: string; server: string } }) => hash(`${s.study.name}|${s.study.server}`) % 2 === 0;

/**
 * Curve points placing x on the population's own distribution: the score at x is the mid-rank percentile of x (ties
 * share their average rank), flipped when lower is better. Anchored on a fixed set of quantiles so the curve stays short
 * and readable in the Help page.
 */
export function percentileCurve(xs: number[], higherIsBetter: boolean): CurvePoints {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const midRank = (v: number) => {
    let below = 0;
    let equal = 0;
    for (const x of s) { if (x < v) below++; else if (x === v) equal++; }
    return (below + equal / 2) / n;
  };
  const anchors = [...new Set(ANCHOR_QS.map((q) => quantile(s, q)))].sort((a, b) => a - b);
  const pts: CurvePoints = anchors.map((v) => {
    const p = 100 * midRank(v);
    return [round(v, 4), round(higherIsBetter ? p : 100 - p, 1)];
  });
  // A curve needs at least two points; a signal that is constant across the population carries no information and is
  // scored neutral.
  if (pts.length === 1) return [[pts[0]![0], 50], [pts[0]![0] + 1, 50]];
  return pts;
}

const SLOPE = 1000;
/**
 * The value each sub-signal feeds its curve, per axis, recovered without touching production code. A probe config turns
 * every curve into a straight line of slope 1000 and every weight into 1, so `scoreAxis`'s delta = (1000·x − 50) / n
 * with n = the axis's contributing sub-signals; inverting gives x to within 0.05·n / 1000. `Evidence.value` is not
 * enough: it is the display value, not the level-scaled number the curve actually reads.
 */
export function curveInputs(payload: EvalPayload, cfg: EvaluationConfig): Record<string, number> {
  const probe = structuredClone(cfg) as EvaluationConfig;
  // No reference, so nothing is imputed: only measured sub-signals reach the evidence, and the reference stays a median
  // of real values (validity spec 2026-10-27, decision 3).
  probe.reference = { dps: {}, healer: {}, tank: {} };
  for (const axis of Object.values(probe.axes)) {
    for (const sub of Object.values(axis.subSignals)) {
      sub.curve = [[-1e9, -1e9 * SLOPE], [1e9, 1e9 * SLOPE]];
      sub.weights = { dps: 1, healer: 1, tank: 1 };
    }
  }
  // The axes alone: no drivers, pillars or reliability, which the bulk fit never reads.
  const out: Record<string, number> = {};
  for (const axis of scoreAllAxes(collectInputs(payload, probe), probe)) {
    // Only configured sub-signals share the axis's Σw; an evidence entry that is not one of them would skew every
    // inversion.
    const configured = probe.axes[axis.key].subSignals;
    const subs = axis.evidence.filter((e) => e.source.split(".")[1]! in configured);
    for (const e of subs) out[e.source] = (e.delta * subs.length + 50) / SLOPE;
  }
  return out;
}

/** Spearman rank correlation. */
export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i]! - ma) * (rb[i]! - mb); da += (ra[i]! - ma) ** 2; db += (rb[i]! - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

/** A key level needs this many samples with an item level for its median to count. */
export const MIN_ILVL_N = 30;

/**
 * The item level expected at each key level, fitted on `samples` (validity spec 2026-10-27, user 2026-10-28): at each
 * key level of the calibration band, the median item level of the characters sampled there, never lower than the level
 * below. The hand-set table's slope carries on past both ends, so a +10 or a +25 still reads a sensible value. Keyed by
 * the season the samples' Raider.IO profiles name most, else `base`'s newest; null under two fitted levels.
 */
export function fitExpectedIlvl(samples: Sample[], base: EvaluationConfig): { slug: string; curve: CurvePoints } | null {
  const slugs = new Map<string, number>();
  const byLevel = new Map<number, number[]>();
  for (const s of samples) {
    const rio = s.payload.rio;
    const slug = rio?.seasons?.[0]?.slug;
    if (slug) slugs.set(slug, (slugs.get(slug) ?? 0) + 1);
    const ilvl = rio?.itemLevel;
    if (typeof ilvl !== "number" || !Number.isFinite(ilvl) || ilvl <= 0) continue;
    const level = s.payload.targetLevel;
    (byLevel.get(level) ?? byLevel.set(level, []).get(level)!).push(ilvl);
  }
  const newest = Object.keys(base.expectedIlvl).at(-1)!;
  const slug = [...slugs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? newest;
  const hand = base.expectedIlvl[slug] ?? base.expectedIlvl[newest]!;
  let floor = -Infinity;
  const fitted = [...byLevel].filter(([, xs]) => xs.length >= MIN_ILVL_N).sort((a, b) => a[0] - b[0]).map(([level, xs]): [number, number] => {
    floor = Math.max(floor, round(quantile(xs, 0.5), 1));
    return [level, floor];
  });
  if (fitted.length < 2) return null;
  const [lo, atLo] = fitted[0]!;
  const [hi, atHi] = fitted.at(-1)!;
  const first = hand[0]![0];
  const last = hand.at(-1)![0];
  return {
    slug,
    curve: [
      ...(first < lo ? [[first, round(atLo - (curve(lo, hand) - curve(first, hand)), 1)] as [number, number]] : []),
      ...fitted,
      ...(last > hi ? [[last, round(atHi + (curve(last, hand) - curve(hi, hand)), 1)] as [number, number]] : []),
    ],
  };
}

/** `cfg` with `fitted` as its season's expected item level (a new season goes last: the newest). */
export const withExpectedIlvl = (cfg: EvaluationConfig, fitted: { slug: string; curve: CurvePoints } | null): EvaluationConfig =>
  fitted ? { ...cfg, expectedIlvl: { ...cfg.expectedIlvl, [fitted.slug]: fitted.curve } } : cfg;

export interface GlobalFit {
  globalCurve: EvaluationConfig["globalCurve"];
  reference: EvaluationConfig["reference"];
  /** Samples per role the fit read; a role under MIN_N keeps `base`'s curve and reference. */
  n: Record<Role, number>;
}

/**
 * `globalCurve` and `reference` fitted on `samples`. Reads globalScore(), taken before the curve, so the curve already in
 * `base` does not bias the fit. The reference is fitted first, from measured values only, and the raw scores the curve
 * reads impute missing sub-signals with that new reference (validity spec 2026-10-27, decision 3): a config fitted on
 * its own population is then a fixed point.
 */
export function fitGlobal(samples: Sample[], base: EvaluationConfig): GlobalFit {
  const globalCurve = structuredClone(base.globalCurve);
  const reference = structuredClone(base.reference);
  const n = { dps: 0, healer: 0, tank: 0 } as Record<Role, number>;
  for (const role of ROLES) {
    const own = samples.filter((s) => s.study.role === role);
    n[role] = own.length;
    if (own.length < MIN_N) continue;

    const xsBySource = new Map<string, number[]>();
    const valuesBySource = new Map<string, number[]>();
    for (const s of own) {
      for (const [src, x] of Object.entries(curveInputs(s.payload, base))) (xsBySource.get(src) ?? xsBySource.set(src, []).get(src)!).push(x);
      for (const e of scoreAllAxes(collectInputs(s.payload, base), base).flatMap((a) => a.evidence)) (valuesBySource.get(e.source) ?? valuesBySource.set(e.source, []).get(e.source)!).push(e.value);
    }
    const ref: Record<string, { x: number; value: number }> = {};
    for (const [src, xs] of xsBySource) {
      const values = valuesBySource.get(src) ?? [];
      if (xs.length < MIN_N || values.length < MIN_N) continue;
      ref[src] = { x: round(quantile(xs, 0.5), 4), value: round(quantile(values, 0.5), 4) };
    }
    reference[role] = ref;

    const withRef: EvaluationConfig = { ...base, reference: { ...base.reference, [role]: ref } };
    const raw = own.map((s) => { const i = collectInputs(s.payload, withRef); return globalScore(scoreAllAxes(i, withRef), i.role, withRef); })
      .filter((g): g is number => g !== null);
    if (raw.length < MIN_N) { reference[role] = base.reference[role]; continue; }
    // Rounding to a tenth can merge two anchors, and a curve's x must strictly increase: keep the first of a tie, and
    // only what lies strictly between the fixed end points.
    const c = percentileCurve(raw, true).map(([x, y]) => [round(x, 1), Math.round(y)] as [number, number])
      .filter(([x], i, a) => x > 0 && x < 100 && (i === 0 || x !== a[i - 1]![0]));
    globalCurve[role] = [[0, 0], ...c, [100, 100]];
  }
  return { globalCurve, reference, n };
}
