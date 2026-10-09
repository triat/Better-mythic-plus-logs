# Self-review: five pillars, three views, a season of runs — design

Status: approved 2026-10-09 (sync needs the member's own WCL client; points to work on against both
references). Canvas page "self-review": variants A + C chosen 2026-10-09 (decision 4). Open
question 1 settled 2026-10-09; the other WCL-dependent items are tracked in GitHub issue #24.
Amended 2026-10-09: a personal page (decision 8), manual characters until Battle.net linking
(decision 1), the phase-1 numbers (section "Numbers"), open question 2.

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
   (up to 5 `{ name, realm, region, source }`), local mode: the same list in `localStorage`. In phase 1
   every entry is `source: "manual"`, added from the result page ("This is me") or the personal page
   (decision 8); a manual entry proves nothing, so nothing is restricted on it. Linking a Battle.net
   account (`wow.profile` scope, `GET /profile/user/wow`) imports the account's characters as
   `source: "bnet"` and is its own step with its own spec (user's choice, 2026-10-09); once it ships,
   hosted members can no longer add characters by hand (local mode, which has no account, keeps the
   manual list). The first character of the list is the main one: the header links to it, and the home
   page offers to open it (from history at 0 pts; never an automatic lookup, which would spend points).

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

4. **Three views on one page** (canvas variants A + C, user's choice 2026-10-09: A's tabs and Overview,
   C's dungeon-first layout as the Dungeons tab). The result page gets three tabs, the same for the member and for
   anyone looked up:
   - **Overview:** the five pillars, each with a score, a trend arrow and one sentence; above them,
     the two or three points to work on first, against two references shown side by side (user's
     choice, 2026-10-09): the average player (the calibration median, the "What makes this score"
     logic already shipped) and the player's own past (their median of the four previous weeks).
     The average player leads the ranking; the own-past column says "better / same / worse".
   - **Dungeons:** variant C's layout inside A's tab: a grid dungeon × pillar (score per cell,
     coloured), its header row the season's pillar scores with their trend, rows sorted by the worst
     dungeon; a dungeon opens its detail in a panel on the right: the abilities that hit the player
     there, what killed them, the casts that went through, a link to its runs.
   - **Runs:** today's run list, every run of the season once synced, each run opening its detail
     (today's row and deep-dive, plus the killing hits and avoidable abilities).

5. **Trend by game week.** Runs are bucketed by the region's weekly reset. Boundaries, from Raider.IO's
   `GET /api/v1/periods` (Blizzard's Mythic+ periods as Raider.IO serves them; captured 2026-10-09, not
   a Blizzard page): US Tuesday 15:00 UTC, EU Wednesday 04:00 UTC, KR and TW Wednesday 23:00 UTC. They
   are taken as fixed in UTC; a daylight-saving shift on Blizzard's side would misplace the runs of
   one hour, accepted. A pillar's weekly value is the median of its per-run scores; the trend compares
   the last two weeks with the four before. Fewer than 3 runs in a window: "not enough runs" instead of
   an arrow.

6. **Simple first, detail on demand.** Every number opens what it is made of, down to the run, the
   timestamp and the Warcraft Logs link. Wording stays template-based and short; the help page explains
   each pillar the way it explains the axes today.

7. **Same engine for others.** Looking up a candidate shows the same three tabs. The verdict
   (INVITE / MAYBE / PASS) stays where it is, computed exactly as today.

8. **A personal page** (user's idea, 2026-10-09): one page that gathers the member's characters, their
   season state (runs found, analysed, last sync) and the sync itself, and opens each character's
   result tabs. It replaces the scattered "My character" chip as the entry point; the result page keeps
   the "This is me" toggle. Canvas page "me" (`docs/design/canvas/Me*.dc.html`): variants A list, B table,
   C main first, published 2026-10-09; the user's choice is pending.

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

## Numbers (phase 1)

Confirmed by the user with the phase-1 plan, 2026-10-09; tests assert them literally.

- **Overview window:** the last 4 game weeks (current one included). Needs at least 3 analysed runs;
  below that the Overview uses the lookup's own evaluation (the verdict's runs) and says so.
- **Own past:** the 4 game weeks before the Overview window, same 3-run floor; "better" or "worse"
  when a sub-signal's curve score moved by more than 3 points, "same" otherwise.
- **Trend arrow:** median per-run pillar score of the last 2 game weeks vs the 4 before, 3 runs
  minimum on each side; within ±3 points it reads "same".
- **Weekly bars:** the last 8 game weeks.
- **Score colours** (pillar cards and dungeon cells, read off the canvas): 75 and above good, 55–74
  neutral, 45–54 warning, below 45 bad, `null` n/a.
- **Sync:** batches of 10 runs, newest first, one request each; a batch refuses to start under
  `MIN_BUDGET_POINTS` (20) + 10 × `ESTIMATE_RUN` left on the client; a run whose report WCL does not
  return is not retried for 24 h.

## Data notes (verified 2026-10-09, issue #24 § 3)

Checked on 26 real runs (all eight dungeons, 15 timed, 11 depleted), 0 new query type:

- **Avoidable abilities.** The avoidable DamageTaken table has one entry per player hit, each with
  `abilities[]` (`guid`, `name`, `total`) sorted by total and **capped at five**. Below five the sum
  equals `total`; at five it can fall short, so a view shows the remainder as "other avoidable
  damage" (`total − Σ abilities`), never drops it.
- **Killing hits.** A Deaths entry's `events[]` holds up to three events, newest first (`damage` or
  `instakill`, with `ability`, `amount`, `overkill`, `sourceIsFriendly`); `events[0]` is the killing
  blow (`killingBlow` agrees in 197 of 202 deaths). `damage.abilities` is something else: the damage
  of the death window summed by ability (top five), useful as "what wore them down". Today's
  `DeathEvent.cause` reads `damage.abilities[0]`, which is not the killing blow in 30 % of deaths;
  phase 1 adds the killing hits beside it and does not change `cause`.
- **Casts that went through.** The Interrupts table lists only enemy spells interrupted at least
  once, with `spellsBegun`, `spellsCompleted`, `spellsInterrupted` and per-player `details[]` (whose
  sum is exactly `spellsInterrupted`). `spellsCompleted` has no player attribution: group context
  only, and a spell nobody ever kicked does not appear (the view says "among spells your group
  kicked at least once"). Channelled spells can report `spellsBegun: 0` with completions and
  interrupts (fixture: Mending Void, 0 begun, 25 completed, 17 interrupted), so a spell's attempts are
  `max(spellsBegun, spellsCompleted + spellsInterrupted)`.
- **Timed or not.** Rankings' `medal: "none"` matches `keystoneBonus = 0` (26 of 26 runs), so the
  season store knows a run's result before its report is fetched.
- **Cost.** Enriching one run cost 7.3 to 7.9 pts (26 runs, 197 pts); `ESTIMATE_RUN = 10` stays the
  pre-spend estimate.

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

1. **What WCL returns.** Settled 2026-10-09 (issue #24 § 1, fixture
   `test/fixtures/wcl-rankings-s2-dps.json`): `encounterRankings(byBracket: true)` lists every ranked
   run of the season, several per key level, depleted runs included (`medal: "none"`); `ranks.length`
   equals `totalKills`. Measured on two characters: 108 runs (11 to 18 per dungeon, 7 weeks) and 94
   runs (8 to 18). All ten of Raider.IO's recent runs of each character were in the list, the depleted
   ones too. `rank.startTime` is the fight's absolute start in epoch ms (`report.startTime` is the
   report's); `startTime + duration` matches Raider.IO's `completed_at` within seconds. The list is the
   same for `metric: dps` and `metric: hps` (checked on one dungeon, 18 runs), every spec included; the
   metric only changes `amount` and `rankPercent`, so a healer run's parse comes from the `hps` query
   and a DPS or tank run's from `dps`. Order: key level, then amount, not time. Cost measured: 12 pts
   (probe) + 9 pts (eight dungeons) = 21 pts, in line with `ESTIMATE_RANKINGS`. Limit: a run that was
   not logged, or not ranked, is absent (non-goal above); the views state the count they rest on.
2. **What a non-owner sees.** With Battle.net linking, bmpl will know which characters a member owns.
   Whether the sync and the self-review views (trends, points to work on) become owner-only, while
   others keep today's vetting view, is decided with the Battle.net spec. Phase 1 has no proof of
   ownership, so decisions 3 and 7 stand as written.

Settled 2026-10-09: sync needs the member's own WCL client (decision 3); points to work on show
both references (decision 4).

## Out of scope

- Comparing two members' progress.
- Goals and reminders ("keep avoidable damage under X").
- Notifications when a new run is logged.
