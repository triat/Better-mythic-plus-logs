// "Your key": the key level every lookup is evaluated for. null = auto-detect.

export const KEY_MIN = 2;
export const KEY_MAX = 40;
export const DEFAULT_KEY = 18;
export const STORAGE_KEY = "bmpl.yourKey";

const clamp = (n: number) => Math.min(KEY_MAX, Math.max(KEY_MIN, n));

/** From auto, the first press lands on `fallback` (the active tab's level) rather than jumping. */
export function stepKey(current: number | null, dir: 1 | -1, fallback: number | null): number {
  if (current === null) return clamp(fallback ?? DEFAULT_KEY);
  return clamp(current + dir);
}

export function parseStoredKey(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= KEY_MIN && n <= KEY_MAX ? n : null;
}

export interface ReevalHint { label: string; action: string }

/** Shown on a tab whose lookup was requested for another level than "your key". */
export function reevalHint(yourKey: number | null, tabLevel: number | null): ReevalHint | null {
  if (yourKey === tabLevel) return null;
  return yourKey === null
    ? { label: "Your key is auto", action: "re-evaluate with auto-detected level" }
    : { label: `Your key is +${yourKey}`, action: `re-evaluate for +${yourKey}` };
}
