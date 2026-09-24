# Scoring calibration study — design

Status: approved 2026-09-24 (protocol agreed in chat; the user set the scope and the budget window).
Collection done (1,081 characters); results below. The user approved the recommended change (global
percentile curve per role, thresholds 70/30): `default-config.json` version 2, curves from
`scripts/calibration/fit-global.ts`.

## Goal

The verdict does not separate players. The user has never seen a profile below 55, and an evaluation
that puts everyone between 50 and 80 does not help choose between two applicants. This study measures
where real players fall under the current rubric and proposes a recalibrated `default-config.json` in
which the score spreads across the real population — the bottom of the ladder visibly low, the top
visibly high — without losing the ranking's meaning.

Nothing ships to production without the user's explicit approval of the candidate config.

## What was established before any data (0 WCL points)

Synthetic DPS players scored with the current config (`scripts/calibration/`, first probe):

| Player | Global | Verdict |
|---|---|---|
| Exactly average vs peers everywhere, parse 50 | 69 | MAYBE, one point under INVITE |
| Weak: +20 % damage/avoidable vs peers, parse 25, −20 % kicks, 1.5 deaths/run | 46 | MAYBE |
| Same weak player, experienced at the level | 53 | MAYBE |
| Bad on everything: +50 % avoidable, parse 10, 2.5 deaths/run | 25 | PASS |

Two structural causes, which the study addresses separately:

1. **Hand-set curve anchors.** "Equal to the peer median" maps to 65 on every peer-relative curve, and
   the tails are flattened. An average player sits next to INVITE.
2. **Averaging ~16 sub-signals** regresses everyone toward the middle: one disqualifying weakness is
   diluted by everything else.

Plus a selection effect the data can only partly correct: bmpl's users mostly look up *applicants*,
who log and who apply at their own level — already above the population.

## Scope (decided by the user)

- Region **EU**; key levels **+15 to +20** (+12 to +14 excluded as unrepresentative); all three roles.
- Budget: the user's WCL client at 18,000 pts/h, free use until **13:00 on 2026-09-24**, keeping a
  **200-point** reserve for bmpl.riat.dev (one active user). More data is welcome within that window.

## Protocol

### 1. Discovery — `scripts/calibration/discover.ts` (~1 pt per page, a few thousand in total)

`worldData.encounter.characterRankings(className, specName, serverRegion: "EU", page)` lists one entry
per character — their best run in that dungeon — sorted by key level, then by WCL's run score within a
level. There is no server-side key-level filter (`bracket` returns nothing; `hardModeLevel` is a WoW
Classic filter). For each of the 40 specs × 8 dungeons:

- read the head of the ladder (8 pages), which holds +16 to +20 whole;
- where the +15 band runs past the head (most popular specs), find its end by galloping and
  bisection, then sample 4 pages across its whole depth — a page cap would cut off exactly the slow end
  of the band, the weak players this study exists to find;
- give each entry a **percentile** = its position in its (dungeon, spec, level) band, 0 = best, 1 = worst.

### 2. Collection — `scripts/calibration/collect.ts` (~87 pts per new character)

- One candidate per (character, spec): level = median of the bands they appear in, percentile = median.
- Cell = role × level (+15..+20) × performance quintile: 90 cells. The collector takes **one candidate
  per cell per round**, so the sample is balanced whenever it stops.
- Each candidate goes through **`performLookup`**, the production code path, at their level and spec,
  and the payload is saved to `.calibration/payloads/` (git-ignored: third-party characters). Raw WCL
  results land in the SQLite cache like any lookup's, so re-reading them is free.
- A budget governor reads `rateLimitData` on every response and pauses under reserve + 250 pts until the
  hour resets.
- **Paced, not burst.** WCL also rate-limits **per IP address**, independently of the point budget
  (`429 Too many requests from this IP address`). The first run spent the whole hour's budget in a
  3-minute burst (~160 lookups, ~10 requests/s) and got the IP blocked for a while; retrying every 30 s
  kept it blocked. The collector now starts one lookup every 16 s on a single worker — at ~90 points per
  new character and 18,000 points/h, that uses the budget across the hour at about 1 request/s — and a
  429 backs off exponentially from 1 to 10 minutes.
- Resumable; deadline flag `--until 12:50`.
- **No deep-dive** in the sample (~16,000 extra points for signals production users rarely have). The
  defensive-cooldown curves stay out of scope.

### 3. Analysis — 0 points, repeatable

Payloads are re-scored offline with `evaluate()`. `targetLevel` is a plain payload field and per-run
signals use each run's own level, so a payload can also be re-scored as if the character applied to a
different key. Measured per role and level band:

- the real distribution of every sub-signal's raw value;
- the distribution of the current global score and verdicts on that population;
- redundant sub-signals (strong correlations inflate the averaging).

### 4. Recalibration

- **Percentile-anchored curves**: each sub-signal's control points placed on the population's
  percentiles (bottom decile toward 10–15, median toward 50, top decile toward 90).
- **Disqualifiers**: a catastrophic value on a critical signal caps the verdict, whatever the rest.
  Thresholds taken from the data.
- **Guardrail — predictive validity**: split each character's runs by date; a score computed on the
  older runs must rank players at least as well as the current rubric on their later runs' outcomes
  (deaths per run, depleted keys). A candidate that spreads scores but ranks worse is rejected.

### 5. Deliverables

- `scripts/calibration/` (dev-only) and a report with before/after distributions per role.
- A candidate `default-config.json` with its `version` bumped. **Not merged into production until the
  user approves it.**

## Results (2026-09-24, 1,081 characters, 0 names kept in the repo)

Collected 07:47–12:50 with `performLookup` (~87 pts each, 54 skips: renamed characters and the realm-slug
bug below). Fit half 552, held-out half 529; every number here is on the held-out half.

**The rubric is too narrow, not too generous in order.** Today's global score ranks players well
against WCL's own ladder (Spearman 0.67 dps, 0.54 healer, 0.67 tank), but squeezes them: p5–p95 is
60–89, 79 % INVITE, 0 % PASS, and the worst fifth of each band still scores 64–74.

| Candidate | p5 / p25 / median / p75 / p95 | INVITE / MAYBE / PASS | ranks like WCL (dps / healer / tank) |
|---|---|---|---|
| today | 60 / 71 / 76 / 81 / 89 | 79 / 20 / 0 % | 0.67 / 0.54 / 0.67 |
| percentile curves on every sub-signal + global percentile | 8 / 28 / 51 / 74 / 95 | 30 / 42 / 27 % | 0.64 / 0.50 / 0.62 |
| **today's rubric + one global percentile curve per role** | ~5 / 29 / 51 / 73 / 96 | ~30 / 45 / 25 % | **0.67 / 0.54 / 0.67** |

The last row — `scripts/calibration/global-only.ts` — spreads the score as much as refitting every
curve, and keeps today's ranking exactly (a monotone mapping cannot reorder anyone). The score then
reads as "percentile among EU players logging +15 to +20 in that role". It is the recommended change:
one `CurvePoints` per role in `default-config.json` applied to the global score, with thresholds 70/30.

**Rejected on the data:**

- *Survival weighted up* (×1.5 to ×3, with or without Experience halved): the global score's power to
  predict a player's later deaths rises from ~0.00 to at most 0.09, while the WCL ranking drops to
  0.43–0.53. Not worth it.
- *Disqualifiers* (worst 5 % on individual deaths or avoidable damage caps the verdict at MAYBE):
  flagged players die exactly as often in their later runs as everyone else (0.44 vs 0.44 per run,
  n = 52). No cap.
- *Sub-signal reweighting by split-half reliability* (wipe deaths 0.37, a tank's own deaths 0.12,
  Consistency 0.2–0.5, against 0.7–0.9 for potions, healthstones, kicks, parse at target): changes
  nothing measurable on the global. Consistency already weighs 0.

**What no global score does:** predict who dies next. A player's own past death rate predicts their
later death rate (0.47), a player's past avoidable damage predicts their later one (0.42); every
global blend is at ≤ 0.1. Those two signals are better shown on their own than averaged in.

## Known limits

- **Realm slugs.** About 5 % of lookups fail as "Character not found" on realms whose name bmpl does not
  turn into WCL's slug: `Ревущий фьорд` (sent as `ревущий-фьорд`) and `Azjol-Nerub` (sent as
  `azjol-nerub`, Blizzard's slug is `azjolnerub`). The sample loses those realms; production has the same
  bug for any member looking those players up — reported separately, not fixed by this study.

- The percentile curves describe one season and one population (EU, +15 to +20, loggers); they must be
  refitted each season, and an applicant far below +15 is compared with a stronger population.
- Axis scores keep today's curves: with the recommended change the global spreads while the axis
  cards still read 60–90.
- WCL only sees players who log. The worst players, who don't, stay invisible.
- The percentile is WCL's own run-score order inside a level band (mostly time), a proxy for the
  performance ladder used only to stratify the sample; the analysis runs on the real signals.
- Where a +16 band also runs past the 8 head pages, its end is only known from the pages sampled
  deeper, which slightly compresses that band's percentiles.
