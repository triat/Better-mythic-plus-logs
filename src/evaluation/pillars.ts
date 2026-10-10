// The five pillars of the self-review (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md): a regrouping
// of today's sub-signals, scored with today's curves and weights. Nothing here feeds the global score or the verdict;
// a `pillarOnly` sub-signal (utility.crowdControl, docs/superpowers/specs/2026-10-10-self-review-control-design.md)
// exists only here.
import type { EvidenceSource } from "./axes/index.ts";
import { PILLAR_KEYS, type AxisScore, type PillarKey, type PillarScore } from "./types.ts";

export const PILLAR_SOURCES: Record<PillarKey, readonly EvidenceSource[]> = {
  damage: ["throughput.medianParse", "throughput.parseAtTarget"],
  survival: ["survival.individualDeaths", "survival.wipeDeaths", "survival.groupDeaths", "survival.defensiveUsage", "survival.avoidableDeaths"],
  avoidable: ["survival.avoidableVsPeers", "survival.dtpsVsPeers"],
  interrupts: ["utility.kicksVsPeers", "utility.kicksAbsolute"],
  control: ["utility.dispels", "utility.crowdControl"],
};

/** Shown beside the pillars, never scored into one. */
export const CONTEXT_SOURCES: readonly EvidenceSource[] = [
  "preparation.potions", "preparation.healthstones", "preparation.ilvlVsLevel",
  "consistency.parseSpread", "consistency.deathsSpread", "consistency.damageSpread",
  "experience.coverage", "experience.atTarget", "experience.medianVsTarget", "experience.activity", "experience.prevSeasonBonus",
];

export const pillarOf = (source: string): PillarKey | null =>
  PILLAR_KEYS.find((k) => (PILLAR_SOURCES[k] as readonly string[]).includes(source)) ?? null;

/** Each pillar's weighted mean of its sub-signals' curve scores: what `scoreAxis` computes over the same sub-signals. */
export function pillarScores(axes: AxisScore[]): PillarScore[] {
  const all = axes.flatMap((a) => [...a.evidence, ...(a.pillarOnly ?? [])]);
  return PILLAR_KEYS.map((key) => {
    const sources = PILLAR_SOURCES[key] as readonly string[];
    const evidence = all
      .filter((e) => sources.includes(e.source) && typeof e.weight === "number" && e.weight > 0 && typeof e.score === "number")
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    let num = 0;
    let den = 0;
    for (const e of evidence) {
      num += e.weight! * e.score!;
      den += e.weight!;
    }
    return { key, score: den > 0 ? Math.round(num / den) : null, evidence };
  });
}
