# bmpl — scoring model

Detailed reference; the README has the short version. The web UI's Help page
(`/help`) explains every number with this instance's live thresholds and
curves; `GET /api/docs` returns the registry with the effective config.

## Verdict and axes

On top of the raw stats, `bmpl lookup` (CLI and web) computes a rule-based
**verdict** — `INVITE` / `MAYBE` / `PASS` / `INSUFFICIENT DATA` — with a
0–100 global score, from five axes:

- **Survival** — deaths (individual and in wipes), damage taken vs. the
  group's peers, avoidable damage vs. peers, and (for healers) teammate
  deaths. The deep-dive's two sub-signals (defensive cooldown usage and the
  share of deaths where a defensive was available and unused, see [Deep-dive: defensive cooldowns](deep-dive.md#deep-dive-defensive-cooldowns))
  count in the self-review's Survival pillar only since config version 10, never in the verdict.
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
  only** (shown as "informational · weight 0"): its weight in the verdict is 0 by default, because variance punishes
  players who push keys (a depleted +21 next to a timed +20 is not
  inconsistency). Raise `axisWeights.<role>.consistency` in `evaluation.json`
  if you disagree.
- **Preparation** — item level vs. the season's expected curve at the target level. Potions and healthstones used per
  run were removed in config version 8 (2026-10-14): a health potion or a healthstone only matters when it would have
  prevented a death, which the deep-dive judges at each death ([deep-dive.md](deep-dive.md)). An `evaluation.json`
  that still names `potions` or `healthstones` fails validation and is ignored with a warning.

An **Experience** axis (coverage, keys at target, recent activity) weighed 0
since config version 4 and was removed in config version 7: no score
changed. Last season's score and recent activity stay visible as plain facts,
outside the score; an `evaluation.json` that still names `experience`
keys loads with a warning and those keys are ignored. Any axis whose role
weight is 0 is informational: shown, never counted in "what would flip the
verdict".

**Missing data scores as the average player** (config version 10). A sub-signal the player could have but whose
data is missing — no ranked run at the target level, no avoidable-damage list for the dungeon, no peer data, no
Raider.IO item level — is scored at the role's calibration median (`reference`), so unknown data neither helps nor
hurts. Before, it left the average, which made the player's other signals count for it: never having played at the
target level then scored better than having played there badly. A sub-signal the kit cannot have (no interrupt, no
dispel) is still left out, and an axis where nothing was measured stays `n/a`. The Method tab's evidence lists only
what was measured ([validity spec](superpowers/specs/2026-10-27-evaluation-validity-design.md)).

**Config version 11** (2026-10-28) applies what the evaluation study found, role by role, on the half of the sampled
characters it was not fitted on. Item level is compared with what the players of the target key level wear (the
median of the characters sampled at each level, refitted every week) rather than a fixed table that had fallen 7 to 8
levels behind. A healer's dispels weigh 1 instead of 3: they barely repeat from one set of runs to the next. Tanks get
their own curves (each signal's percentile among the sampled tanks), their deaths outside wipes weigh 1 instead of 3,
and each measured signal is pulled toward the average tank by k / (n + k) for n runs (`shrinkage`), so one run decides
less. DPS keep their curves and weights.

**Reliability** (validity spec phase 2): how far the verdict holds for the key you vet for. Neither part changes the
score or the verdict.

- **Level**: proven when one of the shown runs is at most two levels below the target (`LEVEL_MARGIN`,
  `src/evaluation/reliability.ts`). Otherwise the score describes the player at their own level, and the Synthèse tab
  says so ("Not proven at +19 · best run +16, none at +17 or above").
- **Stability**: the global score recomputed with each shown run left out in turn, from `verdict.minRuns + 1` runs
  (4 by default). When that range crosses a verdict threshold, a single run decides the verdict.
- The profile header shows "low reliability" in either case; Récents and Live show the spread ("±8") and a mark for an
  unproven level; Compare shows both in one line.

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

Since October 2026 the population is kept fresh: the hosted instance samples
EU characters every hour with the Warcraft Logs points its members leave
unused, and every Wednesday refits `globalCurve`, `reference` and the expected
item level of each key level (`expectedIlvl`: the median item level of the
characters sampled at that level, since 2026-10-28) on the last four weeks of
the season. When the refit would change at least 2 % of the
verdicts or move a role's median by 2 points, it is proposed as a pull
request; nothing changes until it is merged and released
([spec](superpowers/specs/2026-10-14-weekly-recalibration-design.md)).

**What makes this score.** Under the badge, bars show the signals that cost
or earn the most points of the global score against the role's average player
(the calibration median, `reference` in `default-config.json`, refitted with
`globalCurve`), and the largest costs — three at most — that together would
reach the next verdict if brought to the average player's level. Each effect
is "this signal alone at the average player's level"; they do not add up
exactly to the score. The Synthèse tab's strengths and weaknesses are the same
effects, in points of the score shown: a signal within a point of the average
player's is neither.

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
It is `n/a` when no run was measured, when the spec's reference has fewer than 20 sampled players or comes from
fewer than 4 dungeons, or when its median is under 0.5 use per 10 minutes (no real kit). The reference samples every
dungeon and weighs each one the same, since crowd-control opportunities differ from dungeon to dungeon.

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
- `analyze`: ~4 pts per run, once ever (cached forever); re-opening tabs or
  correcting the table costs 0
- Season sync (the web UI's **Sync** on your own character's page, or **Sync N runs** on its card in My
  characters; `POST /api/season/sync`), for
  your own characters only: the rankings (~20 pts, on the first batch) plus
  ~8 pts per run whose log is not cached yet and ~3 pts per run without crowd
  control, in batches of 10 runs, newest first; the estimate (20 + 10 per run
  not analysed + 3 per run without crowd control) is shown before anything is
  spent. A batch refuses to start under 20 + the batch's estimate left on the
  client, the rankings under 20 + 20. On a hosted instance it runs only on the
  member's own Warcraft Logs client, and only for a character in their list.
  Opening the season views costs 0.
- 3600 pts/hr → ~40 fully-uncached lookups/hr, or ~170/hr once runs are cached
