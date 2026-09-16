# Evaluation model — design

Sub-project 2 of 4 (signals → **evaluation model** → separate front → on-demand
run deep-dive). Builds on the signals layer
(`docs/superpowers/specs/2026-09-15-signals-design.md`).

## Goal

Turn the ~15 numbers a lookup produces into a verifiable answer to "should I
invite this player to my +N key?":

- six **axes** scored 0–100 on a shared scale (so a radar chart can show them
  later): Survival, Utility, Throughput, Consistency, Preparation, Experience;
- a **global** score (role-weighted mean) and a **verdict**
  (`invite` / `maybe` / `pass` / `insufficient`);
- under every axis, the **evidence** that moved it, so the user can disagree
  with the model on facts, not on vibes.

Rules are data (`evaluation.json`): piecewise-linear curves, weights and
thresholds. Nothing about the score is hidden in code.

Decisions taken during brainstorming:

- Output form C (axes + global + derived verdict), radar-friendly.
- Calibration C (hand-tuned absolute curves scaled by key level + peer-relative
  signals where they exist). Statistical calibration is out of scope.
- **Timed/depleted is not scored.** Resilient keys and other people's mistakes
  make it unfair; it stays displayed as information only. Replaced by
  Consistency and Preparation.
- Previous-season score is a bonus only, never a malus (rerolls).

## Output model

```ts
export type AxisKey =
  | "survival" | "utility" | "throughput"
  | "consistency" | "preparation" | "experience";

export interface Evidence {
  label: string;   // "0 deaths on 7/9 runs"
  delta: number;   // contribution in axis points vs neutral 50: w_i × (s_i − 50) / Σw; deltas sum to score − 50
  source: string;  // sub-signal id, e.g. "survival.individualDeaths"
}

export interface AxisScore {
  key: AxisKey;
  score: number | null;                   // null = not applicable for this spec/role
  confidence: "high" | "medium" | "low";
  evidence: Evidence[];                   // sorted by |delta| desc
}

export interface Evaluation {
  role: "dps" | "healer" | "tank";
  targetLevel: number;
  axes: AxisScore[];                      // always 6, in the order above
  global: number | null;                  // weighted mean of non-null axes
  verdict: "invite" | "maybe" | "pass" | "insufficient";
  runsUsed: number;                       // displayed runs that have `signals`
  configVersion: string;                  // short hash of the effective config
}
```

Role is derived from the majority `signals.role` across displayed runs;
`unknown` (no signals) falls back to `healer` if the lookup metric is `hps`,
else `dps`.

## Scoring primitives (`src/evaluation/curve.ts`, pure)

- `curve(x, points: [number, number][]): number` — linear interpolation
  between sorted control points, clamped at both ends. Points must be strictly
  increasing in x (validated at config load).
- `levelScale(level, points)` — same interpolation; the result multiplies the
  raw x of level-sensitive signals (deaths, group deaths) **per run, using the
  key level of that run** (`signals.keystone.level`), then the scaled values
  are averaged. Initial: `[[8,1.6],[12,1.3],[16,1.0],[20,0.8],[25,0.65]]` —
  2 deaths in a +8 count as 1.25 in a +16. (Scaling by the *target* level was
  the first design; it inverted the effect under `--level N` above the
  player's runs — final review 2026-09-16.)
- `stddev(xs)` — population standard deviation; `null` if `xs.length < 2`.
- Axis aggregation: `score = Σ(w_i × s_i) / Σ(w_i)` over the sub-signals that
  are **available**; a missing sub-signal is ignored, never counted as 0. No
  available sub-signal → `score: null`.
- Evidence: every available sub-signal emits one `Evidence` with
  `delta = w_i × (s_i − 50) / Σw` (axis points; the deltas of an axis sum to
  `score − 50`) and a human label built from its raw input.
- Scores are rounded to integers (axes and global) **before** the verdict is
  derived, so what is displayed and what is judged are the same number.
- Confidence per axis: `high` if `runsUsed ≥ 6`, `medium` if `3–5`, `low`
  otherwise; Consistency additionally forces `low` when `runsUsed < 5`.

## Inputs

All inputs already exist in the lookup payload except the consumables:

- displayed runs with `signals` (`RunSignals`) — `n = runsUsed`;
- `summary` (`SignalSummary`), `perDungeon`, `targetLevel`, `rio`.

**Signals-layer extension** (no extra WCL points, no `QUERY_VERSION` bump —
`Summary.playerDetails` is already in every stored raw report):

```ts
// RunSignals
consumables: { potions: number; healthstones: number } | null; // null when player not in playerDetails
```

Parsed from `Summary.data.playerDetails.{dps,healers,tanks}[].potionUse /
healthstoneUse` (fixture S1: Mstercheif has `potionUse 6`, `healthstoneUse 3`).

## Axes

Notation: `Δ%` = median over runs of `(mine − peer.median) / peer.median × 100`
(lower is better for damage); `pts` = median over runs of
`(usage − peer.median) × 100` for interrupts (higher is better). Weights are
`dps / healer / tank`; `—` means the sub-signal is not used for that role.
Curves are `[x, score]` control points. All values below are the **initial**
`evaluation.json` and are expected to be tuned.

### Survival

| id | input | curve | weights |
|---|---|---|---|
| `individualDeaths` | mean over runs of `deaths(!inWipe) × levelScale(run key level)` (label shows the raw mean) | `[0,100] [0.5,85] [1,65] [2,35] [3,10]` | 3 / 3 / 3 |
| `wipeDeaths` | mean over runs of deaths with `inWipe` | `[0,100] [1,70] [2,45]` | 1 / 1 / 1 |
| `avoidableVsPeers` | `Δ%` of `avoidableDamage.perMinute` (runs with a peer) | `[-40,100] [-10,80] [0,65] [20,40] [50,10]` | 2 / 2 / 2 |
| `dtpsVsPeers` | `Δ%` of `damageTaken.dtps` (runs with a peer) | same | 1 / 1 / — |
| `groupDeaths` | mean over runs of `(groupTotal − count) × levelScale(run key level)` (label shows the raw mean) | `[0,100] [2,75] [4,45] [7,15]` | — / 2 / — |

### Utility

| id | input | curve | weights |
|---|---|---|---|
| `kicksVsPeers` | `pts` (runs with `usage !== null` and a peer) | `[-40,10] [-20,40] [0,65] [15,85] [30,100]` | 3 / 1 / 3 |
| `kicksAbsolute` | median `interrupts.usage` (runs with `usage !== null`) | `[0,20] [0.15,50] [0.3,80] [0.45,100]` | 1 / 1 / 1 |
| `dispels` | median `dispels.count` per run | `[0,40] [3,60] [10,85] [20,100]` | 1 / 3 / 1 |

A spec without a kick (`kickCooldownS === null` on every run) has no kick
sub-signals. A kit without any dispel or purge (`dispels.available === false`
on every run — rogue, warrior, death knight; see `src/signals/dispel-capability.ts`)
has no dispel sub-signal. If neither applies and the role is not healer, the
axis is `null` ("n/a"). Healers always get the dispel sub-signal (0 dispels is
information for a healer). *(Amended 2026-09-16: the earlier "median dispels
is 0" rule penalized kits that cannot dispel.)*

### Throughput

| id | input | curve | weights |
|---|---|---|---|
| `medianParse` | `perDungeon.medianParse` | `[0,10] [25,35] [50,60] [75,80] [95,100]` | 3 |
| `parseAtTarget` | median `parsePercent` of displayed runs with `keyLevel ≥ targetLevel − 1` (only if ≥ 1 such run) | same | 2 |

A `parsePercent` of exactly 0 is an **unranked** log (WCL has not ranked the
fight); it is excluded from `medianParse`, `parseAtTarget` and `parseSpread`,
and rendered as `unranked`. *(Amended 2026-09-16.)*

### Consistency

Each sub-signal whose own sample is `< 5` is unavailable (parse/deaths:
runs with signals; damage: runs with a peer comparison), so the axis becomes
`null` with `confidence: "low"` when fewer than 5 runs — displayed as
"n/a (needs ≥ 5 runs)".

| id | input | curve | weights |
|---|---|---|---|
| `parseSpread` | `stddev(parsePercent)` over displayed runs | `[0,100] [10,85] [20,60] [35,30]` | 2 |
| `deathsSpread` | `stddev(deaths.count)` | `[0,100] [0.7,75] [1.5,45] [2.5,20]` | 2 |
| `damageSpread` | `stddev` of per-run `Δ%` (avoidable if available, else dtps) | `[0,100] [15,75] [30,45] [50,20]` | 1 |

### Preparation

| id | input | curve | weights |
|---|---|---|---|
| `potions` | mean `consumables.potions` per run (runs with consumables) | `[0,20] [2,55] [4,85] [6,100]` (fixtures: serious players use 5–6 combat potions per key) | 2 |
| `healthstones` | mean `consumables.healthstones` | `[0,40] [1,70] [2,90] [3,100]` | 1 |
| `ilvlVsLevel` | `rio.itemLevel − expectedIlvl(targetLevel)` (only if `rio.itemLevel`) | `[-20,10] [-10,45] [0,75] [10,100]` | 2 |

`expectedIlvl` is a curve in the config, per season (unknown/absent slug →
the **last** configured season, i.e. the newest after a user override merges);
initial for Midnight S2
`[[10,300],[15,315],[20,325],[25,332]]` — **to validate against real
profiles** (fixture: Muleyoxo ilvl 322 at +21, Biwaadrood 280–284 at +18 in S1).

### Experience

| id | input | curve | weights |
|---|---|---|---|
| `coverage` | `dungeonsCovered / totalDungeonsInSeason` | `[0,10] [0.5,45] [0.75,70] [1,100]` | 2 |
| `atTarget` | `dungeonsAtOrAboveTarget / totalDungeonsInSeason` | `[0,20] [0.25,50] [0.5,75] [1,100]` | 3 |
| `medianVsTarget` | `perDungeon.medianLevel − targetLevel` | `[-4,10] [-2,40] [0,70] [2,100]` | 2 |
| `activity` | `rio.derived.runsLast7d` (only if `rio`) | `[0,30] [2,60] [5,85] [10,100]` | 1 |
| `prevSeasonBonus` | if `summary.prevSeason`: `+min(10, prevSeason.all / 400)` added to the axis score after aggregation (clamped to 100); emits an Evidence with that delta; **absent → nothing** | — | — |

## Global, verdict, config

- Axis weights per role — dps `{survival 3, utility 2, throughput 3, consistency 0, preparation 1, experience 2}`; healer `{3, 2.5, 2, 0, 1, 2}`; tank `{3, 2, 2, 0, 1, 2.5}` (same key order). *(Amended 2026-09-16: consistency is informational — variance punishes key pushers; it was 1.5.)* The auto-detected target level is the median of the best run per dungeon (half-levels round up), not the single highest key *(amended 2026-09-16, `inferTargetLevel`)*. `null` axes are excluded from the weighted mean; if all axes are `null`, `global: null`.
- Verdict: `insufficient` if `runsUsed < 3`; else `invite` if `global ≥ 70`, `maybe` if `≥ 45`, else `pass`. `global: null` → `insufficient`.
- Config shape (`src/evaluation/default-config.json`):

```json
{
  "version": "1",
  "levelScale": [[8,1.6],[12,1.3],[16,1.0],[20,0.8],[25,0.65]],
  "expectedIlvl": { "season-mn-2": [[10,300],[15,315],[20,325],[25,332]] },
  "axes": {
    "survival": { "subSignals": { "individualDeaths": { "curve": [[0,100],[0.5,85],[1,65],[2,35],[3,10]], "weights": { "dps": 3, "healer": 3, "tank": 3 } }, "…": "…" } },
    "…": "…"
  },
  "axisWeights": { "dps": { "survival": 3, "…": 0 }, "healer": {}, "tank": {} },
  "verdict": { "invite": 70, "maybe": 45, "minRuns": 3 },
  "confidence": { "high": 6, "medium": 3, "consistencyMinRuns": 5 }
}
```

- Validation at load (`loadConfig`): every curve has ≥ 2 points with strictly
  increasing x and scores within 0–100; every weight ≥ 0; every axis and role
  present; unknown keys rejected with a message naming the path
  (`axes.survival.subSignals.foo`). Invalid default config = startup error;
  invalid user override = warning on stderr + default used.
- User override: `evaluation.json` next to `.env` (same resolution as
  `resolveEnvPath`; `BMPL_EVAL_CONFIG` env override). Merged **deeply by key**
  onto the default (arrays replace, objects merge), so a user may override only
  `verdict.thresholds` or one curve. `configVersion` = first 8 hex chars of
  SHA-256 of the effective config JSON (stable key order).

## Modules

```
src/evaluation/
  types.ts            AxisKey, Evidence, AxisScore, Evaluation, EvaluationConfig
  default-config.json initial rules (above)
  config.ts           loadConfig(userPath?) → EvaluationConfig; validate; deepMerge; configVersion
  curve.ts            curve, levelScale, stddev, median re-export
  inputs.ts           collect(payload) → per-axis raw inputs (pure; where every "mean over runs" lives)
  axes/*.ts           one file per axis: (inputs, role, cfg) → AxisScore
  evaluate.ts         evaluate(payload, cfg) → Evaluation (role detection, aggregation, verdict)
src/signals/wcl-run.ts   + consumables
src/lookup.ts            evaluation added to LookupOutcome and buildLookupPayload
src/setup.ts             resolveEvalConfigPath()
```

`evaluate` takes the **payload** (the same object the server/CLI emit), so
the model can be re-run offline on a saved `--json` file — useful for tuning
`evaluation.json` against a corpus of saved lookups (`bmpl evaluate
saved.json` CLI subcommand, reads a payload and prints the evaluation).

## Rendering (minimal; the radar chart is sub-project 3)

- **CLI**: after the summary line —
  `Verdict: INVITE 78  ·  Survival 82  Utility 61  Throughput 88  Consistency 70  Preparation 55  Experience 74  (high confidence, 9 runs)`
  then, per axis, the two evidence lines with the largest |delta|
  (`  Survival  +18  0.2 individual deaths/run · −6  avoidable +12% vs peers`).
  `n/a` for null axes; `INSUFFICIENT DATA (2 runs)` replaces the verdict.
- **Web**: a verdict badge (green/orange/red/grey) in the char-card header,
  a row of six axis tiles with score + confidence dot, and an expandable
  evidence list per tile (`<details>`); compare table gains seven rows
  (global + six axes, `higher` mode) and a verdict row.
- `bmpl evaluate <payload.json>`: prints the CLI block for a saved payload.

## Tests

- `curve`: interpolation, clamping, single-segment, invalid points rejected.
- `stddev`: population formula, `null` under 2 samples.
- `config`: default loads and validates; deep merge overrides one curve and
  one threshold; an override with a non-monotonic curve is rejected with the
  offending path in the message; `configVersion` changes when a value changes.
- `inputs`: computed from the two fixtures (S1 tank Biwaadrood, S2 healer
  Muleyoxo) after building a payload with `analyzeLookup` + `parseRunSignals`
  + `parseRioProfile` — expected values worked out by hand in the plan.
- each axis: score and evidence order on a hand-built input set; role
  differences (tank has no `dtpsVsPeers`, healer has `groupDeaths`); `null`
  utility for a no-kick/no-dispel DPS; consistency `null` under 5 runs.
- `evaluate`: verdict thresholds at the boundaries (69.9 → maybe, 70 →
  invite), `insufficient` under 3 runs, global excludes null axes, previous
  season bonus applied and clamped, absent previous season adds no evidence.
- consumables parsed from fixture S1 (`Mstercheif → potions 6, healthstones 3`;
  player absent → `null`).

## Out of scope

- Radar chart / visual design (sub-project 3, Claude Design).
- Statistical calibration from a population; automatic tuning.
- WCL ↔ RIO run join; timed/depleted in the score.
- UI editing of weights (users edit `evaluation.json`).
- Scoring across multiple characters of the same account.
