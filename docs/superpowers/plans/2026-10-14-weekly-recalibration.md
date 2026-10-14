# Weekly recalibration — implementation plan

**Goal:** the VPS collects calibration samples every hour with the WCL points the members leave, refits `globalCurve` and
`reference` every Wednesday, and a GitHub workflow turns a meaningful change into a pull request.
**Architecture:** the study's scripts move into `src/calibration/` behind `bmpl calibrate` (`--hourly`, `--fit`); samples
live in `calibration.db` next to `.env` (never `bmpl.db`); `GET /api/ops/calibration` serves the aggregates;
`.github/workflows/calibration-pr.yml` opens the pull request.
**Spec:** `docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md` (builds on
`docs/superpowers/specs/2026-09-24-scoring-calibration-design.md`).

## Global Constraints (from the spec)

- Output: a pull request with the candidate `default-config.json` and the comparison report; never a change to
  production by itself.
- What is refitted: `globalCurve` and `reference` per role, exactly what `scripts/calibration/fit-global.ts` fits today
  (the only parts of the study that shipped; sub-signal curves are not refitted).
- No third-party data in the repository; the collected payloads stay on the VPS; the ops route and the pull request
  carry aggregates only (no names).
- The instance's own WCL client, 18,000 pts/h. Read `limitPerHour` from `rateLimitData`, never a hard-coded limit.
  Spend up to `limitPerHour − BMPL_CALIBRATION_RESERVE` (default 3,000); reserve 300 inside Wednesday 03:00–06:00
  Europe/Paris. Pause 5 minutes after a member request reached WCL. One lookup every ≥ 16 s.
- Target: 2,000 characters in the rolling 4 weeks of the current season, balanced across role × level (15–20) ×
  performance quintile; stop collecting once reached.
- Own database: `calibration.db` next to `.env`, never `bmpl.db`.
- Fit and test halves as in the study (`isFit`: a character in one half only).
- Pull request only when, on the test half, ≥ 2 % of characters change verdict, or a role's median global moves by
  ≥ 2 points.
- Timers: collection `OnCalendar=hourly`, fit `OnCalendar=Wed *-*-* 06:00 Europe/Paris`. The PR workflow runs after
  the fit, from a UTC cron that lands after 06:00 Paris in both summer and winter time.
- The scheduled spend is an explicit, user-approved exception to "never spend WCL points automatically"; `AGENTS.md`
  records it next to the rule.
- Agents never touch the VPS: the new units ship in `deploy/` and the user installs them (`bootstrap.sh`).

## Files

| File | Responsibility |
|---|---|
| `src/calibration/discover.ts` | from `scripts/calibration/discover.ts`: the rankings pool (current season, EU, +15..+20, the study's sampling) |
| `src/calibration/collect.ts` | the hourly collector: governor (limit, reserve, member pause, pace), target check, writes samples |
| `src/calibration/samples.ts` | `calibration.db`: `samples(key, role, level, quintile, collected_at, season, payload_json)`, rolling-window prune |
| `src/calibration/fit.ts` | from `fit-global.ts` + `calibrate.ts`'s `isFit`/`percentileCurve`: `globalCurve` + `reference` from the fit half, the comparison on the test half |
| `src/calibration/report.ts` | `candidate.json` (the two blocks) and `comparison.md` (per role: n, verdict shifts, median moves; no names) |
| `src/calibration/window.ts` | pure: the Wednesday-window test in Europe/Paris, the reserve for an instant |
| `src/cli.ts` | `bmpl calibrate --hourly` / `--fit` |
| `src/server/routes-ops.ts` | `GET /api/ops/calibration` → `{ ok, fittedAt, candidate, comparison, thresholdMet }` (token-guarded) |
| `scripts/calibration/*.ts` | thin wrappers over `src/calibration/` (the study's offline use keeps working) |
| `deploy/bmpl-calibrate-collect.{service,timer}`, `deploy/bmpl-calibrate-fit.{service,timer}`, `deploy/bootstrap.sh` | the two units, installed by the user |
| `.github/workflows/calibration-pr.yml` | Wednesdays: fetch the aggregates, write `default-config.json`, open or update `calibration/<date>` |
| `test/calibration/*.test.ts` | governor, window, target, prune, fit/threshold, ops route |
| docs | `AGENTS.md` (the exception), `docs/agents/architecture.md`, `docs/operator.md`, `deploy/README.md`, `docs/scoring.md` |

## Tasks

Each task ends with `just check`, `just lint`, `bun test` (web/dist absent, no network: fake `gql`) and one commit.

### 1. Move the study's pure parts into `src/calibration/`
- `discover.ts` (LEVELS, roleOf, the pool type, the sampling), `fit.ts` (`percentileCurve`, `isFit`, the
  `globalCurve`/`reference` fit as functions taking samples), `samples.ts` reading the old `.calibration/payloads/*.json`
  too (so the study's data keeps working locally). `scripts/calibration/*` import from there.
- Tests: the fit on a small synthetic sample gives the expected curve end points and medians; `isFit` split stable.
- Commit `refactor(calibration): move the study's core into src/calibration`.

### 2. `calibration.db` and the rolling window
- `openSamples(path)` (bun:sqlite), `put(sample)`, `count({ season, since })` per cell, `prune({ season, keepSince })`.
- Path: next to `.env` (`resolveEnvPath()`), flag/env override `BMPL_CALIBRATION_DB`.
- Tests: put/count/prune; a sample of another season is dropped; never opens `bmpl.db` (path assertion).
- Commit `feat(calibration): sample store`.

### 3. The governor and the window (pure, TDD)
- `window.ts`: `inWednesdayWindow(now)` with `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", … })`;
  `reserveAt(now, cfg)` → 300 or `BMPL_CALIBRATION_RESERVE`.
- `governor`: given `rateLimitData`, the last member WCL observation time and the last lookup time, decide
  `go | wait(ms) | stop`: stop when `pointsSpentThisHour ≥ limitPerHour − reserve`; wait until 5 min after a member
  request; wait until 16 s after the previous lookup.
- Tests: summer and winter dates around 03:00/06:00 Paris; each branch of the governor.
- Commit `feat(calibration): budget governor and Wednesday window`.

### 4. `bmpl calibrate --hourly`
- Discover (pages cached per day in `calibration.db`), pick the next characters from the emptiest cells, run
  `performLookup` against a store opened on `calibration.db`, save the evaluation payload, until the governor says
  stop, the target is reached, or the hour ends. Member activity: the server's meter keeps its last observation in
  memory only (`PointsMeter.snapshot()`, `src/wcl/meter.ts`) and the collector is another process, so the meter's
  observer touches a `last-member-wcl` marker file next to `.env` (at most one write a minute) and the collector reads
  its mtime.
- Tests with a fake `gql`: stops at the limit, keeps the reserve, waits after a member marker, paces at 16 s, stops
  at the target, writes only to `calibration.db`.
- Commit `feat(calibration): hourly collector`.

### 5. `bmpl calibrate --fit` and the ops route
- Fit on the window's samples; write `candidate.json` and `comparison.md` next to `calibration.db`; compute
  `thresholdMet` (≥ 2 % verdict changes on the test half, or a role median moving ≥ 2 points).
- `GET /api/ops/calibration` reads those two files; 404 `{ ok: false, error: "no fit yet" }` before the first fit.
- Tests: threshold both ways; the route needs the token; the payload holds no character names.
- Commit `feat(calibration): weekly fit and ops route`.

### 6. Units and the PR workflow
- `deploy/`: the two services (`ExecStart=/opt/bmpl/bmpl calibrate --hourly` / `--fit`, same user and `.env` as
  `bmpl.service`), the two timers (`hourly`, `Wed *-*-* 06:00 Europe/Paris`, `Persistent=false`), `bootstrap.sh`
  installs them.
- `calibration-pr.yml`: `schedule: cron "45 5 * * 3"` (06:45 or 07:45 Paris, after the fit in both seasons) and
  `workflow_dispatch`; `curl` the ops route with `BMPL_OPS_TOKEN`/`BMPL_URL` secrets; `thresholdMet` false → summary
  line, exit 0; true → write the two blocks into `default-config.json` (version bumped), `comparison.md` as the PR body,
  push `calibration/<date>`, open the PR with `gh pr create` (needs "Allow GitHub Actions to create pull requests").
- actionlint; a dry-run step on a fixture response.
- Commit `ci: weekly calibration pull request`.

### 7. Docs and the user's steps
- `AGENTS.md` hard rule: the exception, its bounds; `docs/agents/architecture.md` (calibration module, db, route);
  `docs/operator.md` and `deploy/README.md` (the units, `BMPL_CALIBRATION_RESERVE`, the repository secrets
  `BMPL_OPS_TOKEN` and `BMPL_URL`, the Actions PR setting); `docs/scoring.md` (refitted weekly).
- The spec's status line "implemented <date>".
- Report to the user what they must do once: re-run `bootstrap.sh` after the release, add the two repository secrets,
  allow Actions to create pull requests.
- Commit `docs: weekly recalibration implemented`.
