# Web front (Vite + React) — design

**Status:** approved direction (canvas "Direction A"), spec under review; hosted-mode screens (sign-in, user menu, proposal wording) implemented 2026-09-18 — issue #7, canvas page "Hosted"; admin page implemented 2026-09-18 — issue #8, canvas artboards Admin*; audit section 2026-09-18 — issue #9, canvas AdminAudit (A)
**Sub-project:** 3 of the bmpl roadmap (signals → evaluation → **front** → run deep-dive)
**Design canvas:** https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s — page *Direction A* is the reference;
page *Explorations* holds the discarded monospace sketch.
**Depends on:** `2026-09-15-signals-design.md`, `2026-09-15-evaluation-model-design.md`

## Goal

Replace the inline HTML/JS UI in `src/server-ui.ts` with a real front end — Vite + React +
TypeScript under `web/` — that keeps every feature of the current UI, shows the evaluation
**verdict first** (badge, six axes, radar), and still ships inside the single Bun binary that
friends double-click. English everywhere in the UI. No new backend features: the front consumes
the existing `/api/*` routes and the `LookupPayload` JSON exactly as they are today.

## Non-goals

- No hosted/multi-user mode, no auth, no database on the front side.
- No new signals, no evaluation changes, no run deep-dive (sub-project 4).
- No component library, no CSS framework, no router library, no state library. Plain React 19
  + hand-written CSS with the existing Primer-dark tokens.
- No DOM component tests. Pure modules are unit-tested; the server's static serving is
  integration-tested.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Stack | Vite 8, React 19, TypeScript strict, `web/` has its own `package.json` + `tsconfig.json` | User choice ("A"). Isolates DOM types and front deps from the Bun/CLI tree. |
| Embedding | Vite emits **fixed file names** (`index.html`, `assets/app.js`, `assets/app.css`); `src/web-assets.ts` imports the three with `with { type: "file" }` and serves them via `Bun.file()`. `bun build --compile` embeds them. | Hashed names would need a generated manifest; a local tool does not need cache busting (served with `Cache-Control: no-cache`). |
| Routing | SPA. Server returns `index.html` for `GET /`, `GET /setup` and `GET /admin`; the app decides which screen to show from `/api/status`. No client router: `location.pathname` + `history.pushState` for the paths. | Two screens; a router is dead weight. |
| Shared code | The front imports **types only** from `../../src/**` (`import type`). One runtime exception: the new pure module `src/wow/classes.ts` (class id → name, hex color). | Types keep the front honest against `LookupPayload`/`Evaluation`; runtime sharing is limited to a dependency-free table so Vite never pulls Bun/Node code. |
| Visual vocabulary | Direction A: current Primer-dark tokens, cards, 6–10 px radii, `system-ui`, existing verdict badge colors. | User choice ("on garde le vocabulaire actuel"). |
| Language | UI strings in English. | User choice. |
| Old UI | `src/server-ui.ts` is deleted in the same change; `bmpl serve` serves the new front. | One UI, no dual maintenance. |

## Repository layout

```
web/
  package.json            vite, react, react-dom, @vitejs/plugin-react, typescript, @types/react(-dom)
  tsconfig.json           strict, lib dom, jsx react-jsx, paths: "@shared/*" → "../src/*"
  vite.config.ts          plugin-react; build.outDir "dist"; rollup output names fixed (see Build);
                          server.proxy "/api" → http://localhost:3000 (dev only)
  index.html              <div id="root">, <script type="module" src="/src/main.tsx">
  src/
    main.tsx              createRoot + <App/>
    App.tsx               screen switch (Setup | Main), status bootstrap, SSE wiring
    api.ts                typed fetch wrappers for every /api route (single place that knows URLs)
    types.ts              `import type` re-exports: LookupPayload, Evaluation, AxisScore, Verdict,
                          Confidence, MPlusRun, RunSignals, RioProfile, SignalSummary, HistoryItem
    styles/tokens.css     the COMMON_CSS colors as CSS custom properties (see Tokens)
    styles/app.css        layout + components; imports tokens.css
    lib/format.ts         fmtAmount, fmtAge, ageDays, pct, signed, fmtDuration (moved from server-ui)
    lib/radar.ts          pure geometry: axisPoint, polygonPoints, ringPoints (tested)
    lib/verdict.ts        verdict/confidence → label, css class, color (tested)
    lib/history.ts        tab selection rules for compare (max 3, ordering) (tested)
    lib/axes.ts           axis-row view model (top evidence, confidence) (tested)
    lib/tiles.ts          signal tile view model (tested)
    lib/runs.ts           dungeon-run row view model incl. per-run signal parts (tested)
    lib/compare.ts        compare table rows + bestIndices (tested)
    components/
      Header.tsx          search form (character, level, spec, metric), Look up, Refresh,
                          clipboard-watch toggle + status, Quit
      Tabs.tsx            history tab strip: class-colored label, select circle for compare,
                          close ×, "Clear all", compare button (enabled when 2–3 selected)
      Home.tsx            empty state: big search field + two-line hint (canvas "Home")
      Detail.tsx          one character: VerdictHero + SignalTiles + DungeonRuns + RioSection
      VerdictHero.tsx     identity, verdict badge, stats line, AxisRows, Radar
      AxisRows.tsx        six rows [label + confidence dot | score | top evidence]
      Radar.tsx           SVG hexagonal radar, one or more series (canvas "Detail"/"Compare")
      SignalTiles.tsx     tile strip from `summary` (timed, avg deaths, DTPS Δ, kicks Δ, avoidable Δ, ilvl, recent timed, prev season)
      DungeonRuns.tsx     collapsible best-run-per-dungeon rows (level, timed, parse, age, stale flag, per-run signals)
      RioSection.tsx      collapsed Raider.IO block (scores, recent/best runs) or the `rioError`
      Compare.tsx         overlaid radars + pivoted table (canvas "Compare")
      Setup.tsx           WCL client id/secret form → POST /api/setup (canvas "Setup")
      Toast.tsx           transient errors (lookup failed, watch error)
src/
  web-assets.ts           the three `type: "file"` imports + `serveWebAsset(path)` helper
  wow/classes.ts          CLASS_NAMES, CLASS_COLORS (hex), className(id), classColor(id)
  server.ts               static routes replace renderMainPage/renderSetupPage
  format.ts               classNames now re-exported from src/wow/classes.ts (CLI colors unchanged)
test/
  server.test.ts          static serving + SPA fallback + 503 when unbuilt
web/src/lib/*.test.ts     pure module tests, run by the root `bun test`
```

Deleted: `src/server-ui.ts`.

## Build & dev workflow

- `just web-install` → `bun install --cwd web`.
- `just web-dev` → `bun run --cwd web dev` (Vite on :5173, proxies `/api` to a running
  `just serve --no-open` on :3000). SSE works through the proxy (Vite proxies streams).
- `just web-build` → `bun run --cwd web build` → `web/dist/{index.html,assets/app.js,assets/app.css}`.
  `vite.config.ts` fixes the names with `build.rollupOptions.output = { entryFileNames:
  "assets/app.js", assetFileNames: "assets/app.[ext]", chunkFileNames: "assets/[name].js" }`
  and `build.cssCodeSplit = false` (one CSS file). Dynamic imports are not used, so there are no
  chunks.
- `just build` / `just build-windows` / `just build-windows-native` run `web-build` first, then the
  existing `bun build --compile` command. The compile fails loudly if `web/dist` is missing.
- `just check` runs the root `tsc --noEmit` **and** `bun run --cwd web typecheck`.
- Root `tsconfig.json` keeps `include: ["src/**", "test/**"]`; `web/` is typechecked by its own
  config. Root `.gitignore` adds `web/dist/` and `web/node_modules/`.
- `web/dist/` is a build artefact: never committed; CI/release builds it.

## Server changes (`src/server.ts`)

```ts
// src/web-assets.ts
import indexHtml from "../web/dist/index.html" with { type: "file" };
import appJs from "../web/dist/assets/app.js" with { type: "file" };
import appCss from "../web/dist/assets/app.css" with { type: "file" };

const ASSETS: Record<string, { path: string; type: string }> = {
  "/assets/app.js": { path: appJs, type: "text/javascript; charset=utf-8" },
  "/assets/app.css": { path: appCss, type: "text/css; charset=utf-8" },
};
export const INDEX = { path: indexHtml, type: "text/html; charset=utf-8" };

/** Response for a static path, or null when the path is not an asset. */
export async function serveWebAsset(pathname: string): Promise<Response | null>;
```

- `GET /` and `GET /setup` → `index.html` (no more server-side redirect to `/setup`; the app reads
  `/api/status`). `GET /assets/app.js|app.css` → the file. All three: `Cache-Control: no-cache`.
- `server.ts` never imports `web-assets.ts` statically. It loads it once, lazily, through a
  guarded dynamic import: `try { assets = await import("./web-assets.ts") } catch { assets = null }`.
  When `web/dist` is not built (dev tree, `bun test`), the resolve error is caught and every
  static route answers `503` with the plain-text body `web UI not built — run: just web-build`;
  the `/api/*` routes keep working. **Verified on Bun 1.3.4** (probe in the design session):
  static `with { type: "file" }` imports inside `web-assets.ts` are embedded by
  `bun build --compile` even when reached through the dynamic import; compiling with `web/dist`
  missing fails with `Could not resolve` (desired); a *dynamic* import that itself carries
  `with { type: "file" }` must NOT be used — it bundles but throws
  `ReferenceError: require_dist is not defined` in the compiled binary.
- Every `/api/*` route is untouched. `Response.redirect("/setup")` and the two `render*Page`
  imports go away.

## API contract consumed (unchanged, listed for the front)

| Route | Request | Response used by the front |
|---|---|---|
| `GET /api/status` | — | `{ ok, hasCredentials, envPath }` |
| `POST /api/setup` | `{ clientId, clientSecret }` | `{ ok, envPath }` or `{ ok:false, error }` |
| `POST /api/lookup` | `{ character, level?, spec?, metric?, refresh? }` | `{ ok, result: LookupPayload, key, fromCache }` or `{ ok:false, error }` (4xx/5xx) |
| `GET /api/history` | — | `{ ok, items: HistoryItem[] }` — `HistoryItem = { key, label, charClass, spec, targetLevel, targetAutoDetected, fetchedAt, request }` |
| `GET /api/history/:key` | — | `{ ok, result: LookupPayload, key, fromCache:true }` |
| `DELETE /api/history[/:key]` | — | `{ ok }` |
| `GET /api/events` (SSE) | — | events `status {active, opts, backend}`, `searching {character}`, `result {key, fromCache}`, `error {message, character}` |
| `POST /api/watch/start` | `{ level?, spec?, metric? }` | `{ ok, active, opts }` or `{ ok:false, error }` |
| `POST /api/watch/stop` | — | `{ ok, active:false }` |
| `GET /api/watch/status` | — | `{ ok, active, opts, backend }` |
| `POST /api/quit` | — | `{ ok }` |

`LookupPayload` (from `src/lookup.ts`) fields the front reads: `character{name, realmSlug, region,
classID, …}`, `zone`, `metric`, `metricAutoSelected`, `alternateMetricHasData`, `specFilter`,
`runsIndexed`, `seasonDungeons`, `targetLevel`, `targetAutoDetected`, `atOrAboveTargetCount`,
`prevLevelBest`, `perDungeon{runs[], dungeonsCovered, totalDungeonsInSeason, dungeonsAtOrAboveTarget,
medianLevel, medianAmount, medianParse}`, `rio`, `rioError`, `summary`, `evaluation`.
`web/src/types.ts` re-exports these with `import type` so any backend rename breaks the front's
typecheck rather than its runtime.

## Tokens (`web/src/styles/tokens.css`)

Lifted verbatim from the current `COMMON_CSS`; the mockups use the same values.

```
--bg #0d1117  --card #161b22  --border #30363d  --border-soft #21262d
--text #e6edf3  --muted #8b949e  --faint #6e7681  --link #58a6ff
--green #56d364  --green-bg #0a2e1a  --green-border #1f6f3a
--yellow #e3b341  --yellow-bg #2e2a0a  --yellow-border #7a6a1f
--red #f85149  --red-bg #2e0a0a  --red-border #7a1f1f
--orange #ffa657  --button #238636  --mono ui-monospace, SFMono-Regular, Menlo, monospace
--radius 6px  --radius-lg 10px
```

Class colors come from `src/wow/classes.ts` (standard WoW palette, e.g. Priest `#ffffff`,
Paladin `#f48cba`, Death Knight `#c41e3a`, …) and are applied inline (`style={{color}}`).

## Screens

All screens: header on top (search form, clipboard-watch toggle, Quit), then the tab strip,
then the content area. Width fluid, min 960 px; the canvas frames are 1440 px.

### Home (`Home.tsx`) — no history

Big centered search (character `Name-Realm`, optional level, optional spec, metric select
`auto/dps/hps`), the hint "Paste a Raider.IO URL or Name-Realm · Ctrl+V anywhere works when
clipboard watch is on", and a one-line note showing the WCL credentials source (`envPath`).

### Detail (`Detail.tsx`) — one active tab

1. **VerdictHero** (card):
   - left: name (class color) + realm/region, spec + role, "Target +N (auto-detected)" chip
     (the "fetched · cached" line and the Refresh button live in the tab strip, next to Compare).
   - center: verdict badge `INVITE 78` / `MAYBE 52` / `PASS 31` (existing badge classes), sub-line
     `for a +21 · 9 runs scored · confidence per axis` (`evaluation.targetLevel`,
     `evaluation.runsUsed`). When `evaluation.verdict === "insufficient"` the badge reads
     `NOT ENOUGH DATA` (muted style, score omitted) and the sub-line reads
     `only N run(s) scored` — the threshold lives in the server config and is not repeated
     in the front.
   - six **AxisRows**: `[confidence dot + label | score or n/a | strongest evidence label + signed delta]`.
     Confidence dot: high = green, medium = yellow, low = red, null axis = hollow. Evidence =
     the entry of `axis.evidence` with the largest `|delta|`; delta rendered as a signed integer `+18` / `−6`
     in mono (as in the mockups). Row click expands all evidence entries for that axis (a `<details>`-like toggle).
   - right: **Radar** with one series in the class color.
2. **SignalTiles**: same tiles as today's summary strip (`summary.*`), null → `—`. Deltas are
   colored by sign with the same rules as `renderSummaryLine` (DTPS/avoidable lower is better,
   kicks higher is better).
3. **DungeonRuns**: "Best run per dungeon" list, one row per `perDungeon.runs` entry:
   dungeon name, `+level` (orange), timed ✓ / depleted ✗, parse % (percentile color classes
   kept: ≥95 legendary, ≥75 magenta, ≥50 blue, ≥25 green, else grey), amount + metric, age,
   `stale` chip when age ≥ 14 days, WCL report link. Row expands to the per-run signals block
   (deaths with wipe tag, DTPS vs peers, kicks usage, dispels, avoidable vs peers, consumables) —
   same numbers as `renderRunSignals`.
   Dungeons of the season with no run are listed at the bottom, muted: `no run indexed`.
   Metric note when `metricAutoSelected && alternateMetricHasData`: "auto-selected; the other
   metric has data too".
4. **RioSection** (collapsed by default): current season score, recent-run count with timed
   count and last-run age, the last 10 recent runs; or `rioError` text in muted red when `rio`
   is null.

### Compare (`Compare.tsx`) — 2 or 3 tabs selected

- Left card: **Radar** with one series per character, each in its class color, legend under it.
- Right card: pivoted table. Header row = names (class color) + verdict badge under each.
  Rows: Score, the six axes, then the compare rows the current UI already has (target level,
  runs indexed, dungeons at/above target, median level/parse, avg deaths, DTPS Δ, kicks Δ,
  avoidable Δ, ilvl, recent timed, prev season). Per row, the best value cell gets the green
  highlight (`lib/compare.ts` exposes `bestIndices(values, mode)`; `n/a`/null never wins;
  ties highlight all tied cells; a row where every character has the same value highlights
  nothing).
- Selection rules (`lib/history.ts`): selecting a 4th tab deselects the oldest selection; a
  closed tab is removed from the selection; "Compare" button enabled only for 2–3.

### Setup (`Setup.tsx`)

Shown when `/api/status` says `hasCredentials:false`, or on `/setup`. Card with client id +
secret fields, the `.env` path hint, "Save & continue". On success → `/`. Server error text shown
inline.

## Data flow

- `App` boots: `GET /api/status` → Setup or Main. Main then `GET /api/history` and opens the
  most recent tab if any, else Home.
- Lookup: header form → `POST /api/lookup` → on `ok`, refetch `/api/history` (server owns the
  order/limit), set the active tab to `key`, render `result`. Results are cached client-side
  in a `Map<key, LookupPayload>`; a tab click uses the cache or `GET /api/history/:key`.
- Refresh: `POST /api/lookup` with the active tab's `request` + `refresh:true`.
- SSE: one `EventSource("/api/events")` for the app lifetime. `status` → watch toggle state +
  label; `searching` → spinner in the header with the character; `result` → fetch
  `/api/history/:key`, activate the tab; `error` → toast. On `EventSource` error the header
  shows "live updates disconnected" until it reconnects (browser auto-retry).
- Watch toggle: `POST /api/watch/start` with the header's current level/spec/metric, or
  `/api/watch/stop`. The toggle reflects the server's `status` event, not the click.
- Quit: `POST /api/quit`, then replace the page with "bmpl stopped — you can close this tab".

## Radar (`lib/radar.ts` + `Radar.tsx`)

- `viewBox -70 -5 440 310` (labels need side room; inline SVG clips), center `(150,150)`, `R = 110`. Axis order fixed:
  survival, utility, throughput, consistency, preparation, experience; angles
  `-90°, -30°, 30°, 90°, 150°, 210°`.
- `axisPoint(i, score)` → `(150 + R·score/100·cos θ, 150 + R·score/100·sin θ)`, rounded to 1
  decimal. Rings at 25/50/75/100 as hexagons through `axisPoint(i, ring)`.
- A `null` axis score contributes the **center point** to the polygon and is drawn as a hollow
  circle (r 4, stroke series color, fill `--card`) at the center; its label carries `n/a`.
  Never plotted as 0.
- Series: `{ points: (number|null)[6], color, label }`. Fill `color` at 14 % opacity, stroke
  2 px, `stroke-linejoin round`; vertices as 3.5 px dots. Labels outside the outer ring at
  `R + 22`, `text-anchor` by quadrant, font 11 px uppercase muted; the single-series detail radar
  appends the score to each label (as in the approved canvas); the compare radar shows labels only.
- Tests (`lib/radar.test.ts`): the six angles; `axisPoint(0,100) = (150,40)`;
  `axisPoint(1,61) = (208.1,116.5)`; a null score maps to `(150,150)`; `polygonPoints` string
  for the canvas sample `[82,61,88,null,55,74]` equals
  `150,59.8 208.1,116.5 233.8,198.4 150,150 97.6,180.3 79.5,109.3`.

## Error handling

- Every `api.ts` wrapper returns `{ ok:true, … } | { ok:false, error: string }` — never throws
  on HTTP errors; network failures become `{ ok:false, error: "Network error" }`.
- Lookup errors → toast (5 s, dismissible) and the form stays filled.
- Malformed history entry (e.g. server restarted, key gone → 404) → the tab is dropped and
  `/api/history` refetched.
- Any component rendering a payload guards `evaluation`/`summary`/`rio` for `null` — the
  payload shapes allow it and the old UI already did.

## Tests

- `web/src/lib/radar.test.ts`, `format.test.ts`, `verdict.test.ts`, `history.test.ts` —
  `bun test` from the root discovers them; they import nothing from the DOM.
- `test/server.test.ts`: starts `runServer` on port 0 with a temporary `web/dist` fixture
  (three tiny files written by the test) and asserts: `GET /` and `GET /setup` return the HTML
  with `no-cache`; `GET /assets/app.js` returns the JS with the JS content type; `GET /nope`
  is 404; with the fixture removed, `GET /` is 503 with the "not built" message. `runServer`
  gains an optional `assets` loader override (`() => Promise<{ index, appJs, appCss } | null>`)
  for this test — the default is the lazily imported `web-assets.ts` — and returns the Bun
  server so the test can read `server.port` and stop it.
- Existing tests keep passing; `test/format.test.ts` is unaffected (CLI rendering stays).
- Manual check before merge: `just web-build && just build && ./bmpl serve` renders the four
  screens from a real lookup; `just web-dev` hot-reloads against `just serve --no-open`.

## Docs

- README: new "Web UI" section (screens, `just web-dev`, `just web-build`, build order, dev
  proxy), the `web/` layout, and the "types-only import" rule. Remove mentions of the inline UI.
- justfile recipe comments updated for the new recipes.

## Out of scope / follow-ups

- Run deep-dive (defensive cooldown efficiency) — sub-project 4; the DungeonRuns row already
  has the slot for it (expandable row).
- Persisting history across restarts (server-side, later).
- Light theme, keyboard shortcuts beyond Enter-to-search, mobile layout.
- Hosted mode (auth, multi-user, rate-limit pooling).
