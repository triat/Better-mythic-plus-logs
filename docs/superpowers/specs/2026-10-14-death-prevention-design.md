# Death prevention: "could I have prevented this death?" — design

Status: draft 2026-10-14, awaiting the user's review. Amends `docs/superpowers/specs/2026-09-16-run-deep-dive-design.md`
(reading B, "Avoidable deaths") and `docs/superpowers/specs/2026-09-15-evaluation-model-design.md` (Preparation axis).
No WCL probe has been run for this draft: the section "To verify before the plan" lists the open facts and their cost.

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
`amount` is the player's health just before it.

Missing: the player's **maximum health**. It comes from the new fetch below.

For each heal tool ready at the death (potion or healthstone, availability as in "Availability"):

```
heal          = the tool's heal (flat, or a share of max health)
room          = maxHp − hpBeforeKillingHit        // a heal cannot go above max health
wouldSave     = min(heal, room) > overkill
```

The verdict is `heal available` when at least one ready heal tool has `wouldSave`. The death line shows the numbers:
"Health potion ready: heals 180k, overkill 110k" or "Health potion ready, not enough: heals 180k, overkill 250k".

Known approximation: the rule assumes the heal lands just before the killing hit. A heal drunk earlier could have been
eaten by the previous hits; a heal drunk at the last moment needs reaction time. The rule is optimistic on purpose: it
says "a heal of that size was in the bag", not "the player had time".

## Availability

- **Health potions**: already in the table (`*:*`, `mn-2.3`, `kind: "minor"`, cooldown 300 s), judged by the cast
  events the deep-dive already fetches. They gain a `heal` field and a new `kind: "heal"`; `minor` stays for the short
  self-heals and utilities.
- **Healthstone**: added to `*:*` with `kind: "heal"`. Ready only if a Warlock was in the group
  (`consumables.healthstonesAvailable`, `src/signals/wcl-run.ts:61`) and no healthstone was used within its cooldown
  before the death. Its spell id is added to the deep-dive's event filter.
- A `heal` entry never counts toward `majorUsage` (same as `minor`).

## Data: the health fetch

The deep-dive fetch (`src/deepdive/wcl.ts`) gains one request per analyzed run: for each of the player's deaths, the
damage events taken by the player in the 5 s before it, with unit resources, which carry the target's health and
maximum health. The requests are aliases of one GraphQL call. The raw row (`RawDeepDive`) stores
`deathHealth: { atMs: number; maxHp: number | null; hpBefore: number | null }[]`.

`DEEPDIVE_QUERY_VERSION` (`src/signals/store.ts:16`, today `1`) goes to `2`: rows fetched before become `staleTable`
and keep today's verdicts until the user re-analyzes them. Nothing is re-fetched automatically.

## To verify before the plan (WCL probes, user approval needed)

None of these was checked; each needs points. Estimated total: about 5 pts on one cached run with deaths.

1. `events(dataType: DamageTaken, targetID, startTime, endTime, includeResources: true)` returns events with the
   target's `hitPoints` and `maxHitPoints`, and in which unit (raw value or percentage). The deep-dive spec noted that
   `events(dataType: DamageTaken, targetID, startTime, endTime)` "returned nothing on that run"; the probe must find
   the working form (hostility type, `dataType: All` with a filter) or fall back to `CombatantInfo` stamina.
2. The heal of each Midnight health potion and of the healthstone: flat amount or share of maximum health, read from
   the healing events of those spell ids on cached runs.
3. The healthstone's spell id, cooldown and charges in Midnight.
4. Whether combat potions share the health potions' cooldown. If they do, a combat potion cast must put the health
   potions on cooldown, and the combat potions' ids join the event filter.

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
- A heal entry without a `heal` value (override file, shared table): validation rejects it with a message naming the
  key and the id, like a missing `cooldownS` today.

## Tests

- `analyzeRun` (pure): one-shot → `unpreventable`; instakill → `unpreventable`; potion ready and heal > overkill →
  `heal available`; potion ready but `room` too small → not; healthstone without a Warlock → not ready; `maxHp` null →
  today's verdicts; precedence immunity > defensive > heal.
- Aggregate: `unpreventable` leaves the counts.
- Evaluation: the Preparation axis without potions and healthstones; calibration test updated.
- Web view models: the death line strings for each verdict, en and fr key parity.
- A fixture captured by the probe (`scripts/`), not hand-written.

## Out of scope

- A reaction-time model (was there 1 s between "low" and the killing hit?).
- Damage-reduction percentages per defensive, which would extend the overkill rule to them.
- Potion or healthstone use outside deaths.
