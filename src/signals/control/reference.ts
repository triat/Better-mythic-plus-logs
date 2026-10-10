// "Compared with the average player of the spec" (docs/superpowers/specs/2026-10-10-self-review-control-design.md,
// decision 7): per-spec medians of crowd-control uses per 10 minutes, collected by scripts/calibration/control.ts.
import mn2 from "./reference-mn-2.json";
import { CC_TABLE, type CcTable } from "./table.ts";

export const MIN_REFERENCE_SAMPLES = 20;
/** A reference measured in fewer dungeons says more about those dungeons than about the spec → n/a. */
export const MIN_REFERENCE_DUNGEONS = 4;
/** Spec "Numbers": a reference median under 0.5 use per 10 minutes means no real kit → n/a. */
export const KIT_FLOOR = 0.5;

export interface ControlReferenceEntry {
  median: number;
  p25: number;
  p75: number;
  samples: number;
  /** Dungeons the samples come from; every dungeon weighs the same in the quantiles (`summariseByDungeon`). */
  dungeons?: number;
}
export interface ControlReference { version: string; tableVersion: string; source: string; scope: string; specs: Record<string, ControlReferenceEntry> }

export const CONTROL_REFERENCE = mn2 as ControlReference;

/** The spec's median, or null: no entry, under 20 samples or 4 dungeons, under the kit floor, or collected on another
 * table version. */
export function referenceFor(className: string, spec: string, ref: ControlReference = CONTROL_REFERENCE, table: CcTable = CC_TABLE): number | null {
  if (ref.tableVersion !== table.version) return null;
  const e = ref.specs[`${className}:${spec}`];
  if (!e || e.samples < MIN_REFERENCE_SAMPLES || (e.dungeons ?? 0) < MIN_REFERENCE_DUNGEONS || e.median < KIT_FLOOR) return null;
  return e.median;
}

/**
 * Quantile `q` of weighted values: each value sits at the middle of its weight on a 0–1 scale, and the quantile is
 * interpolated between neighbours. With equal weights it is the usual median ([1, 2, 3, 4] → 2.5).
 */
export function weightedQuantile(items: { value: number; weight: number }[], q: number): number {
  const xs = items.filter((x) => x.weight > 0).sort((a, b) => a.value - b.value);
  if (xs.length === 0) return Number.NaN;
  const total = xs.reduce((s, x) => s + x.weight, 0);
  let cum = 0;
  const at = xs.map((x) => { const p = (cum + x.weight / 2) / total; cum += x.weight; return p; });
  if (q <= at[0]!) return xs[0]!.value;
  for (let i = 1; i < xs.length; i++) {
    if (q <= at[i]!) return xs[i - 1]!.value + ((xs[i]!.value - xs[i - 1]!.value) * (q - at[i - 1]!)) / (at[i]! - at[i - 1]!);
  }
  return xs[xs.length - 1]!.value;
}

/** A spec's reference entry from its samples grouped by dungeon, every dungeon weighing the same (rounded to 0.01). */
export function summariseByDungeon(byDungeon: ReadonlyMap<number, readonly number[]>): ControlReferenceEntry | null {
  const groups = [...byDungeon.values()].filter((xs) => xs.length > 0);
  if (groups.length === 0) return null;
  const items = groups.flatMap((xs) => xs.map((value) => ({ value, weight: 1 / xs.length })));
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    median: round(weightedQuantile(items, 0.5)),
    p25: round(weightedQuantile(items, 0.25)),
    p75: round(weightedQuantile(items, 0.75)),
    samples: items.length,
    dungeons: groups.length,
  };
}
