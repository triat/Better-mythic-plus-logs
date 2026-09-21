// The two UI languages, server side: the settings column and /api/docs?lang. Mirrors web/src/lib/locale.ts.
export type Locale = "en" | "fr";
export const LOCALES = ["en", "fr"] as const;
export const isLocale = (v: unknown): v is Locale => v === "en" || v === "fr";
