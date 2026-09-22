# Run deep-dive: defensive cooldowns — design

**Status:** implemented 2026-09-16 (plan `docs/superpowers/plans/2026-09-16-run-deep-dive.md`; 18 commits a87090c..fb97eb7)
**Sub-project:** 4 of the bmpl roadmap (signals → evaluation → web front → **run deep-dive**)
**Depends on:** `2026-09-15-signals-design.md` (raw store, `RunSignals.deaths`), `2026-09-15-evaluation-model-design.md` (axes, config, evidence), `2026-09-16-web-front-design.md` (Detail screen, `web/src/lib` view models)

## Goal

Answer, per run and on demand, "does this player use their defensive cooldowns, and did they die
with one available?" — then let the evaluation use it. Two readings, both explainable down to the
facts:

- **Usage vs capacity** (A): casts of each personal defensive over what the cooldown allowed.
- **Avoidable deaths** (B): for each death, what killed them and which defensive was available,
  active, or on cooldown at that moment.

A curated **spec → defensives table** is the source of truth; an **audit** (self-cast buffs the
table does not list, observed cast intervals vs the table's cooldown) makes its mistakes visible
so the user can correct them from the UI. Never part of a lookup: the user chooses which runs to
analyze and sees the WCL point cost first.

## Non-goals

- Spike coverage over the whole fight (reading C of the discussion): only deaths are judged.
- External defensives (Pain Suppression, Blessing of Sacrifice received…), healer covering, group
  cooldown planning.
- Any change to lookups, rankings or the raw run store (`wcl_runs`) beyond reading it.
- Automatic inference of the table (the audit only *flags*; a human decides).
- Talent-aware cooldowns: the table carries the baseline; the observed minimum interval is the
  hint that a talent shortens it.

## Verified API facts (probed 2026-09-16 on report `hGd6gTaqVcyLFZB8` fight 16)

- The player's actor id is already in the cached raw run: `summary.data.composition[] { name, id,
  type, specs }` (Muleyoxo → id 1). No `masterData` query is needed.
- `table(dataType: Casts, sourceID)` → `data.entries[] { guid, name, total }` (casts per
  ability). `table(dataType: Buffs, targetID)` → `data.auras[] { guid, name, totalUptime,
  totalUses }` (buffs on the player, any source). Two tables cost **2 pts**.
- `events(dataType: Casts, sourceID, filterExpression: "ability.id in (…)", limit: 500)` →
  `{ data[] { timestamp, type: "cast", sourceID, targetID, abilityGameID, fight }, nextPageTimestamp }`;
  timestamps are report-relative ms (same base as `fights[].startTime`). Filtered on the table's
  IDs it is one page for a full key (41 events); **1 pt**.
- The `Deaths` table already cached in `wcl_runs` carries, per death: `timestamp`
  (report-relative), `deathWindow`, `killingBlow`, `damage.abilities[] { guid, name, total,
  totalReduced }` and `damage.sources[]` (totals over the death window), and `events[]`
  (`timestamp, ability { name, guid }, amount, mitigated, unmitigatedAmount, absorbed, overkill,
  sourceID`). **No per-death query is needed.**
- `events(dataType: DamageTaken, targetID, startTime, endTime)` returned nothing on that run;
  not used.

Total per analyzed run: **~3 pts**, cached forever.

## Modules

```
src/deepdive/
  defensives.json        shipped table (all 39 specs + "Class:*" shared entries)
  table.ts               loadDefensives(): effective table = shipped ⊕ user override;
                         defensivesFor(className, spec): DefensiveSpell[]; override read/write
  types.ts               DefensiveSpell, RawDeepDive, RunDefensives, DeathAnalysis, …
  wcl.ts                 fetchRawDeepDive(gql, code, fightID, character, tableIds) — network only
  analyze.ts             analyzeRun(raw, run, signals, table): RunDefensives — pure
  aggregate.ts           deepdiveSummary(runs: RunDefensives[]) → evaluation inputs — pure
  store.ts               getDeepDive/putDeepDive on bmpl.db (table wcl_deepdive), DEEPDIVE_QUERY_VERSION
src/evaluation/          survival gains two sub-signals (inputs.ts, axes/survival.ts, default-config.json)
src/lookup.ts            payload.deepdive: RunDefensives[] for displayed runs already analyzed (store only, 0 pts)
src/server.ts            POST /api/deepdive, GET/POST /api/defensives, history refresh after analyses / table edits
src/cli.ts               bmpl analyze, bmpl defensives
src/format-mplus.ts      renderDeepDive(run)
web/src/lib/deepdive.ts  view model (rows, death lines, audit) — tested
web/src/components/RunDeepDive.tsx, DefensivesTable.tsx
```

## The table (`src/deepdive/defensives.json`)

```jsonc
{
  "version": "mn-2.1",
  "Paladin:*":    [ { "id": 642,  "name": "Divine Shield",     "cooldownS": 300, "durationS": 8,  "kind": "immunity" },
                    { "id": 633,  "name": "Lay on Hands",      "cooldownS": 600, "durationS": 0,  "kind": "major" },
                    { "id": 1022, "name": "Blessing of Protection", "cooldownS": 300, "durationS": 10, "kind": "minor" } ],
  "Paladin:Holy": [ { "id": 498,  "name": "Divine Protection", "cooldownS": 45,  "durationS": 8,  "kind": "major" } ],
  "Rogue:*":      [ { "id": 31224, "name": "Cloak of Shadows", "cooldownS": 120, "durationS": 5,  "kind": "immunity" },
                    { "id": 5277,  "name": "Evasion",          "cooldownS": 120, "durationS": 10, "kind": "major" },
                    { "id": 185311, "name": "Crimson Vial",    "cooldownS": 30,  "durationS": 4,  "kind": "minor" } ],
  "...": []
}
```

- Keys are `Class:Spec` with WCL's spacing-free class names (`DeathKnight`, `DemonHunter`),
  `Class:*` for spells every spec of the class has and `*:*` for consumables every spec can use
  (health potions, added in `mn-2.3`). `specDefensives` merges `*:*`, then `Class:*`, then
  `Class:Spec` (the most specific key overrides same ids); `*:*` alone does not make a spec's table
  "present".
- `kind`: `major` — a personal damage-reduction/absorb cooldown that counts toward usage;
  `immunity` — full immunity, counts toward usage and ranks above `major` in the death verdict;
  `minor` — listed and shown (availability at death) but excluded from the usage score (short
  self-heals, freedom-type utilities). `durationS: 0` means "instant, never *active*".
- A spec absent from the table → `tableMissing: true`; the analysis still runs the audit part.
- The shipped table is authored from the model's knowledge for **all 39 specs** and reviewed by
  the user; every entry is data, never code. Version bumps `DEEPDIVE_QUERY_VERSION` only when
  the *fetch* changes (new ids to filter events on), never when cooldowns change (the analysis
  is re-run from the raw cache).

**User override** `defensives.json` next to `.env` (`BMPL_DEFENSIVES` env var, like
`BMPL_EVAL_CONFIG`):

```jsonc
{
  "Paladin:Holy": [ { "id": 498, "cooldownS": 30 },                    // patch a field
                    { "id": 1236616, "ignore": true },                  // "Light's Potential": not a defensive
                    { "id": 123456, "name": "New Spell", "cooldownS": 90, "durationS": 6, "kind": "major" } ] // add
}
```

Merge rule per `Class:Spec` key: entries match on `id`; a patch object updates the listed
fields; `ignore: true` removes the id from the effective list **and** from the audit's
"unlisted" list; an unknown id with all fields present is added; an unknown id missing
`cooldownS`/`kind` is rejected by validation with a message naming the key and id.
`GET /api/defensives` returns each effective entry with `origin: "shipped" | "override"`.

## Fetch (`src/deepdive/wcl.ts`)

One GraphQL request per run:

```graphql
query($code: String!, $fightID: Int!, $actorID: Int!, $filter: String!) {
  rateLimitData { pointsSpentThisHour }
  reportData { report(code: $code) {
    fights(fightIDs: [$fightID]) { startTime endTime }
    casts: table(fightIDs: [$fightID], dataType: Casts, sourceID: $actorID)
    buffs: table(fightIDs: [$fightID], dataType: Buffs, targetID: $actorID)
    castEvents: events(fightIDs: [$fightID], dataType: Casts, sourceID: $actorID, filterExpression: $filter, limit: 500) { data nextPageTimestamp }
  } }
}
```

- `$actorID` comes from the cached run's `summary.data.composition` (match on character name);
  a run whose composition lacks the player → `404` "player not found in cached run". `$filter` = `ability.id in (<all ids of the effective table for that spec>)`;
  if `nextPageTimestamp` is non-null, follow pages (`startTime: nextPageTimestamp`) up to 5.
  With an empty effective table (no ids) the `castEvents` field is not requested at all
  (`REPORT_DEEPDIVE_NO_EVENTS_QUERY`): `castEvents: []`, `tableIds: []`.
- `RawDeepDive = { code, fightID, character, actorID, fightStart, fightEnd, casts, buffs,
  castEvents, tableIds, truncated, fetchedAt, pointsSpent }`. `pointsSpent` = difference of
  `pointsSpentThisHour` read by the last page versus the value the budget pre-check (`PING_QUERY`,
  issued right before the fetch) returned, rounded to 0.1 and floored at 0; `null` when the fetch
  had no such baseline (before the click the estimate 3 is shown).
- Stored raw in `wcl_deepdive(code, fight, character, query_version, json, fetched_at)`;
  `DEEPDIVE_QUERY_VERSION = 1`. A cached row whose `tableIds` misses ids now in the effective
  table is **stale**: the server re-fetches only when the user clicks *Analyze* again on that
  run (the UI shows "table changed — re-analyze (~3 pts)"); otherwise the cached analysis is
  shown with the ids it has.
- Budget guard: `/api/deepdive` refuses with `402 { error: "WCL budget low (N pts left)" }` when
  `rateLimitData.limitPerHour − pointsSpentThisHour < 20` — checked by the PING pre-check before
  the first page and again before each *subsequent* events page (a page already paid for is
  never discarded on its own answer).

## Analysis (`src/deepdive/analyze.ts`, pure)

Inputs: `RawDeepDive`, the run's `RunSignals` (for `fightDurationMs`, `deaths.events[].inWipe`)
and the cached raw `Deaths` table entry for the character (`timestamp`, `deathWindow`,
`killingBlow`, `damage.abilities[]`, `events[]`), the effective `DefensiveSpell[]`.

```ts
interface DefensiveUse {
  id: number; name: string; kind: "major" | "immunity" | "minor";
  cooldownS: number; durationS: number;
  casts: number;                    // from castEvents (fallback: Casts table total)
  capacity: number;                 // ceil(fightDurationS / cooldownS), ≥ 1
  usage: number;                    // min(1, casts / capacity)
  observedMinIntervalS: number | null; // min gap between consecutive casts; null if < 2 casts
  cdMismatch: boolean;              // observedMinIntervalS !== null && observedMinIntervalS < 0.9 × cooldownS
}
interface DeathAnalysis {
  atMs: number;                     // ms since fight start
  inWipe: boolean;                  // from RunSignals (≥ 3 group deaths within ±15 s)
  killingHits: { name: string; amount: number; share: number }[]; // top 3 of deathWindow damage.abilities by total
  killingBlow: string | null;
  available: string[];              // defensives with no cast in (atMs − cooldownS, atMs] and not active (a cast exactly one cooldown before the death is available again)
  active: string[];                 // a cast in [atMs − durationS, atMs]
  onCooldown: { name: string; readyInS: number }[];
  verdict: "immunity available" | "defensive available" | "covered" | "nothing available";
}
interface RunDefensives {
  reportCode: string; fightID: number; character: string;
  className: string; spec: string; tableMissing: boolean; tableVersion: string;
  defensives: DefensiveUse[];
  deaths: DeathAnalysis[];
  majorUsage: number | null;        // mean usage of kind ∈ {major, immunity}; null if none listed
  avoidableDeaths: number;          // deaths (not inWipe) with verdict immunity/defensive available
  countedDeaths: number;            // deaths not inWipe
  unlisted: { id: number; name: string; casts: number; uptimeS: number }[]; // audit, see below
  fetchedAt: number; pointsSpent: number;
}
```

Rules:

- **Casts** per defensive come from `castEvents` (exact timestamps). If the events page is
  missing an id that the `Casts` table reports (should not happen), the table total is used
  and `observedMinIntervalS` is null.
- **Availability at a death** uses the *table* cooldown (baseline). Windows are inclusive of the
  death timestamp. `readyInS = cooldownS − (atMs − lastCastMs)/1000`, rounded to 1 s.
- **Verdict** precedence: any `immunity` available → `immunity available`; else any `major`
  available and nothing active → `defensive available`; else anything active → `covered`;
  else `nothing available`. `minor` entries never drive the verdict (they are listed under
  `available`/`active` for information).
- **Wipe deaths** (`inWipe`) keep their analysis but are excluded from `avoidableDeaths` and
  `countedDeaths`.
- **Audit — `unlisted`**: auras from the `Buffs` table with `totalUses ≥ 1` whose `guid` also
  appears in the `Casts` table (self-cast), minus ids in the effective table, minus ids marked
  `ignore` in the override, minus a shipped denylist of obvious non-defensives (potions, food,
  flasks, runes, Vantus, Well Fed, class offensives such as Avenging Wrath). Sorted by casts
  desc. This is reading C of the design discussion, kept as a diagnostic.
- **Audit — `cdMismatch`** flags a table cooldown longer than what the log shows (talent or
  wrong table). It never changes the score; the UI shows "table 45 s · observed 38 s".

## Aggregation and evaluation

`deepdiveSummary(runs: RunDefensives[])` (pure):

```ts
{ analyzedRuns: number; majorUsage: number | null /* median of runs' majorUsage */;
  avoidableDeathShare: number | null /* Σ avoidableDeaths / Σ countedDeaths; null when Σ countedDeaths = 0 */;
  avoidableDeaths: number; countedDeaths: number }
```

Evaluation (`src/evaluation`): `EvalPayload.deepdive?: RunDefensives[]` (the displayed runs that
are already analyzed; `collectInputs` derives the summary). Two new Survival sub-signals,
present only when `analyzedRuns ≥ cfg.confidence.deepdiveMinRuns` (default **2**), otherwise
`null` (n/a) exactly like a missing signal:

| id | input | curve | weights dps/healer/tank |
|---|---|---|---|
| `defensiveUsage` | `majorUsage` (0–1) | `[0,20] [0.3,55] [0.6,85] [0.9,100]` | 2 / 2 / 2 |
| `avoidableDeaths` | `avoidableDeathShare` (0–1), null when no counted death | `[0,100] [0.34,60] [0.67,30] [1,10]` | 3 / 3 / 3 |

Evidence labels cite facts: `majors used 41% of the time (3 runs)`,
`2/3 deaths with a defensive available`; their `source` is `survival.defensiveUsage` /
`survival.avoidableDeaths` like any sub-signal. `Evaluation` gains `analyzedRuns: number` so
the UI can badge the axis ("3 runs analyzed"); `runsUsed`/confidence are unchanged (they count
enriched runs). Default weights of the existing survival sub-signals are untouched; with the
two new signals present the axis simply has more evidence. `evaluation.json` overrides apply as
for any sub-signal (`confidence.deepdiveMinRuns` joins `consistencyMinRuns`).

`bmpl evaluate <payload.json>` works offline with `deepdive` in the payload.

## API

| Route | Body / query | Response |
|---|---|---|
| `POST /api/deepdive` | `{ reportCode, fightID, character, force?: boolean }` | `{ ok, result: RunDefensives, fromCache, pointsSpent }`; `402` budget low; `404` run not in the raw store (analyze requires a prior lookup that enriched the run); WCL errors relayed as `502 { error }` |
| *(no batch route)* | — | "Analyze all shown" is a client-side sequential loop over `POST /api/deepdive` that stops on the first error (a `402` included) and shows inline progress — same behaviour, one route and no SSE event fewer (ruled at plan time, 2026-09-16) |
| `GET /api/defensives?class=&spec=` | — | `{ ok, entries: (DefensiveSpell & { origin })[], tableMissing, overridePath }` |
| `POST /api/defensives` | `{ className, spec, patch: OverrideEntry }` | writes/merges the user override file, returns the new effective entries; `400` with the validation message on a bad patch |
| `POST /api/lookup` (existing) | — | payload gains `deepdive: RunDefensives[]` from the store (0 pts) |

After a `POST /api/defensives`, the client re-requests `/api/lookup` for the active tab with
`refresh: false`: the server re-runs `analyzeRun` on the cached raw rows (the lookup itself is a
history hit), so the new table is reflected at 0 pts. The server keeps no analysis cache — only
raw rows; analysis is recomputed on read (it is microseconds).

## CLI

- `bmpl analyze <Name-Realm> [--run <code>:<fight>]... [--all] [--level N] [--json]` — performs
  the lookup (cache), analyzes the given runs (or all displayed runs with `--all`), prints the
  estimated cost and asks for confirmation unless `--yes`, then prints `renderDeepDive` per run.
- `bmpl defensives <Class> <Spec>` — prints the effective table with origins and the override
  path; `bmpl defensives --check` validates the override file.
- `bmpl lookup` output gains, under each run that has an analysis, one line:
  `defensives: majors 41% · 1/2 deaths with a defensive available · unlisted: Light's Potential (5×)`.

## Web UI (Detail)

- Each run row gets a right-side action: **Analyze · ~3 pts** (or **Analyzed ✓** with a
  chevron). The runs section header gets **Analyze all shown (~N pts)** which analyzes the
  pending runs one after the other and shows "Analyzing i/n…"; disabled while running.
- The analyzed row expands into a **Defensives** panel (`RunDeepDive.tsx`), three blocks:
  1. **Usage** table: `name · kind · casts / capacity · usage % · CD table (obs. min interval)`;
     `cdMismatch` rows show a yellow "talent?" chip.
  2. **Deaths**: one line per death — `mm:ss · killing hits: A 62% · B 30% · C 8% · verdict`
     with the available / active / on-cooldown lists (`Divine Protection on cooldown, 12 s
     left`); wipe deaths are dimmed with a "wipe" chip and excluded from the count shown in the
     block title (`1/2 deaths with a defensive available`).
  3. **Audit**: "Not in table" list with per-entry actions *Add as major / immunity / minor*
     (opens a two-field inline form: cooldown s, duration s) and *Ignore*; collapsed "Table used
     (Holy Paladin · 4 entries · 1 from your override)" with per-row *Edit cooldown* and
     *Remove for this spec*. Actions call `POST /api/defensives`, then the tab refreshes.
- Hero / Survival axis: the two new evidence lines appear like any other; the axis row carries a
  small "3 runs analyzed" chip when deep-dive evidence is present. Compare table: row
  **Defensives** = `41% · 1/3 avoidable` per character when available, `—` otherwise; higher
  usage wins the highlight.
- All strings English; view models in `web/src/lib/deepdive.ts` are pure and tested; components
  stay thin (spec of sub-project 3 applies).

## Errors and edge cases

- Run not enriched (`--no-stats` lookup, or WCL report gone): *Analyze* is disabled with the
  reason.
- `tableMissing`: panel shows only the audit block plus "No defensives table for Frost Death
  Knight yet — add entries below"; the survival sub-signals stay null for that run.
- Zero deaths: deaths block reads "No deaths"; `avoidableDeathShare` excludes the run's
  denominator (0/0 handled at aggregation).
- Fight shorter than a cooldown: `capacity` floors at 1.
- Events pagination beyond 5 pages: stop, keep what was fetched, flag `truncated: true` in the
  raw row and show a warning line.
- Override file unreadable/invalid JSON: the shipped table is used, the UI banner names the
  file and the error; `POST /api/defensives` refuses until fixed.
- Concurrency: the UI disables every Analyze action while one is running; the server accepts
  concurrent requests (each is independent and idempotent on the cache).

## Tests

- `test/deepdive/analyze.test.ts` — fixtures: the Muleyoxo Voidscar run (captured
  `RawDeepDive` + cached Deaths entry: 1 death, Divine Protection 27 casts, Divine Shield 5)
  and one DPS run with ≥ 2 deaths captured during implementation. Assertions: casts/capacity/
  usage, `observedMinIntervalS`, availability windows at each death (synthetic cases at the
  boundaries: cast exactly `cooldownS` before death = available; cast `durationS` before death =
  active), verdict precedence, wipe exclusion, `unlisted` filtering (denylist, ignore, table).
- `test/deepdive/table.test.ts` — merge of `Class:*` + `Class:Spec`, override patch/add/ignore,
  validation errors, `origin` reporting.
- `test/deepdive/aggregate.test.ts` — median usage, share with zero counted deaths → null.
- `test/evaluation/*` — the two sub-signals: null below `deepdiveMinRuns`, curve values, labels.
- `test/deepdive/store.test.ts` — round trip, query version, in-memory fallback.
- `test/server*.test.ts` — `/api/defensives` GET/POST on a temp override path; `/api/deepdive`
  404 when the run is not in the store (no network).
- `web/src/lib/deepdive.test.ts` — rows, death lines, cost estimate text.
- Manual: analyze the two fixture runs on the built binary, correct a cooldown from the UI,
  see the panel and the Survival evidence update at 0 pts.

## Cost summary

| Action | WCL points |
|---|---|
| Analyze one run | ~3 (2 tables + 1 events page), once ever |
| Analyze all shown (8–9 runs) | ~25–30 |
| Correct the table / re-open a tab | 0 |
| Re-analyze after the table gained ids | ~3 |

## Out of scope / follow-ups

- Absolute (population) references for usage per spec — needs a corpus; later.
- Coverage of damage spikes outside deaths (reading C as a score).
- External defensives and healer contribution.
- Talent-aware cooldowns (WCL `combatantinfo` events carry talents; possible later).
