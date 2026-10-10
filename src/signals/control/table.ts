// The crowd-control table of the self-review's Control pillar (docs/superpowers/specs/2026-10-10-self-review-control-
// design.md, decisions 1 and 2): season data, versioned by file like the avoidable list and the defensives.
import mn2 from "./cc-mn-2.json";

export type CcCategory = "stun" | "incapacitate" | "disorient" | "fear" | "silence" | "knock";
export const CC_CATEGORIES: readonly CcCategory[] = ["stun", "incapacitate", "disorient", "fear", "silence", "knock"];

export interface CcEntry {
  id: number;
  name: string;
  category: CcCategory;
  /** A knock leaves no debuff: it is read as a cast. */
  kind: "debuff" | "cast";
  /** Applied by the player's pet (credited to its owner). */
  pet?: true;
  /** Another id of the same spell, applied by the same cast (Blind's area effect): counted as that spell's uses. */
  group?: number;
}
/** `specs` is keyed `Class:Spec` or `Class:*` (WCL's spacing-free names, as `src/signals/kick-cooldowns.ts`). */
export interface CcTable { version: string; source: string; specs: Record<string, CcEntry[]> }

export const CC_TABLE = mn2 as CcTable;

const sorted = (ids: Iterable<number>): number[] => [...new Set(ids)].sort((a, b) => a - b);

/** Every id the filter asks WCL for, by kind, deduplicated and sorted. */
export function ccIds(t: CcTable = CC_TABLE): { debuffs: number[]; casts: number[] } {
  const all = Object.values(t.specs).flat();
  return { debuffs: sorted(all.filter((e) => e.kind === "debuff").map((e) => e.id)), casts: sorted(all.filter((e) => e.kind === "cast").map((e) => e.id)) };
}

/** The events filter of REPORT_RUN_CONTROL_QUERY: debuff applications and knock casts of the table. */
export function ccFilterExpression(t: CcTable = CC_TABLE): string {
  const { debuffs, casts } = ccIds(t);
  const parts = [`(type = "applydebuff" and ability.id in (${debuffs.join(",")}))`];
  if (casts.length > 0) parts.push(`(type = "cast" and ability.id in (${casts.join(",")}))`);
  return parts.join(" or ");
}

/** `kind:id` → entry; an id listed for several specs keeps its first entry. */
export function ccIndex(t: CcTable = CC_TABLE): Map<string, CcEntry> {
  const out = new Map<string, CcEntry>();
  for (const e of Object.values(t.specs).flat()) if (!out.has(`${e.kind}:${e.id}`)) out.set(`${e.kind}:${e.id}`, e);
  return out;
}

/** A spec's entries: `Class:*` then `Class:Spec`. */
export const specCc = (className: string, spec: string, t: CcTable = CC_TABLE): CcEntry[] =>
  [...(t.specs[`${className}:*`] ?? []), ...(t.specs[`${className}:${spec}`] ?? [])];
