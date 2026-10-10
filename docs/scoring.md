# bmpl — scoring model

Detailed reference; the README has the short version. The web UI's Help page
(`/help`) explains every number with this instance's live thresholds and
curves; `GET /api/docs` returns the registry with the effective config.

## Verdict and axes

On top of the raw stats, `bmpl lookup` (CLI and web) computes a rule-based
**verdict** — `INVITE` / `MAYBE` / `PASS` / `INSUFFICIENT DATA` — with a
0–100 global score, from six axes:

- **Survival** — deaths (individual and in wipes), damage taken vs. the
  group's peers, avoidable damage vs. peers, and (for healers) teammate
  deaths. Once at least `confidence.deepdiveMinRuns` (2 by default) of a
  character's shown runs have been deep-dive analyzed (see [Deep-dive: defensive cooldowns](deep-dive.md#deep-dive-defensive-cooldowns)), two more sub-signals feed in: defensive
  cooldown usage and the share of deaths where a defensive was available and
  unused.
- **Utility** — interrupts vs. peers, normalized by the spec's kick cooldown
  and capacity, plus dispels. Kicks and dispels are each `n/a` when the spec
  has no such ability (rogues, warriors and death knights have no dispel or
  purge at all); the axis is `n/a` only when neither applies — healers are
  always scored, since dispel usage alone is signal.
- **Throughput** — median parse % across runs, and parse % specifically at
  the target key level. A 0% parse means WCL has not ranked that log (yet);
  it is shown as `unranked` and excluded from every parse-based signal.
- **Consistency** — spread (variance) of parse, deaths, and damage taken
  across runs. Needs at least 5 runs; below that it's `n/a`. **Informational
  only**: its weight in the verdict is 0 by default, because variance punishes
  players who push keys (a depleted +21 next to a timed +20 is not
  inconsistency). Raise `axisWeights.<role>.consistency` in `evaluation.json`
  if you disagree.
- **Preparation** — potions and healthstones used per run, and item level
  vs. the season's expected curve at the target level.
- **Experience** — dungeon coverage, share of dungeons at/above target,
  median key level vs. target, recent activity (runs in the last 7 days),
  plus a small bonus — never a penalty — for a strong previous-season score.
  **Informational only** since config version 4: it rewarded volume over
  quality (a player with every dungeon timed at +18 scored below one with a
  handful of average +19s), and on the calibration sample dropping it from
  the global left the ranking against WCL's ladder unchanged. Raise
  `axisWeights.<role>.experience` in `evaluation.json` to count it again (and
  refit `globalCurve`).

The **global score** is a percentile. The weighted mean of the axes (the
role's `axisWeights`) goes through the role's `globalCurve`, fitted on 1,081
EU characters logging +15 to +20 keys in September 2026 (see the
[calibration study](superpowers/specs/2026-09-24-scoring-calibration-design.md)):
50 is the typical player of that population, 70 (INVITE) the top 30 %, and
below 30 (PASS) the bottom quarter or so. The curve only spreads the scale —
it never changes who ranks above whom. It describes one season and one
population, so it is refitted when the season changes. If you change the
weights or curves in `evaluation.json`, set `globalCurve` too (to
`[[0, 0], [100, 100]]` per role to turn it off), or the percentiles no
longer mean what they say.

**What makes this score.** Under the badge, bars show the signals that cost
or earn the most points of the global score against the role's average player
(the calibration median, `reference` in `default-config.json`, refitted with
`globalCurve`), and the largest costs — three at most — that together would
reach the next verdict if brought to the average player's level. Each effect
is "this signal alone at the average player's level"; they do not add up
exactly to the score.

Every axis lists its **evidence**: the specific sub-signals that moved the
score, in plain language. **Timed vs. depleted is deliberately not scored**
— it's shown in the run list as context, but a depleted key on an otherwise
strong run isn't held against the player (it's usually the group's fault,
not theirs). With fewer than 3 enriched runs the verdict is always
`INSUFFICIENT DATA` — there just isn't enough signal yet.

The scoring rules — curves, weights, thresholds — live in
`src/evaluation/default-config.json` and are yours to tune. You don't need to
copy the whole file: `evaluation.json` deep-merges into the defaults, so it
only needs the keys you want to change. For example, to raise the invite bar
and make one Survival curve harsher:

```json
{
  "verdict": { "invite": 75 },
  "axes": {
    "survival": {
      "subSignals": {
        "individualDeaths": { "curve": [[0, 100], [1, 60], [3, 10]] }
      }
    }
  }
}
```

`bmpl` looks for `evaluation.json` next to `.env`, or a path in
`BMPL_EVAL_CONFIG` if set. `bmpl serve` reads the config once at startup —
restart the server after editing `evaluation.json` for changes to take
effect. To see the effect of a config change without spending API points,
save a payload once (`bmpl lookup Name-Realm --json > saved.json`) and
replay it through the model:

```bash
bmpl evaluate saved.json          # human-readable verdict block
bmpl evaluate saved.json --json   # structured output
```

## Self-review pillars and crowd control

The self-review tabs (your own characters only, see [My characters](hosted.md)) regroup the same sub-signals
into five pillars: Damage, Survival, Avoidable damage, Interrupts and Control. A pillar's score is the weighted
mean of its sub-signals with the curves and weights above; it never changes the verdict.

The Control pillar holds dispels and **crowd control**: the stuns, incapacitates, disorients, fears, silences
and knocks (knock-backs, grips, pulls) the player or their pet landed on enemies. Roots and slows do not count.
Per run, applications of one spell within 1 s are one use (an area stun on eight enemies is one use, eight
enemies); bmpl takes the uses per 10 minutes of key and compares them with the median of ranked players of the
same spec at +15 to +20, in percent. The character's value is the median of those percentages over the runs.
It is `n/a` when no run was measured, when the spec's reference has fewer than 20 sampled players, or when its
median is under 0.5 use per 10 minutes (no real kit).

Crowd control is scored **for the pillar only** (`pillarOnly: true` in `default-config.json`): it is kept out of
the Utility axis, the global score and the verdict. It is measured only for your own characters, from one more
Warcraft Logs query per run (about 3 points). The list of spells is season data,
`src/signals/control/cc-mn-2.json`, validated with `scripts/audit-control.ts`; the reference is
`src/signals/control/reference-mn-2.json`, collected with `scripts/calibration/control.ts`.

## API cost

Measured 2026-10-09: the rankings query costs 21 pts, one run's `report.table`
enrichment 7.3–7.9 pts. Before spending, bmpl checks against its estimates
(`ESTIMATE_RANKINGS` 20, `ESTIMATE_RUN` 10, `src/wcl/meter.ts`).

- Auth: 0 pts (OAuth2 token is cached in memory)
- `lookup` with stats enrichment (default), fully uncached: ~90 pts per
  character (≈8 pts per displayed run's `report.table` queries, up to 9
  displayed runs, + ~20 pts for the rankings query). Raider.IO enrichment is
  a separate, free API and doesn't count against this budget.
- `lookup` where the displayed runs are already cached in `bmpl.db`: ~20 pts
  (just the rankings query — per-run enrichment is a cache hit)
- `lookup --no-stats`: ~20 pts per character (rankings query only; Raider.IO
  is still fetched)
- A `lookup` (CLI or web) also records every ranked run of the season the
  rankings listed (the self-review's season store), at no extra cost — unless
  the metric was forced (`--metric`), so stored parses stay on the
  auto-selected one.
- A web lookup of one of your own characters (in My characters) also fetches
  the crowd control of each displayed run that lacks it: ~3 pts per run, once
  ever. A lookup of anyone else costs exactly the above.
- `mplus`: ~20 pts per character (no enrichment; unchanged)
- `analyze`: ~3 pts per run, once ever (cached forever); re-opening tabs or
  correcting the table costs 0
- Season sync (the web UI's **Sync season**, `POST /api/season/sync`), for
  your own characters only: the rankings (~20 pts, on the first batch) plus
  ~8 pts per run whose log is not cached yet and ~3 pts per run without crowd
  control, in batches of 10 runs, newest first; the estimate (20 + 10 per run
  not analysed + 3 per run without crowd control) is shown before anything is
  spent. A batch refuses to start under 20 + the batch's estimate left on the
  client, the rankings under 20 + 20. On a hosted instance it runs only on the
  member's own Warcraft Logs client, and only for a character in their list.
  Opening the season views costs 0.
- 3600 pts/hr → ~40 fully-uncached lookups/hr, or ~170/hr once runs are cached
