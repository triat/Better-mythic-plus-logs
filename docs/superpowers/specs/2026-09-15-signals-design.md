# Signals layer — design

Sub-project 1 of 4 (signals → evaluation model → separate front → on-demand run deep-dive: defensive cooldown efficiency). See the
roadmap decision: local-first, designed so a hosted multi-user service is
possible later.

## Goal

Add the signals that actually separate a good Mythic+ player from a
"good parse", without increasing the number of WCL runs enriched per lookup:

1. **Timed vs depleted** per run (`keystoneBonus` / `keystoneTime`).
2. **Interrupts** normalized by the spec's kick cooldown, vs peers in the
   same fight; **dispels** raw.
3. **Avoidable damage** taken, from Blizzard's in-game classification
   (captured spell-ID list) filtered server-side by WCL.
4. **Death context**: when, what killed, whether it was a group wipe.
5. **Raider.IO profile**: item level, recent runs (timed ratio, activity),
   current + previous season scores per role.
6. A **SQLite store** so every WCL enrichment is fetched once, forever.

No composite score, no per-role interpretation — those are sub-project 2.

## Verified facts (probe of 2026-09-15)

- `report.fights(fightIDs:[id]) { keystoneLevel keystoneBonus keystoneTime keystoneAffixes rating }`
  returns bonus `0` (depleted) / `1..3` (chests) and time in ms.
- `table(dataType: Interrupts)` and `table(dataType: Dispels)` share one shape:
  `data.entries[0].entries[]` = one entry per interrupted/dispelled spell, each
  with `details[] { name, total, abilities[] }` = per-player count.
- `table(dataType: Deaths)` entries carry `name`, `timestamp`, `overkill`,
  `damage.abilities[]` (biggest hitters in the death window),
  `damage.sources[]`, `deathWindow`.
- `table(dataType: Summary)`: `composition[] { name, specs[{ spec, role }] }`,
  `playerDetails.{dps,healers,tanks}[] { name, minItemLevel, maxItemLevel }`,
  `totalTime`.
- `table(dataType: DamageTaken, filterExpression: "ability.id in (…)")`
  returns per-player totals restricted to those spell IDs in one call.
- The WCL v2 schema has **no** notion of avoidable damage (full introspection,
  any tier). Blizzard classifies avoidable spells in-game (`C_DamageMeter`,
  12.0+) but the classification is not written to the combat log file, so it
  must be captured in-game and shipped as a spell-ID list. The open-source
  [postmortem](https://github.com/Sharpened-Banana/postmortem) project ships
  such a capture for Midnight S2 (101 spells, 8 dungeons, keyed by MDT
  dungeon index) — no license on the repo, ask before reusing.
- Point cost per run: current query 4.1 pts; with `fights` + `Interrupts` +
  `Dispels` **7 pts**; with the avoidable-damage table **~10 pts**. 9 runs →
  ~90 pts/lookup uncached (+~10 for rankings).
- WCL subscriptions raise the hourly point budget of the account owning the
  API client (figures seen: 9 000 / 18 000, or 36 000 via Patreon — check the
  WCL profile page). They unlock no extra API data. Not needed in local mode;
  relevant once hosted.
- Raider.IO `characters/profile` is free, keyless, but returned 502/504 in
  bursts during the probe. Field syntax: one `mythic_plus_scores_by_season:X`
  per season (`current`, `previous`). `mythic_plus_best_runs` only covers the
  current season.

## Data model

### `RunSignals` (one per enriched WCL run)

```ts
interface PeerComparison { median: number; count: number }

interface DeathEvent {
  atMs: number;          // ms since fight start
  cause: string | null;  // top ability in the death window
  source: string | null; // top damage source (NPC name)
  overkill: number;
  inWipe: boolean;       // >= 3 group deaths within a 15 s window around this death
}

interface RunSignals {
  role: "dps" | "healer" | "tank" | "unknown";
  keystone: { level: number; chests: number; timed: boolean; timeMs: number; affixes: number[] };
  itemLevel: number | null;
  deaths: { count: number; groupTotal: number; events: DeathEvent[] };
  damageTaken: { total: number; dtps: number; peer: PeerComparison | null };
  interrupts: {
    count: number;
    kickCooldownS: number | null;   // from the spec table; null = spec has no kick
    capacity: number | null;        // fightDuration / kickCooldownS
    usage: number | null;           // count / capacity — fraction of available kicks used
    peer: PeerComparison | null;    // peers compared on `usage`, not `count`
  };
  dispels: { count: number };
  avoidableDamage: {
    total: number; perMinute: number;
    peer: PeerComparison | null;    // on perMinute
    spellCount: number;             // size of the list used, for transparency
  } | null;                         // null when no list exists for this dungeon
  fightDurationMs: number;
  partial?: boolean;     // true when fights[0] was missing and keystone fell back to ranking data
}
```

Peer sets, per signal:

| Signal | Target excluded | Peer set | Why |
|---|---|---|---|
| damageTaken | yes | players with role `dps` | unchanged from today; tanks get `peer: null` |
| interrupts | yes | players with role `dps` or `tank` **and** a known kick cooldown, compared on `usage` | kick cooldowns range from 12 s (Wind Shear) to 60 s (Solar Beam); raw counts penalize casters. Specs with no kick are excluded and get `usage: null` |
| dispels | — | none | too spec-dependent to compare; raw count only |
| avoidableDamage | yes | all other players (any role) | avoidable is avoidable regardless of role; on `perMinute` |

Kick cooldowns live in `src/signals/kick-cooldowns.ts` (spec name → seconds,
~35 entries; source: in-game tooltips, baseline values without talents).
Spec comes from `Summary.composition[].specs[0].spec`. Unknown spec →
`kickCooldownS: null`, treated like "no kick".

Avoidable-damage lists live in `src/signals/avoidable/<season-slug>.json`:
`{ season, capturedAt, source, dungeons: { [wclEncounterID]: number[] } }`.
The parser looks up the list by `encounterID`; no list → `avoidableDamage:
null` (rendered `—`, never `0`). Seeding the Midnight S2 list from postmortem
(with attribution, after asking the author) is a task of the implementation
plan; mapping its MDT dungeon indices to WCL encounter IDs is done once by
hand. A capture addon of our own is out of scope.

`timed = chests > 0`. `MPlusRun.quality` is replaced by `MPlusRun.signals?: RunSignals`.

### `RioProfile`

```ts
interface RioRun {
  dungeon: string; shortName: string; level: number;
  completedAt: number; clearMs: number; parMs: number;
  chests: number; score: number; affixes: string[]; url: string;
}

interface RioProfile {
  fetchedAt: number; lastCrawledAt: number; profileUrl: string;
  itemLevel: number | null; activeSpec: string | null; activeRole: string | null;
  seasons: Array<{ slug: string; all: number; dps: number; healer: number; tank: number }>;
  recentRuns: RioRun[];
  bestRuns: RioRun[];
  weeklyBest: RioRun[];
  derived: {
    recentTimed: number; recentTotal: number;   // chests > 0 over recentRuns
    runsLast7d: number; lastRunAt: number | null;
  };
}
```

Request: one call, `fields=gear,mythic_plus_scores_by_season:current,mythic_plus_scores_by_season:previous,mythic_plus_recent_runs,mythic_plus_best_runs,mythic_plus_weekly_highest_level_runs`.

WCL runs and RIO runs are **not joined** in this iteration; they render in
separate sections.

**Previous-season score is presence-only evidence.** Players who chase the
meta reroll, so an alt with no previous-season score can belong to an
experienced player. Absence is rendered `—` with the hint "no data (reroll?)",
never `0`, and the evaluation model (sub-project 2) must not penalize it.
No public API links characters of one account; manual alt linking is a
possible later feature.

## Store (`bun:sqlite`)

File: `bmpl.db` next to `.env` (resolved via the same logic as `resolveEnvPath`).
Added to `.gitignore`. Two tables, raw JSON + key:

```sql
CREATE TABLE IF NOT EXISTS wcl_run_raw (
  report_code TEXT NOT NULL, fight_id INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (report_code, fight_id));
CREATE TABLE IF NOT EXISTS rio_profile (
  region TEXT NOT NULL, realm TEXT NOT NULL, name TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (region, realm, name));
```

- `wcl_run_raw` stores the **raw GraphQL `report` object** (fights + 5 tables).
  Never expires: a log is immutable. Storing raw means a future signal parsed
  from the same tables costs zero points.
- `rio_profile` TTL 1 h. `refresh: true` on `/api/lookup` bypasses the TTL.
  WCL raw is never invalidated, even on refresh.
- Each `wcl_run_raw` row carries the `query_version` it was fetched with; if
  `REPORT_RUN_SUMMARY_QUERY` later gains a table, bump the `QUERY_VERSION`
  constant and older rows are ignored (kept on disk — a future migration may
  reuse them).
- The server's in-memory `history` (payload cache, 20 entries) is unchanged.
- The compiled binary embeds `bun:sqlite`; nothing extra to ship.

## Modules

```
src/signals/
  types.ts        RunSignals, RioProfile, RioRun, PeerComparison, DeathEvent
  peers.ts        peerComparison(values: Array<{name, value}>, target, roleByName, peerRoles): PeerComparison | null
  wcl-run.ts      parseRunSignals(rawReport, characterName): RunSignals | null   (pure)
  rio-profile.ts  parseRioProfile(rawJson, now): RioProfile                      (pure)
  store.ts        openStore(path | ":memory:"): Store { getWclRun, putWclRun, getRio, putRio, close }
  enrich.ts       enrichRuns(runs, characterName, store): Promise<void>   — cache → gql → store → parse; parallel; per-run failures leave `signals` undefined
  rio-client.ts   fetchRioProfile(region, realm, name, store, { refresh }): Promise<RioProfile | null>  — retries 3× (1 s / 2 s / 4 s) on 5xx/network; returns null + error message on final failure
src/wcl/queries.ts   REPORT_RUN_SUMMARY_QUERY += fights(...) + Interrupts + Dispels + avoidable: DamageTaken(filterExpression) — the filter is built per run from the dungeon's list; runs without a list omit that table
src/signals/kick-cooldowns.ts   spec → kick cooldown seconds
src/signals/avoidable/season-mn-2.json   avoidable spell IDs per WCL encounterID
src/mplus.ts         loses fetchRunSummary / enrichLookupResult / RunQuality; keeps rankings fetch + analyzeLookup
src/setup.ts         adds resolveDbPath() (BMPL_DB_PATH override, else bmpl.db next to .env)
src/signals/summary.ts  signalSummary(runs, rio) — cross-run aggregates shipped in the payload as `summary`, so CLI and web render the same numbers
src/lookup.ts        performLookup() + buildLookupPayload() — one lookup flow shared by cli/server/watch (replaces three copies)
```

Rules:

- Parsers are pure functions over JSON. They never throw on missing
  sub-tables: a missing `interrupts` table yields `{ count: 0, peer: null }`,
  a missing `fights[0]` yields `keystone` from the ranking data (`level`,
  `affixes`) with `chests: 0, timed: false, timeMs: 0` and a `partial: true`
  flag on the `RunSignals`.
- `enrich.ts` and `rio-client.ts` are the only modules that touch the network
  or the store.
- Wipe detection: for each death of the target, count group deaths with
  `|t − atMs| ≤ 15 000`; `inWipe = count ≥ 3` (target included).
- Death `cause` = `damage.abilities[0].name` (largest hitter in the death
  window), `source` = `damage.sources[0].name`. Good enough; the last event of
  `events[]` would be the exact killing blow but is not needed yet.

## Lookup flow

```
/api/lookup (or CLI lookup)
  ├─ fetchMplusData (rankings, unchanged)
  ├─ analyzeLookup (unchanged)
  └─ Promise.all([
       noStats ? skip : enrichRuns(displayedRuns, name, store),
       fetchRioProfile(region, realm, name, store, { refresh })
     ])
```

Payload additions: `rio: RioProfile | null`, `rioError?: string`. Each
displayed run: `signals?: RunSignals` (replaces `quality`). RIO failure never
fails the lookup. `--no-stats` still skips WCL enrichment only.

## Rendering (minimal — the redesign is sub-project 3)

**Run row** (CLI + web): key badge gains timed state — `+18 ✓+1 27:32` in
green, `+18 ✗ depleted 31:04` in red. Quality line becomes:
`2 deaths (1 in wipe) · DTPS −8% · avoidable 12k/min (−20%) · kicks 5/18 (peer 22%) · dispels 8`.
Untimed still shows parse/amount as today.

**Tiles** (profile view, appended to the existing tile row):

| Tile | Value | Color |
|---|---|---|
| Timed (displayed) | `7/9` | green if all, orange otherwise |
| Kicks vs peers | median over runs of `(usage − peer.median) × 100` (points of capacity) | ≥ 0 green, < −25 red, else neutral; `—` if spec has no kick |
| Avoidable dmg vs peers | median over runs of `(perMinute − peer.median) / peer.median × 100` | ≤ −10 green, > 30 red, else neutral; `—` if no list |
| ilvl | RIO `itemLevel` | neutral |
| RIO recent timed | `8/10` | green ≥ 80 %, red < 50 %, else orange |
| Prev season | `3501 (healer)` or `— no data (reroll?)` | neutral |

`avg deaths` tile stays; its tooltip-free label becomes `Avg deaths (x in wipes)`.

**Compare table**: the same six rows added, modes `higher` for timed ratio,
kicks delta, ilvl, recent timed, prev season; `lower` for avoidable damage.

**New section "Recent (Raider.IO)"**: up to 10 rows `dungeon +lvl chests
clear/par date`, each linking to the RIO run URL. If `rio` is null, the
section shows the error dimmed.

**CLI**: `bmpl lookup` prints the same tiles as a summary block and the RIO
section; `--json` includes `rio` and `signals`.

## Tests

First tests in the project, `bun test`. Fixtures in `test/fixtures/`:

- `wcl-run-QvhzaWwPNxMVY4Xd-1.json` — raw report object from the probe
  (Magisters' Terrace +18, Biwaadrood). Captured once with the new query.
- `rio-profile-biwaadrood.json` — a RIO profile with non-empty `recentRuns`
  (capture when RIO is stable; if the season still has no runs for the example
  character, use any active character and anonymize nothing — it's public data).

Unit tests:

- `parseRunSignals`: keystone parsed (level 18, chests 1, timed true), target
  deaths/interrupts/dispels counts, kick `usage` = count / (duration / cd),
  peer medians on `usage` from DPS/tank with a known kick only, healer without
  kick → `usage: null`, tank gets `damageTaken.peer === null`, avoidable
  table present → perMinute + peers, absent → `null`, missing table → zero +
  null, wipe detection on a synthetic Deaths table.
- `parseRioProfile`: seasons, derived ratios, `runsLast7d` with an injected
  `now`.
- `peerComparison`: excludes target, filters roles, median of even/odd sets,
  empty → null.
- `store`: `:memory:` round-trip, RIO TTL expiry, WCL rows never expire,
  `QUERY_VERSION` mismatch hides rows.
- `enrichRuns` with a stubbed `gql` and `:memory:` store: second call makes
  zero network calls.

No network tests. `just test` recipe added.

## Cost budget

| | Before | After (uncached) | After (cached) |
|---|---|---|---|
| Per run | 4.1 pts | ~10 pts | 0 |
| Per lookup (9 runs + rankings) | ~47 pts | ~100 pts | ~10 pts |
| Lookups / hour (3 600 pts) | ~76 | ~36 | ~360 |

Re-looking up someone whose displayed runs haven't changed costs only the
rankings queries.

## Out of scope

- Composite score, per-role interpretation (sub-project 2).
- **Defensive cooldown efficiency** (sub-project 4): needs the events API
  (damage-taken timeline + defensive buff windows), ~15-30 pts per run, plus a
  spec → defensives table. Planned as an on-demand "analyze this run" action,
  not part of every lookup. The raw store designed here is the foundation.
- An in-game addon to capture Blizzard's avoidable-damage classification.
- WCL ↔ RIO run join.
- Enriching more than the displayed runs.
- Non-EU regions.
- UI redesign (sub-project 3, via Claude Design).
- Manual alt linking for reroll detection.
- Storing rankings / characters in SQLite (only needed when hosted).
