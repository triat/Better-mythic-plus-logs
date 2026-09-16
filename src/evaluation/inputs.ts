import { deepdiveSummary } from "../deepdive/aggregate.ts";
import type { RunDefensives } from "../deepdive/types.ts";
import type { SignalSummary } from "../signals/summary.ts";
import type { RioProfile, RunSignals } from "../signals/types.ts";
import { curve, mean, median, stddev } from "./curve.ts";
import type { EvaluationConfig, Role } from "./types.ts";

export interface EvalRun {
  keyLevel: number;
  parsePercent: number;
  reportCode: string;
  fightID: number;
  signals?: RunSignals;
}

export interface EvalPayload {
  metric: "dps" | "hps";
  targetLevel: number;
  perDungeon: {
    runs: EvalRun[];
    dungeonsCovered: number;
    totalDungeonsInSeason: number;
    dungeonsAtOrAboveTarget: number;
    medianLevel: number;
    medianParse: number;
  };
  prevLevelBest: { best: EvalRun } | null;
  rio: RioProfile | null;
  summary: SignalSummary;
  /** Deep-dive analyses of displayed runs (optional; 0 pts — from the raw cache). */
  deepdive?: RunDefensives[];
}

export interface EvalInputs {
  role: Role;
  targetLevel: number;
  runsUsed: number;
  analyzedRuns: number;
  seasonSlug: string | null;
  survival: {
    /** Raw mean deaths/run — unscaled, for labels. */
    individualDeaths: number | null;
    /** Mean of (deaths × levelScale(run's own key level)) — for the curve. */
    individualDeathsScaled: number | null;
    wipeDeaths: number | null;
    avoidableVsPeers: number | null;
    dtpsVsPeers: number | null;
    /** Raw mean teammate deaths/run — unscaled, for labels. */
    groupDeaths: number | null;
    /** Mean of (teammate deaths × levelScale(run's own key level)) — for the curve. */
    groupDeathsScaled: number | null;
    /** Deep-dive: median over analyzed runs of mean major/immunity usage; null under deepdiveMinRuns. */
    defensiveUsage: number | null;
    /** Deep-dive: avoidable / counted deaths; null under deepdiveMinRuns or with no counted death. */
    avoidableDeathShare: number | null;
    avoidableDeathsCount: number;
    countedDeathsCount: number;
  };
  utility: {
    hasKick: boolean;
    kicksVsPeers: number | null;
    kicksAbsolute: number | null;
    /** Median dispels/run; null when the kit cannot dispel at all. */
    dispels: number | null;
    hasDispel: boolean;
  };
  throughput: { medianParse: number | null; parseAtTarget: number | null };
  consistency: { sample: number; parseSpread: number | null; deathsSpread: number | null; damageSpread: number | null };
  preparation: { potions: number | null; healthstones: number | null; ilvl: number | null };
  experience: { coverage: number | null; atTarget: number | null; medianVsTarget: number | null; activity: number | null; prevSeasonAll: number | null };
}

const pct = (mine: number, peerMedian: number): number | null => (peerMedian > 0 ? ((mine - peerMedian) / peerMedian) * 100 : null);
const nums = (xs: Array<number | null | undefined>): number[] => xs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

export function evalRuns(payload: EvalPayload): EvalRun[] {
  const all: EvalRun[] = [];
  if (payload.prevLevelBest) all.push(payload.prevLevelBest.best);
  all.push(...payload.perDungeon.runs);
  return [...new Map(all.map((r) => [`${r.reportCode}:${r.fightID}`, r])).values()];
}

export function detectRole(runs: EvalRun[], metric: "dps" | "hps"): Role {
  const counts = new Map<Role, number>();
  for (const r of runs) {
    const role = r.signals?.role;
    if (role === "dps" || role === "healer" || role === "tank") counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  let best: Role | null = null;
  for (const [role, n] of counts) if (best === null || n > counts.get(best)!) best = role;
  return best ?? (metric === "hps" ? "healer" : "dps");
}

/** Per-run damage Δ% used for consistency's damage spread: avoidable if peered, else dtps if peered, else null. */
const damageDeltaPct = (s: RunSignals): number | null => {
  if (s.avoidableDamage?.peer) return pct(s.avoidableDamage.perMinute, s.avoidableDamage.peer.median);
  if (s.damageTaken.peer) return pct(s.damageTaken.dtps, s.damageTaken.peer.median);
  return null;
};

export function collectInputs(payload: EvalPayload, cfg: EvaluationConfig): EvalInputs {
  const runs = evalRuns(payload);
  const withSig = runs.filter((r) => r.signals !== undefined);
  const sig = withSig.map((r) => r.signals!);

  const role = detectRole(runs, payload.metric);
  const runsUsed = withSig.length;
  const seasonSlug = payload.rio?.seasons[0]?.slug ?? null;

  // A `partial` run's keystone came from ranking data rather than the fight itself — trust
  // the run's own keyLevel over signals.keystone.level in that case.
  const levelFor = (r: EvalRun): number => (r.signals!.partial ? r.keyLevel : r.signals!.keystone.level);

  // --- survival ---
  // Level scaling uses each run's own key level (not the payload's targetLevel), so asking for
  // a harder key doesn't make the same deaths look artificially better or worse.
  const individualDeaths = mean(sig.map((s) => s.deaths.events.filter((e) => !e.inWipe).length));
  const individualDeathsScaled = mean(
    withSig.map((r) => r.signals!.deaths.events.filter((e) => !e.inWipe).length * curve(levelFor(r), cfg.levelScale)),
  );
  const wipeDeaths = mean(sig.map((s) => s.deaths.events.filter((e) => e.inWipe).length));
  const avoidableVsPeers = median(
    nums(
      sig.map((s) =>
        s.avoidableDamage?.peer && s.avoidableDamage.peer.median > 0
          ? pct(s.avoidableDamage.perMinute, s.avoidableDamage.peer.median)
          : null,
      ),
    ),
  );
  const dtpsVsPeers = median(
    nums(sig.map((s) => (s.damageTaken.peer && s.damageTaken.peer.median > 0 ? pct(s.damageTaken.dtps, s.damageTaken.peer.median) : null))),
  );
  const groupDeaths = mean(sig.map((s) => s.deaths.groupTotal - s.deaths.count));
  const groupDeathsScaled = mean(
    withSig.map((r) => (r.signals!.deaths.groupTotal - r.signals!.deaths.count) * curve(levelFor(r), cfg.levelScale)),
  );

  // --- deep-dive (defensives) ---
  // Only analyses of runs this evaluation looks at; below the floor the two signals are n/a.
  const shown = new Set(runs.map((r) => `${r.reportCode}:${r.fightID}`));
  const dd = deepdiveSummary((payload.deepdive ?? []).filter((d) => shown.has(`${d.reportCode}:${d.fightID}`)));
  const ddOk = dd.analyzedRuns >= cfg.confidence.deepdiveMinRuns;
  const defensiveUsage = ddOk ? dd.majorUsage : null;
  const avoidableDeathShare = ddOk ? dd.avoidableDeathShare : null;

  // --- utility ---
  const hasKick = sig.some((s) => s.interrupts.kickCooldownS !== null);
  const kicksVsPeers = median(
    nums(sig.map((s) => (s.interrupts.usage !== null && s.interrupts.peer ? s.interrupts.usage * 100 - s.interrupts.peer.median * 100 : null))),
  );
  const kicksAbsolute = median(nums(sig.map((s) => (s.interrupts.usage !== null ? s.interrupts.usage : null))));
  // A kit with no dispel/purge (rogue, warrior, DK) is n/a, not 0 per run.
  const hasDispel = sig.some((s) => s.dispels.available);
  const dispels = hasDispel ? median(sig.map((s) => s.dispels.count)) : null;

  // --- throughput ---
  // A 0% parse is an unranked log (WCL has not ranked the fight), not a worst-in-bracket run.
  const ranked = (r: EvalRun) => r.parsePercent > 0;
  const medianParse = payload.perDungeon.runs.some(ranked) ? payload.perDungeon.medianParse : null;
  const parseAtTarget = median(runs.filter((r) => ranked(r) && r.keyLevel >= payload.targetLevel - 1).map((r) => r.parsePercent));

  // --- consistency ---
  // Each spread is null unless its own contributing sample size clears the confidence floor.
  const sample = runsUsed;
  const minRuns = cfg.confidence.consistencyMinRuns;
  const rankedSig = withSig.filter(ranked);
  const parseSpread = rankedSig.length >= minRuns ? stddev(rankedSig.map((r) => r.parsePercent)) : null;
  const deathsSpread = sig.length >= minRuns ? stddev(sig.map((s) => s.deaths.count)) : null;
  const damageDeltas = nums(sig.map(damageDeltaPct));
  const damageSpread = damageDeltas.length >= minRuns ? stddev(damageDeltas) : null;

  // --- preparation ---
  const withConsumables = sig.filter((s) => s.consumables !== null);
  const potions = mean(withConsumables.map((s) => s.consumables!.potions));
  const healthstones = mean(withConsumables.map((s) => s.consumables!.healthstones));
  const ilvl = payload.rio?.itemLevel ?? null;

  // --- experience ---
  const { dungeonsCovered, totalDungeonsInSeason, dungeonsAtOrAboveTarget, medianLevel } = payload.perDungeon;
  const coverage = totalDungeonsInSeason > 0 ? dungeonsCovered / totalDungeonsInSeason : null;
  const atTarget = totalDungeonsInSeason > 0 ? dungeonsAtOrAboveTarget / totalDungeonsInSeason : null;
  const medianVsTarget = payload.perDungeon.runs.length > 0 ? medianLevel - payload.targetLevel : null;
  const activity = payload.rio?.derived.runsLast7d ?? null;
  const prevSeasonAll = payload.summary.prevSeason?.all ?? null;

  return {
    role,
    targetLevel: payload.targetLevel,
    runsUsed,
    analyzedRuns: dd.analyzedRuns,
    seasonSlug,
    survival: {
      individualDeaths, individualDeathsScaled, wipeDeaths, avoidableVsPeers, dtpsVsPeers, groupDeaths, groupDeathsScaled,
      defensiveUsage, avoidableDeathShare, avoidableDeathsCount: dd.avoidableDeaths, countedDeathsCount: dd.countedDeaths,
    },
    utility: { hasKick, kicksVsPeers, kicksAbsolute, dispels, hasDispel },
    throughput: { medianParse, parseAtTarget },
    consistency: { sample, parseSpread, deathsSpread, damageSpread },
    preparation: { potions, healthstones, ilvl },
    experience: { coverage, atTarget, medianVsTarget, activity, prevSeasonAll },
  };
}
