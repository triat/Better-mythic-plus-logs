// Per-user settings: "your key", the legend state, the remembered region and locale. Hosted mode keeps them
// on the server (GET/PUT /api/settings); local mode keeps them in the browser under the same keys as before.
import type { Region } from "../types.ts";
import { STORAGE_KEY, parseStoredKey } from "./keyLevel.ts";
import { isLocale } from "./locale.ts";
import type { Locale } from "./locale.ts";
import { isRegion } from "./regions.ts";
import { LIVE_ROLES, isLiveRole, isLiveSort } from "./live/roster.ts";
import type { LiveRole, LiveSort } from "./live/roster.ts";

export interface Settings {
  yourKey: number | null;
  legendOpen: boolean;
  region: Region | null;
  locale: Locale | null;
  liveSort: LiveSort;
  liveRoles: LiveRole[];
  liveClasses: string[];
}
export const DEFAULT_SETTINGS: Settings = { yourKey: null, legendOpen: true, region: null, locale: null, liveSort: "arrival", liveRoles: [...LIVE_ROLES], liveClasses: [] };
export const LEGEND_STORAGE_KEY = "bmpl.legendOpen";
export const REGION_STORAGE_KEY = "bmpl.region";
/** `null` (absent) = follow the browser's language; also read by the anonymous screens (sign-in, /privacy, /help). */
export const LOCALE_STORAGE_KEY = "bmpl.locale";
export const LIVE_SORT_STORAGE_KEY = "bmpl.liveSort";
export const LIVE_ROLES_STORAGE_KEY = "bmpl.liveRoles";
export const LIVE_CLASSES_STORAGE_KEY = "bmpl.liveClasses";

/** The subset of the Web Storage API we use; null when storage is unavailable. */
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** A JSON array in storage; a malformed value or a bad item falls back to `fallback`, never throws. */
function readJsonArray<T>(raw: string | null, isItem: (v: unknown) => v is T, fallback: T[]): T[] {
  if (raw === null) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every(isItem) ? v : fallback;
  } catch {
    return fallback;
  }
}
const isString = (v: unknown): v is string => typeof v === "string";

/** Settings from the browser; defaults when storage is unavailable (private mode) or empty. */
export function readLocalSettings(store: KeyValueStore | null): Settings {
  if (!store) return DEFAULT_SETTINGS;
  try {
    const region = store.getItem(REGION_STORAGE_KEY);
    const locale = store.getItem(LOCALE_STORAGE_KEY);
    const liveSort = store.getItem(LIVE_SORT_STORAGE_KEY);
    return {
      yourKey: parseStoredKey(store.getItem(STORAGE_KEY)),
      legendOpen: store.getItem(LEGEND_STORAGE_KEY) !== "0",
      region: isRegion(region) ? region : null,
      locale: isLocale(locale) ? locale : null,
      liveSort: isLiveSort(liveSort) ? liveSort : DEFAULT_SETTINGS.liveSort,
      liveRoles: readJsonArray(store.getItem(LIVE_ROLES_STORAGE_KEY), isLiveRole, [...LIVE_ROLES]),
      liveClasses: readJsonArray(store.getItem(LIVE_CLASSES_STORAGE_KEY), isString, []),
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
    if ("locale" in patch) {
      if (patch.locale === null || patch.locale === undefined) store.removeItem(LOCALE_STORAGE_KEY);
      else store.setItem(LOCALE_STORAGE_KEY, patch.locale);
    }
    if (patch.liveSort !== undefined) store.setItem(LIVE_SORT_STORAGE_KEY, patch.liveSort);
    if (patch.liveRoles !== undefined) store.setItem(LIVE_ROLES_STORAGE_KEY, JSON.stringify(patch.liveRoles));
    if (patch.liveClasses !== undefined) store.setItem(LIVE_CLASSES_STORAGE_KEY, JSON.stringify(patch.liveClasses));
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
    locale: isLocale(o.locale) ? o.locale : null,
    liveSort: isLiveSort(o.liveSort) ? o.liveSort : DEFAULT_SETTINGS.liveSort,
    liveRoles: Array.isArray(o.liveRoles) && o.liveRoles.every(isLiveRole) ? o.liveRoles : [...LIVE_ROLES],
    liveClasses: Array.isArray(o.liveClasses) && o.liveClasses.every((s) => typeof s === "string") ? o.liveClasses : [],
  };
}
