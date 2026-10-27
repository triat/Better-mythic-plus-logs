# Evaluation validity — design

Status: phase 1 implemented 2026-10-27; phases 2–4 designed, not started.

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

## Phases 2–4

- **Phase 2** (canvas "bmpl · Verdict", variants first): decisions 5 and 6. The range is computed server-side
  (`Evaluation.range`) from the same payload, 0 points.
- **Phase 3** (a read-only script on `calibration.db`, run by the user on the VPS, 0 points): measure effective
  weights and split-half reliability per sub-signal and role; check whether WCL's `rankPercent` is computed per key
  level (`bracketData`); then decisions 7 and 8, each as a candidate config judged on the held-out half.
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
