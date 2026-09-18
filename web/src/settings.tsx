import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api.ts";
import { DEFAULT_SETTINGS, readLocalSettings, writeLocalSettings } from "./lib/settings.ts";
import type { KeyValueStore, Settings } from "./lib/settings.ts";

interface SettingsContext { settings: Settings; update: (patch: Partial<Settings>) => void }
const Ctx = createContext<SettingsContext>({ settings: DEFAULT_SETTINGS, update: () => {} });

const browserStore = (): KeyValueStore | null => {
  try { return localStorage; } catch { return null; }
};

/**
 * Hosted: `initial` came from GET /api/settings at boot and every change is PUT back (fire and forget —
 * a failed write only means the old value comes back on the next boot). Local: the browser's storage.
 */
export function SettingsProvider({ hosted, initial, children }: { hosted: boolean; initial: Settings | null; children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => initial ?? (hosted ? DEFAULT_SETTINGS : readLocalSettings(browserStore())));
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (hosted) void api.putSettings(patch);
    else writeLocalSettings(browserStore(), patch);
  }, [hosted]);
  return <Ctx.Provider value={{ settings, update }}>{children}</Ctx.Provider>;
}

export const useSettings = (): SettingsContext => useContext(Ctx);
