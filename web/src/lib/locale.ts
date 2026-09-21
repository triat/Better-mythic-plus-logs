// The two UI languages. Detection from the browser, the remembered choice on top (design: spec
// 2026-09-21-french-locale-design.md § Locale model). Mirrors src/hosted/locale.ts on purpose (types only cross).
export type Locale = "en" | "fr";
export const LOCALES = ["en", "fr"] as const;
export const isLocale = (v: unknown): v is Locale => v === "en" || v === "fr";
export const LOCALE_LABELS: Record<Locale, string> = { en: "EN", fr: "FR" };
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

/** "fr", "fr-FR", "FR-ca" → fr; anything else, including nothing, → en. */
export const detectLocale = (navigatorLanguage: string | undefined): Locale =>
  (navigatorLanguage ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";

/** The remembered choice wins; otherwise the browser decides. The only place this rule lives. */
export const effectiveLocale = (saved: Locale | null, navigatorLanguage: string | undefined): Locale =>
  saved ?? detectLocale(navigatorLanguage);

const INTL_TAG: Record<Locale, string> = { en: "en-GB", fr: "fr-FR" };

/**
 * Thousands separated by U+202F in both locales (never wraps inside a number — what fmtPts already does),
 * decimal point / comma per locale, at most `maxFractionDigits` decimals, U+2212 for the minus sign.
 */
export function fmtNumber(locale: Locale, n: number, maxFractionDigits = 2): string {
  const parts = new Intl.NumberFormat(INTL_TAG[locale], { maximumFractionDigits: maxFractionDigits, useGrouping: true }).formatToParts(Math.abs(n));
  const s = parts.map((p) => (p.type === "group" ? " " : p.value)).join("");
  return (n < 0 ? "−" : "") + s;
}

/** "21 Sept" / "21 sept." — the run list and the deep-dive ages that show a date. */
export const fmtDate = (locale: Locale, ms: number): string =>
  new Intl.DateTimeFormat(INTL_TAG[locale], { day: "numeric", month: "short", timeZone: "UTC" }).format(ms);

/** ICU categories we use: French says "1 run" for 0 and 1, English only for 1. */
export const pluralCategory = (locale: Locale, n: number): "one" | "other" =>
  new Intl.PluralRules(INTL_TAG[locale]).select(n) === "one" ? "one" : "other";
