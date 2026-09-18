# Testing

`bun test` from the repo root runs everything: `test/**/*.test.ts` (backend) and `web/src/**/*.test.ts` (front view models). ~464 tests, a few seconds, no network, no `web/dist` needed. `just check` (tsc for both projects) is the other gate. Both must be green before a commit.

## Conventions

- **bun:test** (`describe`, `test`, `expect`, `beforeAll`/`afterAll`); one test file per module, mirroring the path (`src/deepdive/analyze.ts` → `test/deepdive/analyze.test.ts`, `web/src/lib/axes.ts` → `web/src/lib/axes.test.ts`).
- **No network, ever.** Inject fakes through the `deps` objects (`performLookup(opts, { store, gql, fetchFn, evalConfig, tables })`, `enrichRuns(runs, name, store, { gql })`, `fetchRioProfile(region, realm, name, store, { fetchFn, sleep })`). A test that would hit WCL or Raider.IO is a bug.
- **SQLite**: `openStore(":memory:")` per test (`openStoreOrMemory` is the CLI's fallback, not a test helper); the `Store._db` handle exists for asserting rows.
- **Server tests** (`test/server*.test.ts`) start `runServer({ port: 0, … })` on an ephemeral port with a temp dir / in-memory store and fake `gql`; they must pass with `web/dist` missing (static routes answer 503 — `test/server.test.ts` covers it). Hosted per-user state has its own files: `test/server-user-state.test.ts` (hosted server with two users, dummy WCL credentials, never fetches), `test/server-sse.test.ts`, `test/hosted/history.test.ts`, `test/hosted/settings.test.ts`, and the front side in `web/src/lib/settings.test.ts`. The shared defensives layer has `test/hosted/defensives.test.ts` (`tablesFor`/`propose`/`decide` against an in-memory `HostedDb`) and `test/server-defensives.test.ts` (the `/api/defensives` and `/api/admin/proposals` routes end to end: lifecycle, author vs. others vs. after approval, dedupe, admin auto-approve, rejection note).
- **Hardening** (issue #9): `test/server-hardening.test.ts` covers secrets hygiene (dotfiles never served, SSE is GET-only), the bare "Internal error" + `server_error` audit row of a handler that throws, and the 429/403 shapes end to end. `test/hosted/origin.test.ts` (`checkOrigin`) and `test/hosted/ratelimit.test.ts` (`RateLimiter`) unit-test the two guards; `test/hosted/audit.test.ts` covers `AuditLog` and the `HostedDb.audit` repo (scope, retention, kind counts). `runServer`'s `ServeOptions.rateLimits` (`Partial<RateLimits>`) overrides `DEFAULT_RATE_LIMITS` per test so a test can hit a limit in a handful of requests instead of 10–60; `getHostedRuntime()` (exported from `src/server.ts`, the module-level runtime of the last `runServer` call) is the test hook for reaching the live `HostedRuntime` — its `audit`, `db`, `meter` — to assert rows and quota state without re-querying SQLite directly.
- **WCL budget and quotas**: `test/wcl/meter.test.ts` (`PointsMeter` attribution, window/reset logic), `test/hosted/quota.test.ts` (`QuotaGate.reserve`/`status`, the quota and budget refusals, admin exemption), `test/lookup.test.ts` (`performLookup` end-to-end with `fetchMplus`/`gql` fakes and dummy WCL credentials — the pattern for any future lookup test), `test/server-lookup.test.ts` (in-flight dedupe, refresh never joining a flight, the 429 shapes), and `web/src/lib/quota.test.ts` (`pointsLeft`/`quotaLabel`/`canAfford`).
- **Front tests never import React or the DOM**: they test `web/src/lib/*` view models with plain objects. Component logic that needs a test belongs in a view model.
- **Rules live in tests.** Spec-mandated numbers (curves, windows, precedence, costs) are asserted literally — when a spec rule changes, change the spec, the test and the code in the same commit.
- Builders over fixtures for unit tests: `test/evaluation/helpers.ts` (`neutralSignals`, `deaths`, …) builds minimal `RunSignals`/`EvalPayload`; prefer extending those helpers to adding JSON.
- **`bun test` does not type-check and auto-loads the repo's `.env`.** A test that could fall through to a real WCL call must set dummy `WCL_CLIENT_ID`/`WCL_CLIENT_SECRET` for its duration (see `test/lookup.test.ts`, `test/server-lookup.test.ts`, `test/server-user-state.test.ts`) — a RED step must never rely on a type error to keep a network path closed.

## Fixtures (`test/fixtures/`)

Real captures of WCL and Raider.IO responses, loaded through `test/fixtures.ts` (`loadWclFixture("s1-tank" | "s2-healer")`, `loadRioFixture()`, `loadDeepdiveFixture("s2-healer" | "s2-rogue")`). They are the parsers' contract tests (`wcl-run`, `rio-profile`, `deepdive/wcl` + `analyze`).

Capturing a new one spends points and needs `.env`:
- deep-dive: `bun scripts/capture-deepdive.ts Name-Realm <reportCode> <fightID> test/fixtures/deepdive-<season>-<dungeon>-<role>.json` (the run must be in the cache — do a `bmpl lookup` first; ~3 pts);
- run report / RIO: save the raw JSON from a `bmpl lookup --json` session or the `bmpl raw-*` commands, keeping the `{ character, run, report }` envelope used by the existing files.

Name fixtures by season + dungeon + role, register them in `test/fixtures.ts`, and never commit the user's own saved payloads (`biwaasham.json` stays untracked).

## Manual verification

- CLI: `just l Name-Realm` against a known character, then `bun src/cli.ts analyze Name-Realm` (cached runs show at 0 pts; it confirms before spending).
- Web: `just build && ./bmpl serve` for the embedded UI, or `just serve --no-open` + `just web-dev` for hot reload. After a rebuild, hard-reload the browser (fixed asset names) and make sure no older `./bmpl serve` still holds :3000.
- Spell tables: `just audit-defensives --only Class:Spec --runs 2` (≈ 9 pts per spec per run) is the way to validate `defensives.json`.
- Points: `just ping` shows the hourly budget before and after.
