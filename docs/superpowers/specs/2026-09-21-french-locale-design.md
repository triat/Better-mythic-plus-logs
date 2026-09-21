# French locale for the web front — design

Status: approved design, 2026-09-21 (brainstorm in chat; canvas "Hosted" page, board "Locale — EN / FR chip (A/B) and the French preview", option **A** chosen: the chip lives in the user menu in hosted mode and at the right of the header in local mode); implemented 2026-09-21 (plan `docs/superpowers/plans/2026-09-21-french-locale.md`, commits `a26a03e^..f7875fb`).

## Why

Most of the first members of bmpl.riat.dev are French speakers. The web front, the help page and the
verdict wording are English only. The tool must read naturally to them without becoming a second
product: one code base, one set of behaviours, two languages on the screen.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Scope | The web front only: every string the browser shows, the help page and its guides, the verdict and axis wording. The CLI, the JSON payloads, server logs and the admin audit rows stay English. WCL / Raider.IO data (spec, dungeon and spell names) stays as the APIs give it. |
| How the language is chosen | Browser detection first (`navigator.language` starting with `fr` → `fr`, anything else → `en`), then an explicit choice remembered per user like the region: `localStorage` `bmpl.locale` in local mode, `user_settings.locale` in hosted mode (`null` = follow the browser). |
| Register | Player's franglais, second person singular ("tu"): WoW terms stay English the way French players say them — *kick, key, timed / depleted, parse, wipe, DPS / HPS, tank / heal, Mythic+, deep-dive, run, reset* — the rest is French. |
| Who writes | Claude writes the French; the user reviews `fr.ts` and the French registry. |
| Mechanism | Typed dictionaries in the front, no library. The help registry carries both languages server-side. |

## Locale model

- `Locale = "en" | "fr"`, `LOCALES`, `isLocale`, `LOCALE_LABELS` (`EN`, `FR`) in `web/src/lib/locale.ts`;
  `Locale` also exists server-side (`src/hosted/locale.ts`, same two values) for the settings column and
  `/api/docs?lang`. The two files do not share code (the front imports types only); a test in each
  project pins the same list.
- `detectLocale(navigatorLanguage: string | undefined): Locale` — `"fr"`, `"fr-FR"`, `"fr-CA"` → `fr`; anything
  else, including `undefined`, → `en`.
- `effectiveLocale(saved: Locale | null, navigatorLanguage: string | undefined): Locale` — the saved choice
  wins, otherwise detection. This is the only place the rule lives.
- `Settings.locale: Locale | null` joins `yourKey`, `legendOpen`, `region` (`web/src/lib/settings.ts`,
  `readLocalSettings` / `writeLocalSettings`, key `bmpl.locale`); hosted: `user_settings.locale TEXT NULL`
  through `migrateColumns`, `SETTINGS_BODY.locale: opt(nullable(oneOf(LOCALES)))`, `parseSettingsPatch`
  accepts it, `GET /api/settings` returns it.
- `<html lang>` is set from the effective locale on every change (`document.documentElement.lang`).
- Anonymous screens (sign-in, `/privacy`, `/help` for a visitor) have no settings: they use
  `effectiveLocale(readLocalSettings(localStorage).locale, navigator.language)` — a member who chose FR
  and signs out keeps FR on the sign-in screen of that browser.

### Switching

Canvas option A. Hosted mode: a "Language" row in the user menu, under the quota block, with a two-way
segmented control **EN | FR** (the current locale highlighted). Local mode: a `chip` (`chip-on` when the
locale differs from the browser's detection) at the right of the header, before the clipboard-watch
toggle, opening the same two-entry `ChipMenu` as the region chip ("Language · remembered": EN English /
FR Français). Picking a locale writes `settings.locale` (hosted: `PUT /api/settings { locale }`) and
re-renders; nothing is re-fetched except `/api/docs`. The board also fixes the French preview of the
header, tabs, hero, axes, tiles and the quota toast (`docs/design/canvas/Locale.dc.html`).

## Dictionaries (`web/src/i18n/`)

- `en.ts` is the source of truth: `export const en = { … } as const`, nested objects by area
  (`header`, `tabs`, `verdict`, `axes`, `tiles`, `runs`, `deepdive`, `compare`, `account`, `admin`,
  `help`, `errors`, `common`). `fr.ts` is typed `Dictionary = DeepStringRecord<typeof en>` so a missing or
  extra key fails `tsc`; a test also checks placeholder parity (`{name}` in `en` ⇔ `{name}` in `fr`).
- Messages are plain strings with `{param}` placeholders. Plurals use one message with a `count`
  parameter and the ICU-like form `{count, plural, one {# run} other {# runs}}`; the front's `t` handles
  exactly `plural` with `one` / `other` (English and French both fit these two forms; French uses `one`
  for 0 and 1 — `pluralCategory(locale, n)`).
- `t(dict, locale)` → `T = (key: MessageKey, params?: Record<string, string | number>) => string`. A key
  that does not exist returns the key itself (never throws; a test asserts it). Numbers in params are
  formatted with `fmtNumber(locale, n)` (narrow no-break space thousands separator, as `fmtPts` does today,
  for both locales — the existing tests keep their expected strings).
- `useT()` (React context `LocaleProvider`) gives components `{ t, locale, setLocale }`. Pure view models
  in `web/src/lib/*.ts` that produce prose take `t: T` as their first parameter; their tests pass
  `tEn = t(en, "en")` so existing assertions keep their English strings. View models that only compute
  numbers or keys do not take `t`.
- Label tables become key tables: `AXIS_LABELS` → `t(\`axes.${key}.title\`)`, role / confidence / verdict
  labels likewise. `AXIS_ORDER` and every key stay as they are.
- Dates: relative ages (`3 d ago`) come from the dictionary (`common.age.*`, `fmtAge`). No absolute date is
  shown anywhere, so the `fmtDate(locale, ms)` helper planned here was dropped (final review).

## Server-side content

- **Help registry.** `EVALUATION_DOCS` becomes `Record<Locale, EvaluationDocs>` (`src/evaluation/docs.ts`
  keeps the type and the English; `src/evaluation/docs.fr.ts` holds the French). `GET /api/docs?lang=fr`
  serves that one, anything else serves `en`. `docsResponse(cfg, hosted, quota, locale)`. The tests that
  scan the prose for numbers, check the FAQ flags and the guide's links run over both locales. `DocsProvider`
  fetches with the effective locale and refetches on change.
- **Evidence lines.** `Evidence` gains `value: number` (the raw sub-signal value the label was formatted
  from) — additive, the CLI keeps printing `label`. The front owns one message per `source`
  (`evidence.<axis>.<subSignal>` with `{value}`), so "parse spread ±12%" becomes « écart de parse ±12 % »
  from the same number. A test pins that every `source` the axes can emit has a message in `en`
  (the list of sources comes from `src/evaluation/axes/*` — exported as `EVIDENCE_SOURCES` so the test
  needs no fixtures).
- **Enums already in the payload** (verdict, confidence, role, `DeathVerdict`, `EntryOrigin`, run flags)
  map to dictionary keys in the front; nothing changes server-side.
- **Errors.** Bodies with `error: "quota"` / `error: "budget"` are rendered from the dictionary (the numbers
  come from the body); every other server error string stays as it is (English, technical, rare).
- **Spec / help guide.** The own-client guide (`wclClient`) is part of the registry, so it is translated
  with it; its links and `code` spans go through the same `linkSegments`.

## What does not change

CLI output and `--json`, server logs, the admin audit detail strings, `bmpl serve` banners, README and docs
(English), WCL / Raider.IO names, the design tokens. Local mode stays pixel-identical in English apart
from the chip.

## Testing

- `web/src/i18n/i18n.test.ts`: key and placeholder parity `en` ⇔ `fr`; `t` with params, plural
  (`one` / `other`, French 0 → `one`), missing key → key; `detectLocale` / `effectiveLocale`.
- Every touched view model: unchanged assertions with `tEn`, plus one French assertion per function
  where the wording is not a straight word swap (plurals, ordering).
- `test/server-docs.test.ts`: `?lang=fr` serves the French registry, `?lang=de` serves English;
  `test/evaluation/docs.test.ts` runs over both locales; `EVIDENCE_SOURCES` ⊆ `en` keys.
- `test/hosted/settings.test.ts` and `test/server/validate`: `locale` round-trip and rejection of `"de"`.
- A visual pass in both locales on the local page and on a throwaway hosted instance (0 WCL points),
  screenshots kept in the report.

## Rollout (plan tasks)

1. Core: `locale.ts`, dictionaries with the `common` area, `t`, `LocaleProvider`, settings column and
   body, chip (after the canvas pick), `<html lang>`.
2. Header, search, tabs, hero, toast, user menu.
3. Axes, legend, tiles, runs, Raider.IO section, compare; `Evidence.value` and the evidence messages.
4. Deep-dive panel and proposals.
5. Account (settings, WCL client card, privacy), sign-in, admin pages.
6. Help page: French registry, TOC, guide.
7. Docs: README (a "Languages" line), `docs/hosted.md` (`locale` setting, `/api/docs?lang`),
   `docs/agents/web-front.md` (dictionaries, `t`, the rule for view models), `AGENTS.md` hard rule
   amended: "English everywhere in code, docs and commits; UI strings live in `web/src/i18n/`, English
   is the source, French mirrors it".
