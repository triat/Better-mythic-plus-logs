// Per-user settings: "your key" and the legend state. Hosted mode keeps them on the server
// (GET/PUT /api/settings); local mode keeps them in the browser under the same keys as before.
import type { Region } from "../types.ts";
import { STORAGE_KEY, parseStoredKey } from "./keyLevel.ts";
import { isRegion } from "./regions.ts";

export interface Settings { yourKey: number | null; legendOpen: boolean; region: Region | null }
export const DEFAULT_SETTINGS: Settings = { yourKey: null, legendOpen: true, region: null };
export const LEGEND_STORAGE_KEY = "bmpl.legendOpen";
export const REGION_STORAGE_KEY = "bmpl.region";

/** The subset of the Web Storage API we use; null when storage is unavailable. */
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Settings from the browser; defaults when storage is unavailable (private mode) or empty. */
export function readLocalSettings(store: KeyValueStore | null): Settings {
  if (!store) return DEFAULT_SETTINGS;
  try {
    const region = store.getItem(REGION_STORAGE_KEY);
    return {
      yourKey: parseStoredKey(store.getItem(STORAGE_KEY)),
      legendOpen: store.getItem(LEGEND_STORAGE_KEY) !== "0",
      region: isRegion(region) ? region : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Persist a patch in the browser; a no-op when storage is unavailable. */
export function writeLocalSettings(store: KeyValueStore | null, patch: Partial<Settings>): void {
  if (!store) return;
  try {
    if ("yourKey" in patch) {
      if (patch.yourKey === null || patch.yourKey === undefined) store.removeItem(STORAGE_KEY);
      else store.setItem(STORAGE_KEY, String(patch.yourKey));
    }
    if (patch.legendOpen !== undefined) store.setItem(LEGEND_STORAGE_KEY, patch.legendOpen ? "1" : "0");
    if ("region" in patch) {
      if (patch.region === null || patch.region === undefined) store.removeItem(REGION_STORAGE_KEY);
      else store.setItem(REGION_STORAGE_KEY, patch.region);
    }
  } catch {
    /* private mode etc. */
  }
}

/** `GET /api/settings` → Settings; anything malformed falls back to the defaults field by field. */
export function parseServerSettings(raw: unknown): Settings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    yourKey: typeof o.yourKey === "number" ? parseStoredKey(String(o.yourKey)) : null,
    legendOpen: o.legendOpen !== false,
    region: isRegion(o.region) ? o.region : null,
  };
}
