# UI redesign, phase 1 (foundation) — implementation plan

**Goal:** the new visual system (tokens, self-hosted Geist fonts, icons) and the new frame — a left sidebar with the
search field at its top, a Récents list and the account block, a Ctrl K command palette — around every in-app page;
a connected home page outside the frame ("Toi cette semaine" + Ta progression + Tes candidats); a landing page for
signed-out hosted visitors. The existing result, compare, Live, `/me`, help, settings and admin views render inside
the new frame unchanged in content (their own redesign is phases 2–4).

**Architecture:** no router (rule kept): `pageOf` gains `home`, `candidate`, `compare`, `live`; each is a full
navigation served by `src/web-static.ts`, and inside the candidate page Récents switches profiles in state with
`history.replaceState`. The frame is one component (`Shell`) fed by pure view models (`lib/shell.ts`,
`lib/palette.ts`). The home page reads the main character's season (`GET /api/season`, 0 pts) through a pure model
(`lib/home.ts`). `GET /api/history` rows gain `verdict` and `score` for the Récents dots. Fonts are two woff2 files
embedded in the binary like the other front assets.

**Spec:** `docs/superpowers/specs/2026-10-11-ui-redesign-design.md` (approved 2026-10-11). Mockups:
`docs/design/redesign/F-Accueil.dc.html`, `F-Landing.dc.html`, `F-Palette.dc.html` (frame and palette), and the
frame as drawn on every other `F-*.dc.html`. Open them in a browser or on the canvas
(https://claude.ai/artifact/WeznnnDkrDGMPyAsuSKBeE, page "4 · Final") and match them; values below win on conflict.

## Global Constraints (from the spec, verbatim where quoted)

- Frame = left sidebar (≈ 248 px): logo, **a 48 px search field at the top** with the region and key-level chips
  under it, navigation (Accueil · Candidats · Mes persos · Comparer · Live · Aide; admin and settings in the account
  menu), a **Récents** list (history: verdict dot, name, score) and the account block at the bottom (avatar, WCL
  budget line hosted / "Reconfigurer", "Quitter", clipboard watcher locally). **No search bar in the content
  column.** **Ctrl K** opens a centred command palette (personnages récents, mes persos, actions). On narrow screens
  the sidebar stacks above the content (no sticky, no `100vh`).
- The connected home page is outside the frame: slim top bar, split hero (search left, "Toi cette semaine" right),
  two equal columns "Ta progression" / "Tes candidats", then a strip with the other characters.
- A signed-out hosted visitor sees the landing page; locally there is no landing (home, or `Setup` without a WCL
  client).
- **No horizontal scroll anywhere.** Buttons inside cards and rows 32–36 px, one 40–44 px primary per view.
- Tokens (spec table): `--bg #0E1014`, `--card #161920`, `--card-2 #1C2029`, `--card-3 #232836`, `--border #232733`,
  `--border-2 #2A2F3B`, `--text #ECEEF2`, `--text-soft #C9CED8`, `--muted #A0A7B4`, `--label #8D95A3`, `--dim #5A6272`
  (decoration only), `--link #7FB4FF`, `--invite #3FCF8E` (bg #12201B, border #24523F), `--maybe #F2B544` (bg
  #1A1812, border #3D3420), `--pass #F2665C` (bg #1E1416, border #4A2228), `--better #5AB8F0`, `--worse #F59E5B`,
  `--primary #ECEEF2` / `--on-primary #0E1014`; radii 16 card · 10 block / button · 999 chip.
- Fonts **Geist** + **Geist Mono** (tabular numbers), **self-hosted** (`font-src 'self'`); icons inline SVG.
- No new runtime dependency; view models pure and tested; every UI string from `web/src/i18n/en.ts` with `fr.ts`
  mirroring it; no WCL point spent by anything in this phase (the home page reads, never looks up).
- `just check` and `bun test` green with `web/dist` absent after every task.

## Before you start

- Bun 1.4.3. Gate per task: `just check && bun test` (with `web/dist` absent: `rm -rf web/dist` first).
- Code facts this plan relies on (checked 2026-10-11):
  - `pageOf` / `Page` live in `web/src/lib/hostedMode.ts:20-27`; `App.tsx:57` resolves the page once per load and
    `App.tsx:236-253` is the boot effect that opens `?open=` and erases the query string.
  - `src/web-static.ts:21-32` is the static route table; `src/web-assets.ts` imports the four built files
    verbatim (`with { type: "file" }`); `web/vite.config.ts` copies `web/public/*` to `dist/` as-is.
  - Hosted CSP (`src/server/security.ts:12-15`): `font-src 'self'`, `img-src 'self' data: https://wow.zamimg.com
    https://cdn.discordapp.com`.
  - History rows: `HistoryEntry` / `HistoryListItem` in `src/server-history.ts:18-45` (local, in memory) and the
    SQLite repo in `src/hosted/history.ts` (hosted per user, and local mode's FK-free copies — same code, table
    pair `HistoryTables`). The list query reads `ITEM_COLUMNS` only (no payload). One-time migrations are
    self-detecting and idempotent, run at open (precedent `migrateRegionlessKeys`).
  - `SeasonView` (`src/self/season.ts:120-139`): `currentWeek`, `runs[]` (newest first, `week`, `keyLevel`,
    `timed`), `recent` / `season` windows with `pillars`, `workOn`, `dungeons[]` (`pillars`, `overall`).
    `useSeason(who, self)` in `web/src/useSeason.ts` loads it (0 pts).
  - Today's header pieces to reuse: `SearchInput` (suggestions, ghost completion), `ChipMenu` (region chip),
    `KeyStepper` (your key), `LiveChip`, `UserMenu` (hosted menu model from `lib/session.ts`).
- Do not run `just deploy`; do not create a release.

## Files

| File | Responsibility |
|---|---|
| `web/public/fonts/Geist-Variable.woff2`, `GeistMono-Variable.woff2`, `OFL.txt` | self-hosted fonts and their licence |
| `src/web-assets.ts`, `src/web-static.ts` | embed and serve the two fonts; routes for `/candidate`, `/compare`, `/live` |
| `web/src/styles/tokens.css`, `web/src/styles/app.css` | new token values, `@font-face`, shell / palette / home / landing classes |
| `src/server-history.ts`, `src/hosted/history.ts` | `verdict` / `score` on history rows (+ migration) |
| `web/src/types.ts` | `HistoryItem.verdict`, `HistoryItem.score` |
| `web/src/lib/hostedMode.ts` | `Page` + `pageOf` additions |
| `web/src/lib/shell.ts` (+ test) | nav items, Récents rows, account lines |
| `web/src/lib/palette.ts` (+ test) | palette sections, filtering, keyboard index |
| `web/src/lib/home.ts` (+ test) | "Toi cette semaine", strengths / costs, best timed key per week |
| `web/src/lib/landing.ts` (+ test) | landing content blocks per instance mode |
| `web/src/components/Icon.tsx` | inline SVG icon set |
| `web/src/components/shell/Shell.tsx`, `Sidebar.tsx`, `Palette.tsx` | the frame |
| `web/src/components/home/HomePage.tsx` | connected home (replaces `Home.tsx`) |
| `web/src/components/Landing.tsx` | signed-out landing (absorbs `SignIn.tsx`) |
| `web/src/App.tsx` | page switch inside `Shell`; `Header`, `Tabs`, `Home`, `SignIn` retired |
| `web/src/i18n/en.ts`, `fr.ts` | `shell`, `palette`, `home`, `landing` sections |
| `docs/agents/web-front.md`, `AGENTS.md`, `README.md` | components map, design pointer, screenshots |

---

## Task 1 — Self-hosted fonts

1. Fetch the fonts once (Geist is OFL-1.1, Vercel; the npm package ships the variable woff2 files):
   ```
   mkdir -p /tmp/geist && cd /tmp/geist && curl -sL https://registry.npmjs.org/geist/-/geist-1.3.1.tgz | tar xz
   tar tzf <(curl -sL https://registry.npmjs.org/geist/-/geist-1.3.1.tgz) | grep -i 'variable.*woff2\|LICENSE'
   ```
   Copy the sans and mono variable woff2 files to `web/public/fonts/Geist-Variable.woff2` and
   `web/public/fonts/GeistMono-Variable.woff2`, and the licence to `web/public/fonts/OFL.txt`. (If the package
   layout differs, use the paths `tar tzf` printed; keep the two target names.)
2. `src/web-assets.ts`: add
   ```ts
   import geistWoff2 from "../web/dist/fonts/Geist-Variable.woff2" with { type: "file" };
   import geistMonoWoff2 from "../web/dist/fonts/GeistMono-Variable.woff2" with { type: "file" };
   export const WEB_ASSETS = { index: indexHtml as unknown as string, appJs, appCss, whConfigJs, geistWoff2, geistMonoWoff2 };
   ```
3. `src/web-static.ts`: `WebAssets` gains `geistWoff2: string; geistMonoWoff2: string`; routes
   `"/fonts/Geist-Variable.woff2"` and `"/fonts/GeistMono-Variable.woff2"` with type `"font/woff2"` and
   `"Cache-Control": "public, max-age=31536000, immutable"` for these two only (names are versioned by the file:
   changing the font means a new name).
4. Test (`test/server.test.ts`, next to the existing `createStaticHandler` cases): a loader returning temp files for
   all six assets answers both font paths with `font/woff2`; a loader returning null answers 503 for them.
5. `just check && bun test`. Commit `feat(web): self-host the Geist fonts`.

## Task 2 — Tokens and base styles

1. `web/src/styles/tokens.css`: replace the values with the spec's table. Keep every existing name the current CSS
   uses, remapped so today's views keep working until phases 2–4 replace them:
   `--card-2/--card-3/--border-2/--label/--dim/--invite*/--maybe*/--pass*/--better/--worse/--primary/--on-primary`
   are new; old names map: `--inset → #0E1014`, `--border-soft → #1E222C`, `--text-soft → #C9CED8`,
   `--muted → #A0A7B4`, `--faint → #8D95A3`, `--link → #7FB4FF`, `--green → #3FCF8E` (+ `-bg #12201B`,
   `-border #24523F`), `--yellow → #F2B544` (+ `#1A1812`, `#3D3420`), `--red → #F2665C` (+ `#1E1416`, `#4A2228`),
   `--warn → #F59E5B`, `--orange → #F59E5B`, `--button → #ECEEF2`; radii `--radius: 10px`, `--radius-sm: 6px`,
   `--radius-lg: 16px`; add `--font-ui: Geist, system-ui, sans-serif` and
   `--mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Each new or remapped line keeps a
   comment "redesign spec 2026-10-11".
2. `app.css` top: two `@font-face` rules (`font-family: Geist` / `"Geist Mono"`, `src: url(/fonts/….woff2)
   format("woff2")`, `font-weight: 100 900`, `font-display: swap`); `body { font-family: var(--font-ui); }`;
   `.mono, code { font-variant-numeric: tabular-nums; }`; `.btn-primary` uses `--primary` / `--on-primary`.
3. Sanity pass in the browser on the current screens (result, compare, `/me`, help, admin): nothing unreadable;
   note but do not fix layout nits (phases 2–4 replace those views).
4. `just check && bun test`. Commit `feat(web): redesign tokens and base type`.

## Task 3 — Verdict and score on history rows

1. `src/server-history.ts`: `HistoryEntry` and `HistoryRecord` gain `verdict: "invite" | "maybe" | "pass" | null`
   and `score: number | null`. A helper `summaryOf(result: unknown)` reads `result.evaluation.verdict` /
   `.global` defensively (null when absent or of the wrong type). `History.record` fills both from the result;
   `updateResult` refreshes them.
2. `src/hosted/history.ts`: add columns `verdict TEXT` and `score INTEGER` to both table pairs; `ITEM_COLUMNS` reads
   them; the upsert writes them; `updateResult` refreshes them. Idempotent migration at open: add the columns when
   `PRAGMA table_info` lacks them, then backfill rows where `verdict IS NULL` from their payload with
   `summaryOf(JSON.parse(payload))` in one transaction.
3. Every caller building a `HistoryRecord` passes the two fields (`grep -rn "targetAutoDetected" src` lists them:
   `src/lookup.ts`, `src/mplus.ts`, `src/server/lookup.ts`, `src/format-mplus.ts`).
4. `web/src/types.ts`: `HistoryItem` gains `verdict: "invite" | "maybe" | "pass" | null; score: number | null`.
5. Tests: `test/server-history.test.ts` (local store: record → list carries verdict/score; `updateResult` refreshes),
   `test/hosted/…history` (migration on a table without the columns backfills from the payload; a second open is a
   no-op), `test/local-history.test.ts` if it builds rows by hand.
6. `just check && bun test`. Commit `feat(server): verdict and score on history rows`.

## Task 4 — Pages and routes

1. `web/src/lib/hostedMode.ts`:
   ```ts
   export type Page = "home" | "candidate" | "compare" | "live" | "admin" | "settings" | "privacy" | "help" | "me";
   const PAGES: Record<string, Page> = {
     "/": "home", "/candidate": "candidate", "/compare": "compare", "/live": "live",
     "/admin": "admin", "/settings": "settings", "/privacy": "privacy", "/help": "help", "/me": "me",
   };
   export const pageOf = (pathname: string): Page => PAGES[pathname] ?? "home";
   /** The candidate page's URL for a history entry (and an optional tab — phase 2 reads `tab`). */
   export const candidateHref = (key: string): string => `/candidate?${new URLSearchParams({ open: key })}`;
   ```
   Update `hostedMode.test.ts`: every path → page, unknown → home, `candidateHref` round-trips a key with quotes and
   accents.
2. `src/web-static.ts`: routes `/candidate`, `/compare`, `/live` → `index`. Extend the route test.
3. `PAGE_EVENT` in `App.tsx` and `src/hosted/usage-catalog.ts`: add `page_home`, `page_candidate`, `page_compare`,
   `page_live` (the catalogue test lists events; keep `page_main_result` for a result shown).
4. `just check && bun test`. Commit `feat(web): page paths for home, candidate, compare and live`.

## Task 5 — Shell view model

`web/src/lib/shell.ts` (pure; takes `t` because it produces labels):

```ts
import type { T } from "../i18n/t.ts";
import type { HistoryItem } from "../types.ts";
import type { Page, StatusInfo } from "./hostedMode.ts";
import type { MenuModel } from "./session.ts";

export type NavKey = "home" | "candidate" | "me" | "compare" | "live" | "help";
export type IconName = "home" | "users" | "user" | "compare" | "live" | "help";
export interface NavItem { key: NavKey; href: string; label: string; icon: IconName; active: boolean; count?: number; dot?: "on" | "off" }
export interface RecentRow { key: string; href: string; name: string; verdict: "invite" | "maybe" | "pass" | null; score: string; active: boolean; classId: number }
export interface AccountView { title: string; lines: string[]; local: boolean }

const NAV: readonly { key: NavKey; href: string; icon: IconName }[] = [
  { key: "home", href: "/", icon: "home" },
  { key: "candidate", href: "/candidate", icon: "users" },
  { key: "me", href: "/me", icon: "user" },
  { key: "compare", href: "/compare", icon: "compare" },
  { key: "live", href: "/live", icon: "live" },
  { key: "help", href: "/help", icon: "help" },
];

export function navItems(t: T, page: Page, o: { candidates: number; liveOn: boolean }): NavItem[] {
  return NAV.map((n) => ({
    ...n,
    label: t(`shell.nav.${n.key}`),
    active: n.key === page,
    ...(n.key === "candidate" && o.candidates > 0 ? { count: o.candidates } : {}),
    ...(n.key === "live" ? { dot: o.liveOn ? "on" as const : "off" as const } : {}),
  }));
}

/** Récents = history, newest first, at most `max` rows; the open profile is active. */
export function recentRows(items: HistoryItem[], activeKey: string | null, max = 8): RecentRow[] {
  return items.slice(0, max).map((i) => ({
    key: i.key,
    href: `/candidate?${new URLSearchParams({ open: i.key })}`,
    name: i.label.split("-")[0] ?? i.label,
    verdict: i.verdict,
    score: i.score === null ? "—" : String(Math.round(i.score)),
    active: i.key === activeKey,
    classId: i.charClass,
  }));
}

/** The account block: hosted = the user menu's name + quota line; local = "Local" + the credentials path line. */
export function accountView(t: T, status: StatusInfo, menu: MenuModel | null): AccountView {
  if (!status.hosted) return { title: t("shell.account.local"), lines: [], local: true };
  return { title: menu?.name ?? "", lines: menu ? [menu.quota.text] : [], local: false };
}
```
(`MenuModel` is `lib/session.ts:9`: `name`, `quota: QuotaLine { text, sub, pct, tone }`.)

Tests `web/src/lib/shell.test.ts` (`tEn` from `i18n/t.ts`): six nav items in order; `active` follows the page;
the candidate count appears only when > 0; Live dot on/off; Récents trims to 8, keeps order, rounds the score,
"—" for null, splits `Name-Realm`, marks the active key; `accountView` local vs hosted (one French assertion for a
label that is not a word swap).

`just check && bun test`. Commit `feat(web): shell view model`.

## Task 6 — Command palette view model

`web/src/lib/palette.ts` (pure): given the query, the search suggestions (`suggestionsOf` rows, already merging
My characters, history and known characters), My characters and the page, return sections:

```ts
export type PaletteAction = { kind: "open"; historyKey: string } | { kind: "lookup"; fill: string; region: Region } | { kind: "go"; href: string };
export interface PaletteRow { id: string; label: string; detail: string; hint: string; action: PaletteAction }
export interface PaletteSection { title: string; rows: PaletteRow[] }
export function paletteSections(t: T, q: string, s: { suggestions: Suggestion[]; mine: MyCharacter[] }): PaletteSection[];
export function moveIndex(sections: PaletteSection[], index: number, delta: 1 | -1): number; // wraps over all rows
export function rowAt(sections: PaletteSection[], index: number): PaletteRow | null;
```
Rules: empty query → "Personnages récents" (history rows from `suggestions` with a `historyKey`, newest first, 5),
"Mes persos" (up to 5, main first), "Actions" (Comparer → `/compare`, Live → `/live`, Aide → `/help`, Mes persos →
`/me`). Non-empty query → one section "Résultats" from `matchSuggestions(suggestions, q)` (`lib/suggest.ts:87`), each
row `open` when it has a history key (hint `t("palette.open")` = "Ouvrir · 0 pt") else `lookup` (hint
`t("palette.lookup")` = "Rechercher"); when nothing matches and the query looks like a Name-Realm or a Raider.IO
link (`parseEntry` from `lib/me.ts`), one `lookup` row for it; actions whose label starts with the query are appended.
Never estimate points for a lookup (the cost is not known before the fetch).

Tests: empty query sections and caps; query match ordering (history rows first as `matchSuggestions` returns);
free Name-Realm fallback; Raider.IO link fallback; `moveIndex` wraps both ways across sections; `rowAt` out of range
is null.

`just check && bun test`. Commit `feat(web): command palette view model`.

## Task 7 — Icons

`web/src/components/Icon.tsx`: `export function Icon({ name, size = 18 }: { name: IconName | "search" | "close" |
"chevron" | "more" | "settings" | "logout" | "admin" | "discord"; size?: number })` returning a 24×24 viewBox stroke
SVG (`stroke="currentColor"`, `strokeWidth={1.8}`, round caps/joins, `aria-hidden`). Paths: copy the ones drawn in
`docs/design/redesign/F-Palette.dc.html` / `F-Accueil.dc.html` (search, home, users, user, compare, live, help) and
add simple ones for the rest. Move `DiscordMark` from `SignIn.tsx` here as `name="discord"` (fill, not stroke).
No test (components are not tested). `just check`. Commit `feat(web): icon component`.

## Task 8 — The frame: Sidebar, Palette, Shell

1. `components/shell/Sidebar.tsx` (thin; props from `App`): logo link `/`; the search `form` with `SearchInput`
   (48 px box, the region `ChipMenu` and the `KeyStepper` under it as chips, the `Ctrl K` hint), submit = today's
   `onLookup` (the lookup button becomes Enter + a small icon button); `navItems` as `<a class="nav-a">` with
   `Icon`; the Récents list (`recentRows`) with a verdict dot (`--invite`/`--maybe`/`--pass`, grey when null) and
   the score in the verdict colour, a "⋯" per row with "Retirer" (today's `closeTab`) and, at the list foot, "Tout
   effacer" (today's `clearAll`); the account block at the bottom: hosted → `UserMenu` (unchanged menu model;
   rendered as the block itself, opening upward), local → the EN / FR chip, the clipboard-watch switch, "Reconfigurer",
   "Quitter" (the controls `Header` shows today, from `uiControls`). The SSE "disconnected" note and the busy line
   ("looking up X…") sit under the search field.
2. `components/shell/Palette.tsx`: a `<dialog>`-like overlay (`role="dialog" aria-modal="true"`, focus trapped in
   the input, Escape and backdrop click close), 700 px wide, input on top, sections from `paletteSections`, ↑/↓ via
   `moveIndex`, Enter runs the row: `open` → `showTab` (or navigate to `candidateHref` off the candidate page),
   `lookup` → today's `runLookup` path, `go` → `location.assign`. Opened by Ctrl K / Cmd K (one `keydown` listener
   on `window` registered by `Shell`, ignored while the palette is open or when focus is in a text field other than
   the sidebar search) and by focusing the sidebar search with an empty value + pressing ↓ (optional).
3. `components/shell/Shell.tsx`: `<div class="shell">` = `<Sidebar/>` + `<div class="shell-main">{children}</div>`
   + `<Palette/>`; `.shell` is `display:flex; flex-wrap:wrap; align-items:stretch`, sidebar `flex: 1 1 248px;
   max-width: 100%`, main `flex: 999 1 720px; min-width: 0; padding: 28px 32px 96px`, content max-width 1120 px
   (1640 px for wide result content stays `--col` until phase 2).
4. CSS in `app.css` under a `/* shell (redesign phase 1) */` block, values from the mockups and the tokens only.
5. `just check`. Commit `feat(web): sidebar frame and command palette`.

## Task 9 — App: pages inside the frame

1. `App.tsx`:
   - Boot: hosted and signed out → `Landing` (Task 12) for `/` and every in-app path except `/privacy` and `/help`
     (unchanged bare pages); signed in / local → `Main`.
   - `Main` renders `<Shell …>` for every page except `home`, which renders `HomePage` (Task 11) with its own slim
     top bar. Page bodies: `candidate` → the current result area (`Detail` / loading / "no profile yet" empty state
     with a link home); `compare` → a picker of history rows (checkbox list, 2–5 — the 5 is decided by the spec;
     today's `Compare` still renders 2–3 columns until phase 4, so cap the picker at 3 in this phase and leave a
     `// phase 4: 5` note) + `CompareLoader`; `live` → `LivePanel` when a roster exists, else a connect card using
     `LiveChip`'s connect action; `me`, `help`, `settings`, `admin`, `privacy` (local) → as today.
   - Candidate page boot: `?open=` → `showTab(key)`; no `?open=` → newest history row; clicking a Récents row on the
     candidate page calls `showTab` and `history.replaceState({}, "", candidateHref(key))`; on any other page it is a
     link to `candidateHref(key)`. A lookup from the sidebar or the palette lands on `/candidate` (same page:
     `replaceState`; other page: `location.assign(candidateHref(r.key))` after the lookup answered, so no lookup is
     ever repeated by the navigation).
   - Retire `Header.tsx`, `Tabs.tsx`, `Home.tsx` and their CSS once nothing imports them (`grep -rn` to confirm);
     keep `SearchInput`, `ChipMenu`, `KeyStepper`, `LiveChip`, `UserMenu`.
   - The Live auto-lookup, SSE handlers, toasts and deep-dive actions stay in `Main` unchanged.
2. Manual check (Task 15 does the full pass): every path renders, Récents switches profiles without a reload on the
   candidate page, Ctrl K opens / closes, a lookup from the palette lands on the candidate page.
3. `just check && bun test`. Commit `feat(web): pages inside the sidebar frame`.

## Task 10 — Home view model

`web/src/lib/home.ts` (pure, takes `t` and `locale` for labels):

```ts
export interface WeekView { label: string; runs: number; bestTimed: number | null; timed: number; scored: number }
export interface PointView { kind: "pillar" | "dungeon"; label: string; detail: string; score: number }
export interface HomeSelf {
  week: WeekView | null;            // null when the season has no run
  workOn: WorkOnView[];             // lib/self.ts workOnRows (reuse, do not re-derive)
  strengths: PointView[];           // ≤ 3
  costs: PointView[];               // ≤ 3
  bestPerWeek: { week: number; level: number | null }[]; // last 4 game weeks, oldest first
  pillars: { key: PillarKey; label: string; score: number | null }[];
}
export function homeSelf(t: T, locale: Locale, season: SeasonView): HomeSelf;
```
Rules (write them as the function's doc comment):
- `week`: the current game week if it has runs, else the previous one; `label` "cette semaine" / "la semaine
  dernière" (`t("home.self.thisWeek")` / `lastWeek`); `runs` = runs of that week; `bestTimed` = highest `keyLevel`
  with `timed === true`; `timed` = runs with `timed === true`; `scored` = runs with `timed !== null`.
- `pillars`: `season.recent ?? season.season` pillars in `PILLAR_ORDER`, labels `self.pillars.*`.
- `strengths`: pillars ≥ 70 (desc), then dungeons whose `overall` ≥ 70 (desc), first 3.
- `costs`: pillars < 60 (asc), then per dungeon its lowest pillar when < 45 (asc), first 3; dungeon detail =
  "<pillar label> <score>".
- `bestPerWeek`: weeks `currentWeek-3 … currentWeek`, the highest timed `keyLevel` of each, null without one.

Tests with a hand-built `SeasonView` (Biwaasham-like numbers from the spec's mockup: pillars 64/66/76/68/55, a
dungeon with Dégâts 43, one with Contrôle 38): week fallback to the previous week; best timed ignores a higher
depleted key; strengths/costs order and caps; `bestPerWeek` nulls; one French assertion on a label.

`just check && bun test`. Commit `feat(web): home view model`.

## Task 11 — Connected home page

`components/home/HomePage.tsx`, matching `F-Accueil.dc.html`: slim top bar (logo, links Mes persos / Live / Aide,
hosted avatar menu or local controls compact), hero split — left: the title, the big search (`SearchInput` +
region chip + `KeyStepper`, 56–64 px), right: "Toi cette semaine" for the main character (`settings.characters[0]`)
from `useSeason({ name, realm, region, level: null }, self)` → `homeSelf`; when the main character has a history
row, its chef-de-groupe line "Un chef de groupe te voit <VERDICT> <score> en +<level>" from that row's
`verdict`/`score`/`targetLevel` (0 pts; no lookup is started from the home page). Below: "Ta progression"
(bestPerWeek line chart as inline SVG, strengths, costs, pillars, "Ouvrir Ma forme" → the main character's history
row on `/candidate`, or `/me` without one) and "Tes candidats" (Live entry, then `recentRows` as two-line rows
linking to `candidateHref`). Strip "Mes autres persos" (other characters, link `/me`). States: no main character →
the right card becomes "Ajoute ton perso" (link `/me`); no season yet → "Synchronise ta saison" (link to the main
character's page; never starts a sync itself); no history → "Tes candidats" shows the search hint.
CSS block `/* home (redesign phase 1) */`. `just check`. Commit `feat(web): connected home page`.

## Task 12 — Landing (signed-out, hosted)

1. `web/src/lib/landing.ts`: `landingView(t, status, search)` → `{ notice: DeniedNotice; loginFailed: boolean; note:
   string; steps: { title: string; text: string }[]; facts: { title: string; text: string }[] }` reusing
   `deniedNotice`, `loginFailed`, `signInNote`; steps = the three of `F-Landing` ("Cherche un joueur", "Lis le
   verdict", "Creuse les runs"); facts = WCL points ("bmpl lit les données publiques de Warcraft Logs ; chaque
   recherche coûte des points sur un budget partagé") and privacy (the note). Tests: notice passthrough, the three
   steps, the guild-mode note.
2. `components/Landing.tsx` matching `F-Landing.dc.html`: hero, Discord button (`--discord`, the only place),
   denied / failed notices exactly as `SignIn` renders them today (copy-id button included), steps, a static
   product preview built from markup (no data fetch), facts, footer (Confidentialité → `/privacy`, Aide → `/help`).
   Delete `SignIn.tsx` once `App` uses `Landing`.
3. `just check && bun test`. Commit `feat(web): signed-out landing page`.

## Task 13 — Strings

Every string introduced in Tasks 5–12 lives in `en.ts` (source) under `shell`, `palette`, `home`, `landing`, with
`fr.ts` mirroring it (French copy from the mockups; English written fresh, same tone: short, factual, no
exclamation marks). Remove the keys only `Header`, `Tabs`, `Home`, `SignIn` used (keep any still read elsewhere —
`grep -rn '"header\.' web/src`). The parity test and `tsc` catch gaps. `just check && bun test`. Commit
`feat(web): strings for the frame, home and landing` (or fold into the tasks above, one commit per task).

## Task 14 — Docs

- `docs/agents/web-front.md`: "Design first" points to the redesign canvas
  (https://claude.ai/artifact/WeznnnDkrDGMPyAsuSKBeE) and `docs/design/redesign/` for this redesign; "Page width" and
  "Components map" describe the frame (`Shell`, `Sidebar`, `Palette`), `HomePage`, `Landing`, the new pages and
  view models (`shell.ts`, `palette.ts`, `home.ts`, `landing.ts`); remove `Header`, `Tabs`, `Home`, `SignIn`.
- `src/web-static.ts` routes and the fonts in `docs/agents/architecture.md` if it lists assets.
- `AGENTS.md` "Where things are" line for `web/src/components/` if it names removed files; roadmap line: redesign
  phase 1 implemented.
- `README.md`: replace screenshots when Task 15 takes new ones.
Commit `docs: redesign phase 1`.

## Task 15 — Verify live

`rm -rf web/dist && just check && bun test`, then `just build` and `./bmpl serve --no-open` (local) — check in a
browser at 1440 px and 390 px: home, candidate (open a history row), compare, Live (not connected), `/me`, help;
Ctrl K; Récents switching; no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth` on each page).
Hosted landing: `just serve --hosted` with the example env, signed out. Screenshots for the README. Report results
plainly; failing checks with their output.
