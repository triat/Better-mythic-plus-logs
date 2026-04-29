# Profile summary tiles — design

## Goal

Make the single-character profile view (one tab active, no compare) answer
one question at a glance: *do I want to play with this character?*

The current view spends a whole section on "Target key level" + "Best run at
previous level", which duplicates info already visible in the per-dungeon
list and pushes the at-a-glance signals (median key, parse %, deaths,
DPS-vs-peers) below the fold.

This change moves those signals into the char-card itself as a compact row
of stat tiles, and drops the "Target key level" section entirely.

## Changes

### Removed

- The whole `<div class="section">` block titled `Target key level: +X`,
  including:
  - The `✓ has N run(s) at or above +X` banner.
  - The "Best run at previous level (+Y)" sub-block and its single `runRow`.
  - The fallback messages (`no runs at all`, `no runs below +X`).

The target level is still visible (as a tile) and the prev-level best run
is still reachable via the existing per-dungeon list and the WCL link on
each row.

### Added — stat tiles in `.char-card`

A horizontal row of tiles, placed inside `.char-card` after the existing
`.metaline` (zone / metric / runs indexed). Tiles wrap onto a second line
on narrow widths.

Tile order, label, value, highlight:

| # | Label              | Value                                                     | Color rule                                                        |
|---|--------------------|-----------------------------------------------------------|-------------------------------------------------------------------|
| 1 | Target             | `+{targetLevel}` + `auto` chip if `targetAutoDetected`     | neutral                                                           |
| 2 | Median key         | `+{perDungeon.medianLevel}`                                | neutral (orange like other key levels)                            |
| 3 | Median parse       | `{perDungeon.medianParse.toFixed(1)}%`                     | percentile class (`pclass()` — same as run rows)                  |
| 4 | Donjons couverts   | `{dungeonsCovered}/{totalDungeonsInSeason}`                | green if `==total`, else neutral                                  |
| 5 | Donjons ≥ target   | `{dungeonsAtOrAboveTarget}/{totalDungeonsInSeason}`        | green if `==total`, orange if `>0`, neutral if `0`                |
| 6 | Σ deaths           | sum of `r.quality.deaths` over displayed runs              | `deaths-0` / `deaths-low` / `deaths-high` (existing classes)      |
| 7 | Δ DTPS vs peers    | median `(dtps - peerMedianDtps) / peerMedianDtps * 100`    | `dtpsDeltaCls()` (existing helper)                                |

"Displayed runs" for tiles 6 and 7 = the same set used by
`summaryStatsFromPayload` in compare mode: `prevLevelBest.best` (if any) +
each `perDungeon.runs[i]`. Reuse `summaryStatsFromPayload` directly so the
profile and compare view stay in sync.

If a tile has no data:

- Tile 6 / 7: render `—` in the dim style (mirrors the compare table).
- Tile 2 / 3 / 4 / 5: when `perDungeon.runs.length === 0`, hide tiles 2–7
  entirely and show a single dim line "No M+ runs indexed this season"
  inside the card. Tile 1 (Target) still renders.

### Untouched

- Char-card header (name / spec / class / score / region+server rank /
  zone+metric+runs-indexed metaline).
- "Best run per dungeon" section (full list of runs).
- The compare view and its `summaryStatsFromPayload` helper — only the
  single-tab profile view is affected.

## Visual style

A flat tile row, not a card grid:

- Container: `display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem`.
- Each tile: `padding: .4rem .65rem; background: #0b0f14;
  border: 1px solid #21262d; border-radius: 6px;` with the label in a
  small dim uppercase style above the value, value in the main color.
- Reuse existing color classes (`p-*`, `deaths-*`, `dtps-*`, class colors,
  `.dim`, `.warn`) — no new color tokens.

Mock (one row, ~7 tiles, wraps on narrow):

```
[ TARGET    ] [ MEDIAN KEY ] [ MEDIAN PARSE ] [ DUNGEONS  ] [ ≥ TARGET ] [ DEATHS ] [ Δ DTPS VS PEERS ]
   +12         +11             78.5%             7/8           5/8           3          +12%
```

## Implementation notes

- All edits in `src/server-ui.ts`. No payload / API changes.
- Reuse `summaryStatsFromPayload` from `render()` — it's a function
  declaration so it's already hoisted into the script's scope; no move
  needed.
- New CSS rules under the existing `.char-card` block in `COMMON_CSS`.
- No new dependencies.

## Out of scope

- Layout for ultra-narrow (mobile) widths beyond `flex-wrap`.
- Tooltips on tiles.
- Sparkline / trend indicators.
- Changes to compare view or per-dungeon list.
