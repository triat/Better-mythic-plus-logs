import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { en } from "./i18n/en.ts";
import { fr } from "./i18n/fr.ts";
import { makeT } from "./i18n/t.ts";
import type { T } from "./i18n/t.ts";
import { effectiveLocale } from "./lib/locale.ts";
import type { Locale } from "./lib/locale.ts";

export interface LocaleContext { t: T; locale: Locale; setLocale: (l: Locale) => void }
const DICTS = { en, fr } as const;
const Ctx = createContext<LocaleContext>({ t: makeT(en, "en"), locale: "en", setLocale: () => {} });

/**
 * `saved` is the remembered choice (settings.locale, or bmpl.locale for the anonymous screens), null = follow
 * the browser. `persist` receives every explicit pick. <html lang> follows the effective locale.
 */
export function LocaleProvider({ saved, persist, children }: { saved: Locale | null; persist: (l: Locale) => void; children: ReactNode }) {
  const [picked, setPicked] = useState<Locale | null>(saved);
  useEffect(() => setPicked(saved), [saved]);
  const locale = effectiveLocale(picked, typeof navigator === "undefined" ? undefined : navigator.language);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = useCallback((l: Locale) => { setPicked(l); persist(l); }, [persist]);
  const value = useMemo<LocaleContext>(() => ({ t: makeT(DICTS[locale], locale), locale, setLocale }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = (): LocaleContext => useContext(Ctx);
