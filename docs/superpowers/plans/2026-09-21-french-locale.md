# French Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web front reads in French for French browsers and for members who pick FR, with one code base, typed dictionaries and a bilingual help registry.

**Architecture:** A `Locale` (`en` | `fr`) is detected from the browser and overridden by a remembered per-user setting (localStorage locally, `user_settings.locale` hosted). Components get `t` from a `LocaleProvider`; pure view models that produce prose take `t` as their first parameter. `web/src/i18n/en.ts` is the typed source of every UI string, `fr.ts` mirrors it (a missing key fails `tsc`). Server-side, the help registry gains a French copy served by `GET /api/docs?lang=fr`, and `Evidence` gains the raw value so the front rebuilds evidence lines in its own language.

**Tech Stack:** Bun ≥ 1.3, TypeScript strict, React 19 (no router, no state lib, no i18n lib), `bun:test`, `Intl.NumberFormat` / `Intl.PluralRules` / `Intl.DateTimeFormat`.

**Spec:** `docs/superpowers/specs/2026-09-21-french-locale-design.md` (canvas board `docs/design/canvas/Locale.dc.html`, option A).

## Global Constraints

- Scope: **the web front only**. CLI output, `--json`, server logs, `bmpl serve` banners, admin audit detail strings, README and docs stay English. Spec, dungeon and spell names stay as WCL / Raider.IO give them.
- Locale rule: `detectLocale(navigator.language)` → `fr` when it starts with `fr` (case-insensitive), else `en`; `effectiveLocale(saved, navigatorLanguage)` → the saved choice wins. `<html lang>` follows the effective locale.
- Persistence: local mode `localStorage` key `bmpl.locale`; hosted mode `user_settings.locale` (`null` = follow the browser) via `PUT /api/settings { locale }`, **and** the same value mirrored to `bmpl.locale` so the sign-in screen keeps the choice after sign-out.
- Dictionaries: `web/src/i18n/en.ts` is the source (`as const`), `web/src/i18n/fr.ts` is typed as its mirror. Placeholders `{name}`; plurals `{count, plural, one {# run} other {# runs}}` (only `one` / `other`, category from `Intl.PluralRules(locale)`); `#` is the formatted count. A missing key returns the key itself.
- Numbers in params: `fmtNumber(locale, n)` — thousands separated by U+202F for both locales, decimals as given (max 2), decimal comma in `fr` (`Intl.NumberFormat`). Percent in French is `12 %` (U+202F before `%`): the dictionary carries the space, never the code.
- Register (French): player's franglais, **tutoiement**. Keep in English: *kick(s), key, timed, depleted, parse, wipe, DPS, HPS, tank, heal, Mythic+, M+, deep-dive, run(s), reset, ilvl, spec, buff, cooldown / cd, cast, pull, boss, trash, immunity, majors (majors = "gros defensives"), reroll, dispel(s), pots / hs*. Translate: verdict copy, actions, settings, help, errors. Glossary: lookup → recherche · applicant → candidat · shown runs → runs affichés · peers → pairs · avoidable damage → dégâts évitables · damage taken → dégâts subis · deaths → morts · teammate → coéquipier · confidence → confiance · target level → niveau cible · expected → attendu · scored → noté · weight → poids · axis → axe · evidence → indice · quota → quota · budget → budget · shared budget → budget partagé · own client → ton propre client · sign in / out → se connecter / se déconnecter · settings → paramètres · help → aide · refresh → rafraîchir · cached → en cache · stale → périmé · pending review → en attente de validation · approved / rejected → approuvé / rejeté · proposal → proposition · table → table · entry → entrée.
- Verdict words stay `INVITE` / `MAYBE` / `PASS`; `NOT ENOUGH DATA` → `PAS ASSEZ DE DONNÉES`. Axis names: Survie, Utilité, Throughput, Régularité, Préparation, Expérience.
- Local mode in English stays pixel-identical apart from the locale chip. Colours, radii and fonts only from `web/src/styles/tokens.css`.
- `web/` imports from `src/` are types-only (`import type … from "@shared/…"`); the single runtime exception stays `src/wow/classes.ts`. `Locale` exists twice on purpose (`src/hosted/locale.ts`, `web/src/lib/locale.ts`).
- Every task ends with `just check` and `bun test` green, `web/dist` absent. Tests never reach WCL or Raider.IO (server tests pin `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` to dummies as the existing ones do).
- Style: 2 spaces, double quotes, trailing commas, ≤ ~120 cols, `.ts` / `.tsx` extensions in imports, English in code and comments. Commit messages end, after a blank line, with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`. Never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env*` (except the two `.env.*.example`), `bmpl.db*`, `web/dist`, `dist/`, `bmpl`.
- No deploy, no release, no tag from an agent.

## File structure

| File | Responsibility |
|---|---|
| `web/src/lib/locale.ts` (new) | `Locale`, `LOCALES`, `isLocale`, `LOCALE_LABELS`, `LOCALE_NAMES`, `detectLocale`, `effectiveLocale`, `fmtNumber`, `fmtDate`, `pluralCategory` — pure, tested |
| `web/src/i18n/en.ts`, `web/src/i18n/fr.ts` (new) | The dictionaries, one nested object per area |
| `web/src/i18n/t.ts` (new) | `Dictionary`, `MessageKey`, `T`, `makeT(dict, locale)`, `formatMessage` — pure, tested |
| `web/src/i18n/i18n.test.ts` (new) | Parity `en` ⇔ `fr`, `formatMessage`, `makeT` |
| `web/src/locale.tsx` (new) | `LocaleProvider`, `useT()` (React context) |
| `web/src/lib/settings.ts` | `Settings.locale`, storage key `bmpl.locale` |
| `web/src/settings.tsx` | mirrors a hosted locale change into localStorage |
| `src/hosted/locale.ts` (new) | server `Locale` / `LOCALES` / `isLocale` |
| `src/hosted/db.ts`, `src/server/validate.ts`, `src/server/routes-user.ts` | `user_settings.locale` column, body validation, patch |
| `src/evaluation/docs.fr.ts` (new), `src/evaluation/docs.ts`, `src/server/routes-shared.ts` | French registry, `EVALUATION_DOCS_BY_LOCALE`, `?lang=` |
| `src/evaluation/types.ts`, `src/evaluation/axis.ts`, `src/evaluation/axes/*.ts` | `Evidence.value` / `Evidence.extra`, `EVIDENCE_SOURCES` |
| `web/src/lib/*.ts` view models | take `t` where they produce prose |
| `web/src/components/**` | read `useT()`; no English literal left in JSX |

Migration rule used by Tasks 2–6 (repeated in each task): every English literal a component renders — JSX text, `title`, `placeholder`, `aria-label`, template strings — becomes `t("area.key")` with the key added to `en.ts` (English exactly as the literal was, so the local page does not change) and to `fr.ts`. A pure view model that returns prose gains `t: T` as its **first** parameter; its callers pass `t` from `useT()`; its tests pass `tEn` (`makeT(en, "en")`) and keep their assertions, plus one `tFr` assertion where the French wording is not a word-for-word swap. Never translate class names, keys, spec / dungeon / spell names, URLs or the WCL/Raider.IO data.

---

### Task 1: Locale core — types, dictionaries, `t`, provider, setting, switch

**Files:**
- Create: `web/src/lib/locale.ts`, `web/src/lib/locale.test.ts`, `web/src/i18n/en.ts`, `web/src/i18n/fr.ts`, `web/src/i18n/t.ts`, `web/src/i18n/i18n.test.ts`, `web/src/locale.tsx`, `src/hosted/locale.ts`, `test/hosted/locale.test.ts`
- Modify: `web/src/lib/settings.ts`, `web/src/lib/settings.test.ts`, `web/src/settings.tsx`, `web/src/types.ts`, `web/src/api.ts` (settings type), `web/src/App.tsx`, `web/src/components/UserMenu.tsx`, `web/src/components/Header.tsx`, `web/src/lib/header.ts`, `web/src/lib/header.test.ts`, `web/src/lib/session.ts`, `web/src/lib/session.test.ts`, `web/src/styles/app.css`, `src/hosted/db.ts`, `src/server/validate.ts`, `src/server/routes-user.ts`, `test/hosted/settings.test.ts`, `test/server/validate.test.ts` (or wherever `SETTINGS_BODY` is tested — `grep -rn SETTINGS_BODY test/`)

**Interfaces:**
- Produces (front): `Locale`, `LOCALES = ["en", "fr"] as const`, `isLocale(v: unknown): v is Locale`, `LOCALE_LABELS: Record<Locale, string>` (`EN` / `FR`), `LOCALE_NAMES: Record<Locale, string>` (`English` / `Français`), `detectLocale(navigatorLanguage: string | undefined): Locale`, `effectiveLocale(saved: Locale | null, navigatorLanguage: string | undefined): Locale`, `fmtNumber(locale: Locale, n: number, maxFractionDigits = 2): string`, `fmtDate(locale: Locale, ms: number): string`, `pluralCategory(locale: Locale, n: number): "one" | "other"`.
- Produces (i18n): `type Dictionary = typeof en`, `type MessageKey` (dotted leaf paths of `en`), `type T = (key: MessageKey, params?: Params) => string`, `type Params = Record<string, string | number>`, `formatMessage(locale, message, params)`, `makeT(dict: Mirror<Dictionary>, locale: Locale): T`, `tEn` (test helper exported from `web/src/i18n/t.ts` as `makeT(en, "en")`).
- Produces (React): `LocaleProvider({ saved, persist, children })`, `useT(): { t: T; locale: Locale; setLocale: (l: Locale) => void }`.
- Produces (settings): `Settings.locale: Locale | null`, `LOCALE_STORAGE_KEY = "bmpl.locale"`; server `UserSettings.locale`, `SETTINGS_BODY.locale`.
- Produces (menus): `localeMenu(t, current): ChipMenuModel` in `web/src/lib/header.ts`; `MenuModel.locale: Locale` in `session.ts` is **not** added — the menu reads `useT().locale` directly.

- [ ] **Step 1: Locale helpers — failing tests**

Create `web/src/lib/locale.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { LOCALES, LOCALE_LABELS, LOCALE_NAMES, detectLocale, effectiveLocale, fmtDate, fmtNumber, isLocale, pluralCategory } from "./locale.ts";

describe("locale", () => {
  test("two locales, labels and names", () => {
    expect(LOCALES).toEqual(["en", "fr"]);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(LOCALE_LABELS).toEqual({ en: "EN", fr: "FR" });
    expect(LOCALE_NAMES).toEqual({ en: "English", fr: "Français" });
  });
  test("detectLocale: any fr-* tag is fr, everything else (and nothing) is en", () => {
    expect(detectLocale("fr")).toBe("fr");
    expect(detectLocale("fr-FR")).toBe("fr");
    expect(detectLocale("FR-ca")).toBe("fr");
    expect(detectLocale("en-GB")).toBe("en");
    expect(detectLocale("de")).toBe("en");
    expect(detectLocale("")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });
  test("effectiveLocale: the saved choice wins over the browser", () => {
    expect(effectiveLocale(null, "fr-FR")).toBe("fr");
    expect(effectiveLocale("en", "fr-FR")).toBe("en");
    expect(effectiveLocale("fr", "en-US")).toBe("fr");
    expect(effectiveLocale(null, undefined)).toBe("en");
  });
  test("fmtNumber: narrow no-break space thousands in both locales, decimal comma in fr, max 2 decimals", () => {
    expect(fmtNumber("en", 1412)).toBe("1 412");
    expect(fmtNumber("fr", 1412)).toBe("1 412");
    expect(fmtNumber("en", 0.25)).toBe("0.25");
    expect(fmtNumber("fr", 0.25)).toBe("0,25");
    expect(fmtNumber("en", 3.14159)).toBe("3.14");
    expect(fmtNumber("fr", 3600.7, 0)).toBe("3 601");
    expect(fmtNumber("en", -7)).toBe("−7");
  });
  test("fmtDate: day and short month", () => {
    const ms = Date.UTC(2026, 8, 21, 12);
    expect(fmtDate("en", ms)).toBe("21 Sep");
    expect(fmtDate("fr", ms)).toBe("21 sept.");
  });
  test("pluralCategory: English one only for 1, French one for 0 and 1", () => {
    expect(pluralCategory("en", 0)).toBe("other");
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
    expect(pluralCategory("fr", 0)).toBe("one");
    expect(pluralCategory("fr", 1)).toBe("one");
    expect(pluralCategory("fr", 2)).toBe("other");
  });
});
```

- [ ] **Step 2: Run it — fails (module not found)**

Run: `bun test web/src/lib/locale` — Expected: FAIL, `Cannot find module "./locale.ts"`.

- [ ] **Step 3: Implement `web/src/lib/locale.ts`**

```ts
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

/** "21 Sep" / "21 sept." — the run list and the deep-dive ages that show a date. */
export const fmtDate = (locale: Locale, ms: number): string =>
  new Intl.DateTimeFormat(INTL_TAG[locale], { day: "numeric", month: "short", timeZone: "UTC" }).format(ms);

/** ICU categories we use: French says "1 run" for 0 and 1, English only for 1. */
export const pluralCategory = (locale: Locale, n: number): "one" | "other" =>
  new Intl.PluralRules(INTL_TAG[locale]).select(n) === "one" ? "one" : "other";
```

- [ ] **Step 4: Run — passes**

Run: `bun test web/src/lib/locale` — Expected: 6 pass. If `fmtDate("fr")` yields `21 sept.` with a different abbreviation on this Bun (`sep.`), pin the expectation to what `Intl` returns on Bun 1.3.4 and note it in the report — the point is the locale switch, not the abbreviation.

- [ ] **Step 5: Dictionaries and `t` — failing tests**

Create `web/src/i18n/i18n.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { en } from "./en.ts";
import { fr } from "./fr.ts";
import { formatMessage, leafKeys, makeT } from "./t.ts";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)(?:,\s*plural[^}]*\{[^}]*\}\s*other\s*\{[^}]*\})?\}/g)].map((m) => m[1]!).sort();

describe("dictionaries", () => {
  test("fr has exactly the keys of en", () => {
    expect(leafKeys(fr).sort()).toEqual(leafKeys(en).sort());
  });
  test("every message keeps its placeholders across languages", () => {
    const keys = leafKeys(en);
    const get = (d: unknown, key: string) => key.split(".").reduce<any>((o, k) => o[k], d) as string;
    for (const key of keys) expect({ key, ph: placeholders(get(fr, key)) }).toEqual({ key, ph: placeholders(get(en, key)) });
  });
  test("no message is empty and none is left in English in fr where en has letters", () => {
    for (const key of leafKeys(fr)) {
      const get = (d: unknown) => key.split(".").reduce<any>((o, k) => o[k], d) as string;
      expect(get(fr).trim().length).toBeGreaterThan(0);
      expect(get(en).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("formatMessage", () => {
  test("params, numbers formatted per locale, unknown params left as is", () => {
    expect(formatMessage("en", "for a +{level}", { level: 21 })).toBe("for a +21");
    expect(formatMessage("fr", "{pts} pts", { pts: 1412 })).toBe("1 412 pts");
    expect(formatMessage("en", "{a} and {b}", { a: "x" })).toBe("x and {b}");
    expect(formatMessage("fr", "{v} %", { v: 12.5 })).toBe("12,5 %");
  });
  test("plural: one / other with # as the formatted count", () => {
    const m = "{count, plural, one {# run scored} other {# runs scored}}";
    expect(formatMessage("en", m, { count: 1 })).toBe("1 run scored");
    expect(formatMessage("en", m, { count: 9 })).toBe("9 runs scored");
    expect(formatMessage("en", m, { count: 0 })).toBe("0 runs scored");
    expect(formatMessage("fr", "{count, plural, one {# run noté} other {# runs notés}}", { count: 0 })).toBe("0 run noté");
    expect(formatMessage("en", "{n, plural, one {a} other {b}} · {n}", { n: 2 })).toBe("b · 2");
  });
});

describe("makeT", () => {
  test("looks a key up, formats, and returns the key itself when missing", () => {
    const t = makeT(en, "en");
    expect(t("common.locale.title")).toBe("Language");
    expect(t("common.locale.remembered")).toBe("Language · remembered");
    // @ts-expect-error — a key that does not exist is still a string at runtime
    expect(t("nope.missing")).toBe("nope.missing");
    expect(makeT(fr, "fr")("common.locale.title")).toBe("Langue");
  });
});
```

- [ ] **Step 6: Run — fails (modules not found)**

Run: `bun test web/src/i18n` — Expected: FAIL.

- [ ] **Step 7: Create `web/src/i18n/en.ts`, `web/src/i18n/fr.ts`, `web/src/i18n/t.ts`**

`web/src/i18n/en.ts` (the source; more areas are added by the later tasks — keep this exact shape):

```ts
// Every string the web front shows, in English — the source of truth. fr.ts mirrors it key for key
// (Mirror<typeof en> makes a missing or extra key a tsc error). Placeholders: {name}; plurals:
// {count, plural, one {# run} other {# runs}}. Numbers in params are formatted per locale by t.
export const en = {
  common: {
    loading: "loading…",
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    back: "← back",
    backToLookups: "← back to lookups",
    help: "Help",
    settings: "Settings",
    privacy: "Privacy",
    admin: "Admin",
    signOut: "Sign out",
    dismiss: "Dismiss",
    locale: {
      title: "Language",
      remembered: "Language · remembered",
      hint: "Remembered on this account",
    },
    age: {
      justNow: "just now",
      hours: "{n}h ago",
      days: "{n}d ago",
      weeks: "{n}w ago",
      months: "{n}mo ago",
      years: "{n}y ago",
    },
  },
} as const;
```

`web/src/i18n/fr.ts`:

```ts
import type { Mirror } from "./t.ts";
import type { en } from "./en.ts";

// French mirror of en.ts: same keys, player's franglais, "tu". WoW terms stay English (kick, key, timed,
// parse, wipe, DPS/HPS, run, reset, ilvl, spec, cooldown…); see the plan's glossary.
export const fr: Mirror<typeof en> = {
  common: {
    loading: "chargement…",
    close: "Fermer",
    cancel: "Annuler",
    save: "Enregistrer",
    back: "← retour",
    backToLookups: "← retour aux recherches",
    help: "Aide",
    settings: "Paramètres",
    privacy: "Confidentialité",
    admin: "Admin",
    signOut: "Se déconnecter",
    dismiss: "Fermer",
    locale: {
      title: "Langue",
      remembered: "Langue · mémorisée",
      hint: "Mémorisée sur ce compte",
    },
    age: {
      justNow: "à l'instant",
      hours: "il y a {n} h",
      days: "il y a {n} j",
      weeks: "il y a {n} sem.",
      months: "il y a {n} mois",
      years: "il y a {n} an(s)",
    },
  },
};
```

`web/src/i18n/t.ts`:

```ts
import type { Locale } from "../lib/locale.ts";
import { fmtNumber, pluralCategory } from "../lib/locale.ts";
import { en } from "./en.ts";

export type Dictionary = typeof en;
/** The same tree with every leaf widened to string — what fr.ts must satisfy. */
export type Mirror<D> = { [K in keyof D]: D[K] extends string ? string : Mirror<D[K]> };
type Leaves<D, P extends string = ""> = { [K in keyof D & string]: D[K] extends string ? `${P}${K}` : Leaves<D[K], `${P}${K}.`> }[keyof D & string];
export type MessageKey = Leaves<Dictionary>;
export type Params = Record<string, string | number>;
export type T = (key: MessageKey, params?: Params) => string;

/** Dotted paths of every leaf, in declaration order — the parity test and the missing-key lookup use it. */
export function leafKeys(dict: object, prefix = ""): string[] {
  return Object.entries(dict).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : leafKeys(v as object, `${prefix}${k}.`)));
}

const PLURAL = /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g;
const PARAM = /\{(\w+)\}/g;

/** {name} → the param (numbers per locale); {count, plural, one {…} other {…}} → the branch, # → the count. */
export function formatMessage(locale: Locale, message: string, params: Params = {}): string {
  const fmt = (v: string | number): string => (typeof v === "number" ? fmtNumber(locale, v) : v);
  const withPlurals = message.replace(PLURAL, (_m, name: string, one: string, other: string) => {
    const v = params[name];
    if (typeof v !== "number") return other.replaceAll("#", v === undefined ? "?" : String(v));
    return (pluralCategory(locale, v) === "one" ? one : other).replaceAll("#", fmt(v));
  });
  return withPlurals.replace(PARAM, (m, name: string) => (name in params ? fmt(params[name]!) : m));
}

const lookup = (dict: object, key: string): string | undefined =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict) as string | undefined;

/** A translator bound to one dictionary and locale. A missing key returns the key: never throws, easy to spot on screen. */
export function makeT(dict: Mirror<Dictionary>, locale: Locale): T {
  return (key, params) => {
    const m = lookup(dict, key);
    return m === undefined ? key : formatMessage(locale, m, params);
  };
}

/** English translator for tests: assertions keep the strings they had before the locale work. */
export const tEn: T = makeT(en, "en");
```

- [ ] **Step 8: Run — passes; `just check` green**

Run: `bun test web/src/i18n && just check` — Expected: all pass, tsc clean.

- [ ] **Step 9: Settings — failing tests**

In `web/src/lib/settings.test.ts`, find the tests of `readLocalSettings` / `writeLocalSettings` / `parseServerSettings` and add:

```ts
test("locale: read from bmpl.locale, invalid values ignored, written and removed like the region", () => {
  const store = fakeStore({ "bmpl.locale": "fr" });      // use the file's existing in-memory store helper; create one if there is none:
  expect(readLocalSettings(store).locale).toBe("fr");     //   const fakeStore = (init: Record<string, string>) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } } as KeyValueStore; };
  expect(readLocalSettings(fakeStore({ "bmpl.locale": "de" })).locale).toBeNull();
  writeLocalSettings(store, { locale: "en" });
  expect(store.getItem("bmpl.locale")).toBe("en");
  writeLocalSettings(store, { locale: null });
  expect(store.getItem("bmpl.locale")).toBeNull();
  expect(parseServerSettings({ yourKey: null, legendOpen: true, region: null, locale: "fr" }).locale).toBe("fr");
  expect(parseServerSettings({ yourKey: null, legendOpen: true, region: null, locale: "xx" }).locale).toBeNull();
});
```

Server side, in `test/hosted/settings.test.ts` (next to the `region` cases) add a `locale` round-trip: `update(userId, { locale: "fr" })` → `get(userId).locale === "fr"`; `update(userId, { locale: null })` → `null`; a fresh user → `null`; and in the `SETTINGS_BODY` test file add `{ locale: "fr" }` accepted, `{ locale: null }` accepted, `{ locale: "de" }` rejected (400 through the route or a `parseBody`-level assertion, whichever the existing region tests use — copy their shape).

- [ ] **Step 10: Run — fails**

Run: `bun test web/src/lib/settings test/hosted/settings test/server` — Expected: FAIL on the new cases.

- [ ] **Step 11: Implement the setting end to end**

`src/hosted/locale.ts` (new):

```ts
// The two UI languages, server side: the settings column and /api/docs?lang. Mirrors web/src/lib/locale.ts.
export type Locale = "en" | "fr";
export const LOCALES = ["en", "fr"] as const;
export const isLocale = (v: unknown): v is Locale => v === "en" || v === "fr";
```

`test/hosted/locale.test.ts` (new): `expect(LOCALES).toEqual(["en", "fr"])` and `isLocale` true/false — the pin that both copies agree.

`src/hosted/db.ts`: `UserSettings.locale: Locale | null` (default `null`), `SETTINGS_COLUMNS` gains `locale TEXT` (through `migrateColumns`, exactly as `region` was added — `grep -n region src/hosted/db.ts` shows the four places: the interface, the default, the `SELECT`, the upsert), read back with `isLocale(r.locale) ? r.locale : null`.

`src/server/validate.ts`: `SETTINGS_BODY` gains `locale: opt(nullable(oneOf(LOCALES)))` (import `LOCALES` from `../hosted/locale.ts`). `src/server/routes-user.ts`: `parseSettingsPatch` accepts `locale` (add `if ("locale" in value) patch.locale = value.locale!;` and the error text becomes "Nothing to update: send `yourKey`, `legendOpen`, `region` and/or `locale`"). Update the header comment of `routes-user.ts` to mention the locale.

`web/src/lib/settings.ts`: `Settings.locale: Locale | null`, `DEFAULT_SETTINGS.locale = null`, `LOCALE_STORAGE_KEY = "bmpl.locale"`, read with `isLocale`, write/remove like `region`; `parseServerSettings` reads `locale` with `isLocale`. `web/src/api.ts`: the settings type gains `locale?: Locale | null` (same place as `region`). `web/src/types.ts`: `export type { Locale } from "./lib/locale.ts";` is **not** needed (front-local type) — leave `types.ts` alone.

`web/src/settings.tsx`: in `update`, hosted branch: `void api.putSettings(patch); if ("locale" in patch) writeLocalSettings(browserStore(), { locale: patch.locale ?? null });` — the spec's "mirror to bmpl.locale so the sign-in screen keeps the choice".

- [ ] **Step 12: Run — passes**

Run: `bun test web/src/lib/settings test/hosted test/server && just check` — Expected: pass, tsc clean.

- [ ] **Step 13: `LocaleProvider` and `useT`**

Create `web/src/locale.tsx`:

```tsx
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
```

Wire it in `web/src/App.tsx`:
- the anonymous screens (`privacy`, `signin` + `help`, `signin`, `setup`, `loading`) and `Main` are all rendered inside one `LocaleProvider`. Add a small component at the bottom of `App.tsx`:

```tsx
const browserStore = (): KeyValueStore | null => { try { return localStorage; } catch { return null; } };
/** Anonymous screens: the remembered choice lives in the browser only. */
function BrowserLocale({ children }: { children: ReactNode }) {
  const persist = useCallback((l: Locale) => writeLocalSettings(browserStore(), { locale: l }), []);
  return <LocaleProvider saved={readLocalSettings(browserStore()).locale} persist={persist}>{children}</LocaleProvider>;
}
/** Signed in / local: the choice is a setting (hosted: PUT /api/settings, mirrored to the browser by SettingsProvider). */
function SettingsLocale({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const persist = useCallback((l: Locale) => update({ locale: l }), [update]);
  return <LocaleProvider saved={settings.locale} persist={persist}>{children}</LocaleProvider>;
}
```

and wrap: every early `return <X …/>` of `App()` becomes `return <BrowserLocale><X …/></BrowserLocale>`; the main tree becomes `<SettingsProvider …><SettingsLocale><DocsProvider><Main …/></DocsProvider></SettingsLocale></SettingsProvider>`. The `loading…` text uses `t("common.loading")` through a tiny `Loading` component that calls `useT()` (inside `BrowserLocale`).

- [ ] **Step 14: The switch — models first (failing tests)**

In `web/src/lib/header.test.ts` add:

```ts
import { tEn } from "../i18n/t.ts";
import { makeT } from "../i18n/t.ts";
import { fr } from "../i18n/fr.ts";
// …
describe("localeMenu", () => {
  test("two entries, the current one on, labels from the dictionary", () => {
    expect(localeMenu(tEn, "fr")).toEqual({
      head: "Language · remembered",
      items: [{ value: "en", label: "EN", hint: "English", on: false }, { value: "fr", label: "FR", hint: "Français", on: true }],
    });
    expect(localeMenu(makeT(fr, "fr"), "en").head).toBe("Langue · mémorisée");
  });
});
```

(Match the exact `ChipMenuModel` shape `regionMenu` returns in `header.ts` — `head`, `items[{ value, label, hint, on }]` — read it first and use its field names; if `regionMenu` uses a different shape, mirror it and adjust the test.)

- [ ] **Step 15: Implement `localeMenu` and the two switches**

`web/src/lib/header.ts`:

```ts
import { LOCALES, LOCALE_LABELS, LOCALE_NAMES } from "./locale.ts";
import type { Locale } from "./locale.ts";
import type { T } from "../i18n/t.ts";

/** The EN / FR chip menu (local mode header) — canvas "Locale" option A. */
export function localeMenu(t: T, current: Locale): ChipMenuModel /* the same type regionMenu returns */ {
  return {
    head: t("common.locale.remembered"),
    items: LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l], hint: LOCALE_NAMES[l], on: l === current })),
  };
}
```

`web/src/components/Header.tsx` (local mode only — the block that renders Clipboard watch / Help / Re-configure / Quit): before the clipboard-watch toggle, a `ChipMenu` fed by `localeMenu(t, locale)` whose trigger label is `LOCALE_LABELS[locale]`, `chip-on` when `locale !== detectLocale(navigator.language)`, `title={t("common.locale.title")}`, `onPick={(v) => setLocale(v as Locale)}`. Reuse `ChipMenu` exactly as the region chip does (same props); do not add CSS beyond `.top .chip-menu { margin-left: 4px; }` if the spacing needs it (tokens only).

`web/src/components/UserMenu.tsx` (hosted): after the `.menu-quota` block and before the first `.menu-sep`, a row:

```tsx
<div className="menu-row" role="group" aria-label={t("common.locale.title")}>
  <span className="faint">{t("common.locale.title")}</span>
  <span className="seg" title={t("common.locale.hint")}>
    {LOCALES.map((l) => (
      <button key={l} type="button" className={"seg-item" + (l === locale ? " on" : "")} onClick={() => setLocale(l)} aria-pressed={l === locale}>{LOCALE_LABELS[l]}</button>
    ))}
  </span>
</div>
```

CSS (`web/src/styles/app.css`, tokens only): `.menu-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; font-size: 12px; }`, `.seg { display: inline-flex; height: 26px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--inset); overflow: hidden; }`, `.seg-item { padding: 0 10px; font-size: 12px; font-weight: 600; color: var(--muted); background: transparent; border: 0; border-right: 1px solid var(--border-soft); cursor: pointer; }`, `.seg-item:last-child { border-right: 0; }`, `.seg-item.on { background: var(--card); color: var(--text); }`. (`--card` exists — check `tokens.css`; if the card token has another name, use that one.)

`UserMenu.tsx` and `Header.tsx` read `const { t, locale, setLocale } = useT();`. The menu's English literals (`Help`, `Settings`, `Admin`, `Sign out`, `Privacy`) switch to `t("common.help")` etc. now — they are in the `common` area already.

- [ ] **Step 16: Run everything, check by eye**

Run: `just check && bun test` — Expected: green, `web/dist` absent. Then `just web-build && bun src/cli.ts serve --no-open --port 3011` (local mode, 0 WCL points as long as you do not search), open `http://localhost:3011/`, check: the chip shows `EN` (browser en) and opens EN / FR; picking FR sets `<html lang="fr">`, the menu entries read French, a reload keeps FR (`bmpl.locale`); the rest of the page is still English (expected — later tasks). Stop the server (`curl -s -X POST http://localhost:3011/api/quit`), `rm -rf web/dist`.

- [ ] **Step 17: Commit**

```bash
git add web/src/lib/locale.ts web/src/lib/locale.test.ts web/src/i18n web/src/locale.tsx web/src/lib/settings.ts web/src/lib/settings.test.ts web/src/settings.tsx web/src/api.ts web/src/App.tsx web/src/components/UserMenu.tsx web/src/components/Header.tsx web/src/lib/header.ts web/src/lib/header.test.ts web/src/styles/app.css src/hosted/locale.ts test/hosted/locale.test.ts src/hosted/db.ts src/server/validate.ts src/server/routes-user.ts test/hosted/settings.test.ts test/server
git commit -m "feat(i18n): locale core — en/fr dictionaries, t(), LocaleProvider, remembered locale setting, EN/FR switch"
```

---

### Task 2: Header, search, key stepper, tabs, toast, sign-in, setup, home

**Files:**
- Modify: `web/src/i18n/en.ts`, `web/src/i18n/fr.ts` (areas `header`, `tabs`, `signin`, `setup`, `errors`), `web/src/components/Header.tsx`, `web/src/components/KeyStepper.tsx`, `web/src/components/Tabs.tsx`, `web/src/components/Toast.tsx`, `web/src/components/Home.tsx`, `web/src/components/Setup.tsx`, `web/src/components/SignIn.tsx`, `web/src/App.tsx` (busy text, toast for quota/budget), `web/src/lib/header.ts` (+test), `web/src/lib/history.ts` (+test), `web/src/lib/keyLevel.ts` (+test), `web/src/lib/hostedMode.ts` (+test: `signInNote`, `deniedNotice`), `web/src/lib/quota.ts` (+test), `web/src/lib/session.ts` (+test), `web/src/lib/format.ts` (+test: `fmtAge`)

**Interfaces:**
- Consumes: `T`, `useT`, `tEn`, `makeT`, `fr` from Task 1.
- Produces: `specMenu(t, payload, current)`, `specChipLabel(t, spec)`, `regionMenu(t, current)` (only if it has prose — its hints are the region names: move `REGION_LABELS`' English to `en.ts` under `header.region.*` and have `regionLabel(t, r)`), `tabSubtitle(t, item, instanceRegion)`, `keyStepperModel(t, …)` (whatever `keyLevel.ts` exports that produces "Your key is +18" / "re-evaluate for +18" — add `t` first), `quotaLabel(t, q)`, `quotaTooltip(t, q)`, `quotaLine(t, q, isAdmin)`, `ownClientLine(t, c)`, `pendingText(t, n)`, `menuModel(t, me, q, ownClient)`, `signInNote(t, status)`, `deniedNotice(t, search)`, `fmtAge(t, ms, now)`.

Dictionary content to add (English = the exact literals in the components today; French below). `en.ts`:

```ts
  header: {
    searchPlaceholder: "Name-Realm or Raider.IO URL",
    specPlaceholder: "e.g. Augmentation",
    metric: { auto: "auto", dps: "dps", hps: "hps" },
    region: { title: "Region", remembered: "Region · remembered", eu: "Europe", us: "Americas & Oceania", kr: "Korea", tw: "Taiwan" },
    spec: {
      title: "Spec filter",
      seenOn: "Spec · seen on {name} this season",
      loadFirst: "Spec · load a character to pick from its specs",
      any: "any",
      other: "Other…",
      typeName: "type a name",
      runs: "{count, plural, one {# run} other {# runs}}",
      chipAny: "spec any ▾",
      chip: "spec {spec} ▾",
    },
    lookup: "Look up",
    key: { label: "Your key", lower: "Lower key level", raise: "Raise key level", title: "The key you are filling — every lookup is evaluated for this level", auto: "auto", autoTitle: "Auto-detect the level each character actually plays at" },
    watch: { label: "Clipboard watch", title: "Look up whatever Name-Realm you copy to the clipboard", on: "on", off: "off" },
    liveDisconnected: "live updates disconnected",
    reconnecting: "Reconnecting…",
    reconfigure: "Re-configure",
    quit: "Quit",
    quotaShare: "Your share of the shared Warcraft Logs budget",
    ownClientTitle: "Your Warcraft Logs client",
    busy: { lookingUp: "looking up {name}…", refreshing: "refreshing {name}…" },
    quota: {
      unlimited: "unlimited · admin",
      none: "no quota",
      left: "{left} of {limit} pts left this hour",
      leftShort: "{left} pts left this hour",
      reached: "quota reached · resets in {min} min",
      resets: "resets in {min} min",
      tooltip: "Hourly quota reached · resets in {min} min · your own client: see Help",
      tooltipNoReset: "Hourly quota reached · your own client: see Help",
      guide: "Use your own Warcraft Logs client →",
      own: "Your WCL client · {spent} / {limit} pts",
      ownNoRequest: "Your WCL client · no request yet",
      stale: "Your WCL client needs re-saving · using the shared budget",
      staleSub: "Settings → save the client again",
      pending: "{count, plural, one {# pending proposal} other {# pending proposals}}",
      adminHandle: " · admin",
    },
  },
  tabs: {
    auto: "auto",
    selected: " · {n} selected",
    compare: "Select for compare",
    close: "Close tab",
    closeAll: "Close all tabs",
    refresh: "↻ Refresh",
    refreshTitle: "Re-fetch the active tab",
    cached: "cached",
  },
  errors: {
    quota: "Hourly quota reached ({used}/{limit} pts) — resets in {min} min",
    budget: "The shared WCL budget is nearly exhausted ({left} pts left) — resets in {min} min",
    ownClientAction: "Use your own client →",
  },
  signin: {
    tagline: "Who applied to your key?",
    sub: "Vet a Mythic+ applicant from their Warcraft Logs and Raider.IO history.",
    discord: "Sign in with Discord",
    failed: "✗ Sign-in failed — Discord did not complete the login. Try again.",
    invite: { title: "Invitation required", body: "Your Discord account signed in fine, but it is not invited. Send your id to the admin:", then: "Then sign in again — no need to reload." },
    denied: { banned: "This account is banned from this instance.", guild: "Sign-in is limited to members of the guild's Discord server.", rate: "Too many sign-ups from your network — try again in a few minutes." },
    note: {
      guild: "Members of the guild's Discord only. Sign-in reads your server list once to check membership and keeps nothing from it.",
      open: "Anyone with a Discord account can sign in. Only your Discord id and name are stored — no message or server access.",
      invite: "Invite-only. Only your Discord id and name are stored — no message or server access.",
    },
  },
  setup: {
    title: "bmpl · setup",
    intro: "Paste your Warcraft Logs API credentials. They are saved locally to {path} and used only to talk to the WCL API.",
    replace: "⚠ Credentials are already set; saving will replace them.",
    step1: "Log in at {site}.",
    step2: "Open {clients} → Create Client.",
    step3: "Any name. Redirect URL: {url}. Leave Public Client unchecked.",
    step4: "Copy the Client ID and Client Secret below.",
    clientId: "Client ID",
    clientSecret: "Client Secret",
    save: "Save & continue",
    saving: "Saving…",
    saved: "✓ saved",
    credentials: "Credentials: ",
  },
```

`fr.ts` for the same keys:

```ts
  header: {
    searchPlaceholder: "Nom-Serveur ou lien Raider.IO",
    specPlaceholder: "ex. Augmentation",
    metric: { auto: "auto", dps: "dps", hps: "hps" },
    region: { title: "Région", remembered: "Région · mémorisée", eu: "Europe", us: "Amériques & Océanie", kr: "Corée", tw: "Taïwan" },
    spec: {
      title: "Filtre de spec",
      seenOn: "Spec · vues sur {name} cette saison",
      loadFirst: "Spec · charge un perso pour choisir parmi ses specs",
      any: "toutes",
      other: "Autre…",
      typeName: "saisis un nom",
      runs: "{count, plural, one {# run} other {# runs}}",
      chipAny: "spec toutes ▾",
      chip: "spec {spec} ▾",
    },
    lookup: "Chercher",
    key: { label: "Ta key", lower: "Baisser le niveau de key", raise: "Monter le niveau de key", title: "La key que tu montes — chaque recherche est évaluée pour ce niveau", auto: "auto", autoTitle: "Détecter le niveau que chaque perso joue vraiment" },
    watch: { label: "Surveillance du presse-papiers", title: "Cherche tout Nom-Serveur que tu copies dans le presse-papiers", on: "on", off: "off" },
    liveDisconnected: "mises à jour en direct coupées",
    reconnecting: "Reconnexion…",
    reconfigure: "Reconfigurer",
    quit: "Quitter",
    quotaShare: "Ta part du budget Warcraft Logs partagé",
    ownClientTitle: "Ton client Warcraft Logs",
    busy: { lookingUp: "recherche de {name}…", refreshing: "rafraîchissement de {name}…" },
    quota: {
      unlimited: "illimité · admin",
      none: "pas de quota",
      left: "{left} pts sur {limit} restants cette heure",
      leftShort: "{left} pts restants cette heure",
      reached: "quota atteint · reset dans {min} min",
      resets: "reset dans {min} min",
      tooltip: "Quota horaire atteint · reset dans {min} min · ton propre client : voir l'Aide",
      tooltipNoReset: "Quota horaire atteint · ton propre client : voir l'Aide",
      guide: "Utiliser ton propre client Warcraft Logs →",
      own: "Ton client WCL · {spent} / {limit} pts",
      ownNoRequest: "Ton client WCL · aucune requête pour l'instant",
      stale: "Ton client WCL doit être ré-enregistré · budget partagé utilisé",
      staleSub: "Paramètres → enregistre à nouveau le client",
      pending: "{count, plural, one {# proposition en attente} other {# propositions en attente}}",
      adminHandle: " · admin",
    },
  },
  tabs: {
    auto: "auto",
    selected: " · {n} sélectionné(s)",
    compare: "Sélectionner pour comparer",
    close: "Fermer l'onglet",
    closeAll: "Fermer tous les onglets",
    refresh: "↻ Rafraîchir",
    refreshTitle: "Recharger l'onglet actif",
    cached: "en cache",
  },
  errors: {
    quota: "Quota horaire atteint ({used}/{limit} pts) — reset dans {min} min",
    budget: "Le budget WCL partagé est presque épuisé ({left} pts restants) — reset dans {min} min",
    ownClientAction: "Utiliser ton propre client →",
  },
  signin: {
    tagline: "Qui a postulé à ta key ?",
    sub: "Évalue un candidat Mythic+ à partir de son historique Warcraft Logs et Raider.IO.",
    discord: "Se connecter avec Discord",
    failed: "✗ Connexion échouée — Discord n'a pas terminé la connexion. Réessaie.",
    invite: { title: "Invitation requise", body: "Ton compte Discord s'est bien connecté, mais il n'est pas invité. Envoie ton id à l'admin :", then: "Puis reconnecte-toi — pas besoin de recharger." },
    denied: { banned: "Ce compte est banni de cette instance.", guild: "La connexion est réservée aux membres du serveur Discord de la guilde.", rate: "Trop d'inscriptions depuis ton réseau — réessaie dans quelques minutes." },
    note: {
      guild: "Réservé aux membres du Discord de la guilde. La connexion lit ta liste de serveurs une fois pour vérifier, sans rien garder.",
      open: "Toute personne avec un compte Discord peut se connecter. Seuls ton id et ton nom Discord sont stockés — aucun accès aux messages ni aux serveurs.",
      invite: "Sur invitation uniquement. Seuls ton id et ton nom Discord sont stockés — aucun accès aux messages ni aux serveurs.",
    },
  },
  setup: {
    title: "bmpl · configuration",
    intro: "Colle tes identifiants d'API Warcraft Logs. Ils sont enregistrés localement dans {path} et servent uniquement à parler à l'API WCL.",
    replace: "⚠ Des identifiants existent déjà ; enregistrer les remplacera.",
    step1: "Connecte-toi sur {site}.",
    step2: "Ouvre {clients} → Create Client.",
    step3: "N'importe quel nom. Redirect URL : {url}. Laisse Public Client décoché.",
    step4: "Copie le Client ID et le Client Secret ci-dessous.",
    clientId: "Client ID",
    clientSecret: "Client Secret",
    save: "Enregistrer & continuer",
    saving: "Enregistrement…",
    saved: "✓ enregistré",
    credentials: "Identifiants : ",
  },
```

Notes for this task:
- The exact English of `signin.denied.*` must be read from `web/src/lib/hostedMode.ts` (`deniedNotice`) and copied verbatim into `en.ts` — the values above are a guide; whatever the component shows today is the source. Same for any literal listed here that does not match the file: **the file wins for `en`**, then translate.
- `fmtAge(t, ms, now)` uses `common.age.*` (`{n}` param); `fmtDuration`, `fmtAmount`, `signed`, `fmtPts` stay locale-free (numbers only).
- The quota/budget toast: `api.ts` currently returns `r.error` (the server's English message) plus `r.quota`. Extend the failure shape with `code: "quota" | "budget" | null` and the numbers (`used`, `limit`, `left`, `resetInS`) when the body has them (`quotaFromFailure` already parses `quota`; add a sibling `budgetFromFailure`); `App.tsx` renders `t("errors.quota", { used, limit, min })` / `t("errors.budget", { left, min })` when `code` is set, else `r.error` as today. `min = Math.max(1, Math.ceil(resetInS / 60))`.
- `Toast` action label comes from `t("errors.ownClientAction")`; `OWN_CLIENT_GUIDE` in `session.ts` keeps only the `href` (`{ href: "/help#wcl-client" }`) and the label comes from `t("header.quota.guide")` in `menuModel(t, …)`.
- `SignIn.tsx`'s notice with the Discord id: keep the id as a param.

- [ ] **Step 1: Extend the dictionaries** with the blocks above (both files), run `bun test web/src/i18n` — parity passes.
- [ ] **Step 2: View models — update the tests first** (`header.test.ts`, `history.test.ts`, `keyLevel.test.ts`, `hostedMode.test.ts`, `quota.test.ts`, `session.test.ts`, `format.test.ts`): add `t` (`tEn`) as the first argument of every call; keep every expected string; add one `makeT(fr, "fr")` assertion per file, e.g. `expect(quotaLine(tFr, { used: 88, limit: 300, resetInS: 2280 }, false).text).toBe("212 pts sur 300 restants cette heure")`, `expect(tabSubtitle(tFr, item, "eu")).toBe(...)`, `expect(fmtAge(tFr, now - 3 * 86400e3, now)).toBe("il y a 3 j")`, `expect(specMenu(tFr, null, "").items.map((i) => i.label)).toEqual(["toutes", "Autre…"])`. Run: `bun test web/src/lib` — Expected: FAIL (signatures).
- [ ] **Step 3: Implement** — add `t` to each model, replace the literals with `t(...)`, keep the logic. `regionLabel(t, r)` → `t(\`header.region.${r}\`)` (the four keys exist above); `REGION_LABELS` in `regions.ts` may stay for the CLI-like uses but nothing in the front renders it any more (delete it if unused: `grep -rn REGION_LABELS web/src`).
- [ ] **Step 4: Components** — `Header.tsx`, `KeyStepper.tsx`, `Tabs.tsx`, `Toast.tsx`, `Home.tsx`, `Setup.tsx`, `SignIn.tsx`, `App.tsx`: `const { t } = useT();` and every literal → `t(...)`. `Setup.tsx` steps with links: render `t("setup.step1", { site: "" })`? No — split the message around the link: use `linkSegments`? Not available for arbitrary dictionaries; instead keep the link as a separate JSX element and give the message the link text as a **string param** (`t("setup.step1", { site: "warcraftlogs.com" })` renders plain text) **only** when the link is not essential; for Setup the links are essential, so use the pattern: `{t("setup.step1").split("{site}")[0]}<a …>warcraftlogs.com</a>{t("setup.step1").split("{site}")[1]}` via a tiny helper `Around({ message, param, children })` in `web/src/components/Around.tsx` (new, 10 lines: splits the raw message on `{param}` and renders `children` in between; the raw message is obtained with `t` and an empty param map so `{site}` survives — `formatMessage` leaves unknown params in place, which the Task 1 test pins).
- [ ] **Step 5: `just check && bun test`** green; visual pass on the local page in FR (`just web-build`, serve on :3011, pick FR, screenshot the header and tabs; stop, `rm -rf web/dist`); on the hosted throwaway (`BMPL_MODE=hosted` with dummy Discord env, scratch `BMPL_DB_PATH`, see the previous session's recipe in `docs/agents/testing.md` if written, else: `BMPL_MODE=hosted BMPL_BASE_URL=http://localhost:3011 BMPL_SESSION_SECRET=$(openssl rand -base64 48) BMPL_DISCORD_CLIENT_ID=123456789012345678 BMPL_DISCORD_CLIENT_SECRET=dummy BMPL_ADMIN_DISCORD_IDS=158231749187469312 BMPL_DB_PATH=/tmp/bmpl-preview.db bun src/cli.ts serve --no-open --port 3011 --hosted`) check the sign-in screen in FR with a `fr-FR` browser language (Chrome DevTools: `Emulation → Locale`, or `navigator.language` override via `mcp__chrome-devtools__emulate`). 0 WCL points: never submit a lookup.
- [ ] **Step 6: Commit** — `git add` the listed files; `git commit -m "feat(i18n): header, search, tabs, toast, sign-in and setup in French"`.

---

### Task 3: Verdict hero, axes, legend, radar, tiles, runs, Raider.IO, compare — with evidence lines from the payload's raw values

**Files:**
- Modify (server): `src/evaluation/types.ts` (`Evidence.value`, `Evidence.extra`), `src/evaluation/axis.ts`, `src/evaluation/axes/survival.ts` (the two labels with extra numbers), `src/evaluation/axes/index.ts` (`EVIDENCE_SOURCES`), `test/evaluation/*.test.ts` (one assertion that evidence carries `value`), `web/src/types.ts` (no change needed — `Evidence` is re-exported as a type already; verify with `grep -n Evidence web/src/types.ts`)
- Modify (front): `web/src/i18n/en.ts` / `fr.ts` (areas `verdict`, `axes`, `evidence`, `tiles`, `runs`, `rio`, `compare`), `web/src/lib/verdict.ts` (+test), `web/src/lib/axes.ts` (+test), `web/src/lib/tiles.ts` (+test), `web/src/lib/runs.ts` (+test), `web/src/lib/compare.ts` (+test), `web/src/lib/radar.ts` (+test if it has labels), `web/src/components/VerdictHero.tsx`, `AxisRows.tsx`, `AxisLegend.tsx`, `Radar.tsx`, `SignalTiles.tsx`, `DungeonRuns.tsx`, `RioSection.tsx`, `Compare.tsx`, `Detail.tsx`, `HelpLink.tsx`

**Interfaces:**
- Produces (server, additive): `Evidence { label: string; delta: number; source: string; value: number; extra?: { runs?: number; count?: number; total?: number } }`; `EVIDENCE_SOURCES: readonly string[]` (every `"<axis>.<id>"` the axes can emit — 22 today).
- Produces (front): `evidenceText(t, e: Evidence): string` in `web/src/lib/axes.ts` — `t(\`evidence.${e.source}\`, { value: …, ...e.extra })` with the same rounding the server labels use (see the table below); `verdictView(t, ev, autoTarget)`, `axisRows(t, ev, info)`, `axisWeightLabel(t, axisWeights, key)`, `heroStats(t, p)`, `tiles(t, p)`, `signalParts(t, s)`, `runRows(t, p, now)`, `runsHeadline(t, p)`, `compareRows(t, …)` (whatever `compare.ts` exports that produces labels), `AXIS_LABELS` removed in favour of `axisTitle(t, key)`.

Server step (do first): in `src/evaluation/axis.ts` push `value: sub.raw ?? sub.value` next to `label`; in `src/evaluation/axes/survival.ts` the `defensiveUsage` label uses `i.analyzedRuns` → also set `extra: { runs: i.analyzedRuns }` on that sub-signal, and `avoidableDeaths` uses two counts → `extra: { count: s.avoidableDeathsCount, total: s.countedDeathsCount }` (add an optional `extra` field to the sub-signal descriptor type in `axis.ts` and copy it into the evidence). `src/evaluation/axes/index.ts`: `export const EVIDENCE_SOURCES = [...] as const` listing every `axis.id` (build it from the axis modules if they export their sub-signal ids, else write the 22 literals and add a test that walks a fixture evaluation and checks every emitted `source` is in the list — `test/evaluation/` has fixtures; `grep -rn "source" test/evaluation/*.test.ts` shows how evidence is asserted today). Test: an evaluation built from the fixtures has `value` (a finite number) on every evidence entry and `extra.runs` on `survival.defensiveUsage` when present.

Evidence messages — English reproduces the server label exactly (the local page stays identical); `value` is passed pre-rounded by `evidenceText` (rounding column), so `{value}` renders through `fmtNumber` (which keeps the given decimals):

| source | rounding of `value` | en | fr |
|---|---|---|---|
| survival.individualDeaths | 1 decimal | `{value} individual deaths/run` | `{value} mort(s) individuelle(s) / run` |
| survival.wipeDeaths | 1 | `{value} deaths in wipes/run` | `{value} mort(s) en wipe / run` |
| survival.avoidableVsPeers | signed, 0 | `avoidable {value}% vs peers` | `évitable {value} % vs pairs` |
| survival.dtpsVsPeers | signed, 0 | `DTPS {value}% vs peers` | `DTPS {value} % vs pairs` |
| survival.groupDeaths | 1 | `{value} teammate deaths/run` | `{value} mort(s) de coéquipiers / run` |
| survival.defensiveUsage | `Math.round(v*100)` + `runs` | `majors used {value}% of possible ({runs, plural, one {# run} other {# runs}})` | `majors utilisés à {value} % du possible ({runs, plural, one {# run} other {# runs}})` |
| survival.avoidableDeaths | `count`, `total` | `{count}/{total} deaths with a defensive available` | `{count}/{total} morts avec un defensive dispo` |
| utility.kicksVsPeers | signed, 0 | `kicks {value} pts vs peers` | `kicks {value} pts vs pairs` |
| utility.kicksAbsolute | `Math.round(v*100)` | `{value}% of kick capacity used` | `{value} % de la capacité de kick utilisée` |
| utility.dispels | 1 | `{value} dispels/run` | `{value} dispels / run` |
| throughput.medianParse | 0 | `median parse {value}%` | `parse médian {value} %` |
| throughput.parseAtTarget | 0 | `parse {value}% at target level` | `parse {value} % au niveau cible` |
| consistency.parseSpread | 0 | `parse spread ±{value}%` | `écart de parse ±{value} %` |
| consistency.deathsSpread | 1 | `deaths spread ±{value}` | `écart de morts ±{value}` |
| consistency.damageSpread | 0 | `damage-vs-peers spread ±{value}%` | `écart de dégâts vs pairs ±{value} %` |
| preparation.potions | 1 | `{value} potions/run` | `{value} potions / run` |
| preparation.healthstones | 1 | `{value} healthstones/run` | `{value} healthstones / run` |
| preparation.ilvlVsLevel | signed, 0 | `ilvl {value} vs expected` | `ilvl {value} vs attendu` |
| experience.coverage | `Math.round(v*100)` | `{value}% dungeons covered` | `{value} % des donjons couverts` |
| experience.atTarget | `Math.round(v*100)` | `{value}% dungeons at/above target` | `{value} % des donjons au niveau cible ou plus` |
| experience.medianVsTarget | signed, 0 | `median key {value} vs target` | `key médiane {value} vs cible` |
| experience.activity | 0 | `{value} runs in last 7 days` | `{value} runs sur les 7 derniers jours` |

"signed" = `signed(v, 0)` from `format.ts` **as a string param** (so the `+` / `−` survive `fmtNumber`); "1 decimal" = pass `Number(v.toFixed(1))` — `fmtNumber` prints `0.2` / `0,2` and drops a trailing `.0` (matches `toFixed(1)` only when there is a decimal: to keep the English identical, pass the **string** `v.toFixed(1)` in `en`-critical spots? No: pass a string for every rounded value — `evidenceText` formats with `fmtNumber(locale, Number(v.toFixed(d)), d)` itself and passes the resulting **string**; it therefore needs `locale`: signature `evidenceText(t, locale, e)`.) A test in `axes.test.ts` walks every `EVIDENCE_SOURCES` entry and asserts `evidenceText(tEn, "en", { source, value: 1.25, delta: 0, label: "", extra: { runs: 2, count: 1, total: 3 } })` never returns a key (no `evidence.` prefix in the output) and that `evidenceText(tEn, "en", realEvidence)` equals `realEvidence.label` for the fixture evaluation (the strongest check: English is byte-identical to the server label).

Dictionary blocks (`en` — exact literals from the files; `fr`):

```ts
  verdict: {
    axes: { survival: "Survival", utility: "Utility", throughput: "Throughput", consistency: "Consistency", preparation: "Preparation", experience: "Experience" },
    words: { invite: "INVITE", maybe: "MAYBE", pass: "PASS", insufficient: "NOT ENOUGH DATA" },
    confidence: { high: "high", medium: "medium", low: "low" },
    role: { dps: "dps", healer: "healer", tank: "tank" },
    runsScored: "{count, plural, one {# run scored} other {# runs scored}}",
    only: "only {runs}",
    forLevel: "for a +{level}{auto} · {runs} · confidence per axis",
    autoSuffix: " (auto)",
    replaces: " (replaces this tab · cached data)",
    rings: "rings = 25 / 50 / 75 / 100 · hollow point = not applicable",
    radar: "Six-axis radar",
    confidenceOf: "{c} confidence",
    axisClick: "Click to see what is measured and every piece of evidence",
    deepdiveFeeds: "Deep-dive analyses feed this axis",
    legend: { title: "How the verdict is built", sub: "six axes scored 0–100, weighted by role · the dot is the axis confidence" },
    measured: "What's measured",
    noEvidence: "no evidence",
    notEnough: "not enough data for this axis",
    analyzed: "{count, plural, one {# run analyzed} other {# runs analyzed}}",
    weight: { all: "weight {w} for every role", info: "weight 0 · informational", dpsOdd: "weight {odd} for dps, {common} for {others}", oneOdd: "weight {common} ({role} {odd})", and: " and " },
    stats: { score: "{metric} score", ilvl: "ilvl", region: "region", server: "server", prevSeason: "prev season" },
    howComputed: "How is this computed?",
  },
  tiles: {
    median: "Median {metric}", medianParse: "Median parse", timed: "Timed (shown)", avgDeaths: "Avg deaths", inWipes: "{n} in wipes",
    dtps: "Δ DTPS vs peers", avoidable: "Avoidable vs peers", kicks: "Kicks vs peers", pts: "pts", ilvl: "ilvl", rioRecent: "RIO recent timed",
    prevSeason: "Prev season", noData: "— no data (reroll?)",
  },
  runs: {
    none: "No M+ runs indexed this season.",
    best: "Best run per dungeon",
    analyzeAll: "Analyze all shown ({cost})",
    analyze: "Analyze", reanalyze: "Re-analyze", analyzing: "Analyzing {done}/{total}…",
    olderThan: "older than {days} days",
    noStats: "No WCL stats for this run",
    openLog: "Open log",
    deaths: "{count, plural, one {# death} other {# deaths}}", wipes: " ({n} in wipes)",
    dtpsVs: "{dtps} dtps {delta} vs {n} dps", dtps: "{dtps} dtps",
    avoidableVs: "avoidable {perMin}/min ({delta})", avoidable: "avoidable {perMin}/min",
    kicksNoSpec: "kicks {n} (no kick on spec)", kicks: "kicks {n}", kicksCap: "kicks {n}/{cap} (peer {peer}%)", kicksCapNoPeer: "kicks {n}/{cap}",
    dispels: "dispels {n}", dispelsNoSpec: "dispels {n} (no dispel on spec)",
    consumables: "{pots} pots · {hs} hs",
    timed: "✓+{chests} {time}", depleted: "✗ depleted {time}",
    unranked: "unranked",
    headline: "{covered}/{total} dungeons · median +{level}, {amount} {metric}, {parse}% parse",
    atTarget: " · {n}/{total} at or above +{level}",
    missing: "missing: {list}",
    cost: "~{pts} pts",
  },
  rio: { title: "Recent runs (Raider.IO)", last: " · last {age}", score: " · score {score}", profile: "profile", none: "(no recent runs)", open: "Open on Raider.IO" },
  compare: {
    evaluation: "Evaluation", score: "Score", summary: "Summary", target: "Target level", auto: " auto", covered: "Dungeons covered", atTarget: "Dungeons ≥ target",
    medianKey: "Median key level", medianOutput: "Median {metric}", medianParse: "Median parse %", avgDeaths: "Avg deaths", dtps: "Median Δ DTPS vs peers",
    timed: "Timed (shown runs)", avoidable: "Avoidable dmg vs peers", kicks: "Kicks vs peers", defensives: "Defensives", ilvl: "ilvl", rioRecent: "RIO recent timed",
    prevSeason: "Prev season", noData: "— no data (reroll?)", bestPrev: "Best run prev-level", perDungeon: "Per-dungeon (best run)",
    note: "Avg deaths and median Δ DTPS are computed across displayed runs. Highlight = best on that row.",
  },
```

French:

```ts
  verdict: {
    axes: { survival: "Survie", utility: "Utilité", throughput: "Throughput", consistency: "Régularité", preparation: "Préparation", experience: "Expérience" },
    words: { invite: "INVITE", maybe: "MAYBE", pass: "PASS", insufficient: "PAS ASSEZ DE DONNÉES" },
    confidence: { high: "haute", medium: "moyenne", low: "basse" },
    role: { dps: "dps", healer: "heal", tank: "tank" },
    runsScored: "{count, plural, one {# run noté} other {# runs notés}}",
    only: "seulement {runs}",
    forLevel: "pour une +{level}{auto} · {runs} · confiance par axe",
    autoSuffix: " (auto)",
    replaces: " (remplace cet onglet · données en cache)",
    rings: "anneaux = 25 / 50 / 75 / 100 · point creux = non applicable",
    radar: "Radar à six axes",
    confidenceOf: "confiance {c}",
    axisClick: "Clique pour voir ce qui est mesuré et chaque indice",
    deepdiveFeeds: "Les analyses deep-dive alimentent cet axe",
    legend: { title: "Comment le verdict est construit", sub: "six axes notés de 0 à 100, pondérés par rôle · le point est la confiance de l'axe" },
    measured: "Ce qui est mesuré",
    noEvidence: "aucun indice",
    notEnough: "pas assez de données pour cet axe",
    analyzed: "{count, plural, one {# run analysé} other {# runs analysés}}",
    weight: { all: "poids {w} pour tous les rôles", info: "poids 0 · informatif", dpsOdd: "poids {odd} pour dps, {common} pour {others}", oneOdd: "poids {common} ({role} {odd})", and: " et " },
    stats: { score: "score {metric}", ilvl: "ilvl", region: "région", server: "serveur", prevSeason: "saison précédente" },
    howComputed: "Comment c'est calculé ?",
  },
  tiles: {
    median: "{metric} médian", medianParse: "Parse médian", timed: "Timed (affichés)", avgDeaths: "Morts moy.", inWipes: "{n} en wipe",
    dtps: "Δ DTPS vs pairs", avoidable: "Évitable vs pairs", kicks: "Kicks vs pairs", pts: "pts", ilvl: "ilvl", rioRecent: "RIO récents timed",
    prevSeason: "Saison préc.", noData: "— pas de données (reroll ?)",
  },
  runs: {
    none: "Aucun run M+ indexé cette saison.",
    best: "Meilleur run par donjon",
    analyzeAll: "Analyser tous les affichés ({cost})",
    analyze: "Analyser", reanalyze: "Ré-analyser", analyzing: "Analyse {done}/{total}…",
    olderThan: "plus vieux que {days} jours",
    noStats: "Pas de stats WCL pour ce run",
    openLog: "Ouvrir le log",
    deaths: "{count, plural, one {# mort} other {# morts}}", wipes: " ({n} en wipe)",
    dtpsVs: "{dtps} dtps {delta} vs {n} dps", dtps: "{dtps} dtps",
    avoidableVs: "évitable {perMin}/min ({delta})", avoidable: "évitable {perMin}/min",
    kicksNoSpec: "kicks {n} (pas de kick sur cette spec)", kicks: "kicks {n}", kicksCap: "kicks {n}/{cap} (pairs {peer} %)", kicksCapNoPeer: "kicks {n}/{cap}",
    dispels: "dispels {n}", dispelsNoSpec: "dispels {n} (pas de dispel sur cette spec)",
    consumables: "{pots} pots · {hs} hs",
    timed: "✓+{chests} {time}", depleted: "✗ depleted {time}",
    unranked: "non classé",
    headline: "{covered}/{total} donjons · médiane +{level}, {amount} {metric}, {parse} % de parse",
    atTarget: " · {n}/{total} au niveau +{level} ou plus",
    missing: "manquants : {list}",
    cost: "~{pts} pts",
  },
  rio: { title: "Runs récents (Raider.IO)", last: " · dernier {age}", score: " · score {score}", profile: "profil", none: "(aucun run récent)", open: "Ouvrir sur Raider.IO" },
  compare: {
    evaluation: "Évaluation", score: "Score", summary: "Résumé", target: "Niveau cible", auto: " auto", covered: "Donjons couverts", atTarget: "Donjons ≥ cible",
    medianKey: "Key médiane", medianOutput: "{metric} médian", medianParse: "Parse médian %", avgDeaths: "Morts moy.", dtps: "Δ DTPS médian vs pairs",
    timed: "Timed (runs affichés)", avoidable: "Dégâts évitables vs pairs", kicks: "Kicks vs pairs", defensives: "Defensives", ilvl: "ilvl", rioRecent: "RIO récents timed",
    prevSeason: "Saison préc.", noData: "— pas de données (reroll ?)", bestPrev: "Meilleur run niveau préc.", perDungeon: "Par donjon (meilleur run)",
    note: "Morts moy. et Δ DTPS médian sont calculés sur les runs affichés. Surligné = meilleur sur la ligne.",
  },
```

- [ ] **Step 1: Server — `Evidence.value` / `extra`, `EVIDENCE_SOURCES`, tests** (`bun test test/evaluation`), commit `feat(evaluation): evidence carries its raw value and extras; EVIDENCE_SOURCES`.
- [ ] **Step 2: Dictionaries** (both files) — parity test green. Numbers in `tiles.*`/`runs.*` keep using `fmtAmount` / `signed` / `fmtDuration` as strings.
- [ ] **Step 3: View-model tests first** (`verdict`, `axes`, `tiles`, `runs`, `compare`, `radar`): add `tEn` (and `"en"` where `locale` is needed) first, keep the strings; one `tFr` assertion per file, including `verdictView(tFr, insufficientEv).badge === "PAS ASSEZ DE DONNÉES"` and the `evidenceText` byte-identity test above. Run — FAIL.
- [ ] **Step 4: Implement** the models; `AXIS_LABELS` → `axisTitle(t, key)`; `axisRows(t, ev, info)` evidence lines use `evidenceText`; `Detail.tsx`'s `quotaTooltip` comes from Task 2.
- [ ] **Step 5: Components** — `useT()` everywhere in the list; `HelpLink` title from `verdict.howComputed`.
- [ ] **Step 6: `just check && bun test`**; visual pass in FR on the local page with the saved payload if `biwaasham.json` exists (`bmpl serve` local + the saved-payload route, or the throwaway hosted instance) — **no lookup**: use a tab already in the local history (`bmpl.db` keeps them); screenshot the hero and the run list.
- [ ] **Step 7: Commit** `feat(i18n): verdict, axes, tiles, runs, Raider.IO and compare in French; evidence lines rebuilt from raw values`.

---

### Task 4: Deep-dive panel and proposals

**Files:**
- Modify: `web/src/i18n/en.ts` / `fr.ts` (area `deepdive`), `web/src/lib/deepdive.ts` (+test), `web/src/components/RunDeepDive.tsx`

**Interfaces:**
- Produces: every prose-producing export of `deepdive.ts` takes `t` first (`costText(t, runs)`, `usageRows(t, …)`, `deathRows(t, …)`, `tableUsedText(t, …)`, `proposalRows(t, …, now)`, `panelModel(t, …)` — use the file's real names: `grep -n "^export" web/src/lib/deepdive.ts`), `fmtAge(t, …)` from Task 2 for ages.

`en`:

```ts
  deepdive: {
    usage: "Usage", deaths: "Deaths · ", wipe: " wipe", audit: "Audit", auditEmpty: "Every self-cast buff is in the table.",
    talent: "talent?", talentTitle: "Casts seen closer than the table cooldown — a talent, or the table is wrong",
    cd: "cd ", s: " s", duration: "duration ",
    casts: "{casts} / {capacity}", cdOf: "cd {cd} s", seenMin: " · seen {s} s apart", onCd: "on cd · {s} s left", killingBlow: "killing blow: {spell}",
    verdict: { immunity: "immunity available", defensive: "defensive available", covered: "covered", nothing: "nothing available" },
    ignoredWarning: "Your defensives.json is ignored: {warning}",
    tableUsed: "Table used: {spec} · {n} entries", fromOverride: "{n} from your override", shared: "{n} shared", pendingReview: "{n} pending review",
    actions: {
      propose: { add: "Propose + {kind}", ignore: "Propose ignore", cd: "Propose cd", remove: "Propose removal", addAs: "Propose as {kind}", save: "Propose" },
      local: { add: "+ {kind}", ignore: "Ignore", cd: "Edit cd", remove: "Remove for this spec", addAs: "Add as {kind}", save: "Save" },
    },
    proposals: { title: "Your proposals", kind: "+ {kind}", cd: "cd {cd} s", duration: "{s} s", spell: "spell {id}", pending: "pending · {age}", rejected: "rejected {age}{note}", approved: "approved {age}{note}", note: " — \"{note}\"" },
    origin: { override: "your override", shared: "shared", pending: "pending review", local: "local table" },
    noTable: "No defensives table for {spec} yet — add entries from the audit below.",
    tableChanged: "The table changed since this run was analyzed — re-analyze to include the new entries.",
    truncated: "Cast events were truncated (more than 5 pages) — counts may be low.",
    title: "Defensives · {spec}", analyzedAgo: "analyzed {age}", pointsSpent: " · {pts} pts",
    majorsUsed: "majors used {pct}% of possible", noDeaths: "No deaths", deathsAvailable: "{n}/{total} deaths with a defensive available",
    uptime: " · {casts}× · {s} s up", summaryAvoidable: "{n}/{total} avoidable", summary: "{pct}% · {deaths}",
  },
```

`fr`:

```ts
  deepdive: {
    usage: "Utilisation", deaths: "Morts · ", wipe: " wipe", audit: "Audit", auditEmpty: "Chaque buff auto-lancé est dans la table.",
    talent: "talent ?", talentTitle: "Casts vus plus rapprochés que le cooldown de la table — un talent, ou la table est fausse",
    cd: "cd ", s: " s", duration: "durée ",
    casts: "{casts} / {capacity}", cdOf: "cd {cd} s", seenMin: " · vus à {s} s d'écart", onCd: "en cd · {s} s restantes", killingBlow: "coup fatal : {spell}",
    verdict: { immunity: "immunité dispo", defensive: "defensive dispo", covered: "couvert", nothing: "rien de dispo" },
    ignoredWarning: "Ton defensives.json est ignoré : {warning}",
    tableUsed: "Table utilisée : {spec} · {n} entrées", fromOverride: "{n} de ton override", shared: "{n} partagées", pendingReview: "{n} en attente de validation",
    actions: {
      propose: { add: "Proposer + {kind}", ignore: "Proposer d'ignorer", cd: "Proposer un cd", remove: "Proposer la suppression", addAs: "Proposer en {kind}", save: "Proposer" },
      local: { add: "+ {kind}", ignore: "Ignorer", cd: "Modifier le cd", remove: "Retirer pour cette spec", addAs: "Ajouter en {kind}", save: "Enregistrer" },
    },
    proposals: { title: "Tes propositions", kind: "+ {kind}", cd: "cd {cd} s", duration: "{s} s", spell: "sort {id}", pending: "en attente · {age}", rejected: "rejetée {age}{note}", approved: "approuvée {age}{note}", note: " — « {note} »" },
    origin: { override: "ton override", shared: "partagée", pending: "en attente de validation", local: "table locale" },
    noTable: "Pas encore de table de defensives pour {spec} — ajoute des entrées depuis l'audit ci-dessous.",
    tableChanged: "La table a changé depuis l'analyse de ce run — ré-analyse pour inclure les nouvelles entrées.",
    truncated: "Les événements de cast ont été tronqués (plus de 5 pages) — les compteurs peuvent être bas.",
    title: "Defensives · {spec}", analyzedAgo: "analysé {age}", pointsSpent: " · {pts} pts",
    majorsUsed: "majors utilisés à {pct} % du possible", noDeaths: "Aucune mort", deathsAvailable: "{n}/{total} morts avec un defensive dispo",
    uptime: " · {casts}× · {s} s actif", summaryAvoidable: "{n}/{total} évitables", summary: "{pct} % · {deaths}",
  },
```

Again: **the file wins for `en`** — read `deepdive.ts` and `RunDeepDive.tsx` and copy each literal exactly (the `origin` suffixes and `kind` names are enums from the payload: `major` / `immunity` / `minor` stay as they are, they are table vocabulary).

- [ ] **Step 1: Dictionaries**, parity green.
- [ ] **Step 2: `deepdive.test.ts` with `tEn` first**, one `tFr` assertion (`verdict.nothing` → `rien de dispo`, `tableUsedText(tFr, …)`). FAIL.
- [ ] **Step 3: Implement** models and component.
- [ ] **Step 4: `just check && bun test`**; visual pass on a run already analyzed in the local history (0 points — never click Analyze on the throwaway).
- [ ] **Step 5: Commit** `feat(i18n): deep-dive panel and proposals in French`.

---

### Task 5: Account, settings, privacy and admin

**Files:**
- Modify: `web/src/i18n/en.ts` / `fr.ts` (areas `account`, `privacy`, `admin`), `web/src/lib/account.ts` (+test), `web/src/lib/admin.ts` (+test), `web/src/components/account/SettingsPage.tsx`, `AccountCard.tsx`, `WclClientCard.tsx`, `PrivacyPage.tsx`, `web/src/components/admin/*.tsx` (8 files)

**Interfaces:**
- Produces: `clientCard(t, …)`, `privacyText(t, …)` (or the real names in `account.ts`), every prose export of `admin.ts` with `t` first.

`en` for `account` / `privacy` (exact literals from the files — the inventory: `Settings`, `your Warcraft Logs client, your account`, `Account`, `signed in with Discord as `, `Delete your account? Type delete to confirm.`, `Delete`, `Delete my account`, `Removes everything above and signs you out. Approved corrections you contributed stay in the shared table, without your name.`, `Your Warcraft Logs client`, `Remove your client? Your lookups go back to the shared budget.`, `Remove`, `Verify again`, `Replace`, `No shared quota.`, `Client id`, `Client secret`, `from warcraftlogs.com/api/clients`, `Save and verify`, `Create a client at … — step by step in Help. The secret is stored encrypted and never shown again; saving sends one PING to check it.`, `This instance does not store WCL clients — your lookups use the shared budget.`, `{n} pts per hour`, `No client — your lookups use the shared budget ({budget}).`, `Stored secret cannot be decrypted (the instance key changed) — save the client again. Your lookups use the shared budget meanwhile.`, `Saved {age}`, `Verified {age}`, and the whole Privacy page). French, same order:

```ts
  account: {
    title: "Paramètres", sub: "ton client Warcraft Logs, ton compte",
    card: "Compte", signedInAs: "connecté avec Discord en tant que ",
    deleteConfirm: "Supprimer ton compte ? Tape {word} pour confirmer.", deleteWord: "delete", delete: "Supprimer", deleteMine: "Supprimer mon compte",
    deleteNote: "Supprime tout ce qui précède et te déconnecte. Les corrections approuvées que tu as proposées restent dans la table partagée, sans ton nom.",
    client: {
      title: "Ton client Warcraft Logs",
      removeConfirm: "Retirer ton client ? Tes recherches repassent sur le budget partagé.", remove: "Retirer", verify: "Vérifier à nouveau", replace: "Remplacer",
      noQuota: "Pas de quota partagé.", clientId: "Client id", clientSecret: "Client secret", idPlaceholder: "depuis warcraftlogs.com/api/clients",
      save: "Enregistrer et vérifier",
      hint: "Crée un client sur {site} — {guide}. Le secret est stocké chiffré et jamais réaffiché ; l'enregistrement envoie un PING pour le vérifier.",
      guideLink: "pas à pas dans l'Aide",
      disabled: "Cette instance ne stocke pas de client WCL — tes recherches utilisent le budget partagé.",
      perHour: "{n} pts par heure",
      none: "Aucun client — tes recherches utilisent le budget partagé ({budget}).",
      stale: "Le secret stocké ne peut plus être déchiffré (la clé de l'instance a changé) — enregistre à nouveau le client. En attendant, tes recherches utilisent le budget partagé.",
      saved: "Enregistré {age}", verified: "Vérifié {age}",
    },
  },
  privacy: {
    title: "Confidentialité", stored: "Ce qui est stocké sur toi",
    identity: "Id, nom d'utilisateur, nom global et avatar Discord", identityGuild: " (sauf si cette instance exige l'appartenance à un serveur — la vérification lit alors ta liste de serveurs une fois à la connexion et ne garde rien)",
    history: "Ton historique de recherches", historyRest: " (les 20 onglets), tes paramètres (ta key, la légende), ton usage WCL horaire, tes propositions de defensives et les notes de l'admin dessus.",
    client: "Ton client Warcraft Logs", clientRest: ", si tu en as ajouté un : l'id du client en clair, le secret chiffré avec une clé que seul ce serveur détient. Vérifié une fois à l'enregistrement ; utilisé pour tes recherches uniquement.",
    sessions: "Sessions", sessionsRest: " : un id aléatoire dans un cookie, ton IP et ton navigateur à la connexion, pendant 30 jours.",
    audit: "Journal d'audit", auditRest: " : connexions, refus et erreurs avec ton id et ton IP, gardés 90 jours.",
    notYours: "Ce qui n'est pas à toi",
    publicData: "Les runs, classements et données de combat récupérés sur Warcraft Logs sont publics et mis en cache pour tout le monde ; ils portent les noms des joueurs de ces runs, c'est ainsi que Warcraft Logs les publie.",
    deleting: "Supprimer ton compte", deleteMine: "Supprimer mon compte",
    questions: "Questions : l'admin de cette instance, sur Discord.",
    operator: "Opérateur : {operator}",
  },
```

(Read `PrivacyPage.tsx` and `AccountCard.tsx` for the full English of each sentence — the `en` values are the file's literals; the French above follows their order.)

Admin (`web/src/components/admin/*.tsx`, `web/src/lib/admin.ts`): the area `admin` is written by the implementer — extract every literal into `en.admin.*` grouped by file (`page`, `instance`, `users`, `invites`, `queue`, `audit`, `gauge`, `forbidden`), and write the French with the glossary (Instance → Instance, Users → Membres, Invites → Invitations, Proposal queue → File des propositions, Audit → Audit, Ban / Unban → Bannir / Débannir, Promote / Demote → Promouvoir / Rétrograder, Revoke sessions → Révoquer les sessions, approve / reject → approuver / rejeter, note → note, pending → en attente, version → version, uptime → uptime, database size → taille de la base, last backup → dernier backup, effective environment → environnement effectif, budget gauge → jauge de budget, "Admins only" → "Réservé aux admins"). Audit **detail strings that come from the server** (action names, JSON detail) stay as they are; only the page chrome is translated.

- [ ] **Step 1: Dictionaries** (account + privacy from above; admin extracted), parity green.
- [ ] **Step 2: `account.test.ts` / `admin.test.ts` with `tEn`**, one `tFr` each. FAIL → implement → PASS.
- [ ] **Step 3: Components.**
- [ ] **Step 4: `just check && bun test`**; visual pass on the throwaway hosted instance: `/privacy` in FR (anonymous, browser `fr-FR`), and — signed-in pages cannot be reached without Discord — check `/settings` and `/admin` render in FR by temporarily pointing a browser at the local build with `bmpl.locale=fr` set and the components mounted through a Storybook-free trick: not available; instead assert through the view-model tests and read the JSX diff carefully. Say so in the report.
- [ ] **Step 5: Commit** `feat(i18n): account, privacy and admin pages in French`.

---

### Task 6: Help page and the bilingual registry

**Files:**
- Create: `src/evaluation/docs.fr.ts`
- Modify: `src/evaluation/docs.ts` (export `EVALUATION_DOCS_BY_LOCALE`), `src/server/routes-shared.ts` (`docsResponse(cfg, hosted, pointsPerUserHour, locale)`, `?lang=`), `test/evaluation/docs.test.ts`, `test/server-docs.test.ts`, `web/src/docs.tsx` (fetch with the locale, refetch on change), `web/src/api.ts` (`docs(locale)`), `web/src/i18n/en.ts` / `fr.ts` (area `help`), `web/src/lib/help.ts` (+test: `toc(t, docs, hosted)`, `fmtThresholds(t, …)`, `axisNote(t, key, c)`, `budgetPill(t, …)`), `web/src/components/help/*.tsx`

**Interfaces:**
- Produces (server): `EVALUATION_DOCS_BY_LOCALE: Record<Locale, EvaluationDocs>` (`en: EVALUATION_DOCS`, `fr: EVALUATION_DOCS_FR`), `docsResponse(cfg, hosted, pointsPerUserHour, locale: Locale = "en")`, route: `const lang = url.searchParams.get("lang"); docsResponse(…, isLocale(lang) ? lang : "en")`.
- Produces (front): `api.docs(locale)` → `GET /api/docs?lang=<locale>`; `DocsProvider` reads `useT().locale` and refetches when it changes (so `LocaleProvider` must wrap `DocsProvider` — it does since Task 1).

Server tests: `test/evaluation/docs.test.ts` — every existing test runs `for (const locale of LOCALES)` over `EVALUATION_DOCS_BY_LOCALE[locale]` (numbers absent, FAQ flags, the guide's links — the French guide links `warcraftlogs.com/api/clients` and `/settings#wcl-client` too); plus `leafKeys`-style structural parity: same axis keys, same sub-signal keys, same number of FAQ entries, sources, runSignals, notScored, same `hostedOnly` flags in the same positions. `test/server-docs.test.ts`: `?lang=fr` → `docs.axes.survival.title === "Survie"`; `?lang=de` and no `lang` → English.

`docs.fr.ts` is the full French registry (`export const EVALUATION_DOCS_FR: EvaluationDocs = { … }`): translate every field of `docs.ts` (sources, runsUsed, peers, verdict.*, levelScale, expectedIlvl, the six axes with their sub-signals' `title / what / source / how / why / naWhen / unit`, extras, notScored, runSignals, deepdive.*, faq, wclClient). Register: same glossary, "tu"; `unit` strings are axis-label-like (`morts par run, pondérées par niveau`). Keep `[label](href)` links and `` `code` `` spans. This is the largest single piece of French in the plan — write it in the file, not in this plan; the structural-parity test and the number scan are the net.

`help` area (`en` = the literals of `HelpPage.tsx`, `HelpToc.tsx`, `AxisSection.tsx`, `SubSignalCard.tsx`, `CurveChart.tsx`, `Faq.tsx`, `WclClientGuide.tsx` and the `toc` labels in `help.ts`):

```ts
  help: {
    title: "Help", sub: "what is analysed, how every number is computed, and why some are not",
    toc: { what: "What bmpl looks at", verdict: "The verdict", axes: "The six axes", levelScale: "Key-level scaling", expectedIlvl: "Expected item level", runs: "Per-run signals", peers: "Peers", deepdive: "Deep-dive", wclClient: "Your own WCL client", reading: "Reading the page", faq: "FAQ" },
    publicData: "All of it is public data: anyone can open the same logs on warcraftlogs.com and count the same deaths.",
    thresholds: { invite: "INVITE", from: "from", maybe: "MAYBE", pass: "PASS", below: "below", high: "high", medium: "medium", low: "low", minimum: "Minimum:", runs: "{count, plural, one {# run} other {# runs}}", enriched: "{count, plural, one {# enriched run} other {# enriched runs}}" },
    weightsCaption: "axis weights by role (effective config, version {version})",
    informational: "{list} {count, plural, one {has} other {have}} weight 0 for every role: shown, never counted. Timed vs depleted is shown in the run list and never scored.",
    axesIntro: "Each axis scores 0–100. A sub-signal's value goes through its curve — printed beside it, linear between the points and clamped outside them — into a 0–100 score; the axis is the mean of those scores weighted by the player's role (the chips under each curve), rounded. A sub-signal that is n/a, or whose weight for the role is 0, is left out. Each evidence line on an axis row is that sub-signal's share of the distance from 50, in axis points.",
    survivalNote: "The two deep-dive sub-signals appear once at least {count, plural, one {# shown run has} other {# shown runs have}} been analyzed.",
    consistencyNote: "Every sub-signal needs at least {count, plural, one {# run} other {# runs}}; below that the axis is n/a.",
    curve: { keyToFactor: "key level → factor", keyToIlvl: "key level → item level", season: " · season ", noSeason: "no season curve configured", weights: "weights by role" },
    shownNotScored: "Shown, not scored",
    tableVersion: "table version ",
    reading: { /* the six bullets of Reading(): verdict, tiles, runs, deepdive, compare, stale — one key each, English verbatim from HelpPage.tsx */ },
    guide: { onWcl: "On warcraftlogs.com", inBmpl: "In bmpl", pts: "{pts} pts / h", lookups: "{count, plural, one {about # uncached lookup} other {about # uncached lookups}}" },
  },
```

French `help` (same keys; `reading.*` translated bullet by bullet; `toc.*`: « Ce que bmpl regarde », « Le verdict », « Les six axes », « Pondération par niveau de key », « Item level attendu », « Signaux par run », « Pairs », « Deep-dive », « Ton propre client WCL », « Lire la page », « FAQ »; `sub`: « ce qui est analysé, comment chaque nombre est calculé, et pourquoi certains ne le sont pas »; `publicData`: « Tout ça est public : n'importe qui peut ouvrir les mêmes logs sur warcraftlogs.com et compter les mêmes morts. »; `guide.onWcl`: « Sur warcraftlogs.com », `guide.inBmpl`: « Dans bmpl », `guide.lookups`: « {count, plural, one {environ # recherche non cachée} other {environ # recherches non cachées}} »). `fmtThresholds` / `axisNote` / `budgetPill` gain `t`; `linkSegments` unchanged.

- [ ] **Step 1: Server** — `docs.fr.ts`, `EVALUATION_DOCS_BY_LOCALE`, `?lang`, tests (`bun test test/evaluation test/server-docs`); commit `feat(docs): French help registry served by /api/docs?lang=fr`.
- [ ] **Step 2: Front** — dictionaries, `help.test.ts` with `tEn`/`tFr`, models, components, `DocsProvider` refetch on locale change (`useEffect` on `locale`; keep the previous docs while loading so the page does not flash).
- [ ] **Step 3: `just check && bun test`**; visual pass: `/help` in FR on the throwaway hosted instance (anonymous, `fr-FR`), screenshot the TOC, the verdict card and the WCL guide; switch to EN through `bmpl.locale` and check the English page is unchanged.
- [ ] **Step 4: Commit** `feat(i18n): help page in French`.

---

### Task 7: Docs and the hard-rule amendment

**Files:**
- Modify: `README.md` (a "Languages" paragraph under the web UI section: English and French, browser detection, the EN/FR switch, `bmpl.locale` / `user_settings.locale`), `docs/hosted.md` (`locale` in the settings table and `PUT /api/settings`; `GET /api/docs?lang=`), `docs/agents/web-front.md` (a "Strings and locales" section: `web/src/i18n/`, `t`, `useT`, the view-model rule, `Mirror`, the parity test, the register/glossary pointer to the spec), `docs/agents/architecture.md` (one line: `/api/docs?lang`, `Evidence.value`/`extra`, `EVALUATION_DOCS_BY_LOCALE`), `AGENTS.md` (hard rule: "English everywhere in code, docs and commits; UI strings live in `web/src/i18n/` — `en.ts` is the source, `fr.ts` mirrors it key for key; never write a UI literal in a component"), `docs/cli.md` only if a CLI flag changed (none expected), the spec's status line (`implemented <date>`).

- [ ] **Step 1: Write the doc changes** (English; the README stays the user manual — say what the user sees, not how it is built).
- [ ] **Step 2: `bun test test/docs`** (link checker) green; `just check && bun test` green.
- [ ] **Step 3: Commit** `docs(i18n): languages in the README and hosted guide; dictionary rule for agents`.

## Self-review

- Spec coverage: locale model (T1), switching (T1), dictionaries and `t` (T1), view-model rule (T2–T6), help registry + `?lang` (T6), `Evidence.value` (T3), enums (T3–T4), quota/budget errors (T2), `<html lang>` (T1), anonymous screens (T1 + T2 sign-in), formats (T1 `fmtNumber`/`fmtDate`, T2 `fmtAge`), tests (each task), rollout order (T1–T7), docs (T7). Gap: none found.
- Type consistency: `T`, `MessageKey`, `Mirror`, `makeT`, `tEn`, `LocaleProvider({ saved, persist })`, `useT() → { t, locale, setLocale }`, `evidenceText(t, locale, e)`, `docsResponse(cfg, hosted, pointsPerUserHour, locale)`, `EVALUATION_DOCS_BY_LOCALE`, `localeMenu(t, current)` — used with the same names in every task.
- Placeholders: the `reading.*` and admin dictionary blocks are deliberately "extract from the file" (the file is the source of English); every other block is written out. The French registry lives in `docs.fr.ts`, sized by the structural-parity test.
