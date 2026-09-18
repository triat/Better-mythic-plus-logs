import shippedJson from "./defensives.json" with { type: "json" };
import { resolveDefensivesPath } from "../setup.ts";
import type { DefensiveKind, DefensiveSpell, EffectiveEntry, EntryOrigin, LoadedTables, Override, OverrideEntry, ShippedTable, SpecDefensives } from "./types.ts";

export const SHIPPED = shippedJson as ShippedTable;

const KINDS: readonly DefensiveKind[] = ["major", "immunity", "minor"];
const KEY_RE = /^[A-Za-z]+:(\*|[A-Za-z]+)$/;

/** WCL reports multi-word classes without spaces ("DeathKnight"); normalize so "Death Knight" matches too. */
export const specKey = (className: string, spec: string): string => `${className.replace(/\s+/g, "")}:${spec.replace(/\s+/g, "")}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (msg: string): never => { throw new Error(`defensives override: ${msg}`); };

function validateEntry(e: unknown, path: string): OverrideEntry {
  if (!isObj(e)) return fail(`${path}: must be an object`);
  if (typeof e.id !== "number" || !Number.isInteger(e.id) || e.id <= 0) return fail(`${path}: id must be a positive integer`);
  const out: OverrideEntry = { id: e.id };
  if (e.ignore !== undefined) { if (typeof e.ignore !== "boolean") return fail(`${path}: ignore must be a boolean`); out.ignore = e.ignore; }
  if (e.name !== undefined) { if (typeof e.name !== "string" || !e.name.trim()) return fail(`${path}: name must be a non-empty string`); out.name = e.name; }
  for (const k of ["cooldownS", "durationS"] as const) {
    if (e[k] !== undefined) {
      if (typeof e[k] !== "number" || !Number.isFinite(e[k]) || (e[k] as number) < 0 || (k === "cooldownS" && (e[k] as number) === 0)) return fail(`${path}: ${k} must be a ${k === "cooldownS" ? "positive" : "non-negative"} number`);
      out[k] = e[k] as number;
    }
  }
  if (e.kind !== undefined) { if (!KINDS.includes(e.kind as DefensiveKind)) return fail(`${path}: kind must be one of ${KINDS.join(", ")}`); out.kind = e.kind as DefensiveKind; }
  return out;
}

/** Structural validation; throws with the offending key/id in the message. */
export function validateOverride(obj: unknown): Override {
  if (!isObj(obj)) return fail("must be an object keyed by \"Class:Spec\"");
  const out: Override = {};
  for (const [key, list] of Object.entries(obj)) {
    if (!KEY_RE.test(key)) return fail(`key "${key}" must look like "Class:Spec" or "Class:*"`);
    if (!Array.isArray(list)) return fail(`${key}: must be an array`);
    out[key] = list.map((e, i) => validateEntry(e, `${key}[${i}]${isObj(e) && typeof e.id === "number" ? ` (id ${e.id})` : ""}`));
  }
  return out;
}

const complete = (e: OverrideEntry): e is OverrideEntry & DefensiveSpell =>
  typeof e.name === "string" && typeof e.cooldownS === "number" && typeof e.durationS === "number" && e.kind !== undefined;

/** Effective list for a class/spec: shipped Class:* ⊕ Class:Spec, then override entries of both keys. */
export function specDefensives(shipped: ShippedTable, override: Override, className: string, spec: string): SpecDefensives {
  const key = specKey(className, spec);
  const starKey = specKey(className, "*");
  const keys = [starKey, key];
  const byId = new Map<number, EffectiveEntry>();
  let present = false;
  for (const k of keys) {
    const list = shipped.specs[k];
    if (!list) continue;
    present = true;
    for (const e of list) byId.set(e.id, { ...e, origin: "shipped" });
  }
  const ignored: number[] = [];
  for (const k of keys) {
    const list = override[k];
    if (!list) continue;
    present = true;
    for (const e of list) {
      if (e.ignore) { byId.delete(e.id); if (!ignored.includes(e.id)) ignored.push(e.id); continue; }
      const cur = byId.get(e.id);
      if (cur) {
        byId.set(e.id, { ...cur, ...(e.name !== undefined ? { name: e.name } : {}), ...(e.cooldownS !== undefined ? { cooldownS: e.cooldownS } : {}), ...(e.durationS !== undefined ? { durationS: e.durationS } : {}), ...(e.kind !== undefined ? { kind: e.kind } : {}), origin: e.origin ?? "override" });
      } else if (complete(e)) {
        byId.set(e.id, { id: e.id, name: e.name, cooldownS: e.cooldownS, durationS: e.durationS, kind: e.kind, origin: e.origin ?? "override" });
      }
      // An incomplete entry for an unknown id is ignored here; applyPatch/validate refuse to write one.
    }
  }
  return { key, entries: [...byId.values()], ignored, tableMissing: !present };
}

/** Pure list merge: `ignore` replaces any earlier patch for the id; otherwise the patch's fields merge over the previous patch (a patch after an ignore starts over). A patch's `origin` is kept on the result. */
export function mergeEntry(list: OverrideEntry[], patch: OverrideEntry): OverrideEntry[] {
  const out = [...list];
  const idx = out.findIndex((e) => e.id === patch.id);
  let next: OverrideEntry;
  if (patch.ignore) next = { id: patch.id, ignore: true, ...(patch.origin ? { origin: patch.origin } : {}) };
  else {
    const prev = idx >= 0 && !out[idx]!.ignore ? out[idx]! : { id: patch.id };
    const { ignore: _i, ...fields } = patch;
    next = { ...prev, ...fields };
  }
  if (idx >= 0) out[idx] = next; else out.push(next);
  return out;
}

/** Every entry of `override` tagged with `origin` (a loader helper; pure). */
export const tagOrigin = (override: Override, origin: Exclude<EntryOrigin, "shipped">): Override =>
  Object.fromEntries(Object.entries(override).map(([k, list]) => [k, list.map((e) => ({ ...e, origin }))]));

/** `base` with each `{ key, patch }` merged in and tagged `origin` (pure). Incomplete unknown ids are kept and ignored by specDefensives. */
export function layerPatches(base: Override, patches: Array<{ key: string; patch: OverrideEntry }>, origin: Exclude<EntryOrigin, "shipped">): Override {
  const out: Override = { ...base };
  for (const { key, patch } of patches) out[key] = mergeEntry(out[key] ?? [], { ...patch, origin });
  return out;
}

/**
 * Pure: returns a new override with `patch` merged under `key`. A known id (in `effective`)
 * keeps only the patched fields; `ignore` replaces any earlier patch; an unknown id must be complete.
 */
export function applyPatch(override: Override, key: string, patch: OverrideEntry, effective: SpecDefensives): Override {
  if (!KEY_RE.test(key)) fail(`key "${key}" must look like "Class:Spec" or "Class:*"`);
  const list = mergeEntry(override[key] ?? [], patch);
  if (!patch.ignore) {
    const known = effective.entries.some((e) => e.id === patch.id) || effective.ignored.includes(patch.id);
    const next = list.find((e) => e.id === patch.id)!;
    if (!known && !complete(next)) fail(`id ${patch.id} is not in the table for ${key}: name, cooldownS, durationS and kind are required to add it`);
  }
  return { ...override, [key]: list };
}

export async function saveOverride(path: string, override: Override): Promise<void> {
  await Bun.write(path, JSON.stringify(override, null, 2) + "\n");
}

/** Shipped table + the user's override file (if any). Never throws: a bad file yields a warning. */
export async function loadDefensives(): Promise<LoadedTables> {
  const overridePath = await resolveDefensivesPath();
  const file = Bun.file(overridePath);
  if (!(await file.exists())) return { shipped: SHIPPED, override: {}, source: "file", overridePath };
  try {
    return { shipped: SHIPPED, override: validateOverride(JSON.parse(await file.text())), source: "file", overridePath };
  } catch (e) {
    return { shipped: SHIPPED, override: {}, source: "file", overridePath, warning: `bmpl: ignoring ${overridePath}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

let cachedTables: Promise<LoadedTables> | null = null;
/** Process-wide effective tables; warns once on stderr. Call resetDefensives() after writing the override. */
export const getDefensives = (): Promise<LoadedTables> => {
  if (!cachedTables) cachedTables = loadDefensives().then((t) => { if (t.warning) console.error(t.warning); return t; });
  return cachedTables;
};
export const resetDefensives = (): void => { cachedTables = null; };
