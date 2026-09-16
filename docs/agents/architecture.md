# Backend architecture (`src/`)

Read this before changing anything under `src/`. The specs in `docs/superpowers/specs/` are the authority when this page and the code disagree — fix whichever is wrong.

## Data flow of a lookup

```
bmpl lookup / POST /api/lookup
  └─ performLookup(opts, deps)                         src/lookup.ts
       ├─ fetchMplusData → rankings (WCL, ~10 pts)     src/mplus.ts, src/wcl/queries.ts
       ├─ analysis: metric (dps/hps by spec), spec filter, per-dungeon best runs, displayed runs (≤ 9)
       ├─ in parallel:
       │    ├─ enrichRuns → per displayed run: cached RawRunReport or WCL report.table (~10 pts/run)   src/signals/enrich.ts, wcl-run.ts
       │    └─ fetchRioProfile → Raider.IO (free, 1 h TTL cache, retry/backoff)                        src/signals/rio-client.ts, rio-profile.ts
       ├─ summary (cross-run aggregates, peers medians)                                                src/signals/summary.ts, peers.ts
       ├─ attachDeepdive → cached deep-dive analyses only (0 pts)                                      src/deepdive/attach.ts
       └─ evaluate(payload, cfg) → axes + verdict                                                      src/evaluation/
  └─ buildLookupPayload(...) → LookupPayload (the one type the CLI renderer and the web front consume)
```

`Deps` (`store`, `gql`, `fetchFn`, `evalConfig`, `tables`) exist so tests inject fakes — keep every new I/O behind them. `LookupPayload = ReturnType<typeof buildLookupPayload>`: add fields there, never in a parallel type.

## WCL client and budget

- `src/wcl/auth.ts` caches one OAuth2 client-credentials token in memory; `src/wcl/client.ts` `gql<T>(query, variables)` is the only network entry point; `src/wcl/queries.ts` holds every GraphQL document (add `rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }` when you need cost visibility; `PING_QUERY` reads it alone for 0 pts).
- Budget: 3600 pts/h per API client. Costs: rankings ≈ 10, one run's `report.table` enrichment ≈ 10, one deep-dive run ≈ 3, Raider.IO 0. Nothing may fetch outside `lookup`/`mplus` enrichment and the explicit deep-dive. The deep-dive refuses with 402 when fewer than 20 pts remain and measures `pointsSpent` against a PING baseline.
- Never add a per-death, per-event or per-page query pattern; batch into one request per run (see `REPORT_DEEPDIVE_QUERY`).

## SQLite cache — `src/signals/store.ts`

`Store` interface (`openStore(path)`, `openStoreOrMemory`, `getStore()` singleton, `closeStore()`), tables created with `CREATE TABLE IF NOT EXISTS`, schema changes must be additive:

| Table | Key | Content | Lifetime |
|---|---|---|---|
| `wcl_run_raw` | `(report_code, fight_id)` | raw WCL run report, `QUERY_VERSION = 2` | forever (immutable) |
| `wcl_deepdive` | `(report_code, fight_id, character)` | Casts + Buffs tables + filtered cast events, `DEEPDIVE_QUERY_VERSION = 1` | forever |
| `rio_profile` | `(region, realm, name)` | raw Raider.IO profile | `RIO_TTL_MS` = 1 h |

Bump a `*_QUERY_VERSION` when the GraphQL document changes shape; old rows are then ignored and refetched. Rankings are never cached (they move). The `_db` handle is for tests only. Path: `BMPL_DB_PATH` or `bmpl.db` next to `.env`.

## Evaluation — `src/evaluation/`

Six axes (`survival, utility, throughput, consistency, preparation, experience`), each a weighted mean of sub-signals scored through piecewise-linear curves (`curve.ts`), weights per role (`dps | healer | tank`, `src/roles.ts`). Rules live in `default-config.json` (`levelScale`, `expectedIlvl` per season, `axes.*.subSignals.*.{curve, weights}`, `confidence: { high, medium, consistencyMinRuns, deepdiveMinRuns }`); the user may override with `evaluation.json` next to `.env` (`config.ts` merges and validates). `evaluate()` returns `Evaluation { axes, global, verdict: invite|maybe|pass|insufficient, confidence, runsUsed, analyzedRuns, … }` with `Evidence[]` per axis — every score must be explainable by evidence lines; the front shows them verbatim. A sub-signal with no data is `null`, never 0. `bmpl evaluate saved.json` replays the model offline on a `lookup --json` payload — use it when tuning curves.

## Signals — `src/signals/`

`wcl-run.ts` parses a raw run report into `RunSignals` (deaths, interrupts, dispels, avoidable damage, ilvl, timed/depleted). Peer comparison (`peers.ts`) uses the medians of the other players in the same run, same role. Kicks are normalised by spec cooldown (`kick-cooldowns.ts`); dispel capability per spec (`dispel-capability.ts`). Avoidable damage = a per-dungeon spell list under `avoidable/season-*.json`, regenerated with `just import-avoidable` from the upstream postmortem project (attribution issue pending upstream — do not redistribute the list elsewhere). Previous-season Raider.IO absence is *unknown*, never penalised.

## Deep-dive — `src/deepdive/`

Defensive-cooldown analysis of one run for one character, on demand (`bmpl analyze`, `POST /api/deepdive`). Spec: `docs/superpowers/specs/2026-09-16-run-deep-dive-design.md` — its rules (capacity, usage, inclusive/half-open windows, verdict precedence, wipes excluded, stale-table ids never judged) are encoded in `analyze.ts` tests; change the spec and the tests together or not at all.

- `defensives.json`: shipped table `{ version, denylist, specs: { "Class:Spec": [{ id, name, cooldownS, durationS, kind: major|minor|immunity }] } }`. Validate with `just audit-defensives` (empirical, ~9 pts per spec per run) rather than from memory; Wowhead pages cannot tell talent-tree membership.
- `table.ts` merges shipped ⊕ user override (`defensives.json` next to `.env`, edited through `POST /api/defensives` or by hand); an invalid override is reported as `tableWarning`, never silently dropped.
- The audit of unlisted self-cast buffs uses `denylist` + the `NON_DEFENSIVE_NAME` regex; add ids to the denylist rather than widening the regex when a single spell is wrong.

## Server — `src/server.ts`

`Bun.serve` on `:3000`: `/api/setup` (writes `.env`), `/api/lookup`, `/api/deepdive`, `/api/defensives` (GET/POST), `/api/history[/…]` (in-memory `History(20)` of tabs, `updateResult` after analyses/table edits), `/api/events` (SSE with heartbeat: lookup results, watcher events), `/api/watch/{start,stop,status}` (clipboard watcher), `/api/quit`, `/api/status`; everything else serves the embedded `web/dist` (`src/web-static.ts`, `src/web-assets.ts` — guarded dynamic import, 503 when not built). Responses are `jsonResponse({ ok, … })`; errors carry `{ ok: false, error }` with 4xx/5xx. The file is large; new feature areas go in their own module (see issue #2 for the planned split).

## CLI — `src/cli.ts`

Commands: `ping, char, lookup, mplus, evaluate, analyze, defensives, serve, watch, zones, raw-rankings, raw-encounter, help`. Rendering in `format-mplus.ts` (picocolors). Anything that spends points must confirm unless `--yes`; `--json` never bypasses the confirmation. `if (import.meta.main) main()` keeps the module importable by tests.

## Config and files next to `.env`

`resolveEnvPath()` looks in cwd then next to the executable. Beside that `.env`: `bmpl.db`, `evaluation.json`, `defensives.json`. Env overrides: `BMPL_DB_PATH`, `BMPL_EVAL_CONFIG`, `BMPL_DEFENSIVES`, `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`. All are user data: git-ignored or, at the repo root, simply never staged.

## Invariants worth re-reading before a change

- Immutable raw in, recomputed analysis out. Never cache a derived score.
- A missing signal is `null` with a reason, not 0.
- Costs are stated in the README "API cost" section; update it when a query changes.
- Season-specific content is a versioned data file, not code.
- `Class:Spec` keys, WCL spelling, everywhere.
