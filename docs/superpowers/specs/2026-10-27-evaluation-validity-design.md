# Evaluation validity — design

Status: phases 1 and 2 implemented 2026-10-27; phase 3's study and engine support implemented 2026-10-27, study v2
(bootstrap intervals, targeted weights, the proposal) implemented 2026-10-27/28; config 11 applied 2026-10-28 from
the corrected run (below); phase 4 designed, not started.

## Goal

The verdict answers one question, the one bmpl was built for (user, 2026-10-27): **will this player help me time a
key at level L, or will the group carry them?** Every rule of the evaluation is judged against that question, and its
truth is measured, not assumed.

Today's model (spec `2026-09-15-evaluation-model-design.md`, calibration `2026-09-24-scoring-calibration-design.md`)
is coherent and reproducible, but nothing ties it to that question:

- curves and weights are hand-picked; `globalCurve` only spreads the weighted mean into a percentile and "never changes
  who ranks above whom" (`docs/scoring.md`);
- its only validation is agreement with WCL's run ladder (Spearman 0.67 dps, 0.54 healer, 0.67 tank) and the study
  states "*What no global score does: predict who dies next […] every global blend is at ≤ 0.1*".

## Audit findings (2026-10-27)

1. **No ground truth.** Weights are opinions; no outcome or human judgement checks them.
2. **Unknown data helps.** A `null` sub-signal leaves the weighted mean (`src/evaluation/axis.ts`), so the axis becomes
   the mean of the player's *other* signals. A DPS with a median parse of 80 who never played near the target level
   scores Throughput 85; with a parse of 30 there it would be 67. Not having played at L beats having played badly.
3. **Analysing runs moves the verdict.** From 2 analysed runs two deep-dive sub-signals (weights 2 and 3) join
   Survival, which the calibration population never had (`reference` holds neither). A DPS at Survival 70 whose deaths
   were all avoidable drops to about 52, about 6 raw points, about 19 percentile points near the median: INVITE to
   MAYBE because someone clicked Analyse.
4. **No shrinkage.** Three runs can score as extreme as nine; confidence is only a label. Split-half reliability is
   low for some signals ("*wipe deaths 0.37, a tank's own deaths 0.12*").
5. **Hand curves blur the weights.** A signal's real weight is its weight × its spread in the population; item level
   is near the top for almost everyone (reference ≈ +7–8 over the expected, curve 100 at +10).
6. **Fragile measures.** Ratios to the median of 3–4 group peers explode on small denominators; dispels are a raw
   count per run (no dungeon, duration or co-dispeller); teammate deaths are charged to the healer (weight 2); healer
   HPS parse measures demand more than skill; the calibration sample is level-balanced (+15 to +20 equally), so "50"
   is the middle of that sample, not the typical player.
7. **The verdict ignores L.** The global barely depends on the target level: a strong +10 player can read INVITE for
   a +20.

## Decisions

| # | Decision | Phase |
|---|---|---|
| 1 | The verdict's question is "helps time a key at L, or gets carried". Validation measures that question (decision 9). | all |
| 2 | **Property suite.** The rules' intended behaviour is pinned by property tests (`test/evaluation/properties.test.ts`), 0 WCL points: monotone curves, unknown = average, analysing never moves the verdict, run order irrelevant, a kit's missing ability is not a gap. | 1 |
| 3 | **Unknown data scores as the average player.** A sub-signal the player *could* have but whose data is missing is scored at the role's calibration median (`cfg.reference[role][source].x`) instead of leaving the mean. A sub-signal the kit *cannot* have (no interrupt, no dispel) stays out, as today. Without a reference for that source, it stays out (today's behaviour). The imputed sources are listed on the axis (`AxisScore.imputed`), never as evidence: evidence lines describe what was measured. | 1 |
| 4 | **Deep-dive signals leave the verdict.** `survival.defensiveUsage` and `survival.avoidableDeaths` become `pillarOnly`: still shown in the run analyses and in the owner's Survival pillar, never in the axis, the global, the drivers or the verdict, until a calibration includes analysed runs. | 1 |
| 5 | **Level gate.** Without a run at L − 2 or above, the verdict reads "unproven at this level" next to the score; the score itself is unchanged (not the old Experience axis, which rewarded volume). Canvas first. | 2 |
| 6 | **Score range.** The badge shows the range the score takes when each run is left out in turn ("INVITE · 64–78"), 0 WCL points. Canvas first. | 2 |
| 7 | **Shrinkage.** Each sub-signal is pulled toward the role's median by n / (n + k), n the runs measured, k from the signal's measured split-half reliability on `calibration.db`. | 3 |
| 8 | **Percentile sub-signals.** Each sub-signal's curve is the population's own percentile (per role; per spec for kicks and dispels), so weights mean what they say; effective weights are measured before and after. | 3 |
| 9 | **Labelled profiles.** 150–200 real profiles rated INVITE / MAYBE / PASS for a stated L by 2–3 experienced key holders who do not see bmpl's score. They measure the current rubric (Spearman, Cohen's kappa), then fit the weights (ordinal regression) on one half and validate on the other. A later-runs outcome (timed share at ≥ L) is a second, weaker check. | 4 |

## Phase 1 — unknown data, deep-dive out, properties (0 WCL points)

### Unknown data (decision 3)

`SubSignalInput` gains `applies?: boolean` (default `true`). `scoreAxis`:

- `applies === false` → skipped (the kit cannot have it);
- `value === null`, applies, weight > 0, not `pillarOnly`, and `cfg.reference[role][source]` exists → scored at
  `reference.x`, counted in Σw, listed in `AxisScore.imputed`; no evidence entry;
- `value === null` and no reference → skipped, as today.

Which sources are structural n/a (`applies: false`): `utility.kicksVsPeers` and `utility.kicksAbsolute` when the spec
has no interrupt, `utility.dispels` when the kit has no dispel. Everything else that can be `null` is missing data:
no ranked run (`throughput.medianParse`), no ranked run at L − 1 or above (`throughput.parseAtTarget`), no avoidable
list or no peer data (`survival.avoidableVsPeers`, `survival.dtpsVsPeers`, `utility.kicksVsPeers`), no Raider.IO
(`preparation.ilvlVsLevel`). Consistency keeps its own `n/a` below `consistencyMinRuns` (weight 0 anyway).

Consequences, accepted:

- The evidence deltas no longer sum exactly to score − 50 when a source is imputed: the imputed sources hold the rest.
- The drivers are unchanged: an imputed source already sits at the reference, its impact is 0.
- The pillars average measured sub-signals only (they describe what was measured).
- The weekly fit reads the raw score with imputation, so the first refit after release re-anchors `globalCurve`;
  until then a profile with imputed sources sits slightly off its percentile. `reference` is fitted from measured
  values only: `curveInputs` probes with an empty `reference`, so nothing is imputed there.

### Deep-dive out of the verdict (decision 4)

`default-config.json`: `"pillarOnly": true` on both deep-dive sub-signals; `version` "10". The registry
(`src/evaluation/docs.ts`, `docs.fr.ts`) says they count in the Survival pillar only; the Method tab's Survival note
says the deep-dive signals are shown but not counted, whatever the number of analysed runs (same slot, new copy).

### Properties (decision 2)

`test/evaluation/properties.test.ts`, on synthetic payloads (`test/evaluation/helpers.ts`):

- every curve of `default-config.json` is monotone;
- moving one sub-signal in its worse direction never raises the global;
- a missing sub-signal scores exactly as the same profile at the reference (unknown = average), so it never beats a
  bad value nor loses to a good one;
- a kit without an interrupt or a dispel is not scored as missing it;
- adding deep-dive analyses never changes the global or the verdict;
- shuffling the runs never changes the evaluation.

## Phase 2 — the verdict at your key (implemented 2026-10-27)

Canvas **https://claude.ai/artifact/XWfxzv9XyHfM5YDikZaSev** ("bmpl · Verdict à ton niveau", sources in
`docs/design/verdict/`): variant **C** chosen (the "Fiabilité" block), and option **2** of board E for the Méthode tab.

- **Evaluation** (`src/evaluation/reliability.ts`): `Evaluation.level` = `{ floor: L − LEVEL_MARGIN (2), best, atTarget,
  proven }` from the shown runs; `Evaluation.range` = the global with each shown run left out in turn
  (`payloadWithout`: the run out of the dungeon list, its median parse recomputed, out of the previous level),
  `{ low, high, without[] }`, null under `verdict.minRuns + 1` runs with signals or for NOT ENOUGH DATA. Neither
  changes the score or the verdict; any key counts as played (timed or not, as elsewhere).
- **History** (`summaryOf`): the rows carry `spread` (the range's widest side around the score) and `unproven`
  (columns added NULL by `migrateReliabilityColumns`, filled when a row is read and re-evaluated); Live's cached
  verdicts carry both.
- **Front** (`web/src/lib/reliability.ts`): the Synthèse verdict card's Fiabilité block (Level, Stability, one dot per
  run left out against the MAYBE / INVITE ticks, the run that moves the score most); the header's "low reliability"
  chip when the level is unproven or the range crosses a threshold; "±N" and the unproven mark in Récents and Live; the
  "Level · Stability" line in Compare; the Méthode tab lists each imputed sub-signal as an "average" row with its
  reason, the role's average, its weight and an effect of 0.

## Phase 3 — measure, then decide (study implemented 2026-10-27)

**The study** (`src/calibration/study.ts`, `bmpl calibrate --study`, and every weekly `--fit` after its fit), 0 WCL
points: it reads the rolling window of `calibration.db` (the newest season present, no zone query) and writes
`study.json` and `study.md` next to it, aggregates only, served by `GET /api/ops/calibration/study`.

- **Per role and counted sub-signal**: n, median curve input, the share of the raw score its weights give it
  (`nominal`) and the share it really carries (`effective` = nominal × the spread of its 0–100 score, normalised);
  `splitHalf` = Spearman between a character's alternating runs (from 4 runs, at least 30 characters); `oneRun` = one
  run's reliability, Spearman-Brown inverted from the halves' size; `k` = (1 − r1) / r1, null when one run carries no
  signal (or the signal is constant).
- **The parse**: Spearman(amount, parse) inside spec × dungeon and inside spec × dungeon × key level, and
  Spearman(key level, parse); "per key level" when the second reaches 0.8 and beats the first by 0.05. The code already
  asks WCL for `byBracket: true` rankings; this checks it on the data.
- **Candidates**, fitted on the fit half (`isFit`), judged on the held-out half, each with `globalCurve` and
  `reference` refitted so the percentiles mean the same: `today`, `shrinkage` (decision 7, k per role and source),
  `percentile` (decision 8, per-role curves `curves[role]` = the fit half's percentile, direction kept), `both`.
  Measured: the raw score's split-half Spearman (the stability the user asked for), its prediction of the newer half's
  deaths, avoidable damage and timed share from the older half, its agreement with WCL's ladder, the verdict shares and
  the verdict changes against today. ~~A candidate beats today when its split-half rises by 0.02 or more and no
  prediction drops by more than 0.02~~ (v1, replaced by v2 below); `best[role]` names the steadiest winner, or null.

**First run on the real samples** (2026-10-27, 2,150 characters): the parse is ranked per key level (Spearman(amount,
parse) 0.93 per level against 0.47 across levels). Split-half of the raw score, today / shrinkage / percentile / both:
dps 0.59 / 0.65 / 0.60 / 0.71, healer 0.61 / 0.79 / 0.40 / 0.73, tank 0.74 / 0.81 / 0.69 / 0.85. The predictions of
the newer half are small (deaths about 0.1 to 0.2, timed near 0). Counted signals close to noise: tank individual
deaths (split-half 0.07), healer dispels (0.16), healer avoidable damage (0.18), healer kicks against peers (0.17).
`preparation.ilvlVsLevel` showed 1.00, an artefact: the item level is the character's, the same in both halves. With
about 350 held-out characters per role, one correlation moves by about ±0.1 at 95 % from sampling alone, so the v1
rule's 0.02 could not tell a gain from noise.

**Study v2** (same day):

- **Paired bootstrap** (`bootstrapDiffs`, 1,000 resamples, a fixed seed so the same samples give the same intervals):
  each resample draws the held-out characters with replacement and measures today and every candidate on that same
  draw; `vsToday[measure]` = candidate − today on all of them with the 2.5th and 97.5th percentiles of the resampled
  differences, for the split-half and the three predictions.
- **A candidate beats today** when it is surely steadier (the split-half interval wholly above 0) and surely not worse
  at predicting (no prediction interval wholly below 0).
- **Two more candidates**: `targeted` (tank `survival.individualDeaths` and healer `utility.dispels` weigh 1 instead
  of 3, `TARGETED`, the two counted signals closest to noise for their role) and `all` (shrinkage + percentile curves
  + targeted weights); `candidate.weights` lists the targeted change.
- **Not run-based sources** (`NOT_RUN_BASED`: `preparation.ilvlVsLevel`) get no split-half, no one-run reliability and
  no k; they keep their nominal and effective shares.

**A bug voids part of both runs** (found 2026-10-28 while writing config 11). `curveInputs` (`src/calibration/fit.ts`)
reads a sub-signal's input back through a linear probe curve, but left the per-role `curves` in place, and `curveFor`
prefers them: on any config with per-role curves every input came out as its percentile score / 1000. `fitGlobal`
reads its `reference` through it, so every candidate with curves (`percentile`, `both`, `all`, `proposal`) was
refitted with a reference near 0.05 for each curved sub-signal (median parse, deaths, kicks…), then scored with
missing data imputed there and shrinkage pulled there. Their rows in both runs, and the decisions below that rest on
them, are void; `shrinkage` and `targeted` (no curves) and the per-signal tables are not affected. The probe now
drops the per-role curves too (regression test in `test/calibration/fit.test.ts`); nothing reached production, which
runs config 10 (no per-role curve). The user still chose to apply the proposal for all three roles (2026-10-28,
before the bug was found, tanks included despite their avoidable prediction −0.10 [−0.16, −0.05]); config 11 is built
from the next, corrected run.

**Config 11, from the corrected run** (2026-10-28, 2,279 characters, after the fix). The rule now picks: dps none
(`both` and `all` are steadier, +0.10 [+0.06, +0.14], but predict avoidable damage surely worse, −0.07 [−0.11,
−0.02]); healers `targeted` (dispels 3 → 1: +0.09 [+0.07, +0.11], no prediction surely worse); tanks `all`
(shrinkage, percentile curves and deaths 3 → 1: +0.11 [+0.08, +0.15]). The proposal adds the fitted expected item level
to every role. Judged on the held-out half against config 10: dps +0.01 [0.00, +0.02], deaths prediction +0.01 [0.00,
+0.02], 13 of 372 verdicts change; healers +0.09 [+0.07, +0.12], nothing surely worse, 39 of 376 change, agreement with
WCL's ladder 0.50 → 0.42; tanks +0.10 [+0.06, +0.14], avoidable prediction −0.09 [−0.14, −0.03], surely worse, 87 of
366 change. The tank row breaks the rule through the fitted item level (`all` alone on the hand-set table: −0.01); the
user applied the proposal for all three roles anyway (« Appliquer la proposition », 2026-10-28), as in the morning's
choice. Config 11 is `proposal.config` written by `applyProposal`; the weekly studies re-check it.

**Decisions after the v2 run** (2026-10-28, 2,175 characters; user: « applique »; void for the curve candidates, see
above). The rule picked `both` for dps
(split-half +0.13 [+0.08, +0.18]) and tank (+0.11 [+0.08, +0.15]) and `all` for healers (+0.19 [+0.12, +0.26]); no
prediction surely worse, though every prediction is weak (deaths 0.1 to 0.2, timed near 0) and the healer intervals
are wide (deaths −0.08 [−0.20, +0.05]). Applied as the rule says, re-checked by the next weekly studies. Seen on the
way: shrinkage alone predicts deaths surely worse in all three roles; percentile curves alone are surely less steady
for healers (−0.22) and tanks (−0.04); a lighter tank deaths weight is surely less steady (−0.08), so it stays at 3.

- **The proposal** (`proposalFrom`, `StudyResult.proposal`): per role, what its best candidate changes, on top of the
  expected item level fitted from the fit half, refitted and judged against today like the candidates; written whole
  as `proposal.config`, from which the next default config is built (`applyProposal` in `src/calibration/apply.ts`),
  so `globalCurve` and `reference` always match the shipped changes.
- **The expected item level is fitted** (`fitExpectedIlvl`): the hand-set table (+15 → 315, +20 → 325) sat 7 to 8
  levels under what the sampled players wear (median gap +8.0 dps, +7.3 healer, +7.2 tank), and the curve gives 75 at
  0 and 100 from +10, so nearly every character scored 90 to 100: a 331 and a 338 barely differed. The table is now
  the median item level of the characters sampled at each key level, refitted every week with the rest; with the
  per-role percentile curves, the median player of the role scores 50 on it.
- **Strengths and weaknesses** (the Synthèse tab) read the drivers: each signal's effect on the score shown against
  the role's average player, in whole points, as "what would flip it" already did. They read axis points against 50
  before, which turned the item level above (92.5 on a one-signal axis) into "+42.5" while it cost the player about a
  third of a point against the average one (user report, 2026-10-28).

**The engine** reads both changes from the config, off by default: `shrinkage[role][source] = k` pulls a value
measured on n runs toward `reference.x` by k / (n + k) (`EvalInputs.counts` holds n; a driver's override is never
pulled), and a sub-signal's `curves[role]` replaces its shared `curve` for that role. Nothing changes until a reviewed
pull request puts the study's `candidate` block into `default-config.json` for the roles where it wins; the Help page
still draws the shared curves.

## Phase 4

- **Phase 4**: decision 9. A rating page for invited raters (profiles anonymised, score hidden), the labelled set
  stored apart from `bmpl.db`, the fit and its report. Success: the fitted model agrees with the raters better than
  today's on the held-out half, and no worse on the later-runs check.

## Non-goals

- Changing the signals' extraction (WCL queries, peers) in phase 1.
- Scoring timed vs depleted keys (unchanged: "*a depleted key on an otherwise strong run isn't held against the
  player*").
- Spending WCL points for any of this, except phase 4's lookups of the profiles to rate (normal lookups).

## Tests

Phase 1: the property suite; `test/evaluation/axes.test.ts` for `applies` and imputation; the fixture goldens in
`test/evaluation/evaluate.test.ts` updated with the reason; `test/calibration` for `curveInputs` without imputation;
`just check`, `just lint`, `bun test`.
