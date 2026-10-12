import type { LookupPayload, PeerComparison, RunSignals } from "../types.ts";
import type { T } from "../i18n/t.ts";
import { higherTone, toneClass } from "./format.ts";

export interface Part { text: string; cls: string }

const pctDelta = (mine: number, median: number) => ((mine - median) / median) * 100;

/** Percent delta against the peers' median (lower is better for DTPS and avoidable damage); null without a usable median. */
export const vsPeers = (mine: number, peer: PeerComparison | null): number | null =>
  peer && peer.median > 0 ? pctDelta(mine, peer.median) : null;

/** Kicks as the run rows count them: capacity rounded, the usage gap vs peers in points (higher is better). */
export function kickFigures(i: RunSignals["interrupts"]): { count: number; noKick: boolean; cap: number | null; peerPct: number | null; deltaPts: number | null } {
  const cap = i.kickCooldownS !== null && i.capacity !== null && i.usage !== null ? Math.round(i.capacity) : null;
  const peer = cap !== null && i.peer ? i.peer.median : null;
  return {
    count: i.count, noKick: i.kickCooldownS === null, cap,
    peerPct: peer === null ? null : Math.round(peer * 100),
    deltaPts: peer === null ? null : (i.usage! - peer) * 100,
  };
}

/** The kicks part of a run row ("kicks 8/20 (peer 30%)"). */
export function kicksPart(t: T, i: RunSignals["interrupts"]): Part {
  const k = kickFigures(i);
  if (k.noKick) return { text: t("runs.kicksNoSpec", { n: k.count }), cls: "faint" };
  if (k.cap === null) return { text: t("runs.kicks", { n: k.count }), cls: "" };
  if (k.peerPct !== null) return { text: t("runs.kicksCap", { n: k.count, cap: k.cap, peer: k.peerPct }), cls: toneClass(higherTone(k.deltaPts!)) };
  return { text: t("runs.kicksCapNoPeer", { n: k.count, cap: k.cap }), cls: "" };
}

/** The dispels part of a run row ("dispels 9"). */
export const dispelsPart = (t: T, d: RunSignals["dispels"]): Part =>
  d.available ? { text: t("runs.dispels", { n: d.count }), cls: "" } : { text: t("runs.dispelsNoSpec", { n: d.count }), cls: "faint" };

export function missingDungeons(p: LookupPayload): string[] {
  const covered = new Set(p.perDungeon.runs.map((r) => r.encounterID));
  return p.seasonDungeons.filter((d) => !covered.has(d.id)).map((d) => d.name);
}
