# Self-review: five pillars, three views, a season of runs — design

Status: approved 2026-10-09 (sync needs the member's own WCL client; points to work on against both
references). Visual variants on the design canvas, page "self-review". Open question 1 still open.

## Goal

Turn bmpl from "vet a stranger" into "see how I play and whether I improve", without losing the
first use: the same engine describes any character, the focus moves to the member's own.

A player must be able to answer, in a few seconds and then in as much detail as they want:

- **Globally:** what should I work on first?
- **Over time:** am I getting better, on what?
- **Per dungeon:** which dungeon gives me trouble, and why there?
- **Per key:** what happened in this run?

The questions are always the same five things (the user's wording, 2026-10-09): do a maximum of
useful damage, do not die, avoid needless damage, interrupt, control.

## Non-goals

- No change to the verdict, curves or weights in phase 1 (no recalibration): the pillars regroup the
  existing sub-signals; scores stay what they are.
- No data that is not in Warcraft Logs: a run that was not logged, or not ranked, does not exist for
  bmpl. The tool says so rather than guessing.
- No coaching text written by a model. Every sentence comes from a measured number and a template.
- No live data during a key (the in-game addon stays the Live panel's).

## Vocabulary: the five pillars

The six axes become five pillars plus a context panel. Phase 1 maps every existing sub-signal; nothing
is dropped, nothing is re-weighted.

| Pillar | Phase 1 (existing sub-signals) | Added at 0 WCL pts (already in the cached run) | Later phase |
|---|---|---|---|
| **Damage** | `medianParse`, `parseAtTarget` | — | Phase 3: useful damage (share on priority targets) |
| **Survival** | `individualDeaths`, `wipeDeaths`, `groupDeaths` (healers), `defensiveUsage`, `avoidableDeaths` (deep-dive) | The three killing hits of every death (Deaths table) | — |
| **Avoidable damage** | `avoidableVsPeers`, `dtpsVsPeers` | Which avoidable abilities hit the player, per dungeon (`abilities[]` of the avoidable DamageTaken table) | — |
| **Interrupts** | `kicksVsPeers`, `kicksAbsolute` | Enemy casts that went through, per spell (`spellsCompleted` of the Interrupts table), shown as group context | — |
| **Control** | `dispels` | — | Phase 2: crowd control (stuns, incapacitates, knock-backs) |

**Context** (shown, not a pillar): preparation (`potions`, `healthstones`, `ilvlVsLevel`),
consistency (`parseSpread`, `deathsSpread`, `damageSpread`) and experience (`coverage`, `atTarget`,
`medianVsTarget`, `activity`). They keep their current weight in the global score (0 for consistency
and experience, as today).

A pillar's score is the weighted mean of its sub-signals with today's curves and weights, the same
computation `scoreAxis` does for an axis. The global score and the verdict are unchanged in phase 1.

## Decisions

1. **"Me" is one or more characters linked to the account.** Hosted: `user_settings.characters`
   (up to 5 `{ name, realm, region }`), set from the result page ("This is me") or Settings. Local
   mode: the same list in `localStorage`. The home page opens on the member's main character when one
   is set.

2. **A season of runs per character.** A new table keeps every run WCL's rankings return for a
   character this season (`character_runs`: region, character, encounter, report code, fight id,
   start time, key level, timed, parse, amount, spec, score, discovered at). The raw run reports stay
   in `wcl_run_raw`, cached forever as today; per-run signals are recomputed from them on read (pure,
   0 pts). Kept for the season; revisited if size or speed becomes a problem.

3. **Sync is explicit, shows its cost and needs the member's own WCL client** (user's choice,
   2026-10-09). "Sync my season" fetches the rankings (~20 pts) and enriches every run not yet cached
   (~10 pts each), newest first, then the view reads everything from the cache. The button states the
   estimate before spending ("142 runs, 118 not cached, ~1 200 pts"). It runs through the member's own
   client (`runWithWclClient`), so it never touches the shared budget or the hourly quota; without an
   own client the button is replaced by the guide to add one. Local mode uses the CLI's own
   credentials. A normal lookup of another player keeps today's cost (best run per dungeon); "Load full
   season" is the same explicit sync for anyone, under the same rule.

4. **Three views on one page.** The result page gets three tabs, the same for the member and for
   anyone looked up:
   - **Overview:** the five pillars, each with a score, a trend arrow and one sentence; above them,
     the two or three points to work on first, against two references shown side by side (user's
     choice, 2026-10-09): the average player (the calibration median, the "What makes this score"
     logic already shipped) and the player's own past (their median of the four previous weeks).
     The average player leads the ranking; the own-past column says "better / same / worse".
   - **Dungeons:** a grid dungeon × pillar (score per cell, coloured), sorted by the worst dungeon;
     a dungeon opens its detail: the abilities that hit the player there, what killed them, the casts
     that went through, the runs.
   - **Runs:** today's run list, every run of the season once synced, each run opening its detail
     (today's row and deep-dive, plus the killing hits and avoidable abilities).

5. **Trend by game week.** Runs are bucketed by the region's weekly reset (Wednesday in EU, Tuesday in
   US; the exact UTC hours are to be confirmed against Blizzard before coding, not taken from memory). A pillar's weekly value is the median of its per-run scores; the
   trend compares the last two weeks with the four before. Fewer than 3 runs in a window: "not enough
   runs" instead of an arrow.

6. **Simple first, detail on demand.** Every number opens what it is made of, down to the run, the
   timestamp and the Warcraft Logs link. Wording stays template-based and short; the help page explains
   each pillar the way it explains the axes today.

7. **Same engine for others.** Looking up a candidate shows the same three tabs. The verdict
   (INVITE / MAYBE / PASS) stays where it is, computed exactly as today.

## Phases

1. **Pillars and views from what exists.** The pillar regrouping, the three tabs, "me", the season
   store and sync, weekly trends, and the details already in cache (killing hits, avoidable abilities,
   casts that went through). No new WCL query type.
2. **Control.** A crowd-control spell table per class/spec (versioned season data like
   `defensives.json`, validated with an audit script), one more WCL query per run, and the Control
   pillar's CC sub-signals. Needs its own spec for the curves.
3. **Useful damage.** Damage done per target and a priority-target list per dungeon (season data like
   the avoidable list). The hardest part: the definition of "useful" must be agreed per dungeon before
   any code. Needs its own spec.

## Data flow (phase 1)

```
lookup / sync ──► WCL rankings (~20 pts) ──► character_runs (season)
                                     └──► enrich uncached runs (~10 pts each) ──► wcl_run_raw (forever)
read (0 pts) ──► character_runs + wcl_run_raw ──► per-run signals ──► pillar scores per run
                     ├──► Overview: pillars, trend, points to work on
                     ├──► Dungeons: dungeon × pillar grid + details
                     └──► Runs: every run + its details
```

## Error handling

- A sync interrupted by a quota refusal or a WCL error keeps what it fetched and resumes from there.
- A run whose raw report is missing (not yet synced) shows its ranking data and "not analysed".
- A pillar with no data (no dispel for the spec, no avoidable list for the dungeon) is `n/a` with the
  reason, never 0, as today.

## Tests

- Pillar mapping: every sub-signal belongs to exactly one pillar or to context; pillar scores equal
  `scoreAxis` over the same sub-signals.
- Season store: upsert of discovered runs, idempotent sync, resume after a refusal, cost estimate.
- Weekly buckets per region, trend thresholds, "not enough runs".
- Dungeon grid and details from fixtures (killing hits, avoidable abilities, completed casts).
- View models for the three tabs, English and French.

## Open questions

1. **What WCL returns.** Whether `encounterRankings(byBracket: true)` lists every ranked run of the
   season or only the best per key level is not stated anywhere in the repo. One real query settles it
   (~20 pts); it needs WCL credentials in the environment. If only the best per level comes back, the
   season history is partial and the views must say so.
Settled 2026-10-09: sync needs the member's own WCL client (decision 3); points to work on show
both references (decision 4).

## Out of scope

- Comparing two members' progress.
- Goals and reminders ("keep avoidable damage under X").
- Notifications when a new run is logged.
