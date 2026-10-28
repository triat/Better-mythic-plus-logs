// The evaluation study, 0 WCL points (spec docs/superpowers/specs/2026-10-27-evaluation-validity-design.md, phase 3):
// on the calibration samples, how reliable each sub-signal is from one run to the next, how much of the score each one
// really carries, whether WCL's parse is ranked per key level, and candidate changes — shrinkage toward the average
// player (decision 7), per-role percentile curves (decision 8), and the targeted weights of study v2 — fitted on one
// half of the characters and judged on the other. Study v2 (2026-10-27) judges each candidate against today's config
// with a paired bootstrap over the held-out characters, so a difference inside the sampling noise decides nothing.
// It reads calibration.db only and writes aggregates: no character name, no WCL call.
import { curveFor } from "../evaluation/axis.ts";
import { curve } from "../evaluation/curve.ts";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scoreOnly } from "../evaluation/evaluate.ts";
import type { EvalPayload, EvalRun } from "../evaluation/inputs.ts";
import { payloadWithRuns } from "../evaluation/reliability.ts";
import { AXIS_KEYS, type AxisKey, type CurvePoints, type EvaluationConfig, type Role } from "../evaluation/types.ts";
import { curveInputs, fitGlobal, isFit, percentileCurve, quantile, ROLES, type Sample, spearman } from "./fit.ts";

/** Pairs below this give no correlation (null). */
export const MIN_PAIRS = 30;
/** A character's shown runs must reach this to be split in two halves. */
export const MIN_SPLIT_RUNS = 4;
/** Resamples of the paired bootstrap (study v2). */
export const BOOTSTRAP = 1000;
/**
 * Sources measured on the character rather than on its runs: both halves read the same value, so a split-half says
 * nothing about them (it is 1 by construction) and they get no reliability and no shrinkage.
 */
export const NOT_RUN_BASED: ReadonlySet<string> = new Set(["preparation.ilvlVsLevel"]);

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
/** Spearman over the pairs, unrounded; null under MIN_PAIRS or when one side is constant (no ranking to compare). */
const corr = (a: number[], b: number[]): number | null => {
  if (a.length < MIN_PAIRS) return null;
  const r = spearman(a, b);
  return Number.isFinite(r) ? r : null;
};
const rho = (a: number[], b: number[]): number | null => {
  const r = corr(a, b);
  return r === null ? null : round(r);
};
const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

type StudyRun = EvalRun & { startTime?: number; encounterID?: number; spec?: string; amount?: number };

/** The shown runs, oldest first (a run without a date sorts by its report code). */
const runsByDate = (p: EvalPayload): StudyRun[] =>
  [...(p.perDungeon.runs as StudyRun[])].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0) || a.reportCode.localeCompare(b.reportCode));

/** Two halves of a character's runs: alternating (reliability) or older / newer (prediction); null under MIN_SPLIT_RUNS. */
export function halves(p: EvalPayload, by: "alternate" | "date"): [EvalPayload, EvalPayload] | null {
  const runs = runsByDate(p);
  if (runs.length < MIN_SPLIT_RUNS) return null;
  const a = by === "alternate" ? runs.filter((_, i) => i % 2 === 0) : runs.slice(0, Math.floor(runs.length / 2));
  const b = by === "alternate" ? runs.filter((_, i) => i % 2 === 1) : runs.slice(Math.floor(runs.length / 2));
  return [payloadWithRuns(p, a), payloadWithRuns(p, b)];
}

export type Outcomes = { deaths: number | null; avoidable: number | null; timed: number | null };

/** What happened in a set of runs, each oriented so that higher is better: fewer deaths, less avoidable, more timed. */
export function outcomes(p: EvalPayload): Outcomes {
  const sig = p.perDungeon.runs.flatMap((r) => (r.signals ? [r.signals] : []));
  if (sig.length === 0) return { deaths: null, avoidable: null, timed: null };
  const peered = sig.flatMap((s) => (s.avoidableDamage?.peer && s.avoidableDamage.peer.median > 0
    ? [(s.avoidableDamage.perMinute - s.avoidableDamage.peer.median) / s.avoidableDamage.peer.median] : []));
  return {
    deaths: -sig.reduce((n, s) => n + s.deaths.count, 0) / sig.length,
    avoidable: peered.length ? -quantile(peered, 0.5) : null,
    timed: sig.filter((s) => s.keystone.timed).length / sig.length,
  };
}

// ---------- per sub-signal ----------

export interface SignalStudy {
  source: string;
  /** Characters with a measured value. */
  n: number;
  median: number | null;
  /** The share of the raw score the weights give it, and the share it really carries (weight × spread of its 0–100 score). */
  nominal: number;
  effective: number;
  /** False for a source measured on the character (NOT_RUN_BASED): no split-half, no one-run reliability, no k. */
  runBased: boolean;
  /** Spearman between the two alternating halves; null under MIN_PAIRS or for a source that is not run-based. */
  splitHalf: number | null;
  /** One run's reliability (Spearman-Brown inverted from the halves' size); null without a split-half. */
  oneRun: number | null;
  /** Shrinkage constant k = (1 − r1) / r1; null when one run carries no signal (r1 ≤ 0). */
  k: number | null;
}

/** The sources a role's verdict counts: a counted axis, weight > 0, not pillar-only. */
export function countedSources(cfg: EvaluationConfig, role: Role): { source: string; axis: AxisKey; nominal: number }[] {
  const axes = AXIS_KEYS.filter((a) => cfg.axisWeights[role][a] > 0);
  const totalAxis = axes.reduce((s, a) => s + cfg.axisWeights[role][a], 0);
  return axes.flatMap((axis) => {
    const subs = Object.entries(cfg.axes[axis].subSignals).filter(([, sc]) => !sc.pillarOnly && sc.weights[role] > 0);
    const totalSub = subs.reduce((s, [, sc]) => s + sc.weights[role], 0);
    return subs.map(([id, sc]) => ({ source: `${axis}.${id}`, axis, nominal: (cfg.axisWeights[role][axis] / totalAxis) * (sc.weights[role] / totalSub) }));
  });
}

const subConfig = (cfg: EvaluationConfig, source: string) => {
  const [axis, id] = source.split(".") as [AxisKey, string];
  return cfg.axes[axis].subSignals[id]!;
};

/** Reliability and real weight of every counted sub-signal of a role. */
export function signalStudy(own: Sample[], cfg: EvaluationConfig, role: Role): SignalStudy[] {
  const sources = countedSources(cfg, role);
  const full = own.map((s) => curveInputs(s.payload, cfg));
  const split = own.flatMap((s) => {
    const h = halves(s.payload, "alternate");
    return h ? [{ a: curveInputs(h[0], cfg), b: curveInputs(h[1], cfg), m: s.payload.perDungeon.runs.length / 2 }] : [];
  });
  const m = split.length ? split.reduce((n, x) => n + x.m, 0) / split.length : 0;
  const rows = sources.map(({ source, nominal }) => {
    const xs = full.flatMap((f) => (typeof f[source] === "number" ? [f[source]!] : []));
    const scores = xs.map((x) => curve(x, curveFor(subConfig(cfg, source), role)));
    const pairs = split.filter((x) => typeof x.a[source] === "number" && typeof x.b[source] === "number");
    const runBased = !NOT_RUN_BASED.has(source);
    const half = runBased ? rho(pairs.map((x) => x.a[source]!), pairs.map((x) => x.b[source]!)) : null;
    const r1 = half === null || m <= 1 ? null : half <= 0 ? 0 : half / (m - (m - 1) * half);
    return {
      source, n: xs.length, median: xs.length ? round(quantile(xs, 0.5)) : null, nominal, spread: sd(scores), runBased,
      splitHalf: half, oneRun: r1 === null ? null : round(r1), k: r1 === null || r1 <= 0 ? null : round((1 - r1) / r1, 2),
    };
  });
  const totalEffective = rows.reduce((s, r) => s + r.nominal * r.spread, 0);
  return rows.map(({ spread, nominal, ...r }) => ({
    ...r, nominal: round(nominal), effective: totalEffective > 0 ? round((nominal * spread) / totalEffective) : 0,
  }));
}

// ---------- the score as a whole, for one config ----------

export const MEASURES = ["splitHalf", "deaths", "avoidable", "timed"] as const;
export type Measure = (typeof MEASURES)[number];
const PREDICTIONS = ["deaths", "avoidable", "timed"] as const;

/** A candidate minus today on one measure: the difference on all held-out characters and its 95 % interval. */
export interface Diff {
  diff: number;
  low: number;
  high: number;
}

export interface ScoreStudy {
  /** Spearman of the raw score between the two alternating halves: the same player, two sets of runs. */
  splitHalf: number | null;
  /** The raw score on the older half against what happened in the newer half. */
  predicts: Outcomes;
  /** Against WCL's own run ladder (the discovery percentile), as in the 2026-09 study. */
  wclLadder: number | null;
  /** Share of each verdict on the whole payloads. */
  verdicts: Record<"invite" | "maybe" | "pass" | "insufficient", number>;
  /** Characters whose verdict differs from today's. */
  changes: number;
  /** Against today's config on the same characters (paired bootstrap); null for today itself. */
  vsToday: Record<Measure, Diff | null> | null;
}

/** One config's raw scores per character, in `own`'s order: on each alternating half, and on the older half. */
export interface ScoreRows {
  halves: ([number, number] | null)[];
  before: (number | null)[];
}

export function scoreRows(own: Sample[], cfg: EvaluationConfig): ScoreRows {
  const raw = (p: EvalPayload) => scoreOnly(p, cfg).raw;
  return {
    halves: own.map((s) => {
      const h = halves(s.payload, "alternate");
      if (!h) return null;
      const a = raw(h[0]);
      const b = raw(h[1]);
      return a === null || b === null ? null : [a, b];
    }),
    before: own.map((s) => {
      const h = halves(s.payload, "date");
      return h ? raw(h[0]) : null;
    }),
  };
}

/** What happened in each character's newer half, in `own`'s order: the same for every config. */
export const laterOutcomes = (own: Sample[]): (Outcomes | null)[] =>
  own.map((s) => {
    const h = halves(s.payload, "date");
    return h ? outcomes(h[1]) : null;
  });

/** The four measures on the characters `idx` points at (a resample may point at one several times). */
function measures(rows: ScoreRows, after: (Outcomes | null)[], idx: readonly number[], r = corr): Record<Measure, number | null> {
  const a: number[] = [];
  const b: number[] = [];
  for (const i of idx) {
    const h = rows.halves[i];
    if (h) { a.push(h[0]); b.push(h[1]); }
  }
  const predict = (k: (typeof PREDICTIONS)[number]) => {
    const x: number[] = [];
    const y: number[] = [];
    for (const i of idx) {
      const before = rows.before[i];
      const v = after[i]?.[k];
      if (before !== null && before !== undefined && typeof v === "number") { x.push(before); y.push(v); }
    }
    return r(x, y);
  };
  return { splitHalf: r(a, b), deaths: predict("deaths"), avoidable: predict("avoidable"), timed: predict("timed") };
}

/** Deterministic numbers in [0, 1) (an LCG): the same samples give the same intervals from one run to the next. */
const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

/**
 * Paired bootstrap over the characters: each resample draws `own.length` characters with replacement and measures
 * today and every candidate on the same draw. A measure's interval is the 2.5th and 97.5th percentile of
 * candidate − today; null when the measure is missing on all the characters or on more than half the draws.
 */
export function bootstrapDiffs(today: ScoreRows, candidates: Record<string, ScoreRows>, after: (Outcomes | null)[], resamples = BOOTSTRAP, seed = 1): Record<string, Record<Measure, Diff | null>> {
  const n = after.length;
  const all = Array.from({ length: n }, (_, i) => i);
  const names = Object.keys(candidates);
  const point = measures(today, after, all);
  const draws = Object.fromEntries(names.map((c) => [c, Object.fromEntries(MEASURES.map((m) => [m, [] as number[]]))])) as Record<string, Record<Measure, number[]>>;
  const rnd = lcg(seed);
  for (let b = 0; b < resamples && n > 0; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * n));
    const t = measures(today, after, idx);
    for (const c of names) {
      const v = measures(candidates[c]!, after, idx);
      for (const m of MEASURES) if (v[m] !== null && t[m] !== null) draws[c]![m].push(v[m]! - t[m]!);
    }
  }
  return Object.fromEntries(names.map((c) => {
    const p = measures(candidates[c]!, after, all);
    return [c, Object.fromEntries(MEASURES.map((m) => {
      const d = draws[c]![m];
      if (p[m] === null || point[m] === null || d.length < resamples / 2) return [m, null];
      return [m, { diff: round(p[m]! - point[m]!), low: round(quantile(d, 0.025)), high: round(quantile(d, 0.975)) }];
    }))];
  })) as Record<string, Record<Measure, Diff | null>>;
}

export function scoreStudy(own: Sample[], cfg: EvaluationConfig, today: EvaluationConfig, rows = scoreRows(own, cfg), after = laterOutcomes(own)): ScoreStudy {
  const m = measures(rows, after, own.map((_, i) => i), rho);
  const whole = own.map((s) => ({ s, now: scoreOnly(s.payload, cfg), before: scoreOnly(s.payload, today) }));
  const ladder = whole.filter((w) => w.now.raw !== null);
  const verdicts = { invite: 0, maybe: 0, pass: 0, insufficient: 0 };
  for (const w of whole) verdicts[w.now.verdict] += 1;
  const n = Math.max(1, whole.length);
  return {
    splitHalf: m.splitHalf,
    predicts: { deaths: m.deaths, avoidable: m.avoidable, timed: m.timed },
    wclLadder: rho(ladder.map((w) => w.now.raw!), ladder.map((w) => -w.s.study.percentile)),
    verdicts: { invite: round(verdicts.invite / n), maybe: round(verdicts.maybe / n), pass: round(verdicts.pass / n), insufficient: round(verdicts.insufficient / n) },
    changes: whole.filter((w) => w.now.verdict !== w.before.verdict).length,
    vsToday: null,
  };
}

// ---------- the parse: per key level or across levels ----------

export interface ParseCheck {
  runs: number;
  /** Mean Spearman(amount, parse) inside (spec, dungeon), and inside (spec, dungeon, key level), weighted by runs. */
  pooled: number | null;
  perLevel: number | null;
  /** Mean Spearman(key level, parse) inside (spec, dungeon): near 0 when the parse is ranked per level. */
  levelVsParse: number | null;
  reading: "per key level" | "across levels" | "unclear";
}

export function parseCheck(samples: Sample[]): ParseCheck {
  const runs = samples.flatMap((s) => (s.payload.perDungeon.runs as StudyRun[]).filter((r) =>
    r.parsePercent > 0 && typeof r.amount === "number" && Number.isFinite(r.amount) && r.spec && typeof r.encounterID === "number"));
  const groups = (key: (r: StudyRun) => string, min: number) => {
    const m = new Map<string, StudyRun[]>();
    for (const r of runs) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return [...m.values()].filter((g) => g.length >= min);
  };
  const weighted = (gs: StudyRun[][], x: (r: StudyRun) => number) => {
    let num = 0;
    let den = 0;
    for (const g of gs) {
      const r = spearman(g.map(x), g.map((r) => r.parsePercent));
      if (!Number.isFinite(r)) continue;
      num += r * g.length;
      den += g.length;
    }
    return den > 0 ? round(num / den) : null;
  };
  const bySpecDungeon = groups((r) => `${r.spec}|${r.encounterID}`, 30);
  const pooled = weighted(bySpecDungeon, (r) => r.amount!);
  const perLevel = weighted(groups((r) => `${r.spec}|${r.encounterID}|${r.keyLevel}`, 15), (r) => r.amount!);
  const levelVsParse = weighted(bySpecDungeon, (r) => r.keyLevel);
  const reading = pooled === null || perLevel === null ? "unclear"
    : perLevel >= 0.8 && perLevel - pooled >= 0.05 ? "per key level"
    : pooled >= perLevel - 0.02 ? "across levels" : "unclear";
  return { runs: runs.length, pooled, perLevel, levelVsParse, reading };
}

// ---------- candidates ----------

/** k per counted source and role, from the fit half (null k: no pull, the signal is left to its weight). */
export function shrinkageFrom(fit: Sample[], cfg: EvaluationConfig): NonNullable<EvaluationConfig["shrinkage"]> {
  const out: NonNullable<EvaluationConfig["shrinkage"]> = {};
  for (const role of ROLES) {
    const own = fit.filter((s) => s.study.role === role);
    if (own.length < MIN_PAIRS) continue;
    const byRole: Record<string, number> = {};
    for (const s of signalStudy(own, cfg, role)) if (s.k !== null) byRole[s.source] = s.k;
    out[role] = byRole;
  }
  return out;
}

/** Each counted sub-signal's curve replaced, per role, by its percentile among the fit half's players of that role. */
export function percentileCurvesFrom(fit: Sample[], cfg: EvaluationConfig): EvaluationConfig["axes"] {
  const axes = structuredClone(cfg.axes);
  for (const role of ROLES) {
    const own = fit.filter((s) => s.study.role === role);
    if (own.length < MIN_PAIRS) continue;
    const inputs = own.map((s) => curveInputs(s.payload, cfg));
    for (const { source } of countedSources(cfg, role)) {
      const xs = inputs.flatMap((f) => (typeof f[source] === "number" ? [f[source]!] : []));
      if (xs.length < MIN_PAIRS) continue;
      const [axis, id] = source.split(".") as [AxisKey, string];
      const sc = axes[axis].subSignals[id]!;
      const up = sc.curve[sc.curve.length - 1]![1] >= sc.curve[0]![1];
      sc.curves = { ...sc.curves, [role]: percentileCurve(xs, up) as CurvePoints };
    }
  }
  return axes;
}

/**
 * Study v2's targeted weights: the two counted signals the 2026-10-27 study found closest to noise for their role
 * (tank individual deaths, split-half 0.07; healer dispels, 0.16) weigh 1 instead of 3.
 */
export const TARGETED: readonly { source: string; role: Role; weight: number }[] = [
  { source: "survival.individualDeaths", role: "tank", weight: 1 },
  { source: "utility.dispels", role: "healer", weight: 1 },
];

/** `axes` with TARGETED's weights. */
export function targetedAxes(axes: EvaluationConfig["axes"]): EvaluationConfig["axes"] {
  const out = structuredClone(axes);
  for (const t of TARGETED) {
    const [axis, id] = t.source.split(".") as [AxisKey, string];
    out[axis].subSignals[id]!.weights[t.role] = t.weight;
  }
  return out;
}

export type CandidateName = "today" | "shrinkage" | "percentile" | "both" | "targeted" | "all";
const CANDIDATES = ["shrinkage", "percentile", "both", "targeted", "all"] as const;

/** A candidate config with its `globalCurve` and `reference` refitted on the fit half, so its percentiles mean the same. */
function refitted(fit: Sample[], cfg: EvaluationConfig): EvaluationConfig {
  const g = fitGlobal(fit, cfg);
  return { ...cfg, globalCurve: g.globalCurve, reference: g.reference };
}

export interface RoleStudy {
  role: Role;
  fit: number;
  test: number;
  signals: SignalStudy[];
  candidates: Record<CandidateName, ScoreStudy>;
}

export interface StudyResult {
  studiedAt: number;
  baseVersion: string;
  samples: number;
  /** Resamples of the paired bootstrap behind every `vsToday` (study v2). */
  bootstrap: number;
  parse: ParseCheck;
  roles: Record<Role, RoleStudy>;
  /** What the candidates add to today's config, ready to be reviewed and applied by hand. */
  candidate: {
    shrinkage: NonNullable<EvaluationConfig["shrinkage"]>;
    curves: Record<string, Partial<Record<Role, CurvePoints>>>;
    weights: { source: string; role: Role; from: number; to: number }[];
  };
  /** Per role, the candidate that keeps the split-half best without losing prediction, or null to keep today's. */
  best: Record<Role, CandidateName | null>;
}

/**
 * A candidate beats today when it is surely steadier (the split-half difference's whole 95 % interval above 0) and
 * surely not worse at predicting (no prediction's interval wholly below 0). Without an interval, it does not.
 */
export function beats(c: ScoreStudy): boolean {
  const v = c.vsToday;
  if (!v?.splitHalf || v.splitHalf.low <= 0) return false;
  return PREDICTIONS.every((k) => v[k] === null || v[k].high >= 0);
}

export function runStudy(samples: Sample[], base: EvaluationConfig, now: number, resamples = BOOTSTRAP): StudyResult {
  const fit = samples.filter(isFit);
  const test = samples.filter((s) => !isFit(s));
  const shrinkage = shrinkageFrom(fit, base);
  const curvesAxes = percentileCurvesFrom(fit, base);
  const configs: Record<CandidateName, EvaluationConfig> = {
    today: base,
    shrinkage: refitted(fit, { ...base, shrinkage }),
    percentile: refitted(fit, { ...base, axes: curvesAxes }),
    both: refitted(fit, { ...base, axes: curvesAxes, shrinkage }),
    targeted: refitted(fit, { ...base, axes: targetedAxes(base.axes) }),
    all: refitted(fit, { ...base, axes: targetedAxes(curvesAxes), shrinkage }),
  };
  const roles = {} as Record<Role, RoleStudy>;
  const best = {} as Record<Role, CandidateName | null>;
  for (const role of ROLES) {
    const ownFit = fit.filter((s) => s.study.role === role);
    const ownTest = test.filter((s) => s.study.role === role);
    const after = laterOutcomes(ownTest);
    const rows = Object.fromEntries((Object.keys(configs) as CandidateName[]).map((name) => [name, scoreRows(ownTest, configs[name])])) as Record<CandidateName, ScoreRows>;
    const diffs = bootstrapDiffs(rows.today, Object.fromEntries(CANDIDATES.map((c) => [c, rows[c]])), after, resamples);
    const candidates = Object.fromEntries((Object.keys(configs) as CandidateName[]).map((name) =>
      [name, { ...scoreStudy(ownTest, configs[name], base, rows[name], after), vsToday: diffs[name] ?? null }])) as Record<CandidateName, ScoreStudy>;
    roles[role] = { role, fit: ownFit.length, test: ownTest.length, signals: signalStudy(ownTest, base, role), candidates };
    const winners = CANDIDATES.filter((n) => beats(candidates[n]));
    best[role] = winners.sort((a, b) => (candidates[b].splitHalf ?? 0) - (candidates[a].splitHalf ?? 0))[0] ?? null;
  }
  const curves: StudyResult["candidate"]["curves"] = {};
  for (const axis of AXIS_KEYS) {
    for (const [id, sc] of Object.entries(curvesAxes[axis].subSignals)) if (sc.curves) curves[`${axis}.${id}`] = sc.curves;
  }
  const weights = TARGETED.map((t) => ({ source: t.source, role: t.role, from: subConfig(base, t.source).weights[t.role], to: t.weight }));
  return {
    studiedAt: now, baseVersion: base.version, samples: samples.length, bootstrap: resamples, parse: parseCheck(samples), roles,
    candidate: { shrinkage, curves, weights }, best,
  };
}

// ---------- the report ----------

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const num = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const signed = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(2)}`;
};
/** "0.71 · +0.12 [+0.08, +0.16]", the difference in bold when its interval leaves out 0. */
const vs = (value: number | null, d: Diff | null | undefined) => {
  if (!d) return num(value);
  const text = `${signed(d.diff)} [${signed(d.low)}, ${signed(d.high)}]`;
  return `${num(value)} · ${d.low > 0 || d.high < 0 ? `**${text}**` : text}`;
};

export function studyMarkdown(r: StudyResult): string {
  const lines = [
    `# Evaluation study, ${new Date(r.studiedAt).toISOString().slice(0, 10)}`,
    "",
    `Config ${r.baseVersion}, ${r.samples} characters from calibration.db (EU, +15 to +20). Signals and candidates are judged on the half of the characters the candidates were not fitted on. Spec: \`docs/superpowers/specs/2026-10-27-evaluation-validity-design.md\`, phase 3 (study v2).`,
    "",
    `A candidate's cell reads: its value · its difference with today [95 % interval, paired bootstrap over the held-out characters, ${r.bootstrap} resamples]. A difference in bold is beyond the sampling noise. Candidates: shrinkage toward the average player, per-role percentile curves, both, targeted weights (${r.candidate.weights.map((w) => `${w.role} ${w.source} ${w.from} → ${w.to}`).join(", ")}), and all of them together.`,
    "",
    "## Parse ranking",
    "",
    `${r.parse.runs} ranked runs. Spearman(amount, parse) inside spec × dungeon: ${num(r.parse.pooled)}; inside spec × dungeon × key level: ${num(r.parse.perLevel)}; Spearman(key level, parse) inside spec × dungeon: ${num(r.parse.levelVsParse)}. Reading: **${r.parse.reading}**.`,
  ];
  for (const role of ROLES) {
    const x = r.roles[role];
    lines.push(
      "",
      `## ${role} (fit ${x.fit}, held out ${x.test})`,
      "",
      "| Signal | n | median | weight share | real share | split-half | one run | k |",
      "|---|---|---|---|---|---|---|---|",
      ...x.signals.map((s) => `| ${s.source} | ${s.n} | ${num(s.median)} | ${pct(s.nominal)} | ${pct(s.effective)} | ${s.runBased ? num(s.splitHalf) : "n/a, per character"} | ${num(s.oneRun)} | ${num(s.k)} |`),
      "",
      "| Candidate | split-half | predicts deaths | predicts avoidable | predicts timed | WCL ladder | INVITE / MAYBE / PASS | changes |",
      "|---|---|---|---|---|---|---|---|",
      ...(Object.keys(x.candidates) as CandidateName[]).map((n) => {
        const c = x.candidates[n];
        const d = c.vsToday;
        return `| ${n} | ${vs(c.splitHalf, d?.splitHalf)} | ${vs(c.predicts.deaths, d?.deaths)} | ${vs(c.predicts.avoidable, d?.avoidable)} | ${vs(c.predicts.timed, d?.timed)} | ${num(c.wclLadder)} | ${pct(c.verdicts.invite)} / ${pct(c.verdicts.maybe)} / ${pct(c.verdicts.pass)} | ${c.changes} |`;
      }),
      "",
      r.best[role]
        ? `**Best: ${r.best[role]}** (surely steadier: the split-half interval is above 0; surely not worse: no prediction interval is below 0).`
        : "**Keep today's**: no candidate is surely steadier without surely predicting worse.",
    );
  }
  return `${lines.join("\n")}\n`;
}

export const studyFiles = (dbPath: string) => ({ json: join(dirname(dbPath), "study.json"), markdown: join(dirname(dbPath), "study.md") });

/** Both files, each written whole (temp file + rename) so the ops route never reads half of one. */
export function writeStudy(dbPath: string, r: StudyResult): void {
  const f = studyFiles(dbPath);
  for (const [path, text] of [[f.json, `${JSON.stringify(r, null, 2)}\n`], [f.markdown, studyMarkdown(r)]] as const) {
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
  }
}

export function readStudy(dbPath: string): { result: StudyResult; markdown: string } | null {
  const f = studyFiles(dbPath);
  if (!existsSync(f.json) || !existsSync(f.markdown)) return null;
  return { result: JSON.parse(readFileSync(f.json, "utf8")) as StudyResult, markdown: readFileSync(f.markdown, "utf8") };
}
