# Weekly recalibration — design

Status: implemented 2026-10-14 (plan `docs/superpowers/plans/2026-10-14-weekly-recalibration.md`); approved 2026-10-14 (user: decisions 1–3, thresholds, the rest of the draft "ok"; hourly collection on the
instance's client at 18,000 pts/h, decision 5, the same day). Builds on `docs/superpowers/specs/2026-09-24-scoring-calibration-design.md`
(the one-off study: discovery, collection, fit, comparison).

## Goal

Keep the evaluation's curves true to the current population without the user running the study by hand: once a week,
in hours nobody plays, collect fresh data with WCL points nobody else needs, refit the candidate config, and propose
it as a pull request the user merges or not.

## Non-goals

- Never change production by itself: the output is a pull request (user, 2026-10-14: "ok pour la PR").
- No new signal, no change to the rubric's structure: only what shipped from the study, the per-role global percentile
  curve (`globalCurve`) and the average-player `reference`, both fitted by `scripts/calibration/fit-global.ts`
  (amended 2026-10-14 while planning: the study's sub-signal curves were never shipped, so they are not refitted).
- No third-party data in the repository (the study's rule: "0 names kept in the repo"; the repository is public).

## Decisions (user answers of 2026-10-14)

1. **The fit and the pull request are weekly.** The Wednesday 03:00–06:00 Europe/Paris window (user: "les mercredi
   matin entre 3 et 6h du matin") is the one where collection may use the whole budget. The window is set in Paris
   time, so it does not drift with daylight saving. The Blizzard EU maintenance on Wednesday mornings does not affect
   the WCL API (user, 2026-10-14).
2. **The run spends WCL points on purpose.** This is an explicit, user-approved exception to "never spend WCL points
   automatically", bounded by the window and a budget (decision 4), recorded in `AGENTS.md` next to the rule.
3. **Output: a pull request** with the candidate `default-config.json` and the comparison report; nothing else.

## Proposed (to confirm)

4. **Where it runs: on the VPS, as two systemd timers** (collection `OnCalendar=hourly`, fit `OnCalendar=Wed *-*-* 06:00 Europe/Paris`). Reasons:
   - the collected payloads (third-party characters) stay on the server, never in GitHub (artifacts of a public
     repository are downloadable by any signed-in GitHub user);
   - systemd handles the Paris time zone natively; GitHub's cron is UTC only.
   The calibration code moves from `scripts/calibration/` (dev-only, not in the binary) into `src/calibration/`, behind
   a CLI command (implemented as `bmpl calibrate --hourly` and `--fit`), so the deployed binary runs it.
5. **The instance's own WCL client, every hour, with what the members leave** (user: no dedicated client, "on pourrait
   faire un run toutes les heures"; the client's subscription allows 18,000 points an hour, "tu peux utiliser ce dont
   tu as besoin"). Measured on production (ops API, 30 days to 2026-10-14): at most 33 lookups a day, 6 active members,
   so about 3,000 of the 432,000 points a day; the members use well under 1 % of the budget. Rules:
   - a `bmpl calibrate --hourly` run starts every hour (systemd timer); it reads `limitPerHour` from `rateLimitData`
     (never a hard-coded limit) and spends what it needs up to `limitPerHour − BMPL_CALIBRATION_RESERVE` (default
     3,000 pts, about 30 member lookups, kept free in every hour);
   - it yields to members: it reads `rateLimitData` before each lookup (the counter includes members' spend), stops for
     the hour when the counter reaches the limit minus the reserve, and pauses 5 minutes after a member request reached
     WCL (the meter's last observation);
   - **paced, never burst**: one lookup every ≥ 16 s, because WCL also limits per IP and the collector shares the VPS
     address with the members (the study's burst got the IP blocked); at ~87 pts a lookup that is about 225 lookups
     and 19,500 pts an hour at most, so the pace, not the budget, is the real limit;
   - **a target, not "as much as possible"**: collection stops once the rolling 4 weeks hold 2,000 characters
     balanced across the study's cells (role × level × performance quintile); beyond that the role curves barely move
     and the points would be spent for nothing. From empty, the target takes about 9 to 10 hours; afterwards the
     hourly runs only replace the characters that age out of the window, a few hundred a week.
   - The Wednesday 03:00–06:00 window keeps its role as the preferred slot for a large batch (the reserve drops to 300
     there), for example after a season starts and the window is empty.
6. **Its own database.** `performLookup` caches what it fetches; the collector opens its own SQLite file
   (`calibration.db` next to `.env`), never the instance's `bmpl.db`, so third-party characters never enter the
   production store or its litestream replica. Samples are kept as evaluation payloads (what `calibrate.ts` re-scores),
   not raw reports.
7. **Rolling sample.** Each week adds new characters (the discovery pass re-reads the current rankings), keeps the
   last 4 weeks of the current season, drops older ones and every sample from a previous season. Fit and test halves
   as in the study (a character is in one half only).
8. **How the pull request is opened, without a GitHub token on the VPS.** After the run the VPS keeps only aggregates
   (`candidate.json`, `comparison.md`: distributions and verdict shifts, no names). A GitHub Actions workflow
   (`calibration-pr.yml`, Wednesdays 06:30 Europe/Paris, i.e. a UTC cron chosen to land after the window in both
   seasons) reads them through the existing read-only ops API (`GET /api/ops/calibration`, `BMPL_OPS_TOKEN` as a
   repository secret), and opens or updates one pull request `calibration/<date>` when the candidate differs from
   `main` beyond a threshold (decision 9). No difference: no pull request, a line in the workflow summary.
9. **Threshold** (user: "ok"). A pull request only when, on the test half, at least 2 % of the characters change verdict or a
   role's median global moves by 2 points or more. Smaller drifts are noise.

## Data flow

```
every hour       systemd → bmpl calibrate --hourly   (up to limitPerHour − 3,000 reserve; Wed 03–06 Paris: reserve 300)
                   discover (current rankings, ~1 pt/page) → collect (performLookup on calibration.db, paced,
                   yields to members) → samples on the VPS (rolling 4 weeks, target 2,000 characters)
Wed 06:00 Paris  systemd → bmpl calibrate --fit → candidate.json + comparison.md (aggregates only)
Wed ~06:30 Paris GitHub Actions → GET /api/ops/calibration → diff vs main → PR "calibration/<date>" (or nothing)
user             → reviews, merges or closes; a merge ships with the next release
```

## Error handling

- WCL errors and 429s: the study's backoff (1 to 10 minutes); the run stops at the window's end whatever its state and
  fits on what it has.
- Not enough new samples (fewer than the study's minimum per role): no candidate, the report says why.
- The ops endpoint unreachable: the workflow fails visibly (red run), nothing else happens.

## Tests

- Moving the scripts into `src/calibration/` keeps today's offline tests green; the pure parts (sampling cells, fit,
  threshold, rolling window) get unit tests.
- `bmpl calibrate --hourly` with a fake `gql`: reads `limitPerHour`, keeps the reserve, yields after a member request,
  paces lookups, stops at the target, never opens `bmpl.db`; `--fit` writes only aggregates where the ops route reads.
- `GET /api/ops/calibration`: token required, aggregates only.
- The workflow's diff step on fixture configs: PR opened above the threshold, nothing below.

## Out of scope

- Auto-merge.
- Recalibrating the crowd-control reference (`scripts/calibration/control.ts`) and the defensive tables: separate,
  could join later.
