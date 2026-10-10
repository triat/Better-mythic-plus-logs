// "Compared with the average player of the spec" (docs/superpowers/specs/2026-10-10-self-review-control-design.md,
// decision 7): per-spec medians of crowd-control uses per 10 minutes, collected by scripts/calibration/control.ts.
import mn2 from "./reference-mn-2.json";
import { CC_TABLE, type CcTable } from "./table.ts";

export const MIN_REFERENCE_SAMPLES = 20;
/** Spec "Numbers": a reference median under 0.5 use per 10 minutes means no real kit → n/a. */
export const KIT_FLOOR = 0.5;

export interface ControlReferenceEntry { median: number; p25: number; p75: number; samples: number }
export interface ControlReference { version: string; tableVersion: string; source: string; scope: string; specs: Record<string, ControlReferenceEntry> }

export const CONTROL_REFERENCE = mn2 as ControlReference;

/** The spec's median, or null: no entry, under 20 samples, under the kit floor, or collected on another table version. */
export function referenceFor(className: string, spec: string, ref: ControlReference = CONTROL_REFERENCE, table: CcTable = CC_TABLE): number | null {
  if (ref.tableVersion !== table.version) return null;
  const e = ref.specs[`${className}:${spec}`];
  if (!e || e.samples < MIN_REFERENCE_SAMPLES || e.median < KIT_FLOOR) return null;
  return e.median;
}
