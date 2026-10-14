# Weekly recalibration — design

Status: draft 2026-10-14, awaiting the user's review. Builds on `docs/superpowers/specs/2026-09-24-scoring-calibration-design.md`
(the one-off study: discovery, collection, fit, comparison).

## Goal

Keep the evaluation's curves true to the current population without the user running the study by hand: once a week,
in hours nobody plays, collect fresh data with WCL points nobody else needs, refit the candidate config, and propose
it as a pull request the user merges or not.

## Non-goals

- Never change production by itself: the output is a pull request (user, 2026-10-14: "ok pour la PR").
- No new signal, no change to the rubric's structure: only what the study already fits (sub-signal curves, the
  per-role global percentile curve, the average-player `reference`).
- No third-party data in the repository (the study's rule: "0 names kept in the repo"; the repository is public).

## Decisions (user answers of 2026-10-14)

1. **Weekly, Wednesday 03:00–06:00 Europe/Paris** (user: "les mercredi matin entre 3 et 6h du matin"). The window is
   set in Paris time, so it does not drift with daylight saving.
2. **The run spends WCL points on purpose.** This is an explicit, user-approved exception to "never spend WCL points
   automatically", bounded by the window and a budget (decision 4), recorded in `AGENTS.md` next to the rule.
3. **Output: a pull request** with the candidate `default-config.json` and the comparison report; nothing else.

## Proposed (to confirm)

4. **Where it runs: on the VPS, as a systemd timer** (`OnCalendar=Wed *-*-* 03:00 Europe/Paris`). Reasons:
   - the collected payloads (third-party characters) stay on the server, never in GitHub (artifacts of a public
     repository are downloadable by any signed-in GitHub user);
   - systemd handles the Paris time zone natively; GitHub's cron is UTC only.
   The calibration code moves from `scripts/calibration/` (dev-only, not in the binary) into `src/calibration/`, behind
   a CLI command `bmpl calibrate --until 06:00`, so the deployed binary runs it.
5. **Which WCL client.** A dedicated client in the VPS `.env` (`BMPL_CALIBRATION_WCL_CLIENT_ID` / `_SECRET`); without
   it the run does nothing. The instance's own client (3600 pts/h) serves the members and should not be drained; a
   separate client at a higher limit (the study used one at 18,000 pts/h) collects about 120 characters per hour
   (~87 pts each, paced at one lookup every ~16 s because WCL also limits per IP), so about 350 a week.
6. **Rolling sample.** Each week adds new characters (the discovery pass re-reads the current rankings), keeps the
   last 4 weeks of the current season, drops older ones and every sample from a previous season. Fit and test halves
   as in the study (a character is in one half only).
7. **How the pull request is opened, without a GitHub token on the VPS.** After the run the VPS keeps only aggregates
   (`candidate.json`, `comparison.md`: distributions and verdict shifts, no names). A GitHub Actions workflow
   (`calibration-pr.yml`, Wednesdays 06:30 Europe/Paris, i.e. a UTC cron chosen to land after the window in both
   seasons) reads them through the existing read-only ops API (`GET /api/ops/calibration`, `BMPL_OPS_TOKEN` as a
   repository secret), and opens or updates one pull request `calibration/<date>` when the candidate differs from
   `main` beyond a threshold (decision 8). No difference: no pull request, a line in the workflow summary.
8. **Threshold.** A pull request only when, on the test half, at least 2 % of the characters change verdict or a
   role's median global moves by 2 points or more. Smaller drifts are noise.

## Data flow

```
Wed 03:00 Paris  systemd → bmpl calibrate --until 06:00
                   discover (current rankings, ~1 pt/page) → collect (performLookup, paced, budget governor)
                   → .calibration/ on the VPS (rolling 4 weeks) → fit → candidate.json + comparison.md
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
- `bmpl calibrate` with a fake `gql`: stops at `--until`, respects the budget reserve, writes only aggregates where
  the ops route reads.
- `GET /api/ops/calibration`: token required, aggregates only.
- The workflow's diff step on fixture configs: PR opened above the threshold, nothing below.

## Out of scope

- Auto-merge.
- Recalibrating the crowd-control reference (`scripts/calibration/control.ts`) and the defensive tables: separate,
  could join later.
