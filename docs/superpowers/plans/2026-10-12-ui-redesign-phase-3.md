# UI redesign, phase 3 (owner pages) — implementation plan

**Goal:** the member's own characters get the redesign's owner pages — a header with "C'est moi" and **Synchroniser**,
and three tabs **Ma forme** (bento + "Comment un chef de groupe te voit"), **Donjons** (pillar heatmap full width, the
selected dungeon's detail below) and **Runs** (season tiles, filters incl. key-level min–max and "niveau cible", runs
grouped by game week) — and **Mes personnages** becomes cards two per row with small toolbar buttons and a "⋯" menu.
Every fact today's owner view and `/me` show stays reachable.

**Architecture:** no router. The owner view is chosen as today (`resultView(...) === "owner"`); it gets its own
component tree `components/owner/` over pure, tested view models. Its tab lives in the same URL query as the candidate
page (`/candidate?open=<key>&tab=form|dungeons|runs[&run=<report:fight>][&as=vetting]`); `as=vetting` shows the member
their own vetting profile (phase 2's `CandidateProfile`) with a way back, without touching "My characters". The season
comes from `GET /api/season` (0 pts) through `useSeason`, as today; the only point-spending controls are the existing
sync and "Analyser" buttons, each a click. The owner Runs tab reuses phase 2's `Timeline` (own = true) for an expanded
run.

**Spec:** `docs/superpowers/specs/2026-10-11-ui-redesign-design.md` decisions 3, 10, 11 (+ "Phase 2 notes"). Mockups:
`docs/design/redesign/F-Moi-Forme.dc.html`, `F-Moi-Donjons.dc.html`, `F-Moi-Runs.dc.html`, `F-Persos.dc.html` (open in a
browser, or the canvas https://claude.ai/artifact/WeznnnDkrDGMPyAsuSKBeE page "4 · Final"); values below win on
conflict. Data shown in the mockups that the app does not have is not invented: say what is missing instead.

## Global Constraints (from the spec, verbatim where quoted)

- **One score family per context**: owner pages show the five pillars; the verdict is reduced to one card "Comment un
  chef de groupe te voit".
- Ma forme = bento (last week, pillars, season key-level chart, à travailler checklist with before → now) + the
  chef-de-groupe card; Donjons = the heatmap across the full width, the selected dungeon's detail below; Runs = runs
  grouped by week with filters (dungeon, spec, timed, period, **key level min–max + "niveau cible"**) under a strip of
  season tiles (one square per run).
- Mes personnages = cards two per row (main may span), small toolbar buttons (32 px), secondary actions in a "⋯" menu;
  characters without a season are a compact group below. Battle.net behaviour unchanged (hosted list from Battle.net
  only, 20 max, re-checked every 30 days; local mode keeps the manual add field).
- **No horizontal scroll anywhere** (check at 390 px); tables are CSS grids that fit, stacked cards on narrow
  widths; buttons in cards / rows 32–36 px, one 40–44 px primary per view.
- Colours: pillar scores on the heat scale (`.heat-1` < 45 · `.heat-2` 45–54 · `.heat-3` 55–69 · `.heat-4` 70–84 ·
  `.heat-5` ≥ 85) in the heatmap; score bars blue ≥ 70 / neutral 50–69 / orange < 50 with the 50 tick; `--better /
  --worse` for every "vs before / vs peers" delta; `--invite/--maybe/--pass` for verdicts only (`--pass` also deaths,
  depleted); WCL parse scale only on a parse %.
- **Never spend WCL points automatically.** Opening a page, a tab, a run, a dungeon reads only (`GET /api/season`,
  history). Sync and "Analyser · 3 pts" stay explicit clicks with the cost on the button.
- No new runtime dependency; view models pure and tested; strings in `web/src/i18n/en.ts` + `fr.ts` (mirror), no UI
  literal in components; `web/` imports `src/` types only (exception `src/wow/classes.ts`); colours from tokens.
- `just check` and `bun test` green with `web/dist` absent after every task.

## Before you start

- Bun on PATH (1.3.4 on this machine; the repo pins 1.4.3 — mention, do not change). Gate per task:
  `rm -rf web/dist && just check && bun test`.
- Read `docs/agents/web-front.md`, `docs/agents/testing.md`, and phase 2's components (`components/candidate/*`) and
  models (`lib/profile.ts`, `lib/timeline.ts`, `lib/runView.ts`, `lib/runList.ts`, `lib/synthesis.ts`) — reuse their
  helpers (`dungeonAbbr`, `parseCell`, `signedPct`, `upgradeOf`, `clearTime`, `scoreBand`, `driverValues`, `classToken`,
  `classInitials`, `candHref`/`candState`/`candInitial`, `Timeline`, `RunFacts`).
- Today's owner code (to replace, then delete when unused): `components/Detail.tsx` `OwnerDetail`;
  `components/self/{ResultHead,Overview,DungeonsTab,DungeonPanel,RunsTab,RunDetailExtra,SyncCard,MeChip}.tsx`;
  `/me`: `components/me/{MePage,MainCard,OtherRow,SyncButton,BnetCard,BnetPicker}.tsx`. Models: `lib/self.ts`
  (`pillarCards`, `workOnRows`, `verdictLine`, `headLine`, `seasonHeader`, `dungeonRows`, `dungeonPanel`, `runOf`,
  `runDetail`, `controlView`, `syncCard`, `syncProgress`, `toggleMe`, `meChip`, `MAX_ME`), `lib/me.ts`
  (`seasonLine`, `mainPillars`, `rowCells`, `makeMain`, `removeAt`, `addCharacter`, `parseEntry`, `historyKeyFor`,
  `lookupQuery`), `lib/home.ts` (`homeSelf`: last week, work on, strengths/costs, best timed per week, pillars),
  `lib/bnet.ts`. `useSeason(who, self, reloadKey)` (`web/src/useSeason.ts`) loads one character's season and runs the
  sync.
- `SeasonView` (`src/self/season.ts`): `currentWeek`, `targetLevel`, `state` (`runs`, `analysed`, `pending`,
  `controlOnly`, `failed`, `estimate`), `runs: SeasonRunView[]` (newest first; `week`, `keyLevel`, `timed: boolean |
  null` — null = no time, `spec`, `parse`, `amount`, `metric`, `durationMs`, `signals`, `analysis`, `pillars`,
  `analysed`, `failed`), `recent` / `season` windows (`runs`, `pillars`, `overall`), `trends[]` (`delta`,
  `direction`, `weekly`), `workOn[]` (`impact`, `value`, `reference`, `past`), `dungeons[]` (`pillars`, `overall`,
  `runs`, `analysed`, `best`, `details` {avoidable, killers, casts, control, controlRuns}).
- The verdict for the chef-de-groupe card is the lookup payload's `evaluation` (the owner page has the payload) —
  `verdictView` + `synthesisView(...).flip`.
- Do not run `just deploy`; no release, no tag; push only when the user says so.

## Files

| File | Responsibility |
|---|---|
| `web/src/lib/profile.ts` (+ test) | owner tabs and `as=vetting` in the URL state |
| `web/src/lib/form.ts` (+ test) | Ma forme: last week, pillars card, key chart, checklist, chef card |
| `web/src/lib/ownerDungeons.ts` (+ test) | heatmap rows, season row, selected dungeon detail |
| `web/src/lib/ownerRuns.ts` (+ test) | filters, tiles, week groups, rows, paging, expanded run |
| `web/src/lib/characters.ts` (+ test) | Mes personnages cards, groups, filters, sort, menu actions |
| `web/src/components/owner/*.tsx` | `OwnerProfile`, `OwnerHeader`, `FormTab`, `OwnerDungeons`, `OwnerRuns`, `KeyChart` |
| `web/src/components/me/*.tsx` | `CharactersPage` (replaces `MePage`/`MainCard`/`OtherRow`), `CharacterCard`, Battle.net pieces kept |
| `web/src/components/Detail.tsx` | owner branch → `OwnerProfile` |
| `web/src/i18n/en.ts`, `fr.ts` | `owner.*`, `chars.*` sections |
| `web/src/styles/app.css` | `.owner-*`, `.form-*`, `.heatmap`, `.oruns-*`, `.chars-*` (tokens only) |
| docs | spec status + notes, `web-front.md`, `AGENTS.md` roadmap, README screenshot of `/me` if the README shows one |

---

## Task 1 — Owner URL state (`lib/profile.ts`)

- `OwnerTab = "form" | "dungeons" | "runs"`, `OWNER_TABS`. `ownerState(search, key, runKeys)` → `{ tab, run, vetting }`
  with the same rules as `candInitial` (run kept only when `open` equals the mounted key and the run exists; unknown
  tab → `form`; `as=vetting` → `vetting: true`). `ownerHref(key, s)` omits defaults. A candidate tab name in the URL
  (`synthesis`, `method`) on an owner page → `form`; `runs` / `dungeons` keep their meaning in both views.
- Switching between the owner view and `as=vetting` keeps `tab` when it exists in the target view, else its default.
- Tests: round trips, defaults omitted, cross-view tab mapping, run validation. Gate. Commit
  `feat(web): owner URL state`.

## Task 2 — Ma forme model (`lib/form.ts`)

Mockup `F-Moi-Forme`. `formView(t, locale, ev: Evaluation, season: SeasonView, docs)` →
```ts
interface FormView {
  week: { label: string; runs: string; bestTimed: string | null; timed: string; chips: { level: string; abbr: string; result: "timed" | "depleted" | "none"; title: string }[]; note: string | null } | null;
  pillars: { global: string | null; rows: { key: PillarKey; name: string; score: number | null; band: Band; trend: string | null }[]; note: string };
  chart: { weeks: { label: string; x: number }[]; dots: { x: number; y: number; timed: boolean | null; title: string }[]; target: { y: number; label: string } | null; levels: { y: number; label: string }[] } | null;
  checklist: { title: string; goal: string; before: string | null; now: string; nowTone: "better" | "worse" | "neutral"; cost: string }[];
  chef: { verdict: { cls: string; label: string; score: string | null }; title: string; path: string | null; vettingHref: string };
}
```
- `week`: from `homeSelf` (same game-week rule); chips = that week's runs newest first (`+19 TS ✓`, depleted `✗`,
  no time `—`); `note` = a factual line when the week holds the season's highest key attempted so far ("Première +20
  tentée (Temple of Sethraliss, depleted 32:55).") else null.
- `pillars`: `season.recent ?? season.season` pillars in `PILLAR_ORDER`, global = that window's `overall`; trend
  text from `trends` (reuse `trendView`); note "trait = joueur moyen · tendances dès N runs récents (tu en as M)".
- `chart`: the last 4 game weeks with runs (x evenly spaced in a 0–1000 viewBox), one dot per run at its key level
  (y scale from min to max level seen, padded), several runs at the same level spread horizontally (mockup rule),
  `timed` colour (timed / depleted / none), the target line at `season.targetLevel`. null with no runs.
- `checklist`: `workOnRows`-style rows (top 3 by impact) with goal (the reference: "objectif 1,6 / run"), before
  (`past.value`, null when absent), now, cost ("−4"), `nowTone` from `past.change`.
- `chef`: `verdictView(ev)` + the target ("en +19") + the path sentence from `synthesisView(...).flip` (first two
  rows: "INVITE à 70 : remonte ton parse médian (57 %) et ton item level"), `vettingHref` = `ownerHref(key, { vetting:
  true })` (pass the key in).
- Tests (FR): the mockup's week (6 runs, best timed +19, 4/6), a season with no runs, a week without depleted keys,
  INVITE (no path), INSUFFICIENT DATA. Gate. Commit `feat(web): my-form view model`.

## Task 3 — Owner Donjons model (`lib/ownerDungeons.ts`)

Mockup `F-Moi-Donjons`. `ownerDungeons(t, locale, season, selected: number | null)` →
- `season` row (pillars of `season.season`, overall, runs) and `rows` sorted **weakest overall first** (null overall
  last), each: abbr (`dungeonAbbr`), name, five cells `{ text, heat: "heat-1".."heat-5" | "", weakest: boolean }`
  (weakest = its lowest pillar, ringed), overall, runs, `selected`.
- `detail` for the selected dungeon (default: the first row): title, sub ("8 runs · global 63"), weak point chip
  ("Point faible : Dégâts 43"), a sentence comparing that pillar with the season's ("Dégâts 43 ici, 21 points sous ta
  moyenne saison (64). Ta Survie (89) y est pourtant ta meilleure."), then the blocks of `dungeonPanel` (what hits =
  avoidable shares with bars, what kills, enemy spells passed / cast + by you, crowd control with uses / enemies and
  "sur N runs avec du contrôle mesuré"), and the runs link (Runs tab filtered on this dungeon). Empty details → the
  existing empty text.
- Tests: sort order, ring on the minimum (ties: first), heat thresholds at 44/45/54/55/69/70/84/85, the comparison
  sentence (FR), null pillars ("—", no heat). Gate. Commit `feat(web): owner dungeons view model`.

## Task 4 — Owner Runs model (`lib/ownerRuns.ts`)

Mockup `F-Moi-Runs`.
```ts
interface RunFilters { dungeon: number | null; spec: string | null; result: "all" | "timed" | "depleted" | "none"; weeks: number | null; keyMin: number | null; keyMax: number | null }
```
- `filterOptions(season)`: dungeons and specs present, key range present, `weeks` choices (1, 3, 8 weeks, all).
  Default filters: all, key range = full range seen; `target` = `season.targetLevel` (a "niveau cible" button sets
  `keyMin = keyMax = target`).
- `ownerRunsView(t, locale, season, filters, open: string | null, loadedWeeks: number)` →
  - `tiles`: every run of the season (oldest left → newest right, or newest first as the mockup — follow it), each
    `{ key, level, result, otherSpec: boolean (dashed), shown: boolean (dimmed when filtered out), title }`, plus the
    legend counts (`timed / count · depleted · sans temps`, counted on the shown runs).
  - `weeks`: groups by `week`, newest first, only the first `loadedWeeks` weeks; each `{ label ("Cette semaine",
    "Il y a 2 semaines"), count, timed, bestTimed, rows }`; a week with no shown run says so ("Aucun run de cette
    semaine ne correspond aux filtres.").
  - rows: `{ key, level, result glyph, abbr, dungeon, spec · amount, time, deaths (+ "wipe" count), dtps abs + vs
    peers, avoidable abs/min + vs peers, kicks n/capacity + peers %, pots · hs, parse (tier) }` — reuse phase 2
    formatting so numbers match the candidate run list.
  - `more`: `{ label: "Charger les semaines précédentes · 70 runs", weeks }` or null; `footer` "N runs affichés · 24
    chargés sur 94".
  - `expanded` (when `open` names a shown run): `runDetail(t, locale, v)` of `lib/self.ts` (deaths with hits, passed
    spells, kicks line, control) + `analysed` + `wcl` link + the `MPlusRun` (`runOf(v)`) and `analysis` for the
    timeline.
- Tests: each filter alone and combined, key min > max normalised, target button, week grouping and labels,
  paging, the tile dimming, numbers equal to `runListRow` for the same run. Gate. Commit
  `feat(web): owner runs view model`.

## Task 5 — Mes personnages model (`lib/characters.ts`)

Mockup `F-Persos`. Inputs: the character list, each one's `SeasonView | null` (loaded by the page), history items
(class / spec via `historyKeyFor`), hosted flag, own client.
- `characterCards(...)` → `{ withSeason: Card[]; without: Compact[]; counts: { all, season, none } }`; `Card`:
  `{ key, name, sub ("Chaman Élémentaire · Hyjal EU"), initials, classColor, main: boolean, global: string, bars:
  { label, value, band }[] (five pillars), line ("94 runs cette saison · à jour" / "33 runs · 25 non analysés ·
  vérifié il y a 7 h"), note ({ text, tone } — first point to work on with its cost, else "Piliers calculés sur N runs
  analysés"), open: { href, label } (history entry → candidate page, else the lookup link as today), sync:
  SyncCardView-derived label with the cost ("Synchroniser 25 runs · ~335 pts") or null, rio: href | null, menu:
  ("main" | "up" | "remove")[] }`; `Compact`: `{ key, name, realm, initials, search: { href, label }, menu }`.
  "With a season" = the season view has ≥ 1 run.
- `filterCards(filter: "all" | "season" | "none")`, sort "principal d'abord" (list order, main first) — keep the
  list order (it is the user's order); `moveUp(list, i)` next to `makeMain` / `removeAt` in `lib/me.ts` (test).
- Tests: grouping, counts, the main card first, note variants, hosted vs local menus (hosted: no manual add; remove
  allowed as today), sync label absent when nothing pending / no usable client (hosted) — match `SyncButton`'s rules.
  Gate. Commit `feat(web): my characters view model`.

## Task 6 — Owner profile shell and Ma forme

1. `components/owner/OwnerProfile.tsx`: holds the owner state (Task 1), mirrors it to the URL like
   `CandidateProfile` (`urlKey` non-null on the candidate page, null on Live). Renders `OwnerHeader`, the sync card
   when open (keep `SyncCard`'s behaviour: estimate before spending, progress, cancel, no-client guide), the tab strip
   (Ma forme · Donjons · Runs (count), same keyboard behaviour as the candidate tabs), the tab. With `vetting` it
   renders `CandidateProfile` plus a small bar "Tu regardes ta fiche telle qu'un chef de groupe la voit · Revenir à
   ma forme".
2. `OwnerHeader.tsx`: class icon, name, "C'est moi" chip (`MeChip` behaviour: toggles the character out of My
   characters locally; hosted as today), the line (spec · realm region · N runs · sync state via `headLine`),
   Refresh + fetched age (as the candidate header), **Synchroniser** (opens the sync card; disabled while running).
3. `FormTab.tsx` + `KeyChart.tsx` (inline SVG, tokens): the bento per the mockup — last week card, pillars card (bars
   with the 50 tick), key chart (dots timed `--better`, depleted `--pass`, no time `--label`; dashed target line),
   checklist (before → now with an arrow, cost), chef card (verdict pill, path, "Voir ma fiche de vetting" →
   `as=vetting`). Wraps to one column under 900 px.
4. `Detail.tsx`: the owner branch renders `OwnerProfile`; App's owner-only fetched/Refresh bar goes (the header has
   it). Usage events: `owner_tab_<tab>` (catalogue + test), keep `self_tab_*` only if still emitted elsewhere, else
   remove them from the catalogue with their test lines.
5. Verify at 1440 / 390 px on a local own character with a synced season if the local data has one (otherwise with
   the empty-season state and say so); no horizontal scroll. Gate. Commit `feat(web): owner profile and my form`.

## Task 7 — Owner Donjons and Runs tabs

1. `OwnerDungeons.tsx`: the heatmap (grid; rows are buttons selecting the dungeon; season row on top; legend faible /
   moyen / fort; footnote "Contour = pilier le plus faible du donjon. Global = moyenne pondérée des piliers dans ce
   donjon."), then the detail card below (two columns ≥ 900 px). "Les N runs" switches to Runs with the dungeon filter.
2. `OwnerRuns.tsx`: the season tiles strip (buttons; clicking a tile opens that run's row), the legend, the filter
   bar (key min / max steppers 32 px, "niveau cible", chips for result, dungeon / spec / period menus with `ChipMenu`),
   the week groups with the grid (stacked cards < 900 px), the expanded row: phase 2's `Timeline` (own = true; layers
   state per page view) + `RunFacts` + passed spells + crowd control (`controlView`) + "Analyser les défensifs · ~3
   pts" when not analysed (`deepdive.analyze(runOf(v))`, disabled while busy / over quota) + WCL ↗; "Charger les
   semaines précédentes".
3. `run` in the URL = the expanded run. Verify at 1440 / 390 px. Gate. Commit
   `feat(web): owner dungeons and runs tabs`.

## Task 8 — Mes personnages page

1. `CharactersPage.tsx` (replaces `MePage`, same props): title + toolbar — hosted: the Battle.net linked line
   ("Battle.net lié · Biwaa#2596 · depuis le 11 oct. · revérifié tous les 30 jours"), "N / 20 persos suivis",
   **Importer à nouveau**, **Délier** (with today's confirmation), the link card when not linked, every Battle.net
   notice and the picker exactly as today; local: the add field as today. Filter chips Tous / Avec saison / Sans saison
   with counts.
2. "Avec une saison · N": `CharacterCard`s two per row (≥ 900 px; the main card may span both), each with its five
   pillar bars, global, line, note, buttons 32 px **Ouvrir**, **Synchroniser … · ~N pts** (same rules as
   `SyncButton`; progress + cancel while running), **Raider.IO ↗**, and "⋯" (`En faire le principal`, `Monter dans
   la liste`, `Retirer du suivi` — remove keeps today's confirmation). Menu: `ChipMenu`-like popover, Escape closes,
   focus returns.
3. "Pas encore de saison · N": compact rows (initials tile, name, realm, **Rechercher**, "⋯"), with the note "une
   recherche suffit pour les activer · 0 pt de saison tant que tu ne synchronises pas".
4. Each character's season is loaded once by the page (0 pts) — reuse `useSeason` per card as today, or one hook for
   the list if simpler; never start a sync without a click.
5. Delete the now-unused `MainCard`, `OtherRow`, `MePage` (and their CSS rules) — keep `BnetCard`, `BnetPicker`,
   `SyncButton` if still used. Verify hosted-only pieces through tests (the local build is local mode) and the local
   page at 1440 / 390 px. Gate. Commit `feat(web): my characters cards`.

## Task 9 — Cleanup, docs, live check

1. Delete owner components no longer imported (`Overview`, `self/DungeonsTab`, `self/DungeonPanel`, `self/RunsTab`,
   `self/RunDetailExtra`, `self/ResultHead` — move `SelfActions` to a types-only module first, e.g.
   `components/owner/types.ts`, and update imports) and view-model functions no longer used anywhere (with their
   tests and i18n keys; `en`/`fr` stay mirrored). Keep everything still used by the home page.
2. Spec: status "phase 3 implemented 2026-10-12" + "Phase 3 notes" (deviations, missing data). `web-front.md`
   components map (`components/owner/`, `CharactersPage`), URL state (`tab` owner values, `as=vetting`). `AGENTS.md`
   roadmap: phase 3 implemented; phase 4 (Compare 2–5, Live, old CSS removal) next. README: if it shows an owner /
   `/me` screenshot, retake it from local cached data (0 pts).
3. Live check (local build, cached data only, no sync / analyse click): owner tabs at 1440 / 390, `as=vetting` and
   back, reload keeps tab + run, Live page profile of an own character leaves the URL alone, `/me` at 1440 / 390,
   menus by keyboard, no console error, `scrollWidth <= innerWidth` everywhere. Stop the server by PID.
4. Gate. Commit `docs: redesign phase 3`.

## After the tasks

Whole-phase review by a fresh agent (spec compliance, quality, "no WCL point without a click", no horizontal scroll,
i18n parity, nothing lost from the old owner view and `/me`), fixes, report. No push unless asked.
