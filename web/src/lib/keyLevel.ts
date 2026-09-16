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

/**
 * Shown on a tab that was not evaluated for "your key": an explicit key that differs from the
 * tab's effective level, or "auto" while the tab's level was requested explicitly.
 */
export function reevalHint(yourKey: number | null, tab: { targetLevel: number; targetAutoDetected: boolean }): ReevalHint | null {
  if (yourKey === null) {
    return tab.targetAutoDetected ? null : { label: "Your key is auto", action: "re-evaluate with auto-detected level" };
  }
  if (yourKey === tab.targetLevel) return null;
  return { label: `Your key is +${yourKey}`, action: `re-evaluate for +${yourKey}` };
}
