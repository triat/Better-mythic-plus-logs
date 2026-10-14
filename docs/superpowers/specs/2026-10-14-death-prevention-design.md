# Death prevention: "could I have prevented this death?" — design

Status: implemented 2026-10-14 (no plan: the user asked for the change directly). Probes of 2026-10-14 (section "Data
notes", ~16 WCL pts) replaced the open facts of the draft. Amends `docs/superpowers/specs/2026-09-16-run-deep-dive-design.md`
(reading B, "Avoidable deaths") and `docs/superpowers/specs/2026-09-15-evaluation-model-design.md` (Preparation axis,
config version 8). Not done: the Claude Design canvas step for the run sheet's death lines (the lines reuse the panel's
existing layout); the live check of `dangerHpShare` and `reactionMs` against real deaths.

## Goal

Answer one question per death, on the run sheet: **"Did I have something at hand that would have prevented my
death?"** The answer names the tool (an immunity, a major defensive, a health potion, a healthstone) or says why
nothing would have helped (a one-shot, an instakill, too much overkill for a heal).

Survivability is read from deaths only. Health potions and healthstones are death-prevention tools: how many a player
drinks over a run says nothing on its own, so the per-run counts stop being scored and shown.

## Non-goals

- No judgement of a potion or healthstone used outside a death (wasted, too early). Only deaths are judged
  (user, 2026-10-14: "ce n'est pas forcément intéressant pour l'instant d'en savoir plus à un autre moment").
- No damage-reduction model per defensive (Divine Protection 20 %, Icebound Fortitude 30 %…). A major defensive is
  judged with today's rule plus the one-shot exclusion below.
- No external defensives, no healer covering, no group cooldowns (same as the deep-dive spec).
- No automatic WCL spend: the analysis stays on demand, behind the Analyze button (user, 2026-10-14, answer 4).

## Decisions (user answers of 2026-10-14)

1. **Potion and healthstone counts are removed.** `preparation.potions` and `preparation.healthstones` leave the
   evaluation (axis, pillar context, `default-config.json` curves and calibration entries, docs) and the UI (the
   `Pots·HS` column of the owner's Runs, the Donjons fact, the run sheet's potions row, the "no potion" timeline
   moment). The Preparation axis keeps `ilvlVsLevel` alone. The raw `consumables` stay in `RunSignals` (they cost
   nothing and old payloads carry them), unread by the evaluation.
2. **A heal only prevents a death if it covers the overkill.** A health potion or a healthstone reduces no damage; it
   adds health. It counts as "would have prevented" only when the heal it gives is larger than what killed the player
   above zero, and the player had room to receive it (see "The heal rule").
3. **One-shots and instakills are excluded.** Such a death is `unpreventable` for every tool, an immunity included.
4. **The analysis stays on demand** (~3 pts per run today, plus the cost of the health data below).

## The death verdict

`DeathVerdict` gains two values; the order is the order of precedence:

| Verdict | When |
|---|---|
| `unpreventable` | instakill, or a one-shot: the killing hit alone (`amount + overkill`) ≥ the player's maximum health |
| `immunity available` | an `immunity` entry was ready (today's rule) |
| `defensive available` | a `major` entry was ready and none was active (today's rule) |
| `heal available` | a health potion or a healthstone was ready and the heal rule says it was enough |
| `covered` | a major defensive was active (today's rule) |
| `nothing available` | none of the above |

`avoidableDeaths` (the evaluation's `survival.avoidableDeaths`) counts `immunity available`, `defensive available` and
`heal available`, outside wipes as today. `unpreventable` deaths leave both the numerator and the denominator.

When the maximum health is unknown (a deep-dive row fetched before this change, or a failed health fetch), the
one-shot test and the heal rule cannot run: the verdict falls back to today's rule, and the death line says the
health data is missing ("re-analyze to judge potions and one-shots").

## The heal rule

Facts already cached for each death (the Deaths table, verified on the three fixtures in `test/fixtures/`): the last
hits newest first, each with `amount`, `overkill`, `mitigated`, `unmitigatedAmount`. On all three fixtures
`unmitigatedAmount − mitigated = amount + overkill`: **`amount` excludes the overkill**, so the killing hit's
`amount` is the player's health just before it. The table keeps only the last three hits (`events/death` is 1 to 3 on
the fixtures), too few to rebuild the health curve.

Missing: the player's **maximum health** and **health over the seconds before the death**. Both come from the new
fetch below.

### Reaction time (user, 2026-10-14: "il faut que le temps de réaction soit pris en compte sinon il va y avoir de faux positif")

A heal only counts if the player had time to see the danger and press the key before the killing hit. Two constants,
in the season table next to the entries (`reaction` block of `defensives.json`, overridable like the entries):

- `dangerHpShare` = **0.5**: the player is in danger once their health is at or below 50 % of max health. Above it,
  nobody is expected to drink.
- `reactionMs` = **700**: the time from the danger to the heal landing. The user's figure (2026-10-14): a median human
  reaction of about 250 ms, plus the decision, the key press and the server round trip.

`dangerHpShare` is a first guess, not a measured fact; both values are checked against real deaths in the plan's live
check, and the user tunes them.

For each heal tool ready at the death (potion or healthstone, availability as in "Availability"):

```
tDanger   = the first moment in the health window when hp ≤ dangerHpShare × maxHp
            (the danger must last: if health goes back above the line, tDanger restarts at the next crossing)
tDrink    = tDanger + reactionMs
inTime    = tDrink < tKill                          // the heal lands before the killing hit
hpAtDrink = the health just before tDrink, from the health window
heal      = the tool's heal (flat, or a share of max health)
effective = min(heal, maxHp − hpAtDrink)            // a heal cannot go above max health
wouldSave = inTime and effective > overkill
```

Why `effective > overkill` is enough: a heal added at `tDrink` shifts every later health value up by `effective`, so the
final value goes from `−overkill` to `effective − overkill`. Healing received after `tDrink` that capped at max health
would break this; the rule ignores it.

The verdict is `heal available` when at least one ready heal tool has `wouldSave`. The death line shows why, with the
numbers:

- "Health potion ready: in danger 2.4 s before death, heals 180k, overkill 110k" → avoidable;
- "Health potion ready, no time: 100 % → 0 in 0.6 s" → not avoidable;
- "Health potion ready, not enough: heals 180k, overkill 250k" → not avoidable.

### Defensives are not reactive (user, 2026-10-14)

The reaction window applies to health potions and healthstones only. Defensives and immunities keep today's rule:
ready at the moment of death means the death was avoidable. The user's reason: "il faut les utiliser au bon moment, or
ces moments sont généralement connus". A defensive answers a known mechanic (a spell that hits the group or one player
hard, or several spells landing together, e.g. a damage-over-time on one player during a group-wide hit), so it is
cast ahead of the damage, not in reaction to the health bar. A burst death with a defensive ready is therefore a
missed planned use, not a lack of time. One-shots and instakills stay `unpreventable` (decision 3).

## Availability

- **Health potions** (1234768, 1295247): one tool, cooldown 300 s, judged by the cast events the deep-dive fetches (the
  ids join the cast filter).
- **Healthstone** (6262, 452930): cooldown 60 s, offered only when a Warlock was in the group (the report's
  composition, the player included).
- A heal tool never counts toward `majorUsage`. A tool whose ids were not in the row's cast filter (an older row) is not
  judged.

## Data: the health fetch

The deep-dive fetch (`src/deepdive/wcl.ts`) gains one request per analyzed run: for each of the player's deaths, the
damage and healing events on the player in the 10 s before it, with unit resources, which carry the player's health
and maximum health on each event. 10 s covers the death windows seen on the fixtures (`deathWindow` 2.0 to 8.0 s). The
requests are aliases of one GraphQL call. The raw row (`RawDeepDive`) stores, per death,
`deathHealth: { atMs: number; maxHp: number | null; curve: { atMs: number; hp: number }[] }[]` (health after each
event, fight-relative ms).

Rows fetched before keep today's verdicts until the user re-analyzes them (see "Implementation notes"). Nothing is
re-fetched automatically.

## Data notes (probes of 2026-10-14)

Run on cached reports `8DFkgn3LtdBcmGJ4` fight 7 (Temple of Sethraliss), `hGd6gTaqVcyLFZB8` fight 16 (Voidscar Arena)
and one Affliction Warlock ranking report (`t1hPrcanpLBKkHCN` fight 12), about 16 pts in all.

1. **Health.** `events(dataType: DamageTaken, sourceID: <player>, includeResources: true)` returns the damage the player
   took with `hitPoints` (health after the event, raw value) and `maxHitPoints` (771 120 for the Assassination Rogue);
   with `targetID` it returns nothing. `events(dataType: Healing, targetID: <player>, includeResources: true)` returns the
   heals received. `resourceActor` says whose resources the event carries: 2 the target, 1 the source (a heal from
   another player then carries the healer's health, which must be skipped). One request with both aliases: ~1 pt.
   Fixture: `test/fixtures/death-health-s2-rogue.json`.
2. **Health potions.** 22 uses of Concentrated Silvermoon Health Potion (1295247) on two runs: amount + overheal between
   370k and 534k, unrelated to max health (25 % to 66 % of it): a flat heal that varies per use. The table keeps the
   lowest, **370 000**, so a "would have saved" is never optimistic. The plain Silvermoon Health Potion (1234768) was not
   seen; it gets the same value.
3. **Healthstone.** Healthstone (6262): 5 uses, each exactly **25 %** of max health. Demonic Healthstone (452930) was
   seen in the Healing table but not measured (the probe was stopped to save points): it counts as a use of the same
   tool and is judged at 25 %, a low estimate. Cooldown 60 s; charges are not modelled.
4. **Shared cooldown.** Combat potions do not share the health potions' cooldown: a player drank a health potion 31 s
   after a Potion of Recklessness, another 78 s after. Health potion intervals were all ≥ 384 s, consistent with 300 s.
5. **WCL's `healthstoneUse`** counts health potions too: no Warlock in either group, yet `healthstoneUse` equals the
   health potions cast (the Rogue: 2 and 2). The count removed by decision 1 was therefore never a healthstone count.
6. Not checked: whether potions and the healthstone are off the global cooldown (`reactionMs` would then need up to one
   global cooldown more).

## Implementation notes

- The heal tools live in a `heals` block of `defensives.json` (`mn-2.4`), next to the specs, not as `kind: "heal"`
  entries: the per-spec table, its override file, the hosted shared layer and the table editor stay unchanged. The two
  health potions left `*:*`.
- `DEEPDIVE_QUERY_VERSION` stays 1: bumping it would hide every analysis already stored. A row without `deathHealth`
  keeps today's verdicts and the analysis carries `healthMissing: true`, which the panel turns into "analyse again".
- The estimate shown before an analysis went from 3 to 4 pts.

## Display

Visible change: the run sheet's death lines and the timeline's death markers. Mocked on the Claude Design canvas first
(`docs/agents/web-front.md`), 2–3 variants. Content of a death line:

- time, killing hit and its size, the player's health before it and the maximum health;
- the verdict in plain words: "Avoidable: Divine Shield ready", "Avoidable: health potion ready (heals 180k,
  overkill 110k)", "Not avoidable: one-shot (520k hit, 480k max health)", "Not avoidable: nothing ready";
- the tools on cooldown, as today.

All strings in `web/src/i18n/en.ts` and `fr.ts`.

## Error handling

- Health fetch fails or returns no resources: the row is stored with `maxHp: null`, the verdicts fall back (see "The
  death verdict"), the run sheet says so. The rest of the deep-dive is kept.
- The `heals` block is shipped data only: no override file entry, no hosted layer, so no validation path.

## Tests

- `analyzeRun` (pure): one-shot → `unpreventable`; instakill → `unpreventable`; potion ready and heal > overkill →
  `heal available`; potion ready but `effective` too small → not; danger reached less than `reactionMs` before the
  killing hit → not; health back above the line then down again → `tDanger` is the last crossing; healthstone without
  a Warlock → not ready; `maxHp` null → today's verdicts; precedence immunity > defensive > heal.
- Aggregate: `unpreventable` leaves the counts.
- Evaluation: the Preparation axis without potions and healthstones; calibration test updated.
- Web view models: the death line strings for each verdict, en and fr key parity.
- A fixture captured by the probe (`scripts/`), not hand-written.

## Out of scope

- A reaction time per player or per role (one value for everyone).
- Damage-reduction percentages per defensive, which would extend the overkill rule to them.
- **Defensive timing on the right damage** (user idea, 2026-10-14, its own spec later): find the dangerous moments of
  each dungeon from the logs (the spells that kill or hit hardest, and the overlaps such as a damage-over-time on one
  player during a group-wide hit), then check whether the player's defensives covered them. This judges defensives
  outside deaths too; this spec only judges deaths.
- Potion or healthstone use outside deaths.
