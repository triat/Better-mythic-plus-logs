# Compare up to 3 characters — design

## Goal

Let the user pick 2 or 3 open tabs in the web UI and see a detailed
side-by-side comparison view, instead of the current short summary that
spans every open tab.

The detailed view is laid out as a pivoted table: characters as columns,
metrics as rows, so a Mythic+ key applicant decision boils down to scanning
each row and seeing who is best where.

## User flow

1. User runs `bmpl serve` and looks up several characters. Each lookup adds
   a tab.
2. Each tab shows a small selectable circle to the left of the character
   name. Clicking the circle toggles selection. Clicking the rest of the
   tab still switches to that tab's detail view (existing behavior).
3. The toolbar button `Compare all tabs` is replaced by
   `Compare selected (N/3)`:
   - Disabled (grey) when fewer than 2 tabs are selected.
   - Active (green) when 2 or 3 are selected.
4. If the user tries to select a 4th tab, the click is ignored and the
   counter button briefly flashes orange. No modal, no alert.
5. Clicking the active button renders the detailed compare table in the
   `#compare` section, hiding `#result`.
6. Clicking any tab in the tab bar closes the compare view and shows that
   tab's detail (existing behavior).
7. Closing a tab removes it from the current selection. If the selection
   drops below 2 while the compare view is open, the compare view closes
   and the active tab's detail view is shown.

Selection state lives only in JS memory. Reloading the page clears it.
The list of tabs themselves is unchanged and still survives a reload via
the existing `/api/history` endpoint.

## Detailed compare view

### Header row

One column per selected character (2 or 3 columns), plus a fixed
left-most label column (~14 rem) that holds metric names. Each character
header cell renders a mini char-card:

- Class-colored character name (clickable — switches to that tab's detail).
- Spec name + class label.
- Score (M+ rating points).
- Region rank.

### Summary block (rows)

| Row label | Source | Highlight rule |
|---|---|---|
| Target level | `payload.targetLevel` (+ `auto` if `targetAutoDetected`) | none (informative) |
| Donjons couverts | `payload.perDungeon.dungeonsCovered` / `totalDungeonsInSeason` | higher better |
| Donjons ≥ target | `payload.perDungeon.dungeonsAtOrAboveTarget` / `totalDungeonsInSeason` | higher better |
| Median key level | `payload.perDungeon.medianLevel` | higher better |
| Median parse % | `payload.perDungeon.medianParse` | higher better |
| Σ deaths (sur runs affichés) | sum of `r.quality.deaths` across `prevLevelBest.best` + each `perDungeon.runs[i]` | lower better |
| Median Δ DTPS vs peers | median of `(r.quality.dtps - r.quality.peerMedianDtps) / r.quality.peerMedianDtps * 100` across the same displayed runs that have a `peerMedianDtps` | lower better |
| Best run prev-level | `prevLevelBest`: `+lvl · parse%` (parse colorized) | higher parse better |

Helper `summaryStatsFromPayload(payload)` returns these values as a flat
object, isolated as one named JS function in the script block.

### Per-dungeon block (rows)

One row per dungeon in the season (`payload.seasonDungeons` — same for
all 3 payloads since they share the season; the first non-empty one is
used). Rows where no selected character has a run for that dungeon are
hidden, so the block has at most 8 rows but can have fewer.

For each character cell in a dungeon row:

- If the character has no run for that dungeon: render `—` in dim grey.
- Otherwise render: `+lvl · parse% · Nd · Δdtps%`
  - `+lvl`: orange like the existing `.run .level`.
  - `parse%`: colorized via `pclass()` (existing `p-legendary` … `p-gray`).
  - `Nd`: deaths count, colorized via `deathsCls()` (existing
    `deaths-0` / `deaths-low` / `deaths-high`).
  - `Δdtps%`: percent vs peer median, colorized via `dtpsDeltaCls()`
    (existing thresholds: ≤-10 green, ±10 neutral, ≤30 yellow, >30 red).
    Hidden if no `peerMedianDtps` (e.g. tank with no peer baseline).

Highlight rule for a dungeon row: the cell with the **highest parse %**
gets the `cell-best` class. Ties highlight all winners.

### Highlighting

A `cell-best` class adds a subtle dark-green background (or left border)
to the winning cell of each row that has a `higher`/`lower` rule.
`none` rows (informative-only, e.g. target level) get no highlight.

### Footer note

Small dim line under the table (kept from the existing compare view):
> "Σ deaths and median Δ DTPS computed across displayed runs (prev-level
> best + per-dungeon bests)."

## Implementation

All changes happen in `src/server-ui.ts`. No new server endpoints, no
shared TS types between server and client, no new files.

### State

```js
let selectedKeys = new Set();
const MAX_COMPARE = 3;
```

### Tab DOM (renderTabs)

Each tab gains a `<span class="tab-check">` to the left of `tab-title`:

```html
<button class="tab [active]" data-key="…">
  <span class="tab-check [checked]" data-toggle="…"></span>
  <span class="tab-title …">Name · Cls</span>
  <span class="tab-sub">+lvl · spec</span>
  <span class="tab-close" data-close="…">×</span>
</button>
```

`tabsEl` click handler gains a `data-toggle` branch (placed before
`data-close` and the existing tab-body branch) that calls
`toggleSelect(key)` and stops propagation.

### New functions

- `toggleSelect(key)` — flips membership in `selectedKeys`. If size would
  exceed `MAX_COMPARE`, calls `flashCounterLimit()` and returns. Always
  calls `renderTabs()` and `updateCompareButton()` after a change.
- `updateCompareButton()` — sets text `Compare selected (N/3)` and
  `disabled` flag based on `selectedKeys.size >= 2`.
- `flashCounterLimit()` — adds `flash-warn` class on the compare button
  for 600 ms via `setTimeout`.
- `summaryStatsFromPayload(payload)` — returns the summary-block values
  for one character (see table above).
- `findRunForDungeon(payload, encounterID)` — returns the matching run
  in `payload.perDungeon.runs` or `null`.
- `highlightBest(values, mode)` — given an array and `'higher'|'lower'`,
  returns an array of indices (one per `values` entry) that tie for the
  best, ignoring `null`/`undefined`. Returns `[]` for `mode === 'none'`
  or when all values are missing.
- `renderCompareTable(rows)` — builds the full table HTML from the
  fetched payloads.

### Modified functions

- `closeTab(key)` — calls `selectedKeys.delete(key)` after the DELETE.
  Also: if compare view is currently open and `selectedKeys.size < 2`,
  hide `#compare`, show `#result`, and re-render the active tab if any.
- `clearAllTabs()` — calls `selectedKeys.clear()`.
- `openCompare()` — replaced. Reads `[...selectedKeys]`, fetches the
  payloads via `/api/history/<key>` in parallel, and calls
  `renderCompareTable()`.

### Removed code

The current `openCompare()` body (the 8-column summary table) is removed
entirely. The new detailed table is the only compare mode.

### CSS additions

- `.tab-check` — 14×14 circle, grey border, vertically centered.
- `.tab-check.checked` — filled blue with a white check (CSS pseudo or
  inline SVG).
- `.compare-detail` — table styles for the new pivoted table:
  fixed-width left label column, equal-width character columns,
  alternating row backgrounds optional.
- `.cell-best` — subtle green background tint (`#0a2e1a` or similar)
  for winning cells.
- `.flash-warn` — `@keyframes` orange flash, 600 ms, applied via
  temporary class on the button.

## Edge cases

- **2 selected vs 3 selected**: same code path, table just has 2
  character columns instead of 3.
- **Dungeon covered by zero selected characters**: row hidden.
- **`prevLevelBest` missing on one character**: cell shows `—`, row
  highlight ignores that index.
- **`quality` missing on a run** (e.g. lookup ran with `--no-stats`):
  deaths and Δdtps cells in that dungeon row show `—`. The character is
  still shown.
- **Mixed roles** (1 healer + 2 dps, etc.): values render unmodified.
  Score, parse %, key level remain comparable. Δdtps comparison is
  meaningless across roles — accepted; user chose who to compare.
- **Refresh of a selected tab**: tab key is stable across refresh
  (`character+level+spec+metric`), so selection survives.
- **Tab closed while compare view open**: see "User flow" step 7.

## Verification (manual)

No automated tests exist in this project; verify the feature by hand:

1. Look up 3 characters. Click each tab's check circle → compare button
   reads `(3/3)`, becomes active.
2. Click compare → detailed table renders with 3 character columns,
   summary rows highlight winners, per-dungeon rows render.
3. Click a 4th tab's check circle → counter flashes orange, no add.
4. Uncheck one → button reads `(2/3)`, still active. Click again → table
   re-renders with 2 columns.
5. Uncheck a second → button disabled, compare view closes if open.
6. Close a selected tab → tab disappears from selection. If selection
   drops below 2 with compare view open, view closes.
7. Run one of the lookups with `--no-stats` (or via a code path that
   skips quality enrichment). Verify deaths and Δdtps cells render `—`.
8. Reload page → selection empty, tabs preserved.

## Out of scope

- CLI `bmpl compare A B C` command.
- Server endpoint `/api/compare`.
- Persisting selection across page reloads.
- Comparing more than 3 characters at once.
- CSV/image export of the compare table.
- Per-encounter diff drilldown (e.g. fight-by-fight breakdown for one
  dungeon across the 3 characters).

## Files touched

- `src/server-ui.ts` only.
