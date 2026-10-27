# bmpl — deep-dive: defensive cooldowns

Detailed reference for running bmpl yourself; the Help page of any instance (`/help#deep-dive`)
has the user-facing version.

## Deep-dive: defensive cooldowns

`bmpl analyze` goes one level deeper than the per-run signals that feed the verdict
([scoring.md](scoring.md#verdict-and-axes)): it fetches
the raw cast/buff/event data for one run and measures, per defensive
cooldown, **usage vs. capacity** (casts vs. how many times the cooldown could
have come up in the fight) and, for every death, **whether the player had something at hand that would have prevented
it** ("immunity available", "defensive available", "heal available", "covered", "nothing available", "not preventable").
It's a separate, opt-in fetch — ~4 WCL points per run, cached forever in `bmpl.db` — because it's a heavier query
than the per-run enrichment `lookup` already does. Each defensive also lists
its cast times (`castsAtMs`, fight-relative), used by the run timeline.

### Deaths: could it have been prevented?

Spec: `docs/superpowers/specs/2026-10-14-death-prevention-design.md`. Survivability is read from deaths only; how many
potions a player drinks over a run is not scored. For each death the analysis has the player's health over the 10 s
before it (damage and healing events with their `hitPoints` / `maxHitPoints`, one request per run, ~1 pt) and decides,
in this order:

1. **not preventable** — an instakill, or a one-shot: the killing hit alone is at least the player's maximum health.
   Such a death leaves both counts of `avoidableDeaths`.
2. **immunity available** / **defensive available** — an immunity, or a major defensive with none active, was off
   cooldown. Defensives are cast ahead of known mechanics, so no reaction time is applied to them.
3. **heal available** — a health potion or a healthstone would have saved the player: it was ready when it could have
   been pressed, **in time** and **enough**. In time: the player crossed the danger line (`dangerHpShare`, 50 % of max
   health) and stayed under it at least `reactionMs` (700 ms) before the killing hit. Enough: the heal (capped by the
   room under max health at that moment) is larger than the overkill. The healthstone needs a Warlock in the group.
4. **covered** (a major defensive was active) or **nothing available**.

The heal tools and the two constants are the `heals` block of `defensives.json` (shipped `mn-2.4`); the health potion
counts a conservative flat 370k (the lowest of 22 uses measured on 2026-10-14, range 370k–534k), the healthstone 25 % of
max health (5 uses, all exactly 25 %). Runs analysed before 2026-10-14 have no health data: their deaths keep the
defensive-only verdict and the panel asks to analyse again (`bmpl analyze … --force`).

```bash
bmpl analyze Biwaadrood-Nerzhul                    # list the runs lookup shows, and which are already analyzed
bmpl analyze Biwaadrood-Nerzhul --all --yes        # analyze every shown run (~4 pts each, once; analyzed ones print from the cache)
bmpl analyze Biwaadrood-Nerzhul --run <code>:<fight>   # analyze one specific run
bmpl analyze Biwaadrood-Nerzhul --all --yes --json # structured output (--json needs --yes to fetch, since it can't prompt)
```

Which spells count as defensives per spec lives in `src/deepdive/defensives.json`
(shipped) and can be extended or corrected with a `defensives.json` next to
your `.env` (or a path in `BMPL_DEFENSIVES`), keyed `"Class:Spec"`, `"Class:*"`
or `"*:*"` (every spec; empty since `mn-2.4`, the health potions moved to the `heals` block). Each entry
supports three shapes:

```json
{
  "Paladin:Holy": [
    { "id": 498, "cooldownS": 42 },
    { "id": 6940, "name": "Blessing of Sacrifice", "cooldownS": 120, "durationS": 12, "kind": "major" },
    { "id": 1044, "ignore": true }
  ]
}
```

- **patch** an existing id (shipped or already in your override) — only the
  fields you list change, e.g. correcting `cooldownS` for a talent that
  shortens it.
- **add** a spell the shipped table doesn't know about — `name`, `cooldownS`,
  `durationS` and `kind` (`major` / `immunity` / `minor`) are all required.
- **ignore** an id — drops it from the effective table and from the audit's
  "not in table" list.

`bmpl defensives <Class> <Spec>` prints the effective table (shipped +
override, override entries marked); `bmpl defensives --check` validates the
override file without printing anything else. `--shared` reads the hosted
instance's approved layer from `bmpl.db` instead of the file (on a local-mode
database this creates the empty hosted tables the first time).

Every spell name in the panel links to Wowhead and shows the spell's tooltip
on hover (Wowhead's `tooltips.js`, loaded from `wow.zamimg.com` — the only
third-party script in the UI; without internet the names are plain links).

The shipped table (`src/deepdive/defensives.json`, version `mn-2.4`) was
audited on 2026-09-16 against the top 2 Voidscar Arena runs of every spec:
entries nobody cast were dropped, ids corrected, audit noise (beacons, raid
buffs, trinkets, racials, forms/stances/mobility) added to the denylist.
`mn-2.3` (2026-09-22) added the Silvermoon Health Potion (season 1) and its
Concentrated version under `"*:*"`; other potions stay audit noise. `mn-2.4` (2026-10-14) moved them to the `heals`
block with the healthstone (ids 6262 and 452930, Demonic Healthstone).
`just audit-defensives [--only Class:Spec] [--runs N]` re-runs that check
(~9 pts per spec) and prints, per spec, the table entries never cast and the
self-cast buffs not in the table — the input for the next table revision.

Once at least `confidence.deepdiveMinRuns` (2 by default) of a character's
shown runs have been analyzed, two more sub-signals are scored: `defensiveUsage` (median major/
immunity usage across analyzed runs) and `avoidableDeaths` (share of deaths
where an immunity, a major defensive or a heal that would have saved was at hand; not-preventable deaths left out).
Since config version 10 they count in the self-review's Survival pillar only (`pillarOnly`), never in the Survival
axis, the global score or the verdict: the score's calibration population has no analysed runs, so analysing a run
must not move a verdict ([validity spec](superpowers/specs/2026-10-27-evaluation-validity-design.md), decision 4).
