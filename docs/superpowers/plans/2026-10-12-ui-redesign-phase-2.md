# UI redesign, phase 2 (candidate) — implementation plan

**Goal:** the candidate profile of the redesign: a compact profile header and four tabs — **Synthèse**, **Runs** (run
list + the selected run with a layered timeline), **Donjons**, **Méthode** — plus the wide **run sheet**; the
Experience axis leaves the evaluation model. Every fact the vetting view shows today stays reachable.

**Architecture:** no router (rule kept). The candidate page's state lives in the URL query
(`/candidate?open=<key>&tab=runs&run=<report:fight>&sheet=1`), written with `history.replaceState`. Each tab is a
thin component over a pure, tested view model in `web/src/lib/`. The timeline model (`lib/timeline.ts`) turns a run's
signals + optional deep-dive analysis into lanes and markers; the deep-dive analysis output gains
`defensives[].castsAtMs` (computed from the already-cached raw `castEvents`, 0 pts). `GET /api/docs` gains the
role's `globalCurve` and `reference` so the Méthode tab can draw the raw → percentile curve and the average player.
The member's own characters keep today's owner view (`OwnerDetail`) until phase 3.

**Spec:** `docs/superpowers/specs/2026-10-11-ui-redesign-design.md` (approved 2026-10-11), decisions 3–9 and
"The run timeline". Mockups: `docs/design/redesign/F-Synthese.dc.html`, `F-Runs.dc.html`, `F-Run.dc.html`,
`F-Donjons.dc.html`, `F-Methode.dc.html` (open them in a browser, or on the canvas
https://claude.ai/artifact/WeznnnDkrDGMPyAsuSKBeE page "4 · Final") and match them; values below win on conflict.
**Mockup layers marked "nouvelle donnée" (dashed, illustrative) are NOT built** — spec decision 9.

## Global Constraints (from the spec, verbatim where quoted)

- **One score family per context**: candidate pages show the verdict and the axes, never the pillars.
- **The Experience axis is removed** from the evaluation output, the help registry and every screen. It weighs 0 for
  every role, so no global score changes; the config version bumps. Previous-season score and activity stay visible
  as plain facts in the profile header.
- **Régularité stays, labelled "informatif · poids 0"**, never counted in a "what would flip the verdict" gap or a
  contribution waterfall. (Generalise: any axis whose role weight is 0 is informational.)
- Profile = four tabs Synthèse · Runs · Donjons · Méthode; Runs = list on top, the selected run below with a
  full-width timeline and a vertical layer checklist at its left; "Ouvrir en grand" opens the run in a wide sheet
  (~72 % of the viewport, ≥ 960 px when the viewport allows) over the page; its left part still shows the run list,
  dimmed but clickable to switch run.
- **No horizontal scroll anywhere.** Tables are CSS grids that fit their column: low-value columns merge into
  two-line cells; rows turn into stacked cards on narrow screens (check at 390 px). Buttons inside cards and rows
  32–36 px, one 40–44 px primary per view.
- Timeline: track 0 → `signals.fightDurationMs`, ticks every 5 min, never wider than its container. Layers (each a
  `<button aria-pressed>` with swatch + count): Morts (default on), Défensif dispo à la mort (on), Recharges majeures
  à la mort (on), Casts de défensifs (off), Contrôle (off). A layer whose data is missing for this run is disabled with
  the reason as its tooltip and, where it applies, the "Analyser · 3 pts" action. Selecting an event shows a callout
  (time, cause with killing-blow share, defensives state) and highlights it in "Moments clés"; arrow keys move between
  events.
- Colour meanings (tokens): `--invite/--maybe/--pass` = verdicts only (`--pass` also deaths, depleted);
  `--better/--worse` = every "vs peers" delta; heat scale for tinted cells; WCL parse scale only on a parse %.
  A score bar is blue (`--better`) ≥ 70, neutral 50–69, orange (`--worse`) < 50, with a 2 px "joueur moyen" tick
  at 50.
- **Never spend WCL points automatically.** The only point-spending controls are the existing "Analyser · 3 pts" /
  "Analyser les N autres · ~N pts" / "Réanalyser" buttons, each a click. Opening a tab, a run or the sheet reads only.
- No new runtime dependency; view models pure and tested; every UI string from `web/src/i18n/en.ts` with `fr.ts`
  mirroring it key for key; `web/` imports `src/` types only (exception `src/wow/classes.ts`); colours only from
  `tokens.css`.
- `just check` and `bun test` green with `web/dist` absent after every task.

## Spec deltas found while planning (apply to the spec in Task 15)

1. **Contrôle layer**: `RunControl` (`src/signals/types.ts`) has counts per spell, no timestamps. Phase 2 shows the
   Contrôle layer disabled, reason "candidat : non récupéré" (vetting view) — timed crowd control joins the "new WCL
   data" follow-up.
2. **Par times** are not in the payload (only Raider.IO's recent runs carry `parMs`): the Donjons tab shows the
   upgrade (`✓ +2`, depleted) and the clear time instead of a "marge timer" column.
3. **"Tous les runs"** is not available for a candidate (the payload holds the best run per dungeon only): the Runs
   filters are "Meilleur par donjon" and "Avec morts".
4. `GET /api/docs` `config` gains `globalCurve` and `reference` (Méthode tab).
5. A user `evaluation.json` written before the change may still name `experience` (axes, weights, references): those
   keys are dropped with a warning instead of failing the config.

## Before you start

- Bun 1.4.3. Gate per task: `rm -rf web/dist && just check && bun test`.
- Read `docs/agents/web-front.md` (rules, view-model pattern, i18n, tokens) and `docs/agents/testing.md`.
- Code facts this plan relies on (checked 2026-10-12):
  - `web/src/components/Detail.tsx`: `Detail` picks `OwnerDetail` (own character, `resultView(...) === "owner"`) or
    `VettingDetail` (`VerdictHero` + `SignalTiles` + `DungeonRuns` + `RioSection`). `Detail` is rendered by `App.tsx`
    on the candidate page **and** the Live page (`result`). Phase 2 replaces `VettingDetail` only.
  - `DeepdiveActions` (in `Detail.tsx`): `analyzing`, `progress`, `analyze(run, force?)`, `analyzeAll()`, `patch`,
    `canAfford(n)`, `quotaTooltip`, `mode`. `RunDeepDive.tsx` renders an analysis (usage, deaths, the audit of
    unlisted spells, the defensives table editing, proposals) — keep it, it moves into the run sheet.
  - Payload: `perDungeon.runs: MPlusRun[]` (best per dungeon; `signals?: RunSignals`), `payload.deepdive` read through
    `analysisFor(payload, run)` (`web/src/lib/deepdive.ts`), `evaluation: Evaluation` (`axes[].evidence[]` with
    `delta`, `source`, `value`, `weight?`, `score?`; `drivers[]` with `impact`, `value`, `reference`;
    `nextVerdict`), `rio` (seasons, recentRuns, derived), `character`, `targetLevel`, `runsIndexed`, `zone`,
    `metric`, `specFilter`, `deepdiveSummary`.
  - `RunSignals.deaths.events[]`: `atMs`, `cause`, `source`, `inWipe`, `killingHits?`. Analysis
    `RunDefensives.deaths[]`: `atMs`, `inWipe`, `killingHits[{id,name,amount,share}]`, `killingBlow`, `available[]`,
    `active[]`, `onCooldown[{name, readyInS}]`, `verdict` (`"immunity available" | "defensive available" | "covered" |
    "nothing available"`); `defensives[]`: `DefensiveUse` (`id`, `name`, `kind`, `cooldownS`, `casts`, `capacity`,
    `usage`, …).
  - `src/deepdive/analyze.ts` `usageOf` already sorts each defensive's `castEvents` timestamps (report-relative ms);
    the fight start is `i.report.fights?.[0]?.startTime ?? i.raw.fightStart`.
  - Existing view models to reuse rather than duplicate: `verdictView`, `confidenceColor` (`lib/verdict.ts`),
    `driversView` (`lib/drivers.ts`), `axisRows`, `evidenceText`, `formatEvidenceValue`, `heroStats`,
    `axisWeightLabel` (`lib/axes.ts`), `rowOf`, `signalParts`, `missingDungeons`, `runsHeadline` (`lib/runs.ts`),
    `panelModel`, `costText`, `unanalyzedRuns`, `analysisFor` (`lib/deepdive.ts`), `tiles` (`lib/tiles.ts`),
    `fmtDuration`, `fmtAge`, `parseTier`, `wclUrl`, `rioHref`, `realmName` (`lib/format.ts`), `axisIsInformational`
    (`lib/help.ts`), `reevalHint` (`lib/keyLevel.ts`), `runDetail` (`lib/self.ts`, for the enemy-spell / avoidable
    rows shape).
  - `candidateHref(key)` in `web/src/lib/hostedMode.ts`; App's boot effect (`App.tsx` ~245) reads `?open=` then
    erases the query string — it must keep `tab`, `run`, `sheet` (see Task 5).
  - Experience is referenced in: `src/evaluation/{types,inputs,pillars,docs,docs.fr,drivers}.ts`,
    `src/evaluation/axes/{experience,index}.ts`, `src/evaluation/default-config.json`, `src/format-mplus.ts`,
    `scripts/calibration/*.ts`, `web/src/lib/{verdict,axes,drivers,help,self}.ts`, `web/src/i18n/{en,fr}.ts`,
    tests under `test/evaluation/`, `test/format.test.ts`, `web/src/lib/*.test.ts`, and `docs/scoring.md`,
    `docs/cli.md`, `README.md` (`grep -rln "experience\|Experience" src web/src test scripts docs README.md`).
- Do not run `just deploy`; do not create a release or tag; do not push.

## Files

| File | Responsibility |
|---|---|
| `src/deepdive/analyze.ts`, `types.ts` | `DefensiveUse.castsAtMs` |
| `src/evaluation/**`, `default-config.json`, `src/format-mplus.ts`, `scripts/calibration/*` | Experience removed, config v7, legacy keys dropped |
| `src/server/routes-shared.ts` | docs `config.globalCurve`, `config.reference` |
| `web/src/styles/tokens.css`, `app.css` | heat + parse scale tokens; `.cand-*`, `.tl-*`, `.sheet-*`, `.grid-*` classes |
| `web/src/lib/profile.ts` (+ test) | URL state (tab, run, sheet), header model, external links |
| `web/src/lib/synthesis.ts` (+ test) | verdict block, "ce qui ferait basculer", forces / faiblesses, axes table |
| `web/src/lib/runList.ts` (+ test) | Runs grid rows (role-aware), filters, sort, batch-analyse line |
| `web/src/lib/timeline.ts` (+ test) | layers, lanes, markers, ticks, callout, moments clés |
| `web/src/lib/runView.ts` (+ test) | selected run / sheet: stats, defensives used/possible, killers, enemy spells, avoidable |
| `web/src/lib/dungeonGrid.ts` (+ test) | Donjons rows (role-aware two-line cells, heat tints), notes strip, inline detail |
| `web/src/lib/method.ts` (+ test) | path, waterfall, axis cards with signals, curve with zones, rules |
| `web/src/components/candidate/*.tsx` | `CandidateProfile`, `ProfileHeader`, `SynthesisTab`, `RunsTab`, `RunPanel`, `Timeline`, `RunSheet`, `DungeonsTab`, `MethodTab` |
| `web/src/components/Detail.tsx`, `App.tsx` | vetting view → `CandidateProfile`; query params kept |
| `web/src/i18n/en.ts`, `fr.ts` | `cand.*` section (header, tabs, synth, runs, timeline, sheet, dungeons, method) |
| docs | spec deltas, `web-front.md`, `scoring.md`, `deep-dive.md`, `cli.md`, `README.md` (+ screenshots), `AGENTS.md` roadmap |

---

## Task 1 — Defensive cast times in the deep-dive analysis

1. `src/deepdive/types.ts`: `DefensiveUse` gains
   `/** Fight-relative ms of each cast with an event (empty for an id added after the fetch: table total only). */ castsAtMs: number[];`
2. `src/deepdive/analyze.ts`: `usageOf(raw, fightS, table, fightStart)` returns `castsAtMs: times.map((t) => t - fightStart)`
   (sorted ascending, as `times` already is). `analyzeRun` passes the fight start it already computes (move the
   `fightStart` line above the `usageOf` call).
3. Tests (`test/deepdive/analyze.test.ts` or the existing analyze test file): on the existing fixture(s), each
   defensive's `castsAtMs.length` equals its event count, values are ≥ 0, ascending, and equal to
   `castEvents[].timestamp − fightStart`; re-analysing the same raw twice gives deep-equal output (purity), and an
   id in the table but not in `raw.tableIds` has `castsAtMs: []`.
4. Payloads saved before carry analyses without the field: the web reads it as `d.castsAtMs ?? []` (Task 7).
   Analyses are recomputed from raw on every hosted read (`withCachedAnalyses`) and on local refresh, so no migration.
5. `docs/deep-dive.md`: one sentence in the output section ("each defensive also lists its cast times, fight-relative,
   used by the run timeline").
6. Gate. Commit `feat(deepdive): defensive cast times`.

## Task 2 — Remove the Experience axis (model, CLI, docs registry)

1. `src/evaluation/types.ts`: `AxisKey` / `AXIS_KEYS` drop `"experience"`.
2. Delete `src/evaluation/axes/experience.ts`; `axes/index.ts` drops it from `scoreAllAxes` and the five
   `experience.*` entries from `EVIDENCE_SOURCES`. `inputs.ts` drops the `experience` block (and any helper only it
   used). `pillars.ts` drops the `experience.*` sources. `drivers.ts` comment mentions it — update.
3. `default-config.json`: remove `axes.experience`, every `axisWeights.<role>.experience`, every
   `reference.<role>["experience.*"]`; `version` `"6"` → `"7"`.
4. `config.ts` `validateConfig`: before validation, a user file's legacy `experience` keys (`axes.experience`,
   `axisWeights.<role>.experience`, `reference.<role>["experience.<id>"]`) are deleted and a warning
   `"evaluation.json: the experience axis was removed — its keys are ignored"` is reported through the same channel
   the loader already uses for config warnings (read `getEvalConfig` to find it; if there is none, `console.warn`
   once). Test: a user override carrying the three kinds of keys loads, the effective config has none of them, the
   warning is emitted once.
5. `docs.ts` / `docs.fr.ts`: remove the `experience` axis doc and its sub-signals; fix the pillars intro sentence
   ("Preparation and consistency stay beside the pillars as context"; French mirror). `src/format-mplus.ts`: drop
   the label and the two formatters.
6. `scripts/calibration/*.ts`: drop experience handling so `just check` passes (they are dev tools; keep them
   compiling, no behaviour change otherwise).
7. Tests: update `test/evaluation/*` and `test/format.test.ts`. Add/keep a regression test: for every evaluation
   fixture used in `test/evaluation/evaluate.test.ts`, `global` and `verdict` are identical to the values the test
   asserted before this change (weight was 0 → unchanged), and no axis has key `"experience"`.
   `test/evaluation/docs.test.ts`: the registry has no `experience` entry and covers every remaining source.
8. Gate. Commit `feat(evaluation): remove the experience axis`.

## Task 3 — Remove Experience from the web; docs config for Méthode

1. `web/src/lib/verdict.ts` `AXIS_ORDER` drops `"experience"`; `axes.ts`, `drivers.ts`, `help.ts`, `self.ts` drop
   the experience formatters / entries; `i18n/en.ts` + `fr.ts` drop every `experience` key
   (`verdict.axes.experience`, `evidence.experience.*`, help texts, …). Saved payloads may still carry an
   `experience` axis (local history saved before): every place that iterates `ev.axes` for display goes through
   `AXIS_ORDER` (or filters to it) — add a test with an evaluation containing an extra `experience` axis: `axisRows`,
   `radarPoints`, compare rows ignore it.
2. `src/server/routes-shared.ts`: `DocsResponse.config` gains `globalCurve: EvaluationConfig["globalCurve"]` and
   `reference: EvaluationConfig["reference"]`; `docsResponse` fills them. Update its test.
3. Update the web tests that listed experience (`axes.test.ts`, `compare.test.ts`, `drivers.test.ts`,
   `help.test.ts`, `verdict.test.ts`).
4. Docs: `docs/scoring.md` (Experience removed — say so in one line where it was described; Régularité is shown as
   "informatif · poids 0"), `docs/cli.md` (axis list), `README.md` (remove the Experience row of the axes table).
5. Gate. Commit `feat(web): drop the experience axis; docs config for the method tab`.

## Task 4 — Tokens: heat and parse scales

1. `tokens.css`, with the "redesign spec 2026-10-11" comment on each line:
   heat `--heat-1-bg #5A2E14 --heat-1-fg #FFB27A` (< 45) · `--heat-2-bg #3A2A1C --heat-2-fg #F5C79B` (45–54) ·
   `--heat-3-bg #1C2029 --heat-3-fg #C9CED8` (55–69) · `--heat-4-bg #152A3A --heat-4-fg #8CCBF2` (70–84) ·
   `--heat-5-bg #16405C --heat-5-fg #BEE4FF` (≥ 85); parse (WCL) `--parse-gray #8A8F98` (< 25), `--parse-green
   #1EFF00` (25–49), `--parse-blue #3D8BFF` (50–74), `--parse-purple #A335EE` (75–94), `--parse-orange #FF8000`
   (95–98), `--parse-pink #E268A8` (99), `--parse-gold #E5CC80` (100).
2. `app.css`: `.tier-*` classes use the parse tokens (no hex left in `app.css` for them); add `.heat-1` … `.heat-5`
   (bg + fg). `lib/format.ts` `parseTier` keeps its names; if the five tiers do not cover pink/gold, add
   `"pink" | "gold"` with tests (99 → pink, 100 → gold).
3. Gate. Commit `feat(web): heat and parse colour tokens`.

## Task 5 — Profile URL state and header model (`lib/profile.ts`)

```ts
export type CandTab = "synthesis" | "runs" | "dungeons" | "method";
export const CAND_TABS: readonly CandTab[] = ["synthesis", "runs", "dungeons", "method"];
export interface CandState { tab: CandTab; run: string | null; sheet: boolean } // run = "report:fight"
export function candState(search: string): CandState;           // unknown tab → synthesis; sheet only with a run
export function candHref(key: string, s: Partial<CandState>): string; // /candidate?open=…[&tab=…][&run=…][&sheet=1], defaults omitted
export interface HeaderFact { label: string; value: string; sub?: string }
export interface ProfileHeaderView {
  name: string; classId: number; classColor: string; iconUrl: string | null; initials: string;
  line: string;            // "Chasseur de démons Dévoreur · DPS · Hyjal (EU)" (spec · class · role · realm (REGION))
  verdict: { cls: string; label: string; score: string | null; target: string }; // target: "pour une +11"
  facts: HeaderFact[];     // RIO, ilvl, region/server rank (from heroStats), previous season score, runs last 7 days (Raider.IO activity)
  links: { rio: string | null; wcl: string };
  meta: string;            // zone · N runs indexed · metric auto / spec filter notes (today's VerdictHero metaline)
  runCount: number;        // the Runs tab count = perDungeon.runs.length
}
export function profileHeader(t: T, locale: Locale, p: LookupPayload): ProfileHeaderView;
```
- `candidateHref` in `hostedMode.ts` becomes `candHref(key, {})` (keep the export name as an alias so callers do
  not change).
- WCL character URL: `https://www.warcraftlogs.com/character/<region>/<realmSlug>/<name lower-cased, encoded>`.
  Class icon: `https://wow.zamimg.com/images/wow/icons/medium/classicon_<class token>.jpg` where the token is the
  class name lower-cased without spaces (`deathknight`, `demonhunter`); the component falls back to the 2-letter tile
  on `onError`.
- `App.tsx` boot effect: keep `tab`, `run`, `sheet` when it rewrites the URL (`candHref(key, candState(search))`);
  switching profile from Récents keeps the tab and drops run/sheet.
- Tests: round trip `candHref` ↔ `candState` (accents, quotes, every tab), defaults omitted, unknown tab, sheet
  without run ignored; `profileHeader` on a fixture payload (FR + EN strings), Death Knight icon token, missing RIO →
  `links.rio` null and no RIO fact.
- Gate. Commit `feat(web): candidate URL state and header model`.

## Task 6 — Synthèse model (`lib/synthesis.ts`)

Mockup `F-Synthese`. Inputs: `t`, `locale`, `ev: Evaluation`, `docs` (titles, `axisWeights`, `reference`) — pass the
narrow pieces, not the whole response.

```ts
export interface VerdictBlock { cls: string; label: string; score: string | null; target: string; barPct: number | null;
  thresholds: { label: string; at: number }[];   // INVITE 70 / MAYBE 30 ticks on the 0–100 bar
  summary: string;                                // one sentence: top strengths, "mais" top costs (template, no free text)
  confidence: string | null }                     // "8 runs notés sur 15 indexés" + low-confidence note when runsUsed < confidence.high
export interface FlipRow { name: string; gain: string; gap: string } // "Survie, jusqu'à +10" / "+46 % vs pairs aujourd'hui"
export interface FlipView { title: string; rows: FlipRow[]; reachable: boolean } // "Pour passer INVITE : +11 pts"
export interface ForceRow { name: string; pts: string; axis: string; detail: string; widthPct: number }
export interface AxisLine { key: AxisKey; name: string; score: number | null; band: "better" | "neutral" | "worse"; why: string; informational: boolean }
export interface SynthesisView { verdict: VerdictBlock; flip: FlipView | null; pros: ForceRow[]; cons: ForceRow[]; informational: { name: string; text: string }[]; axes: AxisLine[] }
export function synthesisView(...): SynthesisView;
```
Rules:
- Pros / cons come from the counted axes' `evidence` (`delta` > 0 / < 0), **excluding axes with role weight 0** (those
  feed `informational` instead); pros top 4, cons top 5 by |delta|; `pts` with sign and one decimal in the locale
  (`+9,2`, `−10,3`); `widthPct = min(100, |delta| / 20 × 100)`; `detail` = `evidenceText`.
- Flip: from `ev.nextVerdict` (`null` → no block); one row per `sources[i]` with the driver's `-impact` as the gain
  ("jusqu'à +N" on the axis title) and the gap from the driver's value vs reference (reuse `driversView` formatting);
  the title gives `threshold − global`. Not reachable → a line saying the three largest costs are not enough.
- Axes table: `AXIS_ORDER` order, `band` from score (≥ 70 better, 50–69 neutral, < 50 worse), `why` = top two
  evidence texts joined " · ", `informational` when the role weight is 0 (chip "informatif · poids 0").
- Tests (FR assertions on the mockup's Obye numbers where possible): weight-0 axis never in pros/cons/flip;
  INSUFFICIENT DATA → `score` null, no flip, summary says not enough runs; INVITE → no flip; ordering and caps;
  saved payload with an `experience` axis ignored.
- Gate. Commit `feat(web): synthesis view model`.

## Task 7 — Run list and timeline models

### `lib/runList.ts` (mockup `F-Runs`, top card)
```ts
export type RunFilter = "best" | "deaths";
export type RunSort = "parse" | "key" | "deaths" | "when";
export interface RunListRow { key: string; abbr: string; dungeon: string; analysed: boolean; hasSignals: boolean;
  level: string; upgrade: { text: string; timed: boolean } | null; time: string;
  deaths: { text: string; tone: "pass" | "neutral" | "dim" };
  dtps: { text: string; tone: "better" | "worse" | "neutral" } | null;   // vs peers %
  avoidable: { text: string; tone: "better" | "worse" | "neutral" } | null;
  util: { label: "kicks" | "dispels"; text: string } | null;           // healers: dispels; others: kicks count/capacity
  parse: { text: string; tier: ParseTier }; when: string; stale: boolean; url: string }
export interface RunListView { rows: RunListRow[]; analysedLine: string; pending: number; batchLabel: string | null; missing: string[] }
export function runListView(t, locale, p: LookupPayload, filter: RunFilter, sort: RunSort, now?): RunListView;
```
- Source: `payload.perDungeon.runs`; "deaths" filter keeps `signals.deaths.count > 0`; default sort parse desc;
  `abbr` = first letters of the dungeon's words (2 chars, "TS" for Temple of Sethraliss); `pending` /
  `batchLabel` = `unanalyzedRuns` + `costText` ("Analyser les 7 autres · ~21 pts"); `missing` = `missingDungeons`.
- The grid at ≥ 900 px: `Donjon | Clé | Temps | Morts | DTPS | Évitable | Kicks/Dispels | Parse | Quand` sized to
  fit ≈ 1120 px; below 900 px each row becomes a two-line card (CSS only, same DOM).

### `lib/timeline.ts` (spec "The run timeline")
```ts
export type LayerKey = "deaths" | "dispo" | "cd" | "casts" | "control";
export const DEFAULT_LAYERS: Record<LayerKey, boolean> = { deaths: true, dispo: true, cd: true, casts: false, control: false };
export interface LayerChip { key: LayerKey; label: string; count: string; on: boolean; disabled: string | null; analyse: boolean } // analyse: show "Analyser · 3 pts"
export interface Marker { id: string; leftPct: number; kind: "death" | "death-bad" | "dispo" | "none" | "cast"; title: string }
export interface Bar { leftPct: number; widthPct: number; title: string }
export interface Lane { key: LayerKey; label: string; markers: Marker[]; bars: Bar[] }
export interface Callout { id: string; time: string; title: string; hits: string; state: string; bad: boolean }
export interface Moment { id: string | null; time: string; text: string; bad: boolean }
export interface TimelineView { durationMs: number; ticks: { leftPct: number; label: string }[]; chips: LayerChip[]; lanes: Lane[];
  events: string[]; callout: Callout | null; moments: Moment[]; summary: string | null }
export function timelineView(t, locale, run: MPlusRun, analysis: RunDefensives | null, own: boolean,
  layers: Record<LayerKey, boolean>, selected: string | null): TimelineView | null; // null when no signals or no fightDurationMs
```
Rules:
- Ticks every 5 min from 0 (labels `0:00`, `5:00`, …), last tick ≤ duration; `leftPct` = ms / duration × 100,
  clamped to [0, 100], two decimals.
- **deaths**: one marker per `signals.deaths.events[]` (id `d<i>`), `death-bad` when the analysis says a defensive
  or immunity was available at that death, else `death`; title "1:53 · Ground Pound". Count = deaths.
- **dispo** (needs analysis, else disabled "Analyse le run pour voir les défensifs à la mort", `analyse: true`): one
  marker per analysed death, `dispo` when available (names in the title), `none` otherwise. Count `"1/3"` =
  deaths with a defensive available / deaths.
- **cd** (needs analysis): per analysed death, one bar per `onCooldown` entry whose defensive is major or immunity
  (look the name up in `analysis.defensives`), from the death time, width `readyInS`; title
  "Astral Shift en recharge 41 s après 1:53". Count = bars.
- **casts** (needs analysis; old analyses without `castsAtMs` → disabled "Réanalyse pour voir les casts (0 pt si déjà
  en cache)" — note: re-analysis of a cached raw costs 0 pts only when the server serves it from cache; keep the
  wording neutral if unsure: "Données absentes de cette analyse"): one marker per `castsAtMs` entry, title
  "12:04 · Astral Shift". Count = total casts with times.
- **control**: disabled, reason `own ? "Horodatage du contrôle : pas encore récupéré" : "Non récupéré pour un
  candidat"` (spec delta 1). Count "—".
- Disabled layers are never drawn even if their flag is on. `events` = ids of death markers in time order (arrow
  keys walk them). `selected` null → no callout. Callout: time, title ("Mort évitable · Storm Strikes" when
  `death-bad`, else "Mort · <cause>"), hits (analysis killing hits "Ground Pound 71 % · Slither Strike 29 %", else the
  signals' `killingHits` names, else the cause), state (analysis: available / active / on cooldown "encore 41 s";
  without analysis: "Analyse le run pour voir les défensifs").
- Moments: one per death (time + title + " — <dispo summary>"), plus a run-level line when
  `signals.consumables?.potions === 0` ("Aucune potion de soin"), id null.
- `summary` (sheet header sentence): "3 morts, dont une évitable : à 13:45, Astral Shift était prêt et n'a pas
  servi." when analysed; "N morts" otherwise; null with 0 deaths ("Aucune mort").
- Tests: the mockup's Vachâman Temple run rebuilt as a fixture (3 deaths at 1:53 / 13:45 / 17:50, analysis with
  Astral Shift available at 13:45, on cooldown 41 s / 32 s, Earth Elemental 94 s) — lane counts, the bad death, bar
  positions, ticks for 30:31, callout texts in FR; no analysis → dispo/cd/casts disabled with `analyse: true`;
  no `fightDurationMs` → null; analysis without `castsAtMs` → casts disabled; control always disabled.
- Gate. Commit `feat(web): run list and timeline view models`.

## Task 8 — Run detail model (`lib/runView.ts`)

For the panel under the list (`F-Runs`) and the sheet (`F-Run`).
```ts
export interface RunStat { key: string; label: string; value: string; tone: "pass" | "better" | "worse" | "neutral" | `tier-${ParseTier}` }
export interface DefRow { name: string; id: number; used: string; pct: number }      // "10/15", bar %
export interface RunDetail { title: string; key: string; upgrade: { text: string; timed: boolean } | null; time: string; when: string;
  spec: string; stats: RunStat[]; defensives: DefRow[]; also: string | null;          // "Aussi sur ce run : kicks 37/146 (pairs 32 %) · dispels 8 · DTPS +14 % vs pairs"
  killers: { id: number | null; name: string; share: string }[];                        // "Ce qui l'a tué", from analysis deaths (fallback signals)
  enemySpells: { id: number; name: string; text: string }[] | null;                     // signals.interrupts.enemyCasts ("passés 4 / 12 · tes kicks 3")
  avoidable: { id: number; name: string; amount: string }[] | null;                     // signals.avoidableDamage.abilities (+ other)
  notAnalysed: string | null;                                                           // "Déjà connu : 3 morts · parse 72,2 %" when no analysis
  wcl: string }
export function runDetail(t, locale, p: LookupPayload, run: MPlusRun, analysis: RunDefensives | null, now?): RunDetail;
```
- Stats: Morts (pass tone when > 0), DTPS vs pairs, Évitable vs pairs, Kicks (or Dispels for healers), Dispels,
  Parse (tier). Reuse the formatting of `signalParts` / `rowOf` so the numbers match the old rows exactly.
- Defensives used/possible: majors and immunities from the analysis (`casts/capacity`), then potions "0/6" when the
  signals carry consumables (capacity = fight duration / 300 s, rounded up — same rule as today's text; if today's
  code shows no capacity for potions, show the count only).
- Tests on the same fixture as Task 7 (FR), a healer run (dispels replace kicks), a run without signals (stats
  empty, `notAnalysed` null, only time/key/parse), a run without analysis.
- Gate. Commit `feat(web): run detail view model`.

## Task 9 — Donjons model (`lib/dungeonGrid.ts`)

Mockup `F-Donjons`. Role-aware columns (two-line cells):
`Donjon (name / date · spec when it differs) | Clé (+16 ✓+1 / time) | Morts (lui / groupe) | Kicks or Dispels
(count + bar vs the best dungeon) | Évitable vs pairs | DTPS vs pairs | Parse (% / amount)`.
```ts
export interface Tint { text: string; cls: `heat-${1|2|3|4|5}` | "" }
export interface DungeonRow { key: string; name: string; sub: string; level: string; upgrade: { text: string; timed: boolean } | null; time: string;
  deaths: Tint; util: { text: string; barPct: number } | null; avoidable: Tint | null; dtps: Tint | null; parse: { text: string; tier: ParseTier; amount: string };
  facts: { label: string; value: string }[]; note: string; analysed: boolean; hasSignals: boolean }
export interface DungeonNote { label: string; value: string; sub: string; tone: "better" | "worse" | "neutral" | `tier-${ParseTier}` }
export interface DungeonGridView { utilLabel: string; rows: DungeonRow[]; notes: DungeonNote[]; legend: string; missing: string[] }
export function dungeonGrid(t, locale, p: LookupPayload, now?): DungeonGridView;
```
- Heat tints for "vs peers" percentages, lower is better: ≤ −20 % → `heat-5`, −20…−5 → `heat-4`, −5…+20 → `heat-3`
  (neutral), +20…+50 → `heat-2`, ≥ +50 → `heat-1`; group deaths ≥ 8 → `heat-1`, ≥ 5 or own deaths > 0 →
  `heat-2`, else neutral.
- Notes strip (4 cards): group deaths per run (+ the worst dungeon as sub), kicks or dispels per run, own deaths per
  run + avoidable median vs peers, median parse (with the healer remark "à lire en dernier pour un soigneur" for
  healers). These replace `SignalTiles` on the candidate page: every value `tiles()` shows today must appear either
  here or in a row's facts — the test asserts it on the fixture.
- `facts` (inline detail): Morts (lui / groupe), Kicks / Dispels, Évitable vs pairs, DTPS vs pairs, amount · parse,
  Potions · healthstones; `note` = "Run non analysé : l'analyse ajoute les morts détaillées et l'usage des
  défensifs." or, analysed, the deep-dive one-liner (`panelModel` headline).
- Tests: DPS vs healer columns, tint thresholds at the edges, a dungeon without signals (row with level/time/parse
  only), the tiles coverage assertion.
- Gate. Commit `feat(web): dungeons grid view model`.

## Task 10 — Méthode model (`lib/method.ts`)

Mockup `F-Methode`.
```ts
export interface PathStep { label: string; value: string; sub: string }        // 1 · Runs 9 "runs notés en +19, le meilleur par donjon" … 5 · Verdict 77
export interface WaterfallPart { key: AxisKey; label: string; pct: number }     // contribution of each counted axis to the raw score
export interface SignalRow { name: string; value: string; ref: string; weight: string; effect: string; tone: "better" | "worse" | "neutral" }
export interface AxisCard { key: AxisKey; name: string; weightLabel: string; confidence: string; score: string; band: "better" | "neutral" | "worse"; informational: boolean; signals: SignalRow[]; note: string | null }
export interface CurveView { points: [number, number][]; raw: number | null; final: number | null; zones: { verdict: "invite" | "maybe" | "pass"; from: number; to: number }[] }
export interface MethodView { title: string; path: PathStep[]; waterfallCaption: string; waterfall: WaterfallPart[]; raw: string; final: string;
  axes: AxisCard[]; curve: CurveView; rules: { invite: number; maybe: number; minRuns: number; high: number; medium: number } }
export function methodView(t, locale, ev: Evaluation, docs: Pick<DocsResponse, "docs" | "config">): MethodView | null; // null until docs load
```
- Raw = weighted mean of the counted axes (role weights > 0, score not null) — the same formula as
  `src/evaluation/global.ts` `globalScore` (re-implemented in the web: it is 8 lines; cite the source in a comment);
  `pct` of an axis = `w × score / Σw` (sum of parts = raw); waterfall caption lists the weights
  ("DPS : Survie ×3, Utilité ×2, Throughput ×3, Préparation ×1").
- Signals per axis: every evidence entry: name (`docs.axes[axis].subSignals[id].title`), value
  (`formatEvidenceValue`), ref (the role's `config.reference[role][source].value`, formatted the same way, "—" when
  absent), weight (`×` evidence.weight, "—" when absent), effect (delta with sign, one decimal), tone by sign.
- Curve: `config.globalCurve[role]`; zones from `config.verdict` (pass < maybe ≤ maybe < invite ≤ invite … 100) on
  the **final** axis; `raw` and `final` mark the player.
- Path: runs used (`ev.runsUsed`, target level), signals count (evidence entries on counted axes), axes count
  ("4 + 1" = counted + informational), raw (one decimal), verdict.
- Tests: raw equals `globalScore` of the fixture (compare with a value computed by `src/evaluation/global.ts` in the
  test — test files may import `src/` at runtime), parts sum to raw, informational axis excluded from parts but has a
  card, missing reference → "—", INSUFFICIENT DATA view.
- Gate. Commit `feat(web): method view model`.

## Task 11 — Candidate profile shell: header, tabs, Synthèse

1. `components/candidate/CandidateProfile.tsx`: props `{ payload, history item fields needed (fetchedAt, cached),
   hint, onReevaluate, onRefresh, refreshBusy, deepdive, self, compareHref, urlKey: string | null }` — `urlKey`
   non-null on the candidate page (the component then mirrors `CandState` into the URL with `replaceState` via
   `candHref`); null on the Live page (state in memory only). Holds `CandState` (initial from `candState(location.search)`
   when `urlKey`), renders `ProfileHeader`, the tab strip (`role="tablist"`, buttons `role="tab"`, `aria-selected`,
   arrow keys move focus; Runs shows its count), then the tab. Tracks `cand_tab_<tab>` usage events (add them to
   `src/hosted/usage-catalog.ts` and `PAGE_EVENT`-style constants; the catalogue test lists events).
2. `ProfileHeader.tsx`: class icon 40 px (fallback 2-letter tile), name in the class colour (text-safe variant for
   Shaman / Death Knight from `src/wow/classes.ts` if it exists, else `classHex`), the verdict pill + score + "pour
   une +N", the line, facts, the re-evaluation hint (`hint`) with its link, "Récupéré il y a … · cache" and
   **Actualiser** (moves here from App's `cand-bar`), `MeChip`, and small buttons **Comparer** (href
   `/compare?pick=<key>` — App's compare page pre-ticks `pick` on boot), **Raider.IO ↗**, **WCL ↗**. Header wraps on
   narrow screens.
3. `SynthesisTab.tsx`: verdict card (bar with INVITE/MAYBE ticks, summary sentence, confidence), "Pour passer …"
   card, Forces et faiblesses (two columns ≥ 900 px, stacked below; bars `--better` / `--worse`), the informational
   card(s), the axes table (score bar with the 50 tick, "informatif · poids 0" chip, `HelpLink` per axis), then
   `RioSection` collapsed at the bottom (Raider.IO recent runs). `HelpLink anchor="verdict"` / `"drivers"` kept.
4. `Detail.tsx`: `VettingDetail` renders `CandidateProfile`. `App.tsx`: the candidate page drops its `cand-bar`
   (moved into the header) and passes `urlKey={activeKey}`; the Live page passes `urlKey={null}`; `/compare?pick=`
   pre-selects.
5. CSS (`app.css`, tokens only): `.cand-head`, `.cand-tabs`, `.synth-*`, `.scorebar` (50 tick), `.chip-info`.
6. Verify in the browser at 1440 and 390 px against `F-Synthese` (no horizontal scroll: `document.documentElement.scrollWidth
   <= innerWidth`). Gate. Commit `feat(web): candidate profile header, tabs and synthesis`.

## Task 12 — Runs tab, run panel and the timeline component

1. `RunsTab.tsx`: card "Runs" with the filter chips (Meilleur par donjon / Avec morts), the analysed line and the
   batch button (`deepdive.analyzeAll`, disabled when `!canAfford(pending)` with `quotaTooltip`, shows
   `deepdive.progress`), the table-warning notice, the grid (header row with sortable headers as buttons with
   `aria-sort`), `missing` dungeons line. Clicking a row selects it (`run` in `CandState`); the first row is
   selected by default.
2. `RunPanel.tsx`: header (abbr tile, dungeon, key, upgrade, time, age, spec), **Ouvrir en grand** (sets
   `sheet`), WCL ↗; then `Timeline`; then "Moments clés", "Défensifs utilisés / possibles" and the "Aussi sur ce run"
   line. Not analysed: the timeline still shows deaths; a callout card "Ce run n'est pas encore analysé" with
   **Analyser · 3 pts** (`deepdive.analyze(run)`, disabled while busy / over quota). Run without signals: a muted
   line ("Pas de statistiques pour ce run") and the WCL link.
3. `Timeline.tsx` (shared with the sheet): layer checklist at the left (vertical on ≥ 720 px, a wrapping row
   above the track below that), each `<button aria-pressed>` with swatch, label, count; disabled chips have
   `aria-disabled`, the reason as `title`, and an inline "Analyser · 3 pts" button when `analyse`. Lanes: label at
   left (28–36 px high), markers absolutely positioned by `leftPct` (buttons with `aria-label` = title for deaths;
   decorative spans for others), bars for cd; ticks under the track. Track width = container (no min-width). Arrow
   Left/Right on a focused death marker moves selection through `events`. Callout under the track. All colours
   from tokens (deaths `--pass`, dispo `--worse`, cd `--dim`/`--border-2`, casts `--link`).
4. URL: selecting a run or toggling the sheet updates `CandState` (and the URL when `urlKey`). Layer toggles are
   per page view (not in the URL).
5. Verify at 1440 / 390 px against `F-Runs` (no horizontal scroll; markers stay inside the track). Gate. Commit
   `feat(web): runs tab with the layered timeline`.

## Task 13 — Run sheet

1. `RunSheet.tsx`: a modal dialog (`role="dialog" aria-modal="true"`, labelled by the run title) over the page:
   scrim (`--scrim`), panel on the right `width: min(100vw, max(960px, 72vw))` capped at the viewport, full height
   with its own vertical scroll (the page behind does not scroll). Left of the panel (only when the viewport leaves
   ≥ 240 px): the run list, dimmed (opacity .55), each row a button switching the run. Escape and the close button
   close it (focus returns to "Ouvrir en grand"); focus is trapped inside while open.
2. Content (mockup `F-Run`): header (abbr, dungeon, key, upgrade, time, age, spec · class, WCL ↗, close), stats row
   (`RunDetail.stats`), the timeline (same `Timeline`, full width), the summary sentence, Moments clés, Défensifs
   utilisés / possibles, Ce qui l'a tué, then two tabs **Sorts ennemis** (`enemySpells`, plus the crowd-control note
   "Non récupéré pour un candidat") and **Dégâts évitables** (`avoidable`); then `RunDeepDive` collapsed under
   "Analyse détaillée et table des défensifs" (keeps reanalyse, the audit, table editing, proposals). Not analysed:
   "Ce run n'est pas encore analysé — Déjà connu : …" + **Analyser · 3 pts**.
3. Under 960 px the sheet takes the full width and hides the run list.
4. Verify at 1440 / 1024 / 390 px against `F-Run` (keyboard: Tab cycles inside, Escape closes). Gate. Commit
   `feat(web): run sheet`.

## Task 14 — Donjons and Méthode tabs

1. `DungeonsTab.tsx` (candidate; do not confuse with `components/self/DungeonsTab.tsx`, the owner tab — name the
   file `components/candidate/CandDungeons.tsx`): the notes strip (4 cards, wrap), the legend (mieux que les pairs /
   comme eux / moins bien with heat swatches), the grid (header + rows; a row is a button toggling its inline detail
   with facts, note, **Analyser · 3 pts** when not analysed and signals exist, **Voir le run →** which switches to the
   Runs tab with that run selected), the peers footnote. Stacked cards below 900 px.
2. `MethodTab.tsx`: "Comment on arrive à INVITE 77" path (5 steps, wraps), the waterfall bar (one segment per
   counted axis, labels under on narrow screens), "Les axes et leurs signaux" cards (signal grid Signal | Lui |
   Moyenne | Poids | Effet; informational axis with its chip and a note), "Du score brut au verdict" curve (inline SVG,
   reuse `components/help/CurveChart.tsx` if it can take zones and a marker, else a small `MethodCurve` in the same
   style), "Les règles" (thresholds and confidence from config). Loading state while docs load.
3. Verify at 1440 / 390 px against `F-Donjons` and `F-Methode`. Gate. Commit `feat(web): candidate dungeons and
   method tabs`.

## Task 15 — Docs, screenshots, live check

1. Spec: status line "phase 2 implemented 2026-10-12"; add a "Phase 2 notes" list with the five spec deltas above.
2. `docs/agents/web-front.md`: components map (`components/candidate/`), the new view models, the URL state.
   `AGENTS.md` roadmap: redesign phase 2 implemented; phases 3–4 next. `docs/agents/architecture.md` if it lists the
   docs response or the analysis fields.
3. README screenshots: replace `docs/images/verdict.png` (Synthèse) and `docs/images/runs.png` (Runs tab with the
   timeline) from a local build on cached data (0 pts; reuse a history entry that already has an analysed run —
   never analyse to make a screenshot).
4. Live check (local `just build && ./bmpl serve --no-open`, cached history only, **no Analyse click**): every tab at
   1440 and 390 px, the sheet, keyboard on tabs / timeline / sheet, a reload keeps tab + run + sheet, the Live page's
   profile does not touch the URL, no console error, `scrollWidth <= innerWidth` on each view. Stop the server by PID.
5. Gate. Commit `docs: redesign phase 2`.

## After the tasks

Whole-phase review by a fresh agent (spec compliance + quality + "no WCL point spent without a click" + no horizontal
scroll + i18n parity), fixes in a final commit, then the report to the user. No push.
