import type { SignalSummary } from "../signals/summary.ts";
import type { RioProfile, RunSignals } from "../signals/types.ts";
import { mean, median, stddev } from "./curve.ts";
import type { Role } from "./types.ts";

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
}

export interface EvalInputs {
  role: Role;
  targetLevel: number;
  runsUsed: number;
  seasonSlug: string | null;
  survival: {
    individualDeaths: number | null;
    wipeDeaths: number | null;
    avoidableVsPeers: number | null;
    dtpsVsPeers: number | null;
    groupDeaths: number | null;
  };
  utility: {
    hasKick: boolean;
    kicksVsPeers: number | null;
    kicksAbsolute: number | null;
    dispels: number | null;
    anyDispel: boolean;
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

export function collectInputs(payload: EvalPayload): EvalInputs {
  const runs = evalRuns(payload);
  const withSig = runs.filter((r) => r.signals !== undefined);
  const sig = withSig.map((r) => r.signals!);

  const role = detectRole(runs, payload.metric);
  const runsUsed = withSig.length;
  const seasonSlug = payload.rio?.seasons[0]?.slug ?? null;

  // --- survival ---
  const individualDeaths = mean(sig.map((s) => s.deaths.events.filter((e) => !e.inWipe).length));
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

  // --- utility ---
  const hasKick = sig.some((s) => s.interrupts.kickCooldownS !== null);
  const kicksVsPeers = median(
    nums(sig.map((s) => (s.interrupts.usage !== null && s.interrupts.peer ? s.interrupts.usage * 100 - s.interrupts.peer.median * 100 : null))),
  );
  const kicksAbsolute = median(nums(sig.map((s) => (s.interrupts.usage !== null ? s.interrupts.usage : null))));
  const dispels = median(sig.map((s) => s.dispels.count));
  const anyDispel = sig.some((s) => s.dispels.count > 0);

  // --- throughput ---
  const medianParse = payload.perDungeon.runs.length > 0 ? payload.perDungeon.medianParse : null;
  const parseAtTarget = median(runs.filter((r) => r.keyLevel >= payload.targetLevel - 1).map((r) => r.parsePercent));

  // --- consistency ---
  const sample = runsUsed;
  const parseSpread = stddev(withSig.map((r) => r.parsePercent));
  const deathsSpread = stddev(sig.map((s) => s.deaths.count));
  const damageSpread = stddev(nums(sig.map(damageDeltaPct)));

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
    seasonSlug,
    survival: { individualDeaths, wipeDeaths, avoidableVsPeers, dtpsVsPeers, groupDeaths },
    utility: { hasKick, kicksVsPeers, kicksAbsolute, dispels, anyDispel },
    throughput: { medianParse, parseAtTarget },
    consistency: { sample, parseSpread, deathsSpread, damageSpread },
    preparation: { potions, healthstones, ilvl },
    experience: { coverage, atTarget, medianVsTarget, activity, prevSeasonAll },
  };
}
