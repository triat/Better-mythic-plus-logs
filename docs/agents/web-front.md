# Web front (`web/`)

Vite 8 + React 19, TypeScript strict with `verbatimModuleSyntax`. Spec: `docs/superpowers/specs/2026-09-16-web-front-design.md` (screens, data flow, radar geometry, error handling). Built output `web/dist` is embedded into the Bun binary by `src/web-assets.ts`; the fixed asset names (`assets/app.js`, `assets/app.css`) are imported verbatim there — do not change `vite.config.ts` output names without updating that file.

## Rules

- **Types only from `src/`**: `import type { … } from "@shared/…"` via `web/src/types.ts` (re-export hub — add new shared types there). Runtime exception: `src/wow/classes.ts` (class names + colours). Anything else runtime from `src/` breaks the Vite build or drags Bun-only code into the browser.
- **No new runtime dependencies**: only `react` and `react-dom`. No router (screen = derived from tabs/history state in `App.tsx`), no state library, no CSS framework, no component library, no icon package.
- **View models are pure and tested** (`web/src/lib/*.ts` + sibling `*.test.ts`): every non-trivial transformation of `LookupPayload` into something displayable lives there — `verdict.ts` (`AXIS_DESCRIPTIONS`, `AXIS_WEIGHTS`, confidence colours), `axes.ts` (`AxisRowModel`), `radar.ts`, `tiles.ts`, `runs.ts`, `deepdive.ts` (panel model, cost estimate), `compare.ts`, `history.ts`, `keyLevel.ts`, `format.ts`. Components (`web/src/components/*.tsx`) stay thin: map a model to markup, hold local UI state only. Tests must not import React or the DOM (they run under `bun test` from the repo root).
- **Tokens** from `web/src/styles/tokens.css` (`--bg --card --inset --border --text --muted --faint --link --green --yellow --warn --red --orange --button --mono --radius --radius-lg` …). Never a raw hex in a component or in `app.css`; if a new value is genuinely needed, add a token with a comment saying where it came from.
- **English strings only.** Copy is product text: short, factual, no exclamation marks.
- **`App.tsx` owns the payload cache** (`Map<key, LookupPayload>`), the active tab (`activeKey` + `activeKeyRef` to avoid stale closures), `reloadActive` (clear cache entry + refetch after anything that changes a stored result: deep-dive, table edit), and the deep-dive callbacks passed down as `DeepdiveActions` (`Detail.tsx`). Keep server-truth flows server-driven: the watcher toggle reflects the SSE `status` event, history order comes from `GET /api/history`.
- **`api.ts`** is the single fetch wrapper; every call returns `ApiResult<T>` (`{ ok: true, … } | { ok: false, error }`). Handle `ok: false` with a toast (`Toast.tsx`), never with `alert()`.
- **SSE**: one `EventSource("/api/events")` via `useSse` for the app lifetime; reconnect is the browser's job, the header shows the disconnected state.
- **Wowhead tooltips**: `web/index.html` loads `https://wow.zamimg.com/js/tooltips.js`; the `whTooltips` config lives in `web/public/wh-config.js` (served as `/wh-config.js`, embedded as the fourth asset alongside `index.html`/`app.js`/`app.css` — see `src/web-assets.ts`, `src/web-static.ts`), as an external script rather than an inline one so the hosted CSP needs no `'unsafe-inline'` for scripts. Render spell names through `SpellLink.tsx` (`useWowheadRefresh` calls `$WowheadPower.refreshLinks()` after mount). Any new external origin must be justified — the hosted CSP (`src/server/security.ts`) allows `wow.zamimg.com` (scripts, styles, images) and `nether.wowhead.com` (connect) besides self.
- **localStorage** keys are `bmpl.*` (`bmpl.legendOpen`, the "your key" value in `App.tsx`), always wrapped in try/catch, always with a working fallback.
- **Radar**: `viewBox="-70 -5 440 310"`, centre (150,150), R = 110, axis order survival, utility, throughput, consistency, preparation, experience at −90°, −30°, 30°, 90°, 150°, 210°; a `null` axis is drawn hollow at the centre, never as 0.

## Dev loop

```
just serve --no-open      # Bun API on :3000, straight from src/cli.ts (no build needed)
just web-dev              # Vite on :5173 with /api proxied to :3000
bun test web/src          # view-model tests only
bun run --cwd web typecheck
just build                # before testing the embedded UI through ./bmpl serve
```

The compiled binary serves whatever `web/dist` contained at `just build` time; browsers cache `assets/app.js` aggressively (fixed name) — after a rebuild, hard-reload (Ctrl+F5) and kill any older `./bmpl serve` still holding :3000 (`for p in $(pgrep -f '^\./bmpl'); do kill $p; done` — never `pkill -f "bmpl serve"`, it matches your own shell).

## Design first — Claude Design canvas

The user's standing rule: any visible UI change is mocked on the Claude Design canvas before it is coded, and the user picks between variants (A/B/C) there. The canvas artboards live at **https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s** (pages: direction-a, iteration-2, explorations, deep-dive, axis-explainers); their source is checked in under `docs/design/canvas/` (`*.dc.html` + `canvas.json`). To update: copy those files to a scratch dir, add/edit artboards (match `tokens.css` and the existing components pixel for pixel — lift values from `app.css`, never round), add a page in `canvas.json`, seed with the design skill's `seed-canvas.mjs`, republish the same artifact with `contract: "0.1.31"`, favicon 🛡️ and no `capabilities`, then copy the updated sources back into `docs/design/canvas/`. Read the artifact first if it may have been edited in the GUI. Once the user chooses, implement exactly the chosen variant.

## Components map

`Home` (empty state) · `Header` (search form, level/spec/metric, watch toggle, quit) · `Tabs` · `Detail` = `VerdictHero` (verdict, radar, `AxisRows` with expandable "What's measured" callouts, `AxisLegend` under the radar) + `SignalTiles` + `DungeonRuns` (per-run Analyze / `RunDeepDive` panel with table corrections) + `RioSection` · `Compare` (2–3 tabs) · `Setup` (credentials) · `Toast` · `KeyStepper` · `Radar` · `SpellLink`.
