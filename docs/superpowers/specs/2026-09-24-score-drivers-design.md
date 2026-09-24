# Score drivers — "what makes this score" — design

Status: approved in chat 2026-09-24 (audience, reference and design agreed); canvas next.

## Problem

Members relay the question players ask on seeing their verdict: *"why this score, and not better?"*
The page cannot answer it. Each axis lists evidence lines such as `−12 0.9 deaths/run`, but that
number is in **axis points** around a neutral 50; the global score is then a weighted mean of six
axes, passed through the role's percentile curve (`globalCurve`, v0.5.0). Nothing on the page links
an evidence line to the number in the badge, and since v0.5.0 no arithmetic a reader could do on the
page gets from one to the other.

## Goal

Beside the verdict, a short list that says, in the badge's own points, which signals cost this
player the most and which carried them — *"−9 Deaths: 0.9/run (average player 0.4)"* — and what it
would take to reach the next verdict. It serves both readers: the recruiter (why this number) and
the player (what to work on). Decided with the user.

## The reference: the "average player"

For each role and each sub-signal, the value of the **median** player of the calibration
population (EU, +15 to +20, 1,081 characters — see
`2026-09-24-scoring-calibration-design.md`). The UI says **"average player"** ("joueur moyen"), the
wording players understand; the Help page states that it is the median, and why: deaths and
avoidable damage are skewed, a few players at 3 deaths a run drag a true mean up, and "average"
would then mean "worse than most".

Each reference holds two numbers per source, because the curve and the reader do not use the same
unit:

- `x` — the curve input, as `scoreAxis` feeds it to the sub-signal's curve (level-scaled for deaths);
- `value` — the display value, as `Evidence.value` carries it (e.g. deaths per run, unscaled).

Both are the role's medians over the calibration payloads, fitted by
`scripts/calibration/fit-global.ts` alongside `globalCurve` (0 WCL points: the payloads are on
disk). Deep-dive sub-signals (`survival.defensiveUsage`, `survival.avoidableDeaths`) have no
reference: the study collected no deep-dive. `experience.prevSeasonBonus` is not a configured
sub-signal and gets none either.

## Computation — `src/evaluation/`, pure

**Config.** A new key `reference: Record<Role, Record<source, { x: number; value: number }>>` in
`default-config.json`, validated like the rest (every role present, finite numbers, sources must name
a configured sub-signal; a source may be absent). Version bumped to 3.

**Impact of one signal.** `scoreAxis` gains an optional `override: Record<source, number>` that
replaces a sub-signal's curve input before `curve()`; `scoreAllAxes` passes it through the six axis
functions. For each contributing sub-signal that has a reference:

```
impact(source) = global(actual) − global(with that source's x replaced by reference.x)
```

where `global` is the final number the badge shows: axes rounded as today, weighted mean, then
`globalCurve`, rounded. So an impact is **in badge points**: −9 means "at the average player's level
on this signal alone, this player would score 9 more". A player exactly at the reference scores 0 on
that signal. Impacts do not add up to the score exactly (the percentile curve is not linear, and a
sub-signal's weight is relative to the others present on its axis); the Help page says so rather
than forcing a sum.

**Path to the next verdict.** Starting from the actual inputs, replace the most negative impact's
input by its reference, recompute, and repeat with the next most negative — up to **3 signals** —
until the global reaches the next threshold (`verdict.maybe` from PASS, `verdict.invite` from MAYBE).
The result lists the signals used and the score reached. If three are not enough, the result says so
(`reachable: false`). No path for INVITE or INSUFFICIENT DATA.

**Output.** `Evaluation` gains:

```ts
drivers?: { source: string; impact: number; value: number; reference: number }[]; // |impact| ≥ 1, sorted by impact ascending (costs first)
nextVerdict?: { verdict: "maybe" | "invite"; sources: string[]; score: number; reachable: boolean } | null;
```

Optional in the type so evaluations saved before this change (history, `--json` files) still load;
the front shows nothing when they are absent. The cost is a handful of extra `scoreAllAxes` runs per
evaluation (one per sub-signal with a reference, ≤ 16, plus ≤ 3 for the path) — pure arithmetic,
no I/O, no WCL.

## Display — design canvas first

A block **"What makes this score"** under the verdict badge in `VerdictHero`, above the axis rows:

- the 3 to 5 largest impacts, costs first then strengths, each as
  `−9  Deaths: 0.9/run (average player 0.4)` — tone colours from `tokens.css`, the sub-signal's
  title from the docs registry, the values formatted like the evidence lines (`VALUE_FORMAT`);
- one closing line: *"To reach INVITE (70): bring deaths and interrupts to the average player's
  level."* — or *"Out of reach by fixing three signals"*;
- a `HelpLink` to a new Help anchor that explains the average player and the "what if" reading.

The axis rows stay underneath, unchanged, as the detail. All strings in `web/src/i18n/en.ts` and
`fr.ts`. The view model (which drivers to show, the sentence) lives in `web/src/lib/`, pure and
tested; the component stays thin. The CLI verdict block (`src/format-mplus.ts`) prints the same
list in plain text.

Mocked first on the Claude Design canvas (`docs/agents/web-front.md`), 2–3 variants; the user picks.

## Tests

- `scoreAxis` override: replacing an input changes only that sub-signal's score.
- A player built at every reference value → every impact 0.
- Signs: worse than the reference → negative impact; better → positive.
- The path: the minimal prefix of the costs that crosses the threshold; `reachable: false` when three
  do not; none for INVITE / INSUFFICIENT.
- Config validation: unknown source, missing role, non-finite number.
- Front view model: top-N selection, formatting per locale, the sentence per case, absent `drivers`.

## Known limits

- The references describe the same population as `globalCurve` and are refitted with it each season
  (issue #19).
- "What if this one signal were average" ignores that signals move together (a player who stops dying
  also stands in less). It answers the reader's question — which part of the play costs points — not
  a causal one.
- Deep-dive signals get no impact until a study collects deep-dives.
