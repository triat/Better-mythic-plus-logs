# bmpl — deep-dive: defensive cooldowns

Detailed reference; the README has the short version.

## Deep-dive: defensive cooldowns

`bmpl analyze` goes one level deeper than the run signals in
[What you get](../README.md#what-you-get): it fetches
the raw cast/buff/event data for one run and measures, per defensive
cooldown, **usage vs. capacity** (casts vs. how many times the cooldown could
have come up in the fight) and, for every death, **whether a defensive was
available and unused** ("immunity available", "defensive available",
"covered", "nothing available"). It's a separate, opt-in fetch — ~3 WCL
points per run, cached forever in `bmpl.db` — because it's a heavier query
than the per-run enrichment `lookup` already does.

```bash
bmpl analyze Biwaadrood-Nerzhul                    # list the runs lookup shows, and which are already analyzed
bmpl analyze Biwaadrood-Nerzhul --all --yes        # analyze every shown run (~3 pts each, once; analyzed ones print from the cache)
bmpl analyze Biwaadrood-Nerzhul --run <code>:<fight>   # analyze one specific run
bmpl analyze Biwaadrood-Nerzhul --all --yes --json # structured output (--json needs --yes to fetch, since it can't prompt)
```

Which spells count as defensives per spec lives in `src/deepdive/defensives.json`
(shipped) and can be extended or corrected with a `defensives.json` next to
your `.env` (or a path in `BMPL_DEFENSIVES`), keyed `"Class:Spec"`, `"Class:*"`
or `"*:*"` (every spec — the shipped table keeps the health potions there, as
`minor` entries: listed and judged at each death, not scored). Each entry
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

The shipped table (`src/deepdive/defensives.json`, version `mn-2.3`) was
audited on 2026-09-16 against the top 2 Voidscar Arena runs of every spec:
entries nobody cast were dropped, ids corrected, audit noise (beacons, raid
buffs, trinkets, racials, forms/stances/mobility) added to the denylist.
`mn-2.3` (2026-09-22) added the Silvermoon Health Potion (season 1) and its
Concentrated version under `"*:*"`; other potions stay audit noise.
`just audit-defensives [--only Class:Spec] [--runs N]` re-runs that check
(~9 pts per spec) and prints, per spec, the table entries never cast and the
self-cast buffs not in the table — the input for the next table revision.

Once at least `confidence.deepdiveMinRuns` (2 by default) of a character's
shown runs have been analyzed, the **Survival** axis in `bmpl lookup` /
`bmpl evaluate` picks up two more sub-signals: `defensiveUsage` (median major/
immunity usage across analyzed runs) and `avoidableDeaths` (share of deaths
where a defensive was available and not used).
