// Dev-only, 0 WCL points: how the choice of axis weights trades "ranks like WCL's ladder" against
// "predicts who dies / stands in things in their next runs". Weights are chosen on the fit half and
// only confirmed on the held-out half, so the held-out numbers are not the ones the choice was made on.
//
//   bun scripts/calibration/weights.ts
//
// Spec: docs/superpowers/specs/2026-09-24-scoring-calibration-design.md
import defaultConfig from "../../src/evaluation/default-config.json" with { type: "json" };
import type { AxisKey, EvaluationConfig, Role } from "../../src/evaluation/types.ts";
import { loadSamples, quantile, type Sample } from "./analyze.ts";
import { buildCandidate, isFit, scoreCandidate, spearman, type Candidate } from "./calibrate.ts";

type Weights = Record<AxisKey, number>;
const ROLES: Role[] = ["dps", "healer", "tank"];

/** Multipliers on today's weights: `axes` per axis, `subs` per sub-signal and role. */
interface Variant { axes?: Partial<Weights>; subs?: Record<string, Partial<Record<Role, number>>> }

/**
 * The sub-signal changes follow the split-half reliability (reliability.ts): deaths in wipes barely
 * repeat from one half of a player's runs to the other (a wipe is a group event), and a tank's own
 * deaths repeat least of all (they die for the group's mistakes as much as their own).
 */
const RELIABILITY: Variant["subs"] = {
  "survival.wipeDeaths": { dps: 0.5, healer: 0.5, tank: 0.5 },
  "survival.individualDeaths": { tank: 0.5 },
};
const VARIANTS: Record<string, Variant> = {
  "today's weights": {},
  "survival ×2": { axes: { survival: 2 } },
  "survival ×3": { axes: { survival: 3 } },
  "survival ×2, experience ×0.5": { axes: { survival: 2, experience: 0.5 } },
  "survival ×3, experience ×0.5, preparation ×0.5": { axes: { survival: 3, experience: 0.5, preparation: 0.5 } },
  "S×2 E×0.5 + reliability": { axes: { survival: 2, experience: 0.5 }, subs: RELIABILITY },
  "S×2 E×0.5 + reliability + avoidable ×1.5": { axes: { survival: 2, experience: 0.5 }, subs: { ...RELIABILITY, "survival.avoidableVsPeers": { dps: 1.5, healer: 1.5, tank: 1.5 } } },
};

interface Run { startTime: number; parsePercent: number; signals?: { deaths?: { events?: { inWipe: boolean }[] }; avoidableDamage?: { perMinute: number; peer?: { median: number } | null } | null } }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Older half of the runs as a payload, and the newer half's outcomes. Same cut as calibrate.ts. */
function split(s: Sample): { older: Sample; deathsB: number; avoidB: number } | null {
  const runs = [...(s.payload as unknown as { perDungeon: { runs: Run[] } }).perDungeon.runs].filter((r) => r.signals).sort((a, b) => a.startTime - b.startTime);
  if (runs.length < 6) return null;
  const cut = Math.floor(runs.length / 2);
  const p = structuredClone(s.payload) as unknown as { perDungeon: { runs: Run[]; medianParse: number | null } };
  p.perDungeon.runs = runs.slice(0, cut);
  const parses = p.perDungeon.runs.map((r) => r.parsePercent).filter((x) => x > 0);
  p.perDungeon.medianParse = parses.length ? quantile(parses, 0.5) : null;
  const newer = runs.slice(cut);
  const deathsB = mean(newer.map((r) => (r.signals?.deaths?.events ? r.signals.deaths.events.filter((e) => !e.inWipe).length : NaN)).filter(Number.isFinite));
  const avoidB = mean(newer.map((r) => { const a = r.signals?.avoidableDamage; return a?.peer && a.peer.median > 0 ? (100 * (a.perMinute - a.peer.median)) / a.peer.median : NaN; }).filter(Number.isFinite));
  return { older: { study: s.study, payload: p as unknown as Sample["payload"] }, deathsB, avoidB };
}

function measure(samples: Sample[], c: Candidate) {
  const full = samples.map((s) => ({ s, g: scoreCandidate(s, c).global })).filter((x): x is { s: Sample; g: number } => x.g !== null);
  const rank = spearman(full.map((x) => x.g), full.map((x) => 1 - x.s.study.percentile));
  const pred = samples.map(split).filter((x): x is NonNullable<ReturnType<typeof split>> => x !== null)
    .map((x) => ({ g: scoreCandidate(x.older, c).global, d: x.deathsB, a: x.avoidB }))
    .filter((x): x is { g: number; d: number; a: number } => x.g !== null);
  const pd = pred.filter((x) => Number.isFinite(x.d));
  const pa = pred.filter((x) => Number.isFinite(x.a));
  return {
    rank,
    deaths: spearman(pd.map((x) => x.g), pd.map((x) => -x.d)),
    avoid: spearman(pa.map((x) => x.g), pa.map((x) => -x.a)),
    n: full.length,
  };
}

const base = defaultConfig as unknown as EvaluationConfig;
const samples = loadSamples();
const fit = samples.filter(isFit);
const test = samples.filter((s) => !isFit(s));
const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
console.log(`fit ${fit.length}, held-out ${test.length}\n`);
console.log("| Axis weights | fit: ranks like WCL | fit: predicts deaths | fit: predicts avoidable | held-out: WCL | held-out: deaths | held-out: avoidable |");
console.log("|---|---|---|---|---|---|---|");
for (const [name, variant] of Object.entries(VARIANTS)) {
  // Weight variants change the raw global's distribution, so the percentile mapping is refitted each time.
  const refit = buildCandidateWithWeights(fit, base, variant);
  const a = measure(fit, refit);
  const b = measure(test, refit);
  console.log(`| ${name} | ${f(a.rank)} | ${f(a.deaths)} | ${f(a.avoid)} | ${f(b.rank)} | ${f(b.deaths)} | ${f(b.avoid)} |`);
}

/** buildCandidate with the weights multiplied first, so the global percentile curve fits them. */
function buildCandidateWithWeights(fitSet: Sample[], cfg: EvaluationConfig, v: Variant): Candidate {
  const weighted = structuredClone(cfg) as EvaluationConfig;
  for (const role of ROLES) for (const [axis, m] of Object.entries(v.axes ?? {}) as [AxisKey, number][]) weighted.axisWeights[role][axis] *= m;
  for (const [src, byRole] of Object.entries(v.subs ?? {})) {
    const [axis, id] = src.split(".") as [AxisKey, string];
    const sc = weighted.axes[axis].subSignals[id]!;
    for (const [role, m] of Object.entries(byRole) as [Role, number][]) sc.weights[role] *= m;
  }
  return buildCandidate(fitSet, weighted);
}
