import type { MPlusRun } from "../mplus.ts";
import { median } from "./peers.ts";
import type { RioProfile, RunSignals } from "./types.ts";

export interface SignalSummary {
  runsWithSignals: number;
  timedShown: number | null;
  avgDeaths: number | null;
  deathsInWipes: number | null;
  dtpsDeltaPct: number | null;
  kicksDeltaPts: number | null;
  avoidableDeltaPct: number | null;
  ilvl: number | null;
  recentTimed: number | null;
  recentTotal: number | null;
  prevSeason: { slug: string; all: number; best: { role: "dps" | "healer" | "tank"; score: number } } | null;
}

const pctDelta = (mine: number, peerMedian: number): number | null =>
  peerMedian > 0 ? ((mine - peerMedian) / peerMedian) * 100 : null;

/** Cross-run aggregates shown as tiles / compare rows. Pure. */
export function signalSummary(runs: MPlusRun[], rio: RioProfile | null): SignalSummary {
  const sig = runs.map((r) => r.signals).filter((s): s is RunSignals => s !== undefined);
  const n = sig.length;

  const dtps = sig.map((s) => (s.damageTaken.peer ? pctDelta(s.damageTaken.dtps, s.damageTaken.peer.median) : null))
    .filter((v): v is number => v !== null);
  const kicks = sig.map((s) => (s.interrupts.usage !== null && s.interrupts.peer ? (s.interrupts.usage - s.interrupts.peer.median) * 100 : null))
    .filter((v): v is number => v !== null);
  const avoid = sig.map((s) => (s.avoidableDamage?.peer ? pctDelta(s.avoidableDamage.perMinute, s.avoidableDamage.peer.median) : null))
    .filter((v): v is number => v !== null);

  let prevSeason: SignalSummary["prevSeason"] = null;
  const prev = rio?.seasons[1];
  if (prev) {
    const roles = [
      { role: "dps" as const, score: prev.dps },
      { role: "healer" as const, score: prev.healer },
      { role: "tank" as const, score: prev.tank },
    ].sort((a, b) => b.score - a.score);
    prevSeason = { slug: prev.slug, all: prev.all, best: roles[0]! };
  }

  return {
    runsWithSignals: n,
    timedShown: n > 0 ? sig.filter((s) => s.keystone.timed).length : null,
    avgDeaths: n > 0 ? sig.reduce((a, s) => a + s.deaths.count, 0) / n : null,
    deathsInWipes: n > 0 ? sig.reduce((a, s) => a + s.deaths.events.filter((e) => e.inWipe).length, 0) : null,
    dtpsDeltaPct: median(dtps),
    kicksDeltaPts: median(kicks),
    avoidableDeltaPct: median(avoid),
    ilvl: rio?.itemLevel ?? null,
    recentTimed: rio ? rio.derived.recentTimed : null,
    recentTotal: rio ? rio.derived.recentTotal : null,
    prevSeason,
  };
}
