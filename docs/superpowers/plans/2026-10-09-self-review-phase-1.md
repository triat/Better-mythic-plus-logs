# Self-review phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player follow themselves over a season, globally, per dungeon and per key, with the same engine that vets other players: five pillars (Damage, Survival, Avoidable damage, Interrupts, Control) regrouping today's sub-signals, a season store of every ranked run, an explicit season sync, weekly trends, and three result tabs (Overview, Dungeons, Runs).

**Architecture:** `scoreAxis` keeps each sub-signal's weight and curve score on its evidence; `pillarScores` re-averages them per pillar, so the verdict does not move. Every lookup already receives every ranked run of the season from WCL: it now records them in a `character_runs` table at 0 extra points. A sync enriches the uncached runs in batches of 10, through the member's own WCL client when hosted. `GET /api/season` turns the stored runs and their cached raw reports into a `SeasonView` (per-run pillars, 4-week window, trends, points to work on, dungeon grid and details) at 0 points. The web front adds three tabs on the result page, built from pure view models.

**Tech Stack:** Bun + TypeScript strict (`src/`), `bun:sqlite`, Vite + React 19 (`web/`), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-09-self-review-pillars-design.md` (canvas page "self-review": `docs/design/canvas/SelfTabs.dc.html` for the tabs and the Overview, `SelfDungeonFirst.dc.html` for the Dungeons tab, `SelfDetails.dc.html` for the sync card, the run detail and "This is me"). Live-data findings: GitHub issue #24.

## Before you start: what the user validates with this plan

Validated by the user on 2026-10-09, as written; Task 19 runs first.

These choices are not in the canvas or were left open by the spec. The plan implements them as written below; the user confirms or changes them before Task 1.

1. **The numbers** in the spec's "Numbers (phase 1)" section (windows, trend band, colour bands, sync batch, retry delay), copied in Global Constraints.
2. **Where today's verdict block goes.** Canvas A shows the Overview without the radar, the axis rows, the signal tiles and Raider.IO. The plan keeps them: the Overview shows canvas A's content first (work on first, the five pillar cards, the verdict line), then today's `VerdictHero`, `SignalTiles` and `RioSection` unchanged below. Today's "Best run per dungeon" list moves to the Runs tab.
3. **The Runs tab before a sync** shows today's list (best run per dungeon) and offers the sync; after the season store has runs, it lists every run of the season, newest first.
4. **The personal page** (spec decision 8) has no canvas yet. Tasks 1 to 18 do not depend on it. Task 19 mocks it on the canvas, the user picks a variant, and Task 20 is written then. This is the only part of the plan written after a later choice, on purpose (the canvas rule in `docs/agents/workflow.md`).

## Global Constraints

- `just check` and `bun test` green after every task, with `web/dist` absent for the final run. (In the cloud environment, where `just` is missing: `bun run typecheck && bun run --cwd web typecheck` and `bun test`.)
- Tests never reach WCL or Raider.IO: fakes through `deps`, dummy `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` in any test that could fall through to a real call.
- English in code, docs and commits; every UI string in `web/src/i18n/en.ts`, mirrored key for key in `fr.ts`; no UI literal in a component.
- `web/` imports from `src/` are `import type` only (runtime exception `src/wow/classes.ts`).
- Colours, radii and fonts only from `web/src/styles/tokens.css`; this plan needs no new token.
- **No change to the verdict, curves or weights** (spec non-goal): `global` and `verdict` of every existing evaluation test stay as they are.
- **Pillars** (spec "Vocabulary"):
  - Damage: `throughput.medianParse`, `throughput.parseAtTarget`
  - Survival: `survival.individualDeaths`, `survival.wipeDeaths`, `survival.groupDeaths`, `survival.defensiveUsage`, `survival.avoidableDeaths`
  - Avoidable damage: `survival.avoidableVsPeers`, `survival.dtpsVsPeers`
  - Interrupts: `utility.kicksVsPeers`, `utility.kicksAbsolute`
  - Control: `utility.dispels`
  - Context (never a pillar): `preparation.*`, `consistency.*`, `experience.*` (including `experience.prevSeasonBonus`)
- "A pillar's score is the weighted mean of its sub-signals with today's curves and weights, the same computation `scoreAxis` does for an axis."
- **Numbers (phase 1)**, verbatim from the spec:
  - "**Overview window:** the last 4 game weeks (current one included). Needs at least 3 analysed runs; below that the Overview uses the lookup's own evaluation (the verdict's runs) and says so."
  - "**Own past:** the 4 game weeks before the Overview window, same 3-run floor; "better" or "worse" when a sub-signal's curve score moved by more than 3 points, "same" otherwise."
  - "**Trend arrow:** median per-run pillar score of the last 2 game weeks vs the 4 before, 3 runs minimum on each side; within ±3 points it reads "same"."
  - "**Weekly bars:** the last 8 game weeks."
  - "**Score colours** (pillar cards and dungeon cells, read off the canvas): 75 and above good, 55–74 neutral, 45–54 warning, below 45 bad, `null` n/a."
  - "**Sync:** batches of 10 runs, newest first, one request each; a batch refuses to start under `MIN_BUDGET_POINTS` (20) + 10 × `ESTIMATE_RUN` left on the client; a run whose report WCL does not return is not retried for 24 h."
- **Week boundaries** (spec decision 5): US Tuesday 15:00 UTC, EU Wednesday 04:00 UTC, KR and TW Wednesday 23:00 UTC, fixed in UTC, anchored on Raider.IO period 1084 (`us` 2026-10-06T15:00:00Z, `eu` 2026-10-07T04:00:00Z, `kr`/`tw` 2026-10-07T23:00:00Z).
- **Sync access** (spec decision 3): hosted, only through the member's own WCL client (403 `own_client_required` otherwise); local, the env credentials. The rankings a lookup already fetches are recorded at 0 extra points; nothing else spends points without a click.
- **"Me"** (spec decision 1): up to 5 `{ name, realm, region, source }`, `realm` is the WCL slug, `source: "manual"` only in phase 1; `PUT /api/settings` refuses any other source. No automatic lookup ever.
- **Data notes** (spec): avoidable `abilities[]` is capped at five, the remainder is "other"; killing hits are the Deaths entry's `events[]` (newest first, up to three), `DeathEvent.cause` is not changed; a spell's attempts are `max(spellsBegun, spellsCompleted + spellsInterrupted)`; `spellsCompleted` is group context, `mine` is the character's own `details[]` total.
- Stage files explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env*`, `bmpl.db*`, `.calibration/`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01VKeqQEbNWAqsCuRB8nKrKP`.

## Files

| File | Responsibility |
|---|---|
| `src/evaluation/types.ts` | `Evidence.weight` / `Evidence.score`, `PillarKey`, `PILLAR_KEYS`, `PillarScore`, `Evaluation.pillars` |
| `src/evaluation/axis.ts` | `scoreAxis` writes `weight` and `score` on each evidence |
| `src/evaluation/pillars.ts` (new) | `PILLAR_SOURCES`, `CONTEXT_SOURCES`, `pillarOf`, `pillarScores` |
| `src/evaluation/evaluate.ts` | `Evaluation.pillars` |
| `src/signals/types.ts`, `src/signals/wcl-run.ts` | `KillingHit`, `AbilityDamage`, `EnemyCast`; parsed from the cached raw run |
| `src/self/weeks.ts` (new) | game-week anchors, `weekOf`, `weekStart` |
| `src/mplus.ts` | `MPlusRun.timed` / `durationMs` from the rankings |
| `src/signals/store.ts` | `character_runs` table, `CharacterKey`, `SeasonRow`, five store methods |
| `src/lookup.ts` | records the season's runs on every lookup (0 pts) |
| `src/signals/enrich.ts` | exports `fetchRunReport` |
| `src/self/sync.ts` (new) | `syncState`, `pendingRows`, `syncBatch`, `runSeasonSync`, `rowToRun` |
| `src/self/season.ts` (new) | `seasonView` and its pure helpers (`trendOf`, `changeOf`, `dungeonDetails`) |
| `src/self/characters.ts` (new) | `MyCharacter`, `MAX_CHARACTERS`, `parseCharacters` |
| `src/server/season.ts` (new) | `GET /api/season`, `POST /api/season/sync` handlers |
| `src/server/validate.ts`, `src/server/routes-shared.ts`, `src/server.ts`, `src/hosted/usage-catalog.ts` | body schemas, routes, rate limit, usage events |
| `src/hosted/schema.ts`, `src/hosted/db.ts`, `src/server/routes-user.ts` | `user_settings.characters` |
| `src/evaluation/docs.ts`, `src/evaluation/docs.fr.ts` | pillar prose for `/help` |
| `web/src/types.ts`, `web/src/api.ts` | shared types, `api.season`, `api.seasonSync` |
| `web/src/lib/settings.ts` | `Settings.characters` (local key `bmpl.characters`) |
| `web/src/lib/self.ts` (new) | every self-review view model |
| `web/src/lib/runs.ts` | exports `rowOf` |
| `web/src/i18n/en.ts`, `web/src/i18n/fr.ts` | `self` section, `help.toc.pillars` |
| `web/src/styles/app.css` | `.rtabs`, `.pillars`, `.pillar-*`, `.work-on*`, `.grid5*`, `.cell*`, `.side-panel`, `.ab-row`, `.sync-card` |
| `web/src/useSeason.ts` (new) | loads the season view, runs the sync loop |
| `web/src/components/Detail.tsx` | result header, the three tabs |
| `web/src/components/self/*.tsx` (new) | `ResultHead`, `SyncCard`, `Overview`, `PillarCards`, `WorkOn`, `DungeonsTab`, `DungeonPanel`, `RunsTab`, `RunDetailExtra` |
| `web/src/components/help/HelpPage.tsx`, `web/src/lib/help.ts` | the pillars section of `/help` |
| `web/src/App.tsx` | passes the self-review context to `Detail` |
| `docs/agents/architecture.md`, `docs/agents/web-front.md`, `docs/scoring.md`, `docs/hosted.md`, `README.md`, `AGENTS.md`, the spec | kept true |

---

### Task 1: Pillar scores from the evaluation's own evidence

**Files:**
- Modify: `src/evaluation/types.ts`, `src/evaluation/axis.ts`, `src/evaluation/evaluate.ts`
- Create: `src/evaluation/pillars.ts`
- Test: `test/evaluation/pillars.test.ts`

**Interfaces:**
- Produces: `Evidence.weight?: number`, `Evidence.score?: number`; `type PillarKey`; `PILLAR_KEYS`; `interface PillarScore { key; score: number | null; evidence: Evidence[] }`; `Evaluation.pillars?: PillarScore[]`; `PILLAR_SOURCES`, `CONTEXT_SOURCES`, `pillarOf(source)`, `pillarScores(axes)`.

- [ ] **Step 1: Failing tests**

Create `test/evaluation/pillars.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { EVIDENCE_SOURCES } from "../../src/evaluation/axes/index.ts";
import { scoreAxis } from "../../src/evaluation/axis.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { collectInputs } from "../../src/evaluation/inputs.ts";
import { CONTEXT_SOURCES, PILLAR_SOURCES, pillarOf } from "../../src/evaluation/pillars.ts";
import { PILLAR_KEYS } from "../../src/evaluation/types.ts";
import { deaths, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const kicks = { count: 6, kickCooldownS: 15, capacity: 10, usage: 0.6, peer: { median: 0.5, count: 3 } };
const pillar = (ev: ReturnType<typeof evaluate>, key: string) => ev.pillars!.find((p) => p.key === key)!;

describe("pillar mapping", () => {
  test("every evidence source belongs to exactly one pillar or to context", () => {
    for (const source of EVIDENCE_SOURCES) {
      const homes = PILLAR_KEYS.filter((k) => (PILLAR_SOURCES[k] as readonly string[]).includes(source)).length
        + ((CONTEXT_SOURCES as readonly string[]).includes(source) ? 1 : 0);
      expect(`${source}:${homes}`).toBe(`${source}:1`);
    }
    expect(pillarOf("utility.dispels")).toBe("control");
    expect(pillarOf("preparation.potions")).toBeNull();
  });
});

describe("pillarScores", () => {
  const runs = () => [1, 2, 3].map(() => runWith({ deaths: deaths(1), interrupts: kicks }));

  test("Damage equals the throughput axis (same two sub-signals)", () => {
    const ev = evaluate(payloadWith(runs()), cfg);
    expect(pillar(ev, "damage").score).toBe(ev.axes.find((a) => a.key === "throughput")!.score);
  });

  test("Interrupts equals scoreAxis over the two kick sub-signals", () => {
    const p = payloadWith(runs());
    const i = collectInputs(p, cfg);
    const expected = scoreAxis("utility", [
      { id: "kicksVsPeers", value: i.utility.kicksVsPeers, label: String },
      { id: "kicksAbsolute", value: i.utility.kicksAbsolute, label: String },
    ], i.role, cfg, i.runsUsed).score;
    expect(pillar(evaluate(p, cfg), "interrupts").score).toBe(expected);
  });

  test("Control is n/a for a kit with no dispel, never 0", () => {
    const p = payloadWith([1, 2, 3].map(() => runWith({ dispels: { count: 0, available: false } })));
    expect(pillar(evaluate(p, cfg), "control").score).toBeNull();
  });

  test("evidence carries its weight and curve score; the global is untouched", () => {
    const ev = evaluate(payloadWith(runs()), cfg);
    const e = ev.axes.find((a) => a.key === "survival")!.evidence.find((x) => x.source === "survival.individualDeaths")!;
    expect(e.weight).toBe(3);
    expect(typeof e.score).toBe("number");
    expect(ev.pillars!.map((x) => x.key)).toEqual(["damage", "survival", "avoidable", "interrupts", "control"]);
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test test/evaluation/pillars.test.ts`
Expected: FAIL (`src/evaluation/pillars.ts` does not exist).

- [ ] **Step 3: Types**

In `src/evaluation/types.ts`, inside `interface Evidence`, after `extra?: EvidenceExtra;`:

```ts
  /** The sub-signal's weight for the role and its curve score (0–100, unrounded), set by `scoreAxis`; the pillars
   * (src/evaluation/pillars.ts) re-average them. Absent on the previous-season bonus and on payloads saved before. */
  weight?: number;
  score?: number;
```

After `AXIS_KEYS`:

```ts
/** The five pillars of the self-review (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md). */
export type PillarKey = "damage" | "survival" | "avoidable" | "interrupts" | "control";
export const PILLAR_KEYS: readonly PillarKey[] = ["damage", "survival", "avoidable", "interrupts", "control"];
```

After `interface AxisScore`:

```ts
/** A pillar: the weighted mean of its sub-signals' curve scores, `null` when none of them has data. */
export interface PillarScore {
  key: PillarKey;
  score: number | null;
  /** The pillar's evidence, sorted by |delta| descending (deltas stay in their own axis' points). */
  evidence: Evidence[];
}
```

In `interface Evaluation`, after `nextVerdict?`:

```ts
  /** The five pillars, regrouped from `axes` (no effect on `global` or `verdict`); absent on payloads saved before. */
  pillars?: PillarScore[];
```

- [ ] **Step 4: `scoreAxis` keeps weight and score**

In `src/evaluation/axis.ts`, the second loop becomes:

```ts
  for (const { source, w, s, label, value, extra } of contributing) {
    num += w * s;
    evidence.push({ label, delta: Math.round(((w * (s - 50)) / den) * 10) / 10, source, value, ...(extra ? { extra } : {}), weight: w, score: s });
  }
```

- [ ] **Step 5: `src/evaluation/pillars.ts`**

```ts
// The five pillars of the self-review (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md): a regrouping
// of today's sub-signals, scored with today's curves and weights. Nothing here feeds the global score or the verdict.
import type { EvidenceSource } from "./axes/index.ts";
import { PILLAR_KEYS, type AxisScore, type PillarKey, type PillarScore } from "./types.ts";

export const PILLAR_SOURCES: Record<PillarKey, readonly EvidenceSource[]> = {
  damage: ["throughput.medianParse", "throughput.parseAtTarget"],
  survival: ["survival.individualDeaths", "survival.wipeDeaths", "survival.groupDeaths", "survival.defensiveUsage", "survival.avoidableDeaths"],
  avoidable: ["survival.avoidableVsPeers", "survival.dtpsVsPeers"],
  interrupts: ["utility.kicksVsPeers", "utility.kicksAbsolute"],
  control: ["utility.dispels"],
};

/** Shown beside the pillars, never scored into one. */
export const CONTEXT_SOURCES: readonly EvidenceSource[] = [
  "preparation.potions", "preparation.healthstones", "preparation.ilvlVsLevel",
  "consistency.parseSpread", "consistency.deathsSpread", "consistency.damageSpread",
  "experience.coverage", "experience.atTarget", "experience.medianVsTarget", "experience.activity", "experience.prevSeasonBonus",
];

export const pillarOf = (source: string): PillarKey | null =>
  PILLAR_KEYS.find((k) => (PILLAR_SOURCES[k] as readonly string[]).includes(source)) ?? null;

/** Each pillar's weighted mean of its sub-signals' curve scores: what `scoreAxis` computes over the same sub-signals. */
export function pillarScores(axes: AxisScore[]): PillarScore[] {
  const all = axes.flatMap((a) => a.evidence);
  return PILLAR_KEYS.map((key) => {
    const sources = PILLAR_SOURCES[key] as readonly string[];
    const evidence = all
      .filter((e) => sources.includes(e.source) && typeof e.weight === "number" && e.weight > 0 && typeof e.score === "number")
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    let num = 0;
    let den = 0;
    for (const e of evidence) {
      num += e.weight! * e.score!;
      den += e.weight!;
    }
    return { key, score: den > 0 ? Math.round(num / den) : null, evidence };
  });
}
```

- [ ] **Step 6: `evaluate()` returns the pillars**

In `src/evaluation/evaluate.ts`: `import { pillarScores } from "./pillars.ts";` and, in the returned object after `nextVerdict,`: `pillars: pillarScores(axes),`.

- [ ] **Step 7: Run the whole suite**

Run: `bun test` then `bun run typecheck && bun run --cwd web typecheck`
Expected: PASS. `test/evaluation/evaluate.test.ts` and `test/evaluation/drivers.test.ts` pass unchanged (the verdict does not move). If a test compares a whole `Evidence` or `AxisScore` with `toEqual`, add `weight` and `score` to its expected value (`expect.any(Number)` for `score`) rather than changing the code.

- [ ] **Step 8: Commit**

```bash
git add src/evaluation/types.ts src/evaluation/axis.ts src/evaluation/pillars.ts src/evaluation/evaluate.ts test/evaluation/pillars.test.ts
git commit -m "feat(evaluation): five pillars regrouped from the axes' evidence"
```

---

### Task 2: Killing hits, avoidable abilities and enemy casts from the cached run

**Files:**
- Modify: `src/signals/types.ts`, `src/signals/wcl-run.ts`
- Test: `test/signals/wcl-run.test.ts`

**Interfaces:**
- Produces: `KillingHit`, `AbilityDamage`, `EnemyCast`; `DeathEvent.killingHits?`, `RunSignals.avoidableDamage.abilities?` / `.other?`, `RunSignals.interrupts.enemyCasts?`.

- [ ] **Step 1: Failing tests**

Append to `test/signals/wcl-run.test.ts`:

```ts
describe("parseRunSignals — self-review details (issue #24 § 3)", () => {
  test("killing hits are the death's events, newest first; cause is unchanged", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Muleyoxo", fb(f))!;
    expect(s.deaths.events).toHaveLength(1);
    const d = s.deaths.events[0]!;
    expect(d.cause).toBe("Cosmic Crash");
    expect(d.killingHits).toEqual([
      { ability: "Unstable Singularity", abilityId: 1264188, amount: 15613, overkill: 18667, friendly: false, instakill: false },
      { ability: "Unstable Singularity", abilityId: 1264188, amount: 34279, overkill: 0, friendly: false, instakill: false },
      { ability: "Cosmic Crash", abilityId: 1300372, amount: 56623, overkill: 0, friendly: false, instakill: false },
    ]);
  });

  test("a self-inflicted hit is marked friendly", async () => {
    const f = await loadWclFixture("s2-healer");
    const s = parseRunSignals(f.report, "Deeprayaa", fb(f))!;
    expect(s.deaths.events[0]!.killingHits![2]).toEqual(
      { ability: "Rune of Void-Tainted Shell", abilityId: 1287955, amount: 763, overkill: 0, friendly: true, instakill: false });
  });

  test("avoidable abilities of the player, the remainder as other", async () => {
    const f = await loadWclFixture("s2-healer");
    expect(parseRunSignals(f.report, "Wazocutie", fb(f))!.avoidableDamage).toMatchObject({
      total: 17051476,
      abilities: [
        { id: 1264188, name: "Unstable Singularity", total: 11592618 },
        { id: 1249712, name: "Venomous Spit", total: 3174069 },
        { id: 1296963, name: "Umbral Rupture", total: 2284789 },
      ],
      other: 0,
    });
    // WCL keeps the top five abilities only: anything above their sum is "other".
    const capped = structuredClone(f.report);
    const entry = capped.avoidable.data.entries.find((e: { name: string }) => e.name === "Muleyoxo");
    entry.total += 5000;
    expect(parseRunSignals(capped, "Muleyoxo", fb(f))!.avoidableDamage!.other).toBe(5000);
  });

  test("enemy casts: attempts, completions, interrupts, the player's own kicks", async () => {
    const f = await loadWclFixture("s2-healer");
    const casts = parseRunSignals(f.report, "Muleyoxo", fb(f))!.interrupts.enemyCasts!;
    expect(casts).toHaveLength(6);
    expect(casts[0]).toEqual({ id: 1228176, name: "Lava Bolt", attempts: 40, completed: 11, interrupted: 27, mine: 1 });
    // A channel: 0 begun, yet completed and interrupted.
    expect(casts.find((c) => c.id === 1310324)).toEqual({ id: 1310324, name: "Mending Void", attempts: 42, completed: 25, interrupted: 17, mine: 0 });
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test test/signals/wcl-run.test.ts`
Expected: FAIL (`killingHits`, `abilities`, `enemyCasts` undefined).

- [ ] **Step 3: Types**

In `src/signals/types.ts`, before `interface DeathEvent`:

```ts
/** One of the last hits of a death (the Deaths entry's `events[]`, up to three, newest first). */
export interface KillingHit {
  ability: string | null;
  abilityId: number | null;
  amount: number;
  overkill: number;
  /** Dealt by the player or an ally (a self-damage trinket, a friendly debuff). */
  friendly: boolean;
  instakill: boolean;
}

/** An avoidable ability that hit the player: WCL lists the top five by damage, the rest is `other`. */
export interface AbilityDamage { id: number; name: string; total: number }

/** An enemy spell the group interrupted at least once (the Interrupts table lists no other). */
export interface EnemyCast {
  id: number;
  name: string;
  /** max(spellsBegun, spellsCompleted + spellsInterrupted): channels report 0 begun. */
  attempts: number;
  completed: number;
  interrupted: number;
  /** Interrupts by this player on that spell. */
  mine: number;
}
```

In `DeathEvent`, after `inWipe: boolean;`:

```ts
  killingHits?: KillingHit[]; // newest first; absent on payloads saved before 2026-10
```

In `RunSignals.interrupts`, after `peer: PeerComparison | null;  // peers compared on usage`:

```ts
    enemyCasts?: EnemyCast[];     // absent without an Interrupts table, and on payloads saved before 2026-10
```

In `RunSignals.avoidableDamage`, after `spellCount: number;`:

```ts
    abilities?: AbilityDamage[];  // the player's top five avoidable abilities
    other?: number;               // total − Σ abilities (WCL's top-five cap)
```

In `RawDeathEvent`, after `sourceID?: number;`: `sourceIsFriendly?: boolean;`

In `RawTableEntry`, after `details?: Array<{ name: string; total?: number }>;`:

```ts
  // DamageTaken entries: per-ability breakdown (top five).
  abilities?: Array<{ name: string; guid?: number; total?: number }>;
  // Interrupts table, per enemy spell.
  spellsBegun?: number;
  spellsCompleted?: number;
  spellsInterrupted?: number;
```

- [ ] **Step 4: Parse them**

In `src/signals/wcl-run.ts`, extend the type import with `EnemyCast, KillingHit, RawTableEntry` (keep the existing names), and add above `parseRunSignals`:

```ts
/** The death's last hits as WCL lists them (newest first, at most three). */
const killingHitsOf = (raw: RawTableEntry): KillingHit[] =>
  (raw.events ?? []).slice(0, 3).map((e) => ({
    ability: e.ability?.name ?? null,
    abilityId: e.ability?.guid ?? null,
    amount: e.amount ?? 0,
    overkill: e.overkill ?? 0,
    friendly: e.sourceIsFriendly === true,
    instakill: e.type === "instakill",
  }));

/** One entry per enemy spell the group interrupted at least once, with the player's own share. */
const enemyCastsOf = (table: RawTable, characterName: string): EnemyCast[] => {
  const out: EnemyCast[] = [];
  for (const outer of table.data?.entries ?? []) {
    for (const spell of outer.entries ?? []) {
      if (typeof spell.guid !== "number") continue;
      const completed = spell.spellsCompleted ?? 0;
      const interrupted = spell.spellsInterrupted ?? 0;
      const mine = (spell.details ?? []).filter((d) => d.name === characterName).reduce((s, d) => s + (d.total ?? 0), 0);
      out.push({ id: spell.guid, name: spell.name, attempts: Math.max(spell.spellsBegun ?? 0, completed + interrupted), completed, interrupted, mine });
    }
  }
  return out;
};
```

In the `interrupts` object, after the `peer:` property:

```ts
    ...(report.interrupts ? { enemyCasts: enemyCastsOf(report.interrupts, characterName) } : {}),
```

In the avoidable block, replace the `avoidableDamage = { … }` assignment with:

```ts
    const entry = report.avoidable.data?.entries?.find((e) => e.name === characterName);
    const abilities = (entry?.abilities ?? [])
      .filter((a) => typeof a.guid === "number" && typeof a.total === "number")
      .map((a) => ({ id: a.guid!, name: a.name, total: a.total! }));
    const listed = abilities.reduce((s, a) => s + a.total, 0);
    avoidableDamage = {
      total: mine,
      perMinute: minutes > 0 ? mine / minutes : 0,
      peer: peerComparison(toValues(perMin), characterName, roleByName, EVERYONE),
      spellCount: list.length,
      abilities,
      other: Math.max(0, mine - listed),
    };
```

In the deaths `.map((d) => ({ … }))`, after `inWipe: near >= WIPE_MIN_DEATHS,`: `killingHits: killingHitsOf(d.raw),`.

- [ ] **Step 5: Run**

Run: `bun test` and the typechecks.
Expected: PASS. A test that compares a whole `RunSignals` or `DeathEvent` with `toEqual` against a parsed fixture needs the new fields in its expectation; prefer `toMatchObject` there only if the test was about another field.

- [ ] **Step 6: Commit**

```bash
git add src/signals/types.ts src/signals/wcl-run.ts test/signals/wcl-run.test.ts
git commit -m "feat(signals): killing hits, avoidable abilities and enemy casts per run"
```

---

### Task 3: Game weeks

**Files:**
- Create: `src/self/weeks.ts`
- Test: `test/self/weeks.test.ts`

**Interfaces:**
- Produces: `WEEK_MS`, `WEEK_ANCHOR: Record<Region, number>`, `weekOf(region, t)`, `weekStart(region, week)`.

- [ ] **Step 1: Failing test**

`test/self/weeks.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { WEEK_ANCHOR, weekOf, weekStart } from "../../src/self/weeks.ts";

// Raider.IO GET /api/v1/periods, captured 2026-10-09 (period 1084 = "current"): spec decision 5.
const RIO = {
  us: { previous: "2026-09-29T15:00:00Z", current: "2026-10-06T15:00:00Z" },
  eu: { previous: "2026-09-30T04:00:00Z", current: "2026-10-07T04:00:00Z" },
  kr: { previous: "2026-09-30T23:00:00Z", current: "2026-10-07T23:00:00Z" },
  tw: { previous: "2026-09-30T23:00:00Z", current: "2026-10-07T23:00:00Z" },
} as const;

describe("game weeks", () => {
  test("anchors are Raider.IO's period boundaries", () => {
    for (const region of ["us", "eu", "kr", "tw"] as const) {
      expect(WEEK_ANCHOR[region]).toBe(Date.parse(RIO[region].current));
      expect(weekStart(region, -1)).toBe(Date.parse(RIO[region].previous));
    }
  });
  test("a run belongs to the week whose reset it follows", () => {
    expect(weekOf("us", Date.parse("2026-10-06T14:59:59Z"))).toBe(-1);
    expect(weekOf("us", Date.parse("2026-10-06T15:00:00Z"))).toBe(0);
    expect(weekOf("eu", Date.parse("2026-10-14T04:00:00Z"))).toBe(1);
    expect(weekOf("eu", Date.parse("2026-08-19T07:30:52Z"))).toBe(-8);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `bun test test/self/weeks.test.ts` → FAIL (module missing).

- [ ] **Step 3: `src/self/weeks.ts`**

```ts
// Game weeks for the self-review trends (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 5).
// One reset per region, taken from Raider.IO's GET /api/v1/periods (period 1084, captured 2026-10-09) and assumed
// fixed in UTC: a daylight-saving shift on Blizzard's side would misplace the runs of one hour, accepted.
import type { Region } from "../wow/regions.ts";

export const WEEK_MS = 7 * 24 * 60 * 60_000;

export const WEEK_ANCHOR: Record<Region, number> = {
  us: Date.UTC(2026, 9, 6, 15), // Tuesday 15:00 UTC
  eu: Date.UTC(2026, 9, 7, 4), // Wednesday 04:00 UTC
  kr: Date.UTC(2026, 9, 7, 23), // Wednesday 23:00 UTC
  tw: Date.UTC(2026, 9, 7, 23),
};

/** The game week `t` (epoch ms) falls in: 0 is the week starting at the anchor, negative before it. */
export const weekOf = (region: Region, t: number): number => Math.floor((t - WEEK_ANCHOR[region]) / WEEK_MS);

/** Epoch ms of the reset that opens `week`. */
export const weekStart = (region: Region, week: number): number => WEEK_ANCHOR[region] + week * WEEK_MS;
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/self/weeks.ts test/self/weeks.test.ts
git commit -m "feat(self): game weeks per region from Raider.IO's periods"
```

---

### Task 4: Rankings carry the result and duration; the season store

**Files:**
- Modify: `src/mplus.ts`, `src/signals/store.ts`
- Test: `test/mplus.test.ts`, `test/signals/store.test.ts`

**Interfaces:**
- Produces: `MPlusRun.timed?: boolean`, `MPlusRun.durationMs?: number`; `CharacterKey`, `SeasonRow`; `Store.upsertSeasonRuns`, `Store.seasonRuns`, `Store.latestSeasonZone`, `Store.markSeasonRunFailed`, `Store.hasWclRun`.

- [ ] **Step 1: Failing tests**

Append to `test/mplus.test.ts`:

```ts
import { loadRankingsFixture } from "./fixtures.ts";

describe("fetchMplusData — every ranked run, with its result (issue #24 § 1)", () => {
  const realFetch = globalThis.fetch;
  const savedEnv = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
  beforeEach(async () => {
    resetAuthCache();
    process.env.WCL_CLIENT_ID = "bmpl-test";
    process.env.WCL_CLIENT_SECRET = "bmpl-test";
    const f = await loadRankingsFixture();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/oauth/token")) return Response.json({ access_token: "t", expires_in: 3600, token_type: "bearer" });
      const body = String(init?.body ?? "");
      if (body.includes("CharacterMetricProbe")) {
        return Response.json({ data: { characterData: { character: { id: 1, name: "Noshiidk", classID: 1, dps: f.zoneRankings, hps: null } } } });
      }
      return Response.json({ data: { characterData: { character: f.encounterRankings } } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; resetAuthCache(); });
  afterAll(() => {
    if (savedEnv.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedEnv.id;
    if (savedEnv.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedEnv.secret;
  });

  test("108 runs, 9 of them depleted, each with its duration", async () => {
    const data = await fetchMplusData("Noshiidk", "Draenor", { region: "eu", metric: "dps", zone: { id: 55, name: "Mythic+ Season 2", partition: 1 } });
    expect(data.runs).toHaveLength(108);
    expect(data.runs.filter((r) => r.timed === false)).toHaveLength(9);
    const first = data.runs.find((r) => r.reportCode === "jctk4KDHYXT1mb76")!;
    expect(first).toMatchObject({ keyLevel: 19, timed: true, durationMs: 1761129, startTime: 1791322772832 });
  });
});
```

Append to `test/signals/store.test.ts`:

```ts
import type { MPlusRun } from "../../src/mplus.ts";

describe("season store (character_runs)", () => {
  const key = { region: "eu", realm: "draenor", name: "Noshiidk" };
  const run = (code: string, startTime: number, over: Partial<MPlusRun> = {}): MPlusRun => ({
    encounterID: 12923, encounterName: "Voidscar Arena", keyLevel: 18, amount: 1000, parsePercent: 50, spec: "Frost",
    affixes: [9, 10], reportCode: code, fightID: 1, startTime, score: 400, timed: true, durationMs: 1_700_000, ...over,
  });

  test("upsert, newest first, idempotent, case-insensitive key", () => {
    const s = openStore(":memory:");
    s.upsertSeasonRuns(key, 55, "dps", [run("A", 1000), run("B", 3000), run("C", 2000, { timed: false })], 10);
    s.upsertSeasonRuns({ region: "EU", realm: "Draenor", name: "noshiidk" }, 55, "dps", [run("B", 3000, { parsePercent: 70 })], 20);
    const rows = s.seasonRuns(key, 55);
    expect(rows.map((r) => r.reportCode)).toEqual(["B", "C", "A"]);
    expect(rows[0]).toMatchObject({ parse: 70, discoveredAt: 10, seenAt: 20, timed: true, durationMs: 1_700_000, affixes: [9, 10], failedAt: null });
    expect(rows[1]!.timed).toBe(false);
    expect(s.latestSeasonZone(key)).toBe(55);
    expect(s.latestSeasonZone({ ...key, name: "Other" })).toBeNull();
    expect(s.seasonRuns(key, 54)).toEqual([]);
    s.close();
  });

  test("a failed fetch is remembered; hasWclRun reads the raw cache only", () => {
    const s = openStore(":memory:");
    s.upsertSeasonRuns(key, 55, "dps", [run("A", 1000)], 10);
    s.markSeasonRunFailed(key, "A", 1, 99);
    expect(s.seasonRuns(key, 55)[0]!.failedAt).toBe(99);
    expect(s.hasWclRun("A", 1)).toBe(false);
    s.putWclRun("A", 1, { code: "A" });
    expect(s.hasWclRun("A", 1)).toBe(true);
    s.close();
  });
});
```

- [ ] **Step 2: Run, expect failures** — `bun test test/mplus.test.ts test/signals/store.test.ts` → FAIL.

- [ ] **Step 3: `src/mplus.ts`**

In `MPlusRun`, after `score: number;`:

```ts
  /** From the rankings: `medal: "none"` is a depleted key (issue #24 § 3); absent on runs saved before 2026-10. */
  timed?: boolean;
  /** The fight's duration in ms, from the rankings. */
  durationMs?: number;
```

In `interface EncounterRank`, after `score: number;`: `duration: number;` and `medal: string;`.

In `fetchMplusData`'s `runs.push({ … })`, after `score: r.score,`:

```ts
        timed: r.medal !== "none",
        durationMs: r.duration,
```

- [ ] **Step 4: `src/signals/store.ts`**

Imports: `import type { MPlusRun } from "../mplus.ts";` and `import type { Metric } from "../roles.ts";`.

Append to `SCHEMA` (inside the template string, after the last table):

```sql
-- Every ranked run WCL's rankings returned for a character (self-review spec, decision 2). Filled by every
-- lookup at 0 extra points; a sync fetches the raw reports of the runs not yet in wcl_run_raw.
CREATE TABLE IF NOT EXISTS character_runs (
  region         TEXT    NOT NULL,
  realm          TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  report_code    TEXT    NOT NULL,
  fight_id       INTEGER NOT NULL,
  zone_id        INTEGER NOT NULL,
  encounter_id   INTEGER NOT NULL,
  encounter_name TEXT    NOT NULL,
  start_time     INTEGER NOT NULL,
  duration_ms    INTEGER,
  key_level      INTEGER NOT NULL,
  timed          INTEGER,
  metric         TEXT    NOT NULL,
  parse          REAL    NOT NULL,
  amount         REAL    NOT NULL,
  spec           TEXT    NOT NULL,
  score          REAL    NOT NULL,
  affixes        TEXT    NOT NULL,
  discovered_at  INTEGER NOT NULL,
  seen_at        INTEGER NOT NULL,
  failed_at      INTEGER,
  PRIMARY KEY (region, realm, name, report_code, fight_id)
);
CREATE INDEX IF NOT EXISTS character_runs_zone ON character_runs (region, realm, name, zone_id, start_time);
```

Types, after `RIO_TTL_MS`:

```ts
/** A character as the season store keys it (lower-cased on every read and write, like `rio_profile`). */
export interface CharacterKey { region: string; realm: string; name: string }

export interface SeasonRow {
  reportCode: string;
  fightID: number;
  zoneID: number;
  encounterID: number;
  encounterName: string;
  startTime: number;
  durationMs: number | null;
  keyLevel: number;
  timed: boolean | null;
  /** The metric `parse` and `amount` were ranked on (the last lookup's). */
  metric: Metric;
  parse: number;
  amount: number;
  spec: string;
  score: number;
  affixes: number[];
  discoveredAt: number;
  /** Last time a rankings fetch listed the run. */
  seenAt: number;
  /** Last time a sync asked WCL for the report and got none. */
  failedAt: number | null;
}
```

In `interface Store`, before `close(): void;`:

```ts
  /** Records every run of a rankings fetch for the character (0 pts: already fetched). */
  upsertSeasonRuns(key: CharacterKey, zoneID: number, metric: Metric, runs: MPlusRun[], now?: number): void;
  /** The character's runs in that zone (season), newest first. */
  seasonRuns(key: CharacterKey, zoneID: number): SeasonRow[];
  /** The zone of the character's newest stored run; null when none is stored. */
  latestSeasonZone(key: CharacterKey): number | null;
  markSeasonRunFailed(key: CharacterKey, code: string, fightID: number, now?: number): void;
  /** Whether the run's raw report is cached at the current QUERY_VERSION, without parsing it. */
  hasWclRun(code: string, fightID: number): boolean;
```

Inside `openStore`, with the other prepared statements:

```ts
  const ck = (k: CharacterKey) => [k.region.toLowerCase(), k.realm.toLowerCase(), k.name.toLowerCase()] as const;
  const upsertSeason = db.query(
    "INSERT INTO character_runs (region, realm, name, report_code, fight_id, zone_id, encounter_id, encounter_name, start_time, duration_ms, " +
    "key_level, timed, metric, parse, amount, spec, score, affixes, discovered_at, seen_at, failed_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) " +
    "ON CONFLICT (region, realm, name, report_code, fight_id) DO UPDATE SET zone_id = excluded.zone_id, " +
    "encounter_id = excluded.encounter_id, encounter_name = excluded.encounter_name, start_time = excluded.start_time, " +
    "duration_ms = excluded.duration_ms, key_level = excluded.key_level, timed = excluded.timed, metric = excluded.metric, " +
    "parse = excluded.parse, amount = excluded.amount, spec = excluded.spec, score = excluded.score, affixes = excluded.affixes, " +
    "seen_at = excluded.seen_at",
  );
  const upsertSeasonMany = db.transaction((k: readonly [string, string, string], zoneID: number, metric: Metric, runs: MPlusRun[], now: number) => {
    for (const r of runs) {
      upsertSeason.run(k[0], k[1], k[2], r.reportCode, r.fightID, zoneID, r.encounterID, r.encounterName, r.startTime, r.durationMs ?? null,
        r.keyLevel, r.timed === undefined ? null : r.timed ? 1 : 0, metric, r.parsePercent, r.amount, r.spec, r.score, JSON.stringify(r.affixes), now, now);
    }
  });
  interface SeasonDbRow {
    report_code: string; fight_id: number; zone_id: number; encounter_id: number; encounter_name: string; start_time: number;
    duration_ms: number | null; key_level: number; timed: number | null; metric: Metric; parse: number; amount: number; spec: string;
    score: number; affixes: string; discovered_at: number; seen_at: number; failed_at: number | null;
  }
  const seasonQ = db.query<SeasonDbRow, [string, string, string, number]>(
    "SELECT * FROM character_runs WHERE region = ? AND realm = ? AND name = ? AND zone_id = ? ORDER BY start_time DESC",
  );
  const latestZoneQ = db.query<{ zone_id: number }, [string, string, string]>(
    "SELECT zone_id FROM character_runs WHERE region = ? AND realm = ? AND name = ? ORDER BY start_time DESC LIMIT 1",
  );
  const failSeason = db.query("UPDATE character_runs SET failed_at = ? WHERE region = ? AND realm = ? AND name = ? AND report_code = ? AND fight_id = ?");
  const hasRunQ = db.query<{ one: number }, [string, number, number]>(
    "SELECT 1 AS one FROM wcl_run_raw WHERE report_code = ? AND fight_id = ? AND query_version = ?",
  );
  const toSeasonRow = (r: SeasonDbRow): SeasonRow => ({
    reportCode: r.report_code, fightID: r.fight_id, zoneID: r.zone_id, encounterID: r.encounter_id, encounterName: r.encounter_name,
    startTime: r.start_time, durationMs: r.duration_ms, keyLevel: r.key_level, timed: r.timed === null ? null : r.timed === 1,
    metric: r.metric, parse: r.parse, amount: r.amount, spec: r.spec, score: r.score, affixes: JSON.parse(r.affixes) as number[],
    discoveredAt: r.discovered_at, seenAt: r.seen_at, failedAt: r.failed_at,
  });
```

In the returned object, before `close()`:

```ts
    upsertSeasonRuns(key, zoneID, metric, runs, now = Date.now()) {
      upsertSeasonMany(ck(key), zoneID, metric, runs, now);
    },
    seasonRuns(key, zoneID) {
      return seasonQ.all(...ck(key), zoneID).map(toSeasonRow);
    },
    latestSeasonZone(key) {
      return latestZoneQ.get(...ck(key))?.zone_id ?? null;
    },
    markSeasonRunFailed(key, code, fightID, now = Date.now()) {
      failSeason.run(now, ...ck(key), code, fightID);
    },
    hasWclRun(code, fightID) {
      return hasRunQ.get(code, fightID, QUERY_VERSION) !== null;
    },
```

Add a row to the table in `docs/agents/architecture.md` "SQLite cache" in Task 21, not here.

- [ ] **Step 5: Run** — `bun test` and typechecks → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mplus.ts src/signals/store.ts test/mplus.test.ts test/signals/store.test.ts
git commit -m "feat(signals): season store of every ranked run, with result and duration"
```

---

### Task 5: Every lookup records the season (0 extra points)

**Files:**
- Modify: `src/lookup.ts`
- Test: `test/lookup.test.ts`

- [ ] **Step 1: Failing test**

Append to `test/lookup.test.ts`:

```ts
describe("performLookup — season store", () => {
  test("records every ranked run, before the spec filter, without another WCL call", async () => {
    const x = await fixture();
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus });
    expect(o.ok).toBe(true);
    const key = { region: "eu", realm: "hyjal", name: x.name };
    expect(x.store.seasonRuns(key, 1).map((r) => r.reportCode).sort()).toEqual([x.data.runs[0]!.reportCode, "OTHERCODE"].sort());
    expect(x.fetches()).toBe(1);
    await performLookup({ ...opts(x.name), refresh: true }, { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus });
    expect(x.store.seasonRuns(key, 1)).toHaveLength(2);
    x.store.close();
  });
});
```

- [ ] **Step 2: Run, expect failure** — `bun test test/lookup.test.ts` → FAIL (0 rows).

- [ ] **Step 3: Implement**

In `src/lookup.ts`, right after `let data = fetched;`:

```ts
  // The rankings list every ranked run of the season (issue #24 § 1): keep them for the season views, 0 extra pts.
  store.upsertSeasonRuns({ region: opts.region, realm: realmToSlug(opts.realm), name: data.character.name }, data.zoneID, data.metric, data.runs);
```

- [ ] **Step 4: Run** — `bun test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lookup.ts test/lookup.test.ts
git commit -m "feat(lookup): record the season's ranked runs on every lookup"
```

---
### Task 6: Season sync, one batch per request

**Files:**
- Modify: `src/signals/enrich.ts` (export the report fetch)
- Create: `src/self/sync.ts`
- Test: `test/self/sync.test.ts`

**Interfaces:**
- Consumes: `Store.seasonRuns`, `Store.hasWclRun`, `Store.markSeasonRunFailed`, `Store.upsertSeasonRuns`, `Store.latestSeasonZone`.
- Produces: `SYNC_BATCH`, `SYNC_RETRY_MS`, `SyncState`, `rowToRun(row)`, `syncState(store, rows, now)`, `pendingRows(store, rows, now)`, `syncBatch(store, key, rows, deps)`, `runSeasonSync(req, deps)`.

- [ ] **Step 1: Failing tests**

`test/self/sync.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { MPlusData, MPlusRun } from "../../src/mplus.ts";
import { SYNC_RETRY_MS, pendingRows, runSeasonSync, syncBatch, syncState } from "../../src/self/sync.ts";
import { openStore } from "../../src/signals/store.ts";
import { PING_QUERY } from "../../src/wcl/queries.ts";

const key = { region: "eu" as const, realm: "draenor", name: "Noshiidk" };
const NOW = Date.UTC(2026, 9, 9, 12);
const run = (i: number): MPlusRun => ({
  encounterID: 12923, encounterName: "Voidscar Arena", keyLevel: 18, amount: 1000, parsePercent: 50, spec: "Frost",
  affixes: [], reportCode: `R${i}`, fightID: 1, startTime: i * 1000, score: 400, timed: true, durationMs: 1_700_000,
});

/** PING answers from `spent` in order (the last one repeats); report queries answer `{ code }`, null or throw. */
function fakeGql(o: { spent?: number[]; missing?: string[]; throwOn?: string[] } = {}) {
  const calls: string[] = [];
  let ping = 0;
  const spent = o.spent ?? [0];
  const gql = async <T,>(q: string, vars?: Record<string, unknown>): Promise<T> => {
    if (q === PING_QUERY) {
      const s = spent[Math.min(ping++, spent.length - 1)]!;
      return { rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: s, pointsResetIn: 1000 } } as T;
    }
    const code = String(vars?.code);
    calls.push(code);
    if (o.throwOn?.includes(code)) throw new Error("boom");
    return { reportData: { report: o.missing?.includes(code) ? null : { code } } } as T;
  };
  return { gql, calls };
}

function seeded(n: number) {
  const store = openStore(":memory:");
  store.upsertSeasonRuns(key, 55, "dps", Array.from({ length: n }, (_, i) => run(i + 1)), NOW);
  return store;
}

describe("syncState / pendingRows", () => {
  test("counts and the estimate (rankings + 10 pts per pending run)", () => {
    const store = seeded(12);
    store.putWclRun("R12", 1, { code: "R12" });
    store.putWclRun("R1", 1, { code: "R1" });
    expect(syncState(store, store.seasonRuns(key, 55), NOW)).toEqual({ runs: 12, analysed: 2, pending: 10, failed: 0, estimate: 120 });
  });
});

describe("syncBatch", () => {
  test("fetches the 10 newest uncached runs, then the rest", async () => {
    const store = seeded(12);
    const f = fakeGql();
    expect(await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).toEqual({ ok: true, fetched: 10, failed: 0 });
    expect(f.calls).toEqual(["R12", "R11", "R10", "R9", "R8", "R7", "R6", "R5", "R4", "R3"]);
    expect(await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).toEqual({ ok: true, fetched: 2, failed: 0 });
    expect(await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).toEqual({ ok: true, fetched: 0, failed: 0 });
    expect(f.calls).toHaveLength(12);
  });

  test("a report WCL does not return is skipped for 24 h, then retried", async () => {
    const store = seeded(3);
    await syncBatch(store, key, store.seasonRuns(key, 55), { gql: fakeGql({ missing: ["R3"] }).gql, now: NOW });
    const rows = store.seasonRuns(key, 55);
    expect(syncState(store, rows, NOW)).toMatchObject({ analysed: 2, pending: 0, failed: 1 });
    expect(pendingRows(store, rows, NOW + 3_600_000)).toEqual([]);
    expect(pendingRows(store, rows, NOW + SYNC_RETRY_MS).map((r) => r.reportCode)).toEqual(["R3"]);
  });

  test("refuses to start under 20 + 10 pts per run left, spending nothing", async () => {
    const store = seeded(10);
    const f = fakeGql({ spent: [3600 - 119] });
    const out = await syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW });
    expect(out.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("a batch where every fetch throws rethrows and marks nothing", async () => {
    const store = seeded(2);
    const f = fakeGql({ throwOn: ["R1", "R2"] });
    await expect(syncBatch(store, key, store.seasonRuns(key, 55), { gql: f.gql, now: NOW })).rejects.toThrow("boom");
    expect(syncState(store, store.seasonRuns(key, 55), NOW)).toMatchObject({ pending: 2, failed: 0 });
  });
});

describe("runSeasonSync", () => {
  test("refresh re-reads the rankings, then one batch; points measured by PING", async () => {
    const store = openStore(":memory:");
    let fetches = 0;
    const data = { zoneID: 55, metric: "dps", runs: [run(1), run(2)] } as unknown as MPlusData;
    const fetchMplus = async () => { fetches++; return data; };
    const f = fakeGql({ spent: [100, 121, 140] });
    const out = await runSeasonSync({ name: "Noshiidk", realm: "Draenor", region: "eu", refresh: true }, { store, gql: f.gql, fetchMplus, now: NOW });
    expect(out).toEqual({ ok: true, fetched: 2, failed: 0, state: { runs: 2, analysed: 2, pending: 0, failed: 0, estimate: 0 }, pointsSpent: 40 });
    expect(fetches).toBe(1);
    // Without refresh, a stored season is not fetched again.
    await runSeasonSync({ name: "Noshiidk", realm: "Draenor", region: "eu" }, { store, gql: f.gql, fetchMplus, now: NOW });
    expect(fetches).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `bun test test/self/sync.test.ts` → FAIL (module missing).

- [ ] **Step 3: Export the report fetch**

In `src/signals/enrich.ts`, rename `async function fetchRaw(` to:

```ts
/** One run's raw report (~10 pts): the summary tables, plus the avoidable table when the dungeon has a list. */
export async function fetchRunReport(
```

(same parameters and body) and its one call inside `enrichRuns` to `raw = await fetchRunReport(first, gql);`.

- [ ] **Step 4: `src/self/sync.ts`**

```ts
// Season sync (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 3): one batch of raw run
// reports per request, newest first, so a member's own WCL secret only lives for one request and an interrupted sync
// resumes from the cache. The caller decides which WCL client runs it (src/server/season.ts).
import { BudgetLowError, MIN_BUDGET_POINTS } from "../deepdive/wcl.ts";
import { fetchMplusData, type MPlusRun } from "../mplus.ts";
import { fetchRunReport, type GqlFn } from "../signals/enrich.ts";
import type { CharacterKey, SeasonRow, Store } from "../signals/store.ts";
import { realmToSlug } from "../util.ts";
import { gql as realGql } from "../wcl/client.ts";
import { ESTIMATE_RANKINGS, ESTIMATE_RUN } from "../wcl/meter.ts";
import { PING_QUERY } from "../wcl/queries.ts";
import type { RateLimitData } from "../wcl/types.ts";
import type { Region } from "../wow/regions.ts";

export const SYNC_BATCH = 10;
export const SYNC_RETRY_MS = 24 * 60 * 60_000;

export interface SyncState {
  runs: number;
  /** Raw report cached: the run is analysed on read. */
  analysed: number;
  /** Still to fetch. */
  pending: number;
  /** WCL returned no report in the last 24 h (private or deleted log). */
  failed: number;
  /** Points a full sync would cost now: the rankings plus `ESTIMATE_RUN` per pending run (0 when nothing is pending). */
  estimate: number;
}

const recentlyFailed = (r: SeasonRow, now: number): boolean => r.failedAt !== null && now - r.failedAt < SYNC_RETRY_MS;

export const rowToRun = (r: SeasonRow): MPlusRun => ({
  encounterID: r.encounterID, encounterName: r.encounterName, keyLevel: r.keyLevel, amount: r.amount, parsePercent: r.parse,
  spec: r.spec, affixes: r.affixes, reportCode: r.reportCode, fightID: r.fightID, startTime: r.startTime, score: r.score,
  ...(r.timed === null ? {} : { timed: r.timed }),
  ...(r.durationMs === null ? {} : { durationMs: r.durationMs }),
});

export function syncState(store: Store, rows: SeasonRow[], now: number): SyncState {
  let analysed = 0;
  let failed = 0;
  for (const r of rows) {
    if (store.hasWclRun(r.reportCode, r.fightID)) analysed++;
    else if (recentlyFailed(r, now)) failed++;
  }
  const pending = rows.length - analysed - failed;
  return { runs: rows.length, analysed, pending, failed, estimate: pending > 0 ? ESTIMATE_RANKINGS + pending * ESTIMATE_RUN : 0 };
}

/** The runs a sync still has to fetch, in the rows' order (newest first from `Store.seasonRuns`). */
export const pendingRows = (store: Store, rows: SeasonRow[], now: number): SeasonRow[] =>
  rows.filter((r) => !store.hasWclRun(r.reportCode, r.fightID) && !recentlyFailed(r, now));

export type SyncBatchOutcome = { ok: true; fetched: number; failed: number } | { ok: false; status: 402; error: string };

/**
 * Fetches up to `SYNC_BATCH` pending reports. Refuses before spending when the client has less than
 * `MIN_BUDGET_POINTS` + `ESTIMATE_RUN` per run left. A report WCL does not return is marked failed (retried after
 * `SYNC_RETRY_MS`); a thrown fetch is not marked, and a batch where every fetch threw rethrows the first error.
 */
export async function syncBatch(store: Store, key: CharacterKey, rows: SeasonRow[], deps: { gql?: GqlFn; now?: number } = {}): Promise<SyncBatchOutcome> {
  const gql = deps.gql ?? realGql;
  const now = deps.now ?? Date.now();
  const batch = pendingRows(store, rows, now).slice(0, SYNC_BATCH);
  if (batch.length === 0) return { ok: true, fetched: 0, failed: 0 };
  const ping = await gql<RateLimitData>(PING_QUERY);
  const left = ping.rateLimitData.limitPerHour - ping.rateLimitData.pointsSpentThisHour;
  if (left < MIN_BUDGET_POINTS + batch.length * ESTIMATE_RUN) return { ok: false, status: 402, error: new BudgetLowError(left).message };
  const results = await Promise.allSettled(batch.map((r) => fetchRunReport(rowToRun(r), gql)));
  let fetched = 0;
  let failed = 0;
  let firstError: unknown = null;
  results.forEach((res, i) => {
    const r = batch[i]!;
    if (res.status === "rejected") {
      firstError ??= res.reason;
      return;
    }
    if (res.value) {
      store.putWclRun(r.reportCode, r.fightID, res.value);
      fetched++;
    } else {
      store.markSeasonRunFailed(key, r.reportCode, r.fightID, now);
      failed++;
    }
  });
  if (fetched === 0 && failed === 0 && firstError !== null) throw firstError;
  return { ok: true, fetched, failed };
}

export interface SeasonSyncRequest { name: string; realm: string; region: Region; refresh?: boolean }
export interface SeasonSyncDeps { store: Store; gql?: GqlFn; fetchMplus?: typeof fetchMplusData; now?: number }
export type SeasonSyncOutcome =
  | { ok: true; fetched: number; failed: number; state: SyncState; pointsSpent: number }
  | { ok: false; status: 402; error: string };

/**
 * One sync request: the rankings when asked (`refresh`, the first batch) or when nothing is stored yet, then one
 * batch. `pointsSpent` is the client's counter difference between two PINGs (0 pts each). Throws what
 * `fetchMplusData` and `syncBatch` throw (`CharacterNotFoundError`, `WclError`): the route maps them.
 */
export async function runSeasonSync(req: SeasonSyncRequest, deps: SeasonSyncDeps): Promise<SeasonSyncOutcome> {
  const gql = deps.gql ?? realGql;
  const now = deps.now ?? Date.now();
  const key: CharacterKey = { region: req.region, realm: realmToSlug(req.realm), name: req.name };
  const spent = async (): Promise<number> => (await gql<RateLimitData>(PING_QUERY)).rateLimitData.pointsSpentThisHour;
  const before = await spent();
  let zoneID = deps.store.latestSeasonZone(key);
  if (req.refresh || zoneID === null) {
    const data = await (deps.fetchMplus ?? fetchMplusData)(req.name, req.realm, { region: req.region });
    deps.store.upsertSeasonRuns(key, data.zoneID, data.metric, data.runs, now);
    zoneID = data.zoneID;
  }
  const out = await syncBatch(deps.store, key, deps.store.seasonRuns(key, zoneID), { gql, now });
  if (!out.ok) return out;
  const after = await spent();
  return {
    ok: true,
    fetched: out.fetched,
    failed: out.failed,
    state: syncState(deps.store, deps.store.seasonRuns(key, zoneID), now),
    pointsSpent: Math.max(0, Math.round((after - before) * 10) / 10),
  };
}
```

(`src/wcl/types.ts` exports `RateLimitData`; `src/deepdive/wcl.ts` exports `MIN_BUDGET_POINTS` and `BudgetLowError`; `src/util.ts` exports `realmToSlug`.)

- [ ] **Step 5: Run** — `bun test` and typechecks → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/signals/enrich.ts src/self/sync.ts test/self/sync.test.ts
git commit -m "feat(self): season sync in batches of 10, budget-guarded, resumable"
```

---

### Task 7: The season view (0 pts)

**Files:**
- Create: `src/self/season.ts`
- Test: `test/self/season.test.ts`

**Interfaces:**
- Consumes: `evaluate` (with `pillars`), `parseRunSignals` (with Task 2's details), `weekOf`, `rowToRun`, `SyncState`.
- Produces: `SeasonView`, `SeasonRunView`, `WindowView`, `PillarTrend`, `WorkOnRow`, `DungeonRow`, `DungeonDetails`, `PillarRecord`, `SeasonInput`; `seasonView(input, cfg)`, `payloadOf(...)`, `trendOf(recent, before)`, `changeOf(now, before)`, `dungeonDetails(signals)`; the constants `RECENT_WEEKS = 4`, `PAST_WEEKS = 4`, `TREND_RECENT_WEEKS = 2`, `TREND_BEFORE_WEEKS = 4`, `MIN_WINDOW_RUNS = 3`, `SAME_BAND = 3`, `WEEKLY_BARS = 8`, `WORK_ON_MAX = 3`.

- [ ] **Step 1: Failing tests**

`test/self/season.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import {
  MIN_WINDOW_RUNS, RECENT_WEEKS, SAME_BAND, TREND_BEFORE_WEEKS, TREND_RECENT_WEEKS, WEEKLY_BARS, WORK_ON_MAX,
  changeOf, seasonView, trendOf,
} from "../../src/self/season.ts";
import type { SeasonRow } from "../../src/signals/store.ts";
import { loadWclFixture } from "../fixtures.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const NOW = Date.UTC(2026, 9, 9, 12); // EU game week 0 opened 2026-10-07 04:00 UTC
const DAY = 86_400_000;

const row = (code: string, startTime: number): SeasonRow => ({
  reportCode: code, fightID: 16, zoneID: 55, encounterID: 12923, encounterName: "Voidscar Arena", startTime, durationMs: 1_796_309,
  keyLevel: 21, timed: true, metric: "hps", parse: 60, amount: 227_611, spec: "Holy", score: 500, affixes: [9, 10, 147],
  discoveredAt: NOW, seenAt: NOW, failedAt: null,
});

async function input() {
  const f = await loadWclFixture("s2-healer");
  // A and B in week 0, C and D in week −1, E (newest) not fetched yet.
  const rows = [row("E", NOW - 1000), row("A", NOW - DAY), row("B", NOW - 2 * DAY), row("C", NOW - 4 * DAY), row("D", NOW - 6 * DAY)];
  return {
    character: { name: "Muleyoxo", realm: "silvermoon", region: "eu" as const },
    zoneID: 55, targetLevel: 21, now: NOW, rows,
    report: (code: string) => (code === "E" ? null : f.report),
    analysis: () => null,
    state: { runs: 5, analysed: 4, pending: 1, failed: 0, estimate: 30 },
  };
}

describe("phase-1 numbers (spec, section Numbers)", () => {
  test("windows, floors and bands", () => {
    expect([RECENT_WEEKS, TREND_RECENT_WEEKS, TREND_BEFORE_WEEKS, MIN_WINDOW_RUNS, SAME_BAND, WEEKLY_BARS, WORK_ON_MAX]).toEqual([4, 2, 4, 3, 3, 8, 3]);
  });
  test("trendOf: 3 runs a side, ±3 reads same", () => {
    expect(trendOf([60, 60], [50, 50, 50])).toEqual({ delta: null, direction: null });
    expect(trendOf([53, 53, 53], [50, 50, 50])).toEqual({ delta: 3, direction: "same" });
    expect(trendOf([54, 54, 54], [50, 50, 50])).toEqual({ delta: 4, direction: "up" });
    expect(trendOf([40, 40, 40], [50, 50, 50])).toEqual({ delta: -10, direction: "down" });
  });
  test("changeOf: more than 3 curve points", () => {
    expect(changeOf(54, 50)).toBe("better");
    expect(changeOf(53, 50)).toBe("same");
    expect(changeOf(46, 50)).toBe("worse");
  });
});

describe("seasonView", () => {
  test("runs, weeks, analysed state, per-run pillars", async () => {
    const v = seasonView(await input(), cfg);
    expect(v.currentWeek).toBe(0);
    expect(v.runs.map((r) => [r.reportCode, r.week, r.analysed])).toEqual([["E", 0, false], ["A", 0, true], ["B", 0, true], ["C", -1, true], ["D", -1, true]]);
    expect(v.runs[0]!.signals).toBeNull();
    expect(v.runs[0]!.pillars).toBeNull();
    expect(Object.keys(v.runs[1]!.pillars!)).toEqual(["damage", "survival", "avoidable", "interrupts", "control"]);
    expect(v.runs[1]!.signals!.deaths.events[0]!.killingHits![0]!.ability).toBe("Unstable Singularity");
  });

  test("the 4-week window and the season need 3 analysed runs; no past yet", async () => {
    const v = seasonView(await input(), cfg);
    expect(v.recent!.runs).toBe(4);
    expect(v.season!.runs).toBe(4);
    expect(v.recent!.pillars.map((p) => p.key)).toEqual(["damage", "survival", "avoidable", "interrupts", "control"]);
    for (const w of v.workOn) expect(w.past).toBeNull();
    expect(v.workOn.length).toBeLessThanOrEqual(WORK_ON_MAX);
    const two = await input();
    two.rows = two.rows.slice(0, 3); // E (unfetched), A, B: two analysed runs
    expect(seasonView(two, cfg).recent).toBeNull();
  });

  test("trends: no arrow without 3 runs before; 8 weekly bars, oldest first", async () => {
    const v = seasonView(await input(), cfg);
    const t = v.trends.find((x) => x.key === "survival")!;
    expect(t).toMatchObject({ delta: null, direction: null, recentRuns: 4 });
    expect(t.weekly).toHaveLength(8);
    expect(t.weekly.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(t.weekly[6]).toBe(t.weekly[7]);
  });

  test("dungeon row and its details summed over the analysed runs", async () => {
    const v = seasonView(await input(), cfg);
    expect(v.dungeons).toHaveLength(1);
    const d = v.dungeons[0]!;
    expect(d).toMatchObject({ encounterID: 12923, name: "Voidscar Arena", runs: 5, analysed: 4, best: { level: 21, timed: true } });
    expect(d.details.avoidable).toEqual([{ id: 1264188, name: "Unstable Singularity", total: 4 * 10_724_909 }]);
    expect(d.details.avoidableOther).toBe(0);
    expect(d.details.avoidableTotal).toBe(4 * 10_724_909);
    expect(d.details.killers).toEqual([{ ability: "Unstable Singularity", deaths: 4 }]);
    expect(d.details.casts.slice(0, 2)).toEqual([
      { id: 1310324, name: "Mending Void", attempts: 168, completed: 100, interrupted: 68, mine: 0 },
      { id: 1228176, name: "Lava Bolt", attempts: 160, completed: 44, interrupted: 108, mine: 4 },
    ]);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `bun test test/self/season.test.ts` → FAIL (module missing).

- [ ] **Step 3: `src/self/season.ts`**

```ts
// The season views of the self-review (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decisions
// 4 and 5, section "Numbers"): every stored run of a character, its cached raw report re-parsed and re-scored on each
// read, 0 WCL pts. Pure: the caller hands in the rows, a raw-report reader and a deep-dive reader.
import type { RunDefensives } from "../deepdive/types.ts";
import { evaluate } from "../evaluation/evaluate.ts";
import type { EvalPayload } from "../evaluation/inputs.ts";
import { pillarOf } from "../evaluation/pillars.ts";
import { PILLAR_KEYS, type Evaluation, type EvaluationConfig, type PillarKey, type PillarScore } from "../evaluation/types.ts";
import type { MPlusRun } from "../mplus.ts";
import type { Metric } from "../roles.ts";
import { median } from "../signals/peers.ts";
import type { SeasonRow } from "../signals/store.ts";
import { signalSummary } from "../signals/summary.ts";
import type { RawRunReport, RunSignals } from "../signals/types.ts";
import { parseRunSignals } from "../signals/wcl-run.ts";
import type { Region } from "../wow/regions.ts";
import { SYNC_RETRY_MS, rowToRun, type SyncState } from "./sync.ts";
import { weekOf } from "./weeks.ts";

export const RECENT_WEEKS = 4;
export const PAST_WEEKS = 4;
export const TREND_RECENT_WEEKS = 2;
export const TREND_BEFORE_WEEKS = 4;
export const MIN_WINDOW_RUNS = 3;
export const SAME_BAND = 3;
export const WEEKLY_BARS = 8;
export const WORK_ON_MAX = 3;
const TOP_DETAILS = 5;

export type PillarRecord = Record<PillarKey, number | null>;

export interface SeasonRunView {
  key: string;
  reportCode: string;
  fightID: number;
  encounterID: number;
  encounterName: string;
  keyLevel: number;
  startTime: number;
  durationMs: number | null;
  timed: boolean | null;
  parse: number;
  amount: number;
  metric: Metric;
  spec: string;
  affixes: number[];
  score: number;
  /** Game week (src/self/weeks.ts). */
  week: number;
  /** Its raw report is cached. */
  analysed: boolean;
  /** The last sync got no report from WCL; retried after 24 h. */
  failed: boolean;
  signals: RunSignals | null;
  /** The cached deep-dive of this run, if any. */
  analysis: RunDefensives | null;
  pillars: PillarRecord | null;
}

export interface WindowView { runs: number; pillars: PillarScore[]; global: number | null }

export interface PillarTrend {
  key: PillarKey;
  /** Median per-run score of the last 2 weeks minus the 4 before, rounded; null under 3 runs on a side. */
  delta: number | null;
  direction: "up" | "down" | "same" | null;
  /** Scored runs in the last 2 weeks (what "not enough runs" shows). */
  recentRuns: number;
  /** Median per-run score of each of the last 8 weeks, oldest first; null for a week without a run. */
  weekly: (number | null)[];
}

export interface WorkOnRow {
  source: string;
  pillar: PillarKey | null;
  /** Badge points vs the average player (negative: costs). */
  impact: number;
  value: number;
  reference: number;
  /** The English evidence line, for the CLI. */
  label: string;
  /** The same sub-signal over the 4 weeks before the window; null without 3 analysed runs there. */
  past: { value: number; change: "better" | "same" | "worse" } | null;
}

export interface DungeonDetails {
  /** Top five avoidable abilities over the dungeon's analysed runs, the rest in `avoidableOther`. */
  avoidable: { id: number; name: string; total: number }[];
  avoidableOther: number;
  avoidableTotal: number;
  /** The killing blow (newest killing hit, else the death's top ability) of each of the player's deaths. */
  killers: { ability: string; deaths: number }[];
  /** Enemy spells the group kicked at least once, most completed first. */
  casts: { id: number; name: string; attempts: number; completed: number; interrupted: number; mine: number }[];
}

export interface DungeonRow {
  encounterID: number;
  name: string;
  runs: number;
  analysed: number;
  pillars: PillarRecord;
  /** The badge score of the dungeon's analysed runs. */
  overall: number | null;
  best: { level: number; timed: boolean | null } | null;
  details: DungeonDetails;
}

export interface SeasonView {
  character: { name: string; realm: string; region: Region };
  zoneID: number;
  targetLevel: number;
  currentWeek: number;
  /** Last time a rankings fetch listed the character's runs. */
  checkedAt: number | null;
  state: SyncState;
  /** Newest first. */
  runs: SeasonRunView[];
  /** The last 4 game weeks; null under 3 analysed runs. */
  recent: WindowView | null;
  /** Every analysed run of the season; null under 3. */
  season: WindowView | null;
  trends: PillarTrend[];
  /** The window's costliest sub-signals vs the average player (at most 3); [] without a window. */
  workOn: WorkOnRow[];
  /** Worst overall first; a dungeon without an analysed run last. */
  dungeons: DungeonRow[];
}

export interface SeasonInput {
  character: { name: string; realm: string; region: Region };
  zoneID: number;
  targetLevel: number;
  now: number;
  /** Newest first (`Store.seasonRuns`). */
  rows: SeasonRow[];
  report: (code: string, fightID: number) => RawRunReport | null;
  analysis: (code: string, fightID: number) => RunDefensives | null;
  state: SyncState;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const record = (pillars: PillarScore[] | undefined): PillarRecord =>
  Object.fromEntries(PILLAR_KEYS.map((k) => [k, pillars?.find((p) => p.key === k)?.score ?? null])) as PillarRecord;

/** An evaluation payload over any set of runs: the lookup's engine, without Raider.IO (so no ilvl, no activity). */
export function payloadOf(runs: MPlusRun[], analyses: RunDefensives[], targetLevel: number, metric: Metric, totalDungeons: number): EvalPayload {
  const ranked = runs.filter((r) => r.parsePercent > 0).map((r) => r.parsePercent);
  return {
    metric,
    targetLevel,
    perDungeon: {
      runs,
      dungeonsCovered: new Set(runs.map((r) => r.encounterID)).size,
      totalDungeonsInSeason: totalDungeons,
      dungeonsAtOrAboveTarget: new Set(runs.filter((r) => r.keyLevel >= targetLevel).map((r) => r.encounterID)).size,
      medianLevel: median(runs.map((r) => r.keyLevel)) ?? 0,
      medianParse: median(ranked) ?? 0,
    },
    prevLevelBest: null,
    rio: null,
    summary: signalSummary(runs, null),
    deepdive: analyses,
  };
}

export function trendOf(recent: number[], before: number[]): { delta: number | null; direction: PillarTrend["direction"] } {
  if (recent.length < MIN_WINDOW_RUNS || before.length < MIN_WINDOW_RUNS) return { delta: null, direction: null };
  const delta = Math.round(median(recent)! - median(before)!);
  return { delta, direction: Math.abs(delta) <= SAME_BAND ? "same" : delta > 0 ? "up" : "down" };
}

/** Curve scores (higher is better for every sub-signal), so no per-signal direction table is needed. */
export const changeOf = (now: number, before: number): "better" | "same" | "worse" =>
  now - before > SAME_BAND ? "better" : now - before < -SAME_BAND ? "worse" : "same";

export function dungeonDetails(signals: RunSignals[]): DungeonDetails {
  const avoid = new Map<number, { id: number; name: string; total: number }>();
  const killers = new Map<string, number>();
  const casts = new Map<number, DungeonDetails["casts"][number]>();
  let other = 0;
  let total = 0;
  for (const s of signals) {
    const a = s.avoidableDamage;
    if (a) {
      total += a.total;
      other += a.other ?? 0;
      for (const x of a.abilities ?? []) {
        const cur = avoid.get(x.id) ?? { id: x.id, name: x.name, total: 0 };
        cur.total += x.total;
        avoid.set(x.id, cur);
      }
    }
    for (const d of s.deaths.events) {
      const ability = d.killingHits?.[0]?.ability ?? d.cause;
      if (ability) killers.set(ability, (killers.get(ability) ?? 0) + 1);
    }
    for (const c of s.interrupts.enemyCasts ?? []) {
      const cur = casts.get(c.id) ?? { id: c.id, name: c.name, attempts: 0, completed: 0, interrupted: 0, mine: 0 };
      cur.attempts += c.attempts;
      cur.completed += c.completed;
      cur.interrupted += c.interrupted;
      cur.mine += c.mine;
      casts.set(c.id, cur);
    }
  }
  const abilities = [...avoid.values()].sort((a, b) => b.total - a.total);
  return {
    avoidable: abilities.slice(0, TOP_DETAILS),
    avoidableOther: other + abilities.slice(TOP_DETAILS).reduce((s, a) => s + a.total, 0),
    avoidableTotal: total,
    killers: [...killers].map(([ability, deaths]) => ({ ability, deaths }))
      .sort((a, b) => b.deaths - a.deaths || a.ability.localeCompare(b.ability)).slice(0, TOP_DETAILS),
    casts: [...casts.values()].sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name)).slice(0, TOP_DETAILS),
  };
}

interface Item { run: MPlusRun; view: SeasonRunView }

export function seasonView(input: SeasonInput, cfg: EvaluationConfig): SeasonView {
  const { character, now } = input;
  const currentWeek = weekOf(character.region, now);
  const metric: Metric = input.rows[0]?.metric ?? "dps";
  const totalDungeons = new Set(input.rows.map((r) => r.encounterID)).size;
  const evalOf = (list: Item[], targetLevel: number): Evaluation =>
    evaluate(payloadOf(list.map((i) => i.run), list.flatMap((i) => (i.view.analysis ? [i.view.analysis] : [])), targetLevel, metric, totalDungeons), cfg);

  const items = input.rows.map((row): Item => {
    const raw = input.report(row.reportCode, row.fightID);
    const run = rowToRun(row);
    const signals = raw ? parseRunSignals(raw, character.name, { keyLevel: row.keyLevel, affixes: row.affixes, encounterID: row.encounterID }) : null;
    if (signals) run.signals = signals;
    const analysis = signals ? input.analysis(row.reportCode, row.fightID) : null;
    const view: SeasonRunView = {
      key: `${row.reportCode}:${row.fightID}`, reportCode: row.reportCode, fightID: row.fightID, encounterID: row.encounterID,
      encounterName: row.encounterName, keyLevel: row.keyLevel, startTime: row.startTime, durationMs: row.durationMs, timed: row.timed,
      parse: row.parse, amount: row.amount, metric: row.metric, spec: row.spec, affixes: row.affixes, score: row.score,
      week: weekOf(character.region, row.startTime),
      analysed: raw !== null,
      failed: raw === null && row.failedAt !== null && now - row.failedAt < SYNC_RETRY_MS,
      signals, analysis, pillars: null,
    };
    const item = { run, view };
    // A single run, at its own key level: the per-run score the trends and weekly bars are made of.
    if (signals) view.pillars = record(evalOf([item], row.keyLevel).pillars);
    return item;
  });

  const scored = items.filter((i) => i.view.signals !== null);
  const inWeeks = (from: number, to: number): Item[] => scored.filter((i) => i.view.week >= from && i.view.week <= to);
  const windowOf = (list: Item[]): { view: WindowView; ev: Evaluation } | null => {
    if (list.length < MIN_WINDOW_RUNS) return null;
    const ev = evalOf(list, input.targetLevel);
    return { ev, view: { runs: list.length, pillars: ev.pillars ?? [], global: ev.global } };
  };
  const recent = windowOf(inWeeks(currentWeek - RECENT_WEEKS + 1, currentWeek));
  const past = windowOf(inWeeks(currentWeek - RECENT_WEEKS - PAST_WEEKS + 1, currentWeek - RECENT_WEEKS));
  const season = windowOf(scored);

  const trends: PillarTrend[] = PILLAR_KEYS.map((key) => {
    const scores = (from: number, to: number): number[] => inWeeks(from, to).map((i) => i.view.pillars![key]).filter(isNum);
    const r = scores(currentWeek - TREND_RECENT_WEEKS + 1, currentWeek);
    const b = scores(currentWeek - TREND_RECENT_WEEKS - TREND_BEFORE_WEEKS + 1, currentWeek - TREND_RECENT_WEEKS);
    const weekly = Array.from({ length: WEEKLY_BARS }, (_, n) => {
      const w = currentWeek - WEEKLY_BARS + 1 + n;
      const m = median(scores(w, w));
      return m === null ? null : Math.round(m);
    });
    return { key, ...trendOf(r, b), recentRuns: r.length, weekly };
  });

  const evidenceOf = (ev: Evaluation | null, source: string) => ev?.axes.flatMap((a) => a.evidence).find((e) => e.source === source) ?? null;
  const workOn: WorkOnRow[] = !recent ? [] : (recent.ev.drivers ?? []).filter((d) => d.impact < 0).slice(0, WORK_ON_MAX).map((d) => {
    const nowE = evidenceOf(recent.ev, d.source);
    const pastE = evidenceOf(past?.ev ?? null, d.source);
    return {
      source: d.source, pillar: pillarOf(d.source), impact: d.impact, value: d.value, reference: d.reference, label: d.label,
      past: nowE && pastE && isNum(nowE.score) && isNum(pastE.score) ? { value: pastE.value, change: changeOf(nowE.score, pastE.score) } : null,
    };
  });

  const byEncounter = new Map<number, Item[]>();
  for (const i of items) byEncounter.set(i.view.encounterID, [...(byEncounter.get(i.view.encounterID) ?? []), i]);
  const dungeons: DungeonRow[] = [...byEncounter.values()].map((list) => {
    const withSig = list.filter((i) => i.view.signals !== null);
    const ev = withSig.length > 0 ? evalOf(withSig, input.targetLevel) : null;
    let best: Item | null = null;
    for (const i of list) {
      if (!best || i.view.keyLevel > best.view.keyLevel || (i.view.keyLevel === best.view.keyLevel && i.view.timed === true && best.view.timed !== true)) best = i;
    }
    return {
      encounterID: list[0]!.view.encounterID,
      name: list[0]!.view.encounterName,
      runs: list.length,
      analysed: withSig.length,
      pillars: record(ev?.pillars),
      overall: ev?.global ?? null,
      best: best ? { level: best.view.keyLevel, timed: best.view.timed } : null,
      details: dungeonDetails(withSig.map((i) => i.view.signals!)),
    };
  }).sort((a, b) => (a.overall ?? Number.POSITIVE_INFINITY) - (b.overall ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name));

  return {
    character, zoneID: input.zoneID, targetLevel: input.targetLevel, currentWeek,
    checkedAt: input.rows.length > 0 ? Math.max(...input.rows.map((r) => r.seenAt)) : null,
    state: input.state,
    runs: items.map((i) => i.view),
    recent: recent?.view ?? null,
    season: season?.view ?? null,
    trends, workOn, dungeons,
  };
}
```

- [ ] **Step 4: Run** — `bun test` and typechecks → PASS. Then a timing check on real data, 0 pts, against the scratch cache of issue #24's 26 runs or any local `bmpl.db` with a synced character: `seasonView` for 100+ runs must answer in well under a second; if not, report the measured time to the user before going on (the fix would be a per-process memo of parsed signals, which this plan does not add).

- [ ] **Step 5: Commit**

```bash
git add src/self/season.ts test/self/season.test.ts
git commit -m "feat(self): season view with windows, trends, points to work on and dungeon details"
```

---

### Task 8: Routes — `GET /api/season`, `POST /api/season/sync`

**Files:**
- Create: `src/server/season.ts`
- Modify: `src/server/validate.ts`, `src/server/routes-shared.ts`, `src/server.ts` (`rateLimitFor`, `apiEventFor`), `src/hosted/usage-catalog.ts`
- Test: `test/server-season.test.ts`

**Interfaces:**
- Produces: `GET /api/season?name&realm&region&level` → `{ ok: true, season: SeasonView | null }`; `POST /api/season/sync { name, realm, region, refresh? }` → `{ ok: true, fetched, failed, state, pointsSpent, ownClient? }`, 403 `{ ok: false, error: "own_client_required", message }` hosted without an own client, 402 budget, 404 `not_found`, 502 WCL. Usage events `season_view` (api), `season_sync` (api), `self_tab_dungeons` and `self_tab_runs` (ui).

- [ ] **Step 1: Failing tests**

`test/server-season.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { loadWclFixture } from "./fixtures.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let local: Awaited<ReturnType<typeof runServer>>;
let hosted: Awaited<ReturnType<typeof runServer>>;
let member: ReturnType<typeof loginAs>;
const saved = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-season-"));
  mkdirSync(join(dir, "assets"));
  for (const [p, c] of [["index.html", "<!doctype html>"], ["assets/app.js", ""], ["assets/app.css", ""], ["wh-config.js", ""]]) writeFileSync(join(dir, p!), c!);
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  // Dummy credentials: nothing below may reach WCL; a regression fails at OAuth instead of spending points.
  process.env.WCL_CLIENT_ID = "bmpl-test";
  process.env.WCL_CLIENT_SECRET = "bmpl-test";
  const assets = async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") });
  local = await runServer({ port: 0, open: false, hosted: false, assets });
  hosted = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets });
  const store = await getStore();
  member = loginAs(openHosted(store._db), TEST_HOSTED_CONFIG.sessionSecret, { discordId: "300000000000000001", role: "member" });
  const f = await loadWclFixture("s2-healer");
  const key = { region: "eu", realm: "silvermoon", name: "Muleyoxo" };
  store.upsertSeasonRuns(key, 55, "hps", [{ ...f.run }, { ...f.run, reportCode: "UNFETCHED", fightID: 2, startTime: f.run.startTime + 1000 }]);
  store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
});
afterAll(() => {
  local.stop(true);
  hosted.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  if (saved.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = saved.id;
  if (saved.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = saved.secret;
  rmSync(dir, { recursive: true, force: true });
});

const l = (p: string) => `http://localhost:${local.port}${p}`;
const h = (p: string) => `http://localhost:${hosted.port}${p}`;

describe("GET /api/season", () => {
  test("the stored season, analysed from the cache", async () => {
    const r = await fetch(l("/api/season?name=Muleyoxo&realm=silvermoon&region=eu&level=21"));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.season.runs.map((x: { reportCode: string; analysed: boolean }) => [x.reportCode, x.analysed]))
      .toEqual([["UNFETCHED", false], [expect.any(String), true]]);
    expect(body.season.state).toEqual({ runs: 2, analysed: 1, pending: 1, failed: 0, estimate: 30 });
  });
  test("an unknown character has no season; bad parameters are a 400", async () => {
    expect((await (await fetch(l("/api/season?name=Nobody&realm=silvermoon&region=eu"))).json()).season).toBeNull();
    expect((await fetch(l("/api/season?name=M&realm=silvermoon&region=eu"))).status).toBe(400);
    expect((await fetch(l("/api/season?name=Muleyoxo&realm=silvermoon&region=xx"))).status).toBe(400);
  });
  test("hosted: signed-in only", async () => {
    expect((await fetch(h("/api/season?name=Muleyoxo&realm=silvermoon&region=eu"))).status).toBe(401);
    expect((await fetch(h("/api/season?name=Muleyoxo&realm=silvermoon&region=eu"), { headers: { cookie: member.cookie } })).status).toBe(200);
  });
});

describe("POST /api/season/sync", () => {
  test("hosted without an own WCL client: refused before any WCL call", async () => {
    const r = await fetch(h("/api/season/sync"), {
      method: "POST", headers: { cookie: member.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Muleyoxo", realm: "silvermoon", region: "eu" }),
    });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("own_client_required");
  });
  test("the body is validated", async () => {
    const r = await fetch(l("/api/season/sync"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Muleyoxo" }) });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failures** — `bun test test/server-season.test.ts` → FAIL (404 on the routes).

- [ ] **Step 3: Body schema**

In `src/server/validate.ts`, after `LOOKUP_BODY`:

```ts
/** POST /api/season/sync: one batch of a character's season sync (self-review spec, decision 3). */
export const SEASON_SYNC_BODY = obj({
  name: str({ min: 2, max: 32, trim: true, pattern: WOW_NAME }),
  realm: str({ min: 2, max: 32, trim: true, pattern: WOW_REALM }),
  region: oneOf(REGIONS),
  refresh: opt(bool()),
});
```

- [ ] **Step 4: `src/server/season.ts`**

```ts
// The self-review routes (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md): the season view at
// 0 pts, and the sync, which hosted runs only on the member's own WCL client (decision 3).
import { hasCredentials } from "../config.ts";
import { analyzeCached } from "../deepdive/attach.ts";
import { getEvalConfig } from "../evaluation/config.ts";
import type { RequestContext } from "../hosted/auth.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { CharacterNotFoundError, inferTargetLevel } from "../mplus.ts";
import { seasonView } from "../self/season.ts";
import { rowToRun, runSeasonSync, syncState } from "../self/sync.ts";
import { getStore } from "../signals/store.ts";
import { realmToSlug } from "../util.ts";
import { WclError } from "../wcl/client.ts";
import { isRegion } from "../wow/regions.ts";
import { failureBody, tablesOf, wclScopeFor } from "./deepdive.ts";
import { jsonResponse } from "./http.ts";
import { SEASON_SYNC_BODY, WOW_NAME, WOW_REALM, parseBody } from "./validate.ts";

const OWN_CLIENT_REQUIRED = "A season sync runs on your own Warcraft Logs client: add one in Settings.";

export async function handleSeasonGet(url: URL, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const name = url.searchParams.get("name") ?? "";
  const realm = url.searchParams.get("realm") ?? "";
  const region = url.searchParams.get("region") ?? "";
  const levelRaw = url.searchParams.get("level");
  if (!WOW_NAME.test(name) || !WOW_REALM.test(realm) || !isRegion(region)) {
    return jsonResponse({ ok: false, error: "Expected `name`, `realm` and `region`" }, 400);
  }
  const level = levelRaw === null ? null : Number(levelRaw);
  if (level !== null && !(Number.isInteger(level) && level >= 2 && level <= 50)) return jsonResponse({ ok: false, error: "Invalid `level`" }, 400);
  const store = await getStore();
  const key = { region, realm: realmToSlug(realm), name };
  const zoneID = store.latestSeasonZone(key);
  if (zoneID === null) return jsonResponse({ ok: true, season: null });
  const rows = store.seasonRuns(key, zoneID);
  const [cfg, tables] = await Promise.all([getEvalConfig(), tablesOf(ctx, runtime)]);
  const season = seasonView({
    character: { name, realm: key.realm, region },
    zoneID,
    targetLevel: level ?? inferTargetLevel(rows.map(rowToRun)) ?? rows[0]!.keyLevel,
    now: ctx.now,
    rows,
    report: (code, fightID) => store.getWclRun(code, fightID),
    analysis: (code, fightID) => analyzeCached(store, tables, { reportCode: code, fightID }, name),
    state: syncState(store, rows, ctx.now),
  }, cfg);
  return jsonResponse({ ok: true, season });
}

export async function handleSeasonSync(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const b = await parseBody(req, SEASON_SYNC_BODY);
  if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
  const body = b.value;
  if (!hasCredentials()) return jsonResponse({ ok: false, error: "No credentials configured. Visit /setup first." }, 400);
  const scope = await wclScopeFor(runtime, ctx.user);
  // Hosted, a sync never spends the shared budget (decision 3): refused before any WCL call.
  if (ctx.hosted && !scope.own) return jsonResponse({ ok: false, error: "own_client_required", message: OWN_CLIENT_REQUIRED }, 403);
  runtime?.audit.setTarget(`season ${body.name}-${body.realm}`);
  const store = await getStore();
  try {
    const out = await scope.run(() => runSeasonSync(body, { store, now: ctx.now }));
    if (!out.ok) return jsonResponse({ ok: false, error: out.error }, out.status);
    runtime?.track(ctx.user?.id ?? null, "season_sync");
    const ownClient = runtime && ctx.user ? { ownClient: await runtime.wclClients.view(ctx.user.id) } : {};
    return jsonResponse({ ok: true, fetched: out.fetched, failed: out.failed, state: out.state, pointsSpent: out.pointsSpent, ...ownClient });
  } catch (e) {
    if (e instanceof CharacterNotFoundError) {
      return jsonResponse(failureBody({ status: 404, error: e.message, notFound: { character: `${body.name}-${body.realm}`, region: body.region } }, runtime), 404);
    }
    if (e instanceof WclError) return jsonResponse(failureBody({ status: 502, error: e.message, wcl: e.publicMessage }, runtime), 502);
    throw e;
  }
}
```

- [ ] **Step 5: Wire the routes, the rate limit and the usage events**

`src/server/routes-shared.ts`: `import { handleSeasonGet, handleSeasonSync } from "./season.ts";` and, after the `/api/deepdive` route:

```ts
    route("GET", "/api/season", (_req, url, rc) => handleSeasonGet(url, rc, ctx.runtime)),
    route("POST", "/api/season/sync", (req, _url, rc) => handleSeasonSync(req, rc, ctx.runtime)),
```

`src/server.ts`, in `rateLimitFor` after the `/api/deepdive` line:

```ts
  if (req.method === "POST" && url.pathname === "/api/season/sync") return { limiter: runtime.limits.deepdive, key };
```

and in `apiEventFor`'s `switch`: `case "GET /api/season": return "season_view";`.

`src/hosted/usage-catalog.ts`, at the end of the `// Lookup` group: `season_sync: { category: "lookup", source: "api" },`; at the end of the `// Result` group:

```ts
  season_view: { category: "result", source: "api" },
  self_tab_dungeons: { category: "result", source: "ui" },
  self_tab_runs: { category: "result", source: "ui" },
```

Update the doc comment of `HostedRuntime.limits` (`src/hosted/runtime.ts`) so its list of covered routes includes `POST /api/season/sync` (deep-dive limiter).

- [ ] **Step 6: Run** — `bun test` and typechecks → PASS (`test/hosted/usage-events.test.ts` counts `USAGE_EVENTS.length`, so it follows the catalogue by itself).

- [ ] **Step 7: Commit**

```bash
git add src/server/season.ts src/server/validate.ts src/server/routes-shared.ts src/server.ts src/hosted/usage-catalog.ts src/hosted/runtime.ts test/server-season.test.ts
git commit -m "feat(server): season view and season sync routes"
```

---

### Task 9: "Me": the member's characters in the settings

**Files:**
- Create: `src/self/characters.ts`
- Modify: `src/hosted/schema.ts`, `src/hosted/db.ts`, `src/server/validate.ts`, `src/server/routes-user.ts`
- Test: `test/hosted/settings.test.ts`, `test/self/characters.test.ts`; update the four full-object assertions listed in Step 5

**Interfaces:**
- Produces: `MAX_CHARACTERS = 5`, `CharacterSource = "manual" | "bnet"`, `MyCharacter { name; realm; region; source }`, `parseCharacters(raw)`; `UserSettings.characters: MyCharacter[]`; `SETTINGS_BODY.characters`.

- [ ] **Step 1: Failing tests**

`test/self/characters.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MAX_CHARACTERS, parseCharacters } from "../../src/self/characters.ts";

describe("parseCharacters", () => {
  test("keeps valid entries, drops the rest, dedupes, caps at 5", () => {
    const ok = (name: string) => ({ name, realm: "hyjal", region: "eu", source: "manual" });
    const raw = JSON.stringify([ok("Biwaasham"), ok("biwaasham"), { name: "X" }, ok("A1"), ok("Bb"), ok("Cc"), ok("Dd"), ok("Ee"), ok("Ff")]);
    expect(parseCharacters(raw).map((c) => c.name)).toEqual(["Biwaasham", "Bb", "Cc", "Dd", "Ee"]);
    expect(MAX_CHARACTERS).toBe(5);
  });
  test("null, garbage and non-arrays are an empty list", () => {
    expect(parseCharacters(null)).toEqual([]);
    expect(parseCharacters("{")).toEqual([]);
    expect(parseCharacters("{}")).toEqual([]);
  });
});
```

(`A1` is dropped by the name pattern.) Also in that file:

```ts
import { WOW_NAME, WOW_REALM } from "../../src/server/validate.ts";
import { CHARACTER_PATTERNS } from "../../src/self/characters.ts";
test("patterns match validate.ts", () => {
  expect(CHARACTER_PATTERNS.name.source).toBe(WOW_NAME.source);
  expect(CHARACTER_PATTERNS.realm.source).toBe(WOW_REALM.source);
});
```

Append to `test/hosted/settings.test.ts`, inside its main `describe`, a test using the file's existing `db`/user setup:

```ts
  test("characters: stored, read back, defaults to []", () => {
    const chars = [{ name: "Biwaasham", realm: "hyjal", region: "eu" as const, source: "manual" as const }];
    expect(db.settings.update(userId, { characters: chars }, 1).characters).toEqual(chars);
    expect(db.settings.get(userId).characters).toEqual(chars);
  });
```

(use the variable names the file already uses for the hosted db and the user id). Append to `test/server-user-state.test.ts`:

```ts
describe("PUT /api/settings — characters", () => {
  test("manual entries are stored; a bnet entry or a sixth character is refused", async () => {
    const c = (name: string, source = "manual") => ({ name, realm: "hyjal", region: "eu", source });
    const put = (characters: unknown[]) => fetch(h("/api/settings"), as(a, { method: "PUT", body: JSON.stringify({ characters }) }));
    expect((await put([c("Biwaasham")])).status).toBe(200);
    expect((await (await fetch(h("/api/settings"), as(a))).json()).settings.characters).toEqual([c("Biwaasham")]);
    expect((await put([c("Biwaasham", "bnet")])).status).toBe(400);
    expect((await put(["Aa", "Bb", "Cc", "Dd", "Ee", "Ff"].map((n) => c(n)))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failures** — `bun test test/self/characters.test.ts test/hosted/settings.test.ts test/server-user-state.test.ts` → FAIL.

- [ ] **Step 3: `src/self/characters.ts`**

```ts
// "Me" (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md, decision 1): up to five characters per
// member. Phase 1 has manual entries only; `bnet` is reserved for the Battle.net import, which writes them itself —
// PUT /api/settings never accepts one.
import { isRegion, type Region } from "../wow/regions.ts";

// Same patterns as src/server/validate.ts (WOW_NAME, WOW_REALM), duplicated so validate.ts can import
// MAX_CHARACTERS without a cycle; test/self/characters.test.ts pins them equal.
const NAME = /^\p{L}{2,32}$/u;
const REALM = /^[\p{L}\d' -]{2,32}$/u;
export const CHARACTER_PATTERNS = { name: NAME, realm: REALM };

export const MAX_CHARACTERS = 5;
export type CharacterSource = "manual" | "bnet";
export interface MyCharacter {
  name: string;
  /** The WCL realm slug (`payload.character.realmSlug`). */
  realm: string;
  region: Region;
  source: CharacterSource;
}

const isCharacter = (v: unknown): v is MyCharacter => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && NAME.test(o.name) && typeof o.realm === "string" && REALM.test(o.realm)
    && isRegion(o.region) && (o.source === "manual" || o.source === "bnet");
};

const idOf = (c: MyCharacter): string => `${c.region}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;

/** The stored JSON column, defensively: invalid entries dropped, duplicates removed (first kept), capped. */
export function parseCharacters(raw: string | null): MyCharacter[] {
  if (raw === null) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: MyCharacter[] = [];
  for (const c of v) {
    if (!isCharacter(c) || seen.has(idOf(c))) continue;
    seen.add(idOf(c));
    out.push({ name: c.name, realm: c.realm, region: c.region, source: c.source });
    if (out.length === MAX_CHARACTERS) break;
  }
  return out;
}
```

- [ ] **Step 4: Schema, repo, validation, route**

`src/hosted/schema.ts`: in `CREATE TABLE IF NOT EXISTS user_settings`, after `live_classes TEXT,`: `characters   TEXT,`; in `SETTINGS_COLUMNS`, after `["live_classes", "TEXT"],`: `["characters", "TEXT"],`.

`src/hosted/db.ts`:
- `import { parseCharacters, type MyCharacter } from "../self/characters.ts";`
- `UserSettings` gains `characters: MyCharacter[]`; `DEFAULT_USER_SETTINGS` gains `characters: []`.
- `settingsGet`: row type gains `characters: string | null`, the SELECT list gains `, characters`.
- `settingsUpsert`: add `characters` to the column list, one more `?`, and `characters = excluded.characters` to the `ON CONFLICT` list.
- In `settings(userId)`: the row mapping gains `characters: parseCharacters(r.characters),`; the no-row default gains `characters: []`.
- In `update`: `settingsUpsert.run(…, JSON.stringify(next.liveClasses), JSON.stringify(next.characters), now)` (matching the new column order: put `characters` right after `live_classes` in the INSERT list).

`src/server/validate.ts` (after `SEASON_SYNC_BODY`, since it uses `WOW_NAME`/`WOW_REALM`; move `SETTINGS_BODY` below them if it is declared earlier, as `const` declarations are not hoisted):

```ts
import { MAX_CHARACTERS } from "../self/characters.ts";
/** A "this is me" entry the member adds by hand; `bnet` entries come only from the Battle.net import. */
const MY_CHARACTER = obj({
  name: str({ min: 2, max: 32, trim: true, pattern: WOW_NAME }),
  realm: str({ min: 2, max: 32, trim: true, pattern: WOW_REALM }),
  region: oneOf(REGIONS),
  source: oneOf(["manual"] as const),
});
```

and in `SETTINGS_BODY`: `characters: opt(arr(MY_CHARACTER, { max: MAX_CHARACTERS })),`.


`src/server/routes-user.ts`, `parseSettingsPatch`: the parameter type gains `characters?: MyCharacter[]`; add `if ("characters" in value) patch.characters = value.characters!;` and append `` `characters` `` to the "Nothing to update" message (`…, \`liveClasses\` and/or \`characters\``).

- [ ] **Step 5: Full-object assertions**

Add `characters: []` to the expected settings objects in: `test/server-user-state.test.ts` (the `toEqual` around lines 138 and 142–147), `test/hosted/settings.test.ts` (lines 17–18 and 23), `test/hosted/db.test.ts` (lines 140 and 142). Update the "Nothing to update" message wherever a test asserts it (`grep -rn "Nothing to update" test`).

- [ ] **Step 6: Run** — `bun test` and typechecks → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/self/characters.ts src/hosted/schema.ts src/hosted/db.ts src/server/validate.ts src/server/routes-user.ts test/self/characters.test.ts test/hosted/settings.test.ts test/hosted/db.test.ts test/server-user-state.test.ts
git commit -m "feat(hosted): the member's characters in the settings (manual entries)"
```

---
### Task 10: Front plumbing — shared types, API calls, `Settings.characters`

**Files:**
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/lib/settings.ts`, `web/src/lib/runs.ts` (export `rowOf`)
- Test: `web/src/lib/settings.test.ts`

**Interfaces:**
- Produces: `api.season(q)`, `api.seasonSync(body)`; `Settings.characters: MyCharacter[]` (local key `bmpl.characters`); `rowOf(t, run, metric, now)` exported.

- [ ] **Step 1: Failing test**

In `web/src/lib/settings.test.ts`, add `characters: []` to the `parseServerSettings(null)` expectation if it lists fields (it compares with `DEFAULT_SETTINGS`, which gains the field), and append:

```ts
describe("characters", () => {
  const me = { name: "Biwaasham", realm: "hyjal", region: "eu", source: "manual" } as const;
  test("local round trip under bmpl.characters; garbage reads as []", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    writeLocalSettings(store, { characters: [me] });
    expect(m.get("bmpl.characters")).toBe(JSON.stringify([me]));
    expect(readLocalSettings(store).characters).toEqual([me]);
    m.set("bmpl.characters", "[{\"name\":1}]");
    expect(readLocalSettings(store).characters).toEqual([]);
  });
  test("server settings: characters parsed, invalid ones dropped", () => {
    expect(parseServerSettings({ characters: [me, { name: "x" }] }).characters).toEqual([me]);
    expect(parseServerSettings({}).characters).toEqual([]);
  });
});
```

(import `readLocalSettings`, `writeLocalSettings`, `parseServerSettings` if the file does not already.)

- [ ] **Step 2: Run, expect failure** — `bun test web/src/lib/settings.test.ts` → FAIL.

- [ ] **Step 3: Types and API**

`web/src/types.ts`, with the other re-exports:

```ts
export type { PillarKey, PillarScore } from "@shared/evaluation/types.ts";
export type { DungeonDetails, DungeonRow, PillarRecord, PillarTrend, SeasonRunView, SeasonView, WindowView, WorkOnRow } from "@shared/self/season.ts";
export type { SyncState } from "@shared/self/sync.ts";
export type { CharacterSource, MyCharacter } from "@shared/self/characters.ts";
export type { AbilityDamage, EnemyCast, KillingHit } from "@shared/signals/types.ts";
```

`web/src/api.ts` (import the new types from `./types.ts`), in the `api` object after `deepdive`:

```ts
  season: (q: { name: string; realm: string; region: Region; level: number }) =>
    call<{ season: SeasonView | null }>(`/api/season?${new URLSearchParams({ name: q.name, realm: q.realm, region: q.region, level: String(q.level) })}`),
  seasonSync: (body: { name: string; realm: string; region: Region; refresh?: boolean }) =>
    call<{ fetched: number; failed: number; state: SyncState; pointsSpent: number; ownClient?: OwnClientView | null }>("/api/season/sync", post(body)),
```

- [ ] **Step 4: Settings**

`web/src/lib/settings.ts`:
- `import type { MyCharacter } from "../types.ts";`
- `Settings` gains `characters: MyCharacter[];`
- `DEFAULT_SETTINGS` gains `characters: Object.freeze([] as MyCharacter[]) as MyCharacter[],`
- `export const CHARACTERS_STORAGE_KEY = "bmpl.characters";`
- a guard next to `isString`:

```ts
const NAME = /^\p{L}{2,32}$/u;
/** A stored "this is me" entry; the server's own check is src/self/characters.ts. */
export const isMyCharacter = (v: unknown): v is MyCharacter => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && NAME.test(o.name) && typeof o.realm === "string" && o.realm.length >= 2 && o.realm.length <= 32
    && isRegion(o.region) && (o.source === "manual" || o.source === "bnet");
};
```

(`isRegion` from `./regions.ts`.)
- `readLocalSettings`: `characters: readJsonArray(store.getItem(CHARACTERS_STORAGE_KEY), isMyCharacter, []),`
- `writeLocalSettings`: `if (patch.characters !== undefined) store.setItem(CHARACTERS_STORAGE_KEY, JSON.stringify(patch.characters));`
- `parseServerSettings`: `characters: Array.isArray(o.characters) ? o.characters.filter(isMyCharacter) : [],`

`web/src/lib/runs.ts`: `const rowOf = (` becomes `export const rowOf = (`.

- [ ] **Step 5: Run** — `bun test` and both typechecks → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/src/api.ts web/src/lib/settings.ts web/src/lib/settings.test.ts web/src/lib/runs.ts
git commit -m "feat(web): season API calls and the member's characters in the settings"
```

---

### Task 11: Strings (English source, French mirror)

**Files:**
- Modify: `web/src/i18n/en.ts`, `web/src/i18n/fr.ts`
- Test: `web/src/i18n/i18n.test.ts` (existing parity test)

- [ ] **Step 1: English** — in `en.ts`, a new top-level section after `runs`:

```ts
  self: {
    tabs: { overview: "Overview", dungeons: "Dungeons", runs: "Runs" },
    pillars: { damage: "Damage", survival: "Survival", avoidable: "Avoidable damage", interrupts: "Interrupts", control: "Control" },
    head: {
      runs: "{count, plural, one {# run this season} other {# runs this season}}",
      checked: " · checked {age}",
      sync: "Sync season",
      me: "This is me",
      meOn: "This is me ✓",
      meFull: "Up to {max} characters: remove one from your list first",
    },
    basis: {
      recent: "last 4 weeks · {count, plural, one {# run} other {# runs}}",
      lookup: "the runs behind the verdict · {count, plural, one {# run} other {# runs}}",
    },
    workOn: {
      title: "Work on first",
      sub: "what costs you the most · {basis}",
      point: "point",
      vsAvg: "vs the average player",
      vsPast: "vs your own past",
      impact: "{value} pts of score",
      better: "better ({value} before)",
      same: "same",
      worse: "worse ({value} before)",
      noPast: "no past yet",
      none: "Nothing costs you points against the average player.",
      line: "Work on first: {list}",
    },
    trend: {
      up: "↗ {delta}",
      down: "↘ {delta}",
      same: "→ same",
      notEnough: "not enough runs for a trend ({count} recently)",
    },
    pillar: {
      na: "n/a",
      details: "details ›",
      hide: "hide ‹",
      controlNote: "dispels only until phase 2",
      naControl: "No dispel or purge for this spec: n/a, not 0.",
      naGeneric: "No data for this pillar yet.",
    },
    verdictLine: "Verdict for a group leader: ",
    context: "context: {list}",
    contextItem: "{name} {score}",
    informational: "{item} (informational)",
    grid: { season: "season · all dungeons", dungeon: "dungeon · worst first", overall: "overall", runs: "runs" },
    panel: {
      sub: "{count, plural, one {# run} other {# runs}}{best}",
      best: " · best +{level} {result}",
      timed: "timed",
      depleted: "depleted",
      avoidable: "What hits you here (avoidable)",
      other: "other avoidable damage",
      killers: "What kills you here",
      deaths: "{count, plural, one {# death} other {# deaths}}",
      casts: "Casts that went through (group)",
      castsNote: "among spells your group kicked at least once",
      castOf: "{completed} of {attempts}",
      mine: "you kicked {n}",
      runsLink: "{count, plural, one {# run} other {# runs}} in {name} ›",
      empty: "No analysed run in this dungeon yet.",
    },
    runs: {
      title: "Every run this season",
      count: "{count, plural, one {# run} other {# runs}}",
      filter: "{name} ×",
      details: "details ›",
      hide: "hide ‹",
      notAnalysed: "not analysed",
      failed: "Warcraft Logs returned no report for this run",
    },
    detail: {
      deathAt: "Death at {at}",
      ofHits: "{pct} of the hits",
      self: "{ability} (self)",
      avoidable: "Avoidable damage taken",
      casts: "Casts that went through",
      kicked: "You kicked {mine} of the {interrupted} interrupted.",
      noDeath: "No death.",
    },
    sync: {
      title: "Sync your season",
      found: "{runs} ranked runs found · {pending} not analysed yet",
      cost: "~{pts} pts on your own WCL client · the shared budget is not used",
      costLocal: "~{pts} pts on your WCL client",
      start: "Sync {count, plural, one {# run} other {# runs}}",
      cancel: "Cancel",
      running: "Syncing…",
      progress: "{done} of {total} runs · {pts} pts spent · you can leave this page: what is synced stays, the next sync resumes",
      done: "Season synced · {analysed} of {runs} runs analysed",
      failed: "{count, plural, one {# log is} other {# logs are}} not available on Warcraft Logs",
      noClient: "A season sync needs your own Warcraft Logs client: it can cost over 1 000 points.",
      addClient: "Add your client in Settings ›",
      without: "Without it: the best run per dungeon, as today.",
      nothing: "Look this character up first: its rankings list the season's runs.",
      stopped: "Sync stopped: {error}",
    },
    loading: "Loading the season…",
  },
```

and in `help.toc`: `pillars: "The five pillars",`.

- [ ] **Step 2: French** — in `fr.ts`, the same keys (glossary and register: `docs/superpowers/specs/2026-09-21-french-locale-design.md`, "Decisions"; "run" stays "run", "tu"):

```ts
  self: {
    tabs: { overview: "Vue d'ensemble", dungeons: "Donjons", runs: "Runs" },
    pillars: { damage: "Dégâts", survival: "Survie", avoidable: "Dégâts évitables", interrupts: "Interruptions", control: "Contrôle" },
    head: {
      runs: "{count, plural, one {# run cette saison} other {# runs cette saison}}",
      checked: " · vérifié {age}",
      sync: "Synchroniser la saison",
      me: "C'est moi",
      meOn: "C'est moi ✓",
      meFull: "{max} personnages au plus : retire d'abord un personnage de ta liste",
    },
    basis: {
      recent: "4 dernières semaines · {count, plural, one {# run} other {# runs}}",
      lookup: "les runs du verdict · {count, plural, one {# run} other {# runs}}",
    },
    workOn: {
      title: "À travailler en premier",
      sub: "ce qui te coûte le plus · {basis}",
      point: "point",
      vsAvg: "face au joueur moyen",
      vsPast: "face à ton passé",
      impact: "{value} pts de score",
      better: "mieux ({value} avant)",
      same: "pareil",
      worse: "moins bien ({value} avant)",
      noPast: "pas encore d'historique",
      none: "Rien ne te coûte de points face au joueur moyen.",
      line: "À travailler en premier : {list}",
    },
    trend: {
      up: "↗ {delta}",
      down: "↘ {delta}",
      same: "→ stable",
      notEnough: "pas assez de runs pour une tendance ({count} récemment)",
    },
    pillar: {
      na: "n/a",
      details: "détails ›",
      hide: "masquer ‹",
      controlNote: "dispels seulement jusqu'à la phase 2",
      naControl: "Pas de dispel ni de purge pour cette spé : n/a, pas 0.",
      naGeneric: "Pas encore de données pour ce pilier.",
    },
    verdictLine: "Verdict pour un chef de groupe : ",
    context: "contexte : {list}",
    contextItem: "{name} {score}",
    informational: "{item} (informatif)",
    grid: { season: "saison · tous les donjons", dungeon: "donjon · le plus faible d'abord", overall: "global", runs: "runs" },
    panel: {
      sub: "{count, plural, one {# run} other {# runs}}{best}",
      best: " · meilleur +{level} {result}",
      timed: "dans les temps",
      depleted: "hors temps",
      avoidable: "Ce qui te touche ici (évitable)",
      other: "autres dégâts évitables",
      killers: "Ce qui te tue ici",
      deaths: "{count, plural, one {# mort} other {# morts}}",
      casts: "Sorts passés (groupe)",
      castsNote: "parmi les sorts que ton groupe a interrompus au moins une fois",
      castOf: "{completed} sur {attempts}",
      mine: "tu en as interrompu {n}",
      runsLink: "{count, plural, one {# run} other {# runs}} dans {name} ›",
      empty: "Aucun run analysé dans ce donjon pour l'instant.",
    },
    runs: {
      title: "Tous les runs de la saison",
      count: "{count, plural, one {# run} other {# runs}}",
      filter: "{name} ×",
      details: "détails ›",
      hide: "masquer ‹",
      notAnalysed: "non analysé",
      failed: "Warcraft Logs n'a renvoyé aucun rapport pour ce run",
    },
    detail: {
      deathAt: "Mort à {at}",
      ofHits: "{pct} des coups",
      self: "{ability} (soi-même)",
      avoidable: "Dégâts évitables subis",
      casts: "Sorts passés",
      kicked: "Tu en as interrompu {mine} sur les {interrupted} interrompus.",
      noDeath: "Aucune mort.",
    },
    sync: {
      title: "Synchroniser ta saison",
      found: "{runs} runs classés trouvés · {pending} pas encore analysés",
      cost: "~{pts} pts sur ton propre client WCL · le budget partagé n'est pas utilisé",
      costLocal: "~{pts} pts sur ton client WCL",
      start: "Synchroniser {count, plural, one {# run} other {# runs}}",
      cancel: "Annuler",
      running: "Synchronisation…",
      progress: "{done} sur {total} runs · {pts} pts dépensés · tu peux quitter cette page : ce qui est synchronisé reste, la prochaine synchro reprend",
      done: "Saison synchronisée · {analysed} runs analysés sur {runs}",
      failed: "{count, plural, one {# log indisponible} other {# logs indisponibles}} sur Warcraft Logs",
      noClient: "Une synchro de saison demande ton propre client Warcraft Logs : elle peut coûter plus de 1 000 points.",
      addClient: "Ajoute ton client dans les réglages ›",
      without: "Sans lui : le meilleur run par donjon, comme aujourd'hui.",
      nothing: "Recherche d'abord ce personnage : son classement liste les runs de la saison.",
      stopped: "Synchro arrêtée : {error}",
    },
    loading: "Chargement de la saison…",
  },
```

and in `help.toc`: `pillars: "Les cinq piliers",`.

- [ ] **Step 3: Run** — `bun test web/src/i18n` and `bun run --cwd web typecheck` → PASS (same leaf keys and placeholders). A plural's branches cannot contain `{param}` (the `PLURAL` regex in `t.ts` stops at the first `}`): every message above keeps its parameters outside the plural.

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n/en.ts web/src/i18n/fr.ts
git commit -m "feat(web): self-review strings, English and French"
```

---

### Task 12: Self-review view models

**Files:**
- Create: `web/src/lib/self.ts`, `web/src/lib/self.test.ts`

**Interfaces:**
- Consumes: Task 10's types, Task 11's strings, `evidenceText` / `formatEvidenceValue` (`axes.ts`), `verdictView` / `axisTitle` (`verdict.ts`), `rowOf` (`runs.ts`), `fmtAge` / `fmtAmount` / `fmtDuration` / `signed` (`format.ts`).
- Produces: `PILLAR_ORDER`, `RESULT_TABS`, `ResultTab`, `Band`, `scoreBand`, `trendView`, `pillarCards`, `basisText`, `workOnRows`, `verdictLine`, `headLine`, `seasonHeader`, `dungeonRows`, `dungeonPanel`, `runOf`, `runDetail`, `syncCard`, `syncProgress`, `MAX_ME`, `isMe`, `toggleMe`, `meChip`.

- [ ] **Step 1: Failing tests**

`web/src/lib/self.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { DungeonRow, Evaluation, LookupPayload, MyCharacter, SeasonRunView, SeasonView } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  dungeonPanel, isMe, meChip, pillarCards, runDetail, scoreBand, syncCard, toggleMe, trendView, workOnRows,
} from "./self.ts";

const tFr = makeT(fr, "fr");
const titleOf = (s: string) => s;

const ev = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 18, axes: [], global: 55, verdict: "maybe", runsUsed: 8, analyzedRuns: 0, configVersion: "x",
  drivers: [{ source: "survival.individualDeaths", impact: -9, value: 1.4, reference: 0.7, label: "1.4 individual deaths/run" }],
  nextVerdict: null,
  pillars: [
    { key: "damage", score: 68, evidence: [{ label: "median parse 61%", delta: 4, source: "throughput.medianParse", value: 61, weight: 3, score: 61 }] },
    { key: "survival", score: 41, evidence: [{ label: "1.4 individual deaths/run", delta: -6, source: "survival.individualDeaths", value: 1.4, weight: 3, score: 40 }] },
    { key: "avoidable", score: 57, evidence: [] },
    { key: "interrupts", score: 82, evidence: [] },
    { key: "control", score: null, evidence: [] },
  ],
  ...over,
});

const season = (over: Partial<SeasonView> = {}): SeasonView => ({
  character: { name: "Muleyoxo", realm: "silvermoon", region: "eu" }, zoneID: 55, targetLevel: 18, currentWeek: 0, checkedAt: 0,
  state: { runs: 142, analysed: 24, pending: 118, failed: 0, estimate: 1200 },
  runs: [], recent: null, season: null,
  trends: [{ key: "survival", delta: -9, direction: "down", recentRuns: 6, weekly: [null, null, null, null, null, null, 45, 40] }],
  workOn: [], dungeons: [], ...over,
});

describe("scoreBand (spec: 75 / 55 / 45)", () => {
  test("bands", () => {
    expect([80, 75, 74, 55, 54, 45, 44, null].map(scoreBand)).toEqual(["good", "good", "mid", "mid", "warn", "warn", "bad", "na"]);
  });
});

describe("trendView", () => {
  test("arrows, same, not enough", () => {
    expect(trendView(tEn, { key: "damage", delta: 6, direction: "up", recentRuns: 5, weekly: [] })).toEqual({ text: "↗ +6", cls: "tone-good" });
    expect(trendView(tEn, { key: "damage", delta: -9, direction: "down", recentRuns: 5, weekly: [] })).toEqual({ text: "↘ −9", cls: "tone-bad" });
    expect(trendView(tEn, { key: "damage", delta: 2, direction: "same", recentRuns: 5, weekly: [] }).text).toBe("→ same");
    expect(trendView(tEn, undefined).text).toBe("not enough runs for a trend (0 recently)");
    expect(trendView(tFr, { key: "damage", delta: null, direction: null, recentRuns: 2, weekly: [] }).text).toBe("pas assez de runs pour une tendance (2 récemment)");
  });
});

describe("pillarCards", () => {
  test("from the lookup's evaluation when the season has no window", () => {
    const c = pillarCards(tEn, "en", ev(), season());
    expect(c.map((x) => [x.key, x.score, x.band])).toEqual([
      ["damage", "68", "mid"], ["survival", "41", "bad"], ["avoidable", "57", "mid"], ["interrupts", "82", "good"], ["control", "n/a", "na"],
    ]);
    expect(c[1]!.trend.text).toBe("↘ −9");
    expect(c[1]!.bars.map((b) => [b.px, b.last, b.empty])).toEqual([[2, false, true], [2, false, true], [2, false, true], [2, false, true], [2, false, true], [2, false, true], [13, false, false], [11, true, false]]);
    expect(c[4]!.trend.text).toBe("dispels only until phase 2");
    expect(c[4]!.sentence).toBe("No dispel or purge for this spec: n/a, not 0.");
  });
  test("from the 4-week window when there is one", () => {
    const s = season({ recent: { runs: 38, global: 60, pillars: [{ key: "damage", score: 70, evidence: [] }] } });
    expect(pillarCards(tEn, "en", ev(), s)[0]!.score).toBe("70");
  });
});

describe("workOnRows", () => {
  test("the lookup's costs when the season has no window; no past", () => {
    const r = workOnRows(tEn, "en", ev(), season(), titleOf);
    expect(r).toEqual([{ n: 1, title: "survival.individualDeaths", pillar: "Survival", impact: "−9 pts of score", past: { text: "no past yet", cls: "muted" }, detail: expect.any(String) }]);
  });
  test("the window's rows with the own-past column", () => {
    const s = season({
      recent: { runs: 38, global: 60, pillars: [] },
      workOn: [{ source: "survival.individualDeaths", pillar: "survival", impact: -9, value: 1.4, reference: 0.7, label: "", past: { value: 0.2, change: "worse" } }],
    });
    expect(workOnRows(tEn, "en", ev(), s, titleOf)[0]!.past).toEqual({ text: "worse (0.2 before)", cls: "tone-bad" });
    expect(workOnRows(tFr, "fr", ev(), s, titleOf)[0]!.past.text).toBe("moins bien (0,2 avant)");
  });
});

describe("dungeonPanel", () => {
  const row: DungeonRow = {
    encounterID: 12923, name: "Voidscar Arena", runs: 21, analysed: 18,
    pillars: { damage: 62, survival: 28, avoidable: 41, interrupts: 80, control: null }, overall: 53, best: { level: 18, timed: false },
    details: {
      avoidable: [{ id: 1, name: "Shadow Pool", total: 380 }, { id: 2, name: "Void Slash", total: 240 }], avoidableOther: 380, avoidableTotal: 1000,
      killers: [{ ability: "Void Slash", deaths: 4 }],
      casts: [{ id: 3, name: "Lava Bolt", attempts: 40, completed: 11, interrupted: 27, mine: 9 }],
    },
  };
  test("shares, counts and the runs link", () => {
    const p = dungeonPanel(tEn, "en", row);
    expect(p.sub).toBe("21 runs · best +18 depleted");
    expect(p.avoidable.map((a) => [a.name, a.pct, a.width])).toEqual([["Shadow Pool", "38%", 38], ["Void Slash", "24%", 24]]);
    expect(p.other).toEqual({ pct: "38%", width: 38 });
    expect(p.killers).toEqual([{ ability: "Void Slash", deaths: "4 deaths" }]);
    expect(p.casts).toEqual([{ id: 3, name: "Lava Bolt", ofText: "11 of 40", mine: "you kicked 9" }]);
    expect(p.runsLink).toBe("21 runs in Voidscar Arena ›");
    expect(dungeonPanel(tFr, "fr", row).avoidable[0]!.pct).toBe("38\u00a0%"); // Intl: no-break space
  });
});

describe("runDetail", () => {
  test("killing hits as shares, avoidable amounts, casts and the kick line", () => {
    const v = {
      signals: {
        deaths: { count: 1, groupTotal: 1, events: [{ atMs: 842_000, cause: null, source: null, overkill: 0, inWipe: false, killingHits: [
          { ability: "Void Slash", abilityId: 5, amount: 71, overkill: 10, friendly: false, instakill: false },
          { ability: "Shadow Pool", abilityId: 6, amount: 29, overkill: 0, friendly: true, instakill: false },
        ] }] },
        avoidableDamage: { total: 3_500_000, perMinute: 1, peer: null, spellCount: 3, abilities: [{ id: 6, name: "Shadow Pool", total: 2_100_000 }], other: 1_400_000 },
        interrupts: { count: 4, kickCooldownS: 15, capacity: 10, usage: 0.4, peer: null, enemyCasts: [{ id: 7, name: "Lava Bolt", attempts: 12, completed: 3, interrupted: 9, mine: 4 }] },
      },
    } as unknown as SeasonRunView;
    const d = runDetail(tEn, "en", v)!;
    expect(d.deaths).toEqual([{ title: "Death at 14:02", hits: [{ ability: "Void Slash", share: "71% of the hits" }, { ability: "Shadow Pool (self)", share: "29% of the hits" }] }]);
    expect(d.avoidable.map((a) => a.name)).toEqual(["Shadow Pool", "other avoidable damage"]);
    expect(d.casts).toEqual([{ id: 7, name: "Lava Bolt", ofText: "3 of 12" }]);
    expect(d.kicked).toBe("You kicked 4 of the 9 interrupted.");
  });
});

describe("syncCard", () => {
  const own = { clientId: "abcd…wxyz", verifiedAt: 1, updatedAt: 1, usable: true, snapshot: null };
  test("hosted without a usable own client: the guide", () => {
    expect(syncCard(tEn, season(), true, null).kind).toBe("noClient");
    expect(syncCard(tEn, season(), true, { ...own, usable: false }).kind).toBe("noClient");
  });
  test("estimate before spending, done when nothing is pending", () => {
    const v = syncCard(tEn, season(), true, own);
    expect(v).toEqual({ kind: "ready", found: "142 ranked runs found · 118 not analysed yet", cost: "~1\u202f200 pts on your own WCL client · the shared budget is not used", start: "Sync 118 runs" });
    expect(syncCard(tEn, season(), false, null)).toMatchObject({ kind: "ready", cost: "~1\u202f200 pts on your WCL client" });
    expect(syncCard(tEn, season({ state: { runs: 142, analysed: 140, pending: 0, failed: 2, estimate: 0 } }), false, null))
      .toEqual({ kind: "done", text: "Season synced · 140 of 142 runs analysed", failed: "2 logs are not available on Warcraft Logs" });
    expect(syncCard(tEn, null, false, null).kind).toBe("nothing");
  });
});

describe("me", () => {
  const p = { character: { name: "Muleyoxo", realmSlug: "silvermoon", region: "eu" } } as unknown as LookupPayload;
  const c = (name: string): MyCharacter => ({ name, realm: "silvermoon", region: "eu", source: "manual" });
  test("toggle, case-insensitive, at most 5", () => {
    expect(isMe([c("muleyoxo")], p)).toBe(true);
    expect(toggleMe([], p)).toEqual([c("Muleyoxo")]);
    expect(toggleMe([c("Muleyoxo"), c("Other")], p)).toEqual([c("Other")]);
    const full = ["Aa", "Bb", "Cc", "Dd", "Ee"].map(c);
    expect(toggleMe(full, p)).toBeNull();
    expect(meChip(tEn, full, p)).toEqual({ label: "This is me", on: false, disabled: true, title: "Up to 5 characters: remove one from your list first" });
    expect(meChip(tEn, [c("Muleyoxo")], p)).toEqual({ label: "This is me ✓", on: true, disabled: false });
  });
});
```

- [ ] **Step 2: Run, expect failure** — `bun test web/src/lib/self.test.ts` → FAIL (module missing).

- [ ] **Step 3: `web/src/lib/self.ts`**

```ts
// View models of the self-review result tabs (docs/superpowers/specs/2026-10-09-self-review-pillars-design.md;
// canvas page "self-review": SelfTabs, SelfDungeonFirst, SelfDetails). Pure: no React, no fetch.
import type {
  AxisKey, DungeonRow, Evaluation, LookupPayload, MPlusRun, MyCharacter, OwnClientView, PillarKey, PillarScore, PillarTrend,
  SeasonRunView, SeasonView, WorkOnRow,
} from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { evidenceText, formatEvidenceValue } from "./axes.ts";
import { fmtAge, fmtAmount, fmtDuration, signed } from "./format.ts";
import { AXIS_ORDER, axisTitle, verdictView } from "./verdict.ts";

/** Same order as src/evaluation/types.ts PILLAR_KEYS (the front cannot import runtime values from src/). */
export const PILLAR_ORDER: readonly PillarKey[] = ["damage", "survival", "avoidable", "interrupts", "control"];
export type ResultTab = "overview" | "dungeons" | "runs";
export const RESULT_TABS: readonly ResultTab[] = ["overview", "dungeons", "runs"];

export type Band = "good" | "mid" | "warn" | "bad" | "na";
/** Spec "Numbers (phase 1)", read off the canvas: 75 / 55 / 45. */
export const scoreBand = (s: number | null): Band => (s === null ? "na" : s >= 75 ? "good" : s >= 55 ? "mid" : s >= 45 ? "warn" : "bad");
const scoreText = (t: T, s: number | null): string => (s === null ? t("self.pillar.na") : String(s));

/** Weekly bars: 0.28 px per point, so 100 fills the 28 px row; an empty week is a 2 px stub. */
const BAR_PX_PER_POINT = 0.28;
const pct = (locale: Locale, x: number): string => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(x);

export interface TrendView { text: string; cls: "tone-good" | "tone-bad" | "muted" | "faint" }

export function trendView(t: T, tr: PillarTrend | undefined): TrendView {
  if (!tr || tr.direction === null || tr.delta === null) return { text: t("self.trend.notEnough", { count: tr?.recentRuns ?? 0 }), cls: "faint" };
  if (tr.direction === "same") return { text: t("self.trend.same"), cls: "muted" };
  return { text: t(`self.trend.${tr.direction}`, { delta: signed(tr.delta) }), cls: tr.direction === "up" ? "tone-good" : "tone-bad" };
}

export interface PillarCard {
  key: PillarKey;
  title: string;
  score: string;
  band: Band;
  trend: TrendView;
  bars: { px: number; last: boolean; empty: boolean }[];
  /** One sentence: the pillar's two strongest evidence lines. */
  sentence: string;
  /** Every evidence line, for "details". */
  lines: string[];
}

/** The window's pillars when the season has one (4 weeks, 3+ runs), else the lookup's own evaluation. */
const pillarsOf = (ev: Evaluation, season: SeasonView | null): PillarScore[] => season?.recent?.pillars ?? ev.pillars ?? [];

export function pillarCards(t: T, locale: Locale, ev: Evaluation, season: SeasonView | null): PillarCard[] {
  const source = pillarsOf(ev, season);
  return PILLAR_ORDER.map((key) => {
    const p = source.find((x) => x.key === key) ?? null;
    const score = p?.score ?? null;
    const tr = season?.trends.find((x) => x.key === key);
    const weekly = tr?.weekly ?? [];
    const lines = (p?.evidence ?? []).map((e) => evidenceText(t, locale, e));
    return {
      key,
      title: t(`self.pillars.${key}`),
      score: scoreText(t, score),
      band: scoreBand(score),
      trend: key === "control" && score === null ? { text: t("self.pillar.controlNote"), cls: "faint" } : trendView(t, tr),
      bars: weekly.map((w, i) => ({ px: w === null ? 2 : Math.max(2, Math.round(w * BAR_PX_PER_POINT)), last: i === weekly.length - 1, empty: w === null })),
      sentence: score === null ? (key === "control" ? t("self.pillar.naControl") : t("self.pillar.naGeneric")) : lines.slice(0, 2).join(" · "),
      lines,
    };
  });
}

export const basisText = (t: T, ev: Evaluation, season: SeasonView | null): string =>
  season?.recent ? t("self.basis.recent", { count: season.recent.runs }) : t("self.basis.lookup", { count: ev.runsUsed });

export interface WorkOnView {
  n: number;
  title: string;
  pillar: string;
  detail: string;
  impact: string;
  past: { text: string; cls: "tone-good" | "tone-bad" | "muted" };
}

/** The pillar an evidence source belongs to, read off the evaluation itself (no copy of the mapping in the front). */
const pillarOfSource = (ev: Evaluation, source: string): PillarKey | null =>
  ev.pillars?.find((p) => p.evidence.some((e) => e.source === source))?.key ?? null;

export function workOnRows(t: T, locale: Locale, ev: Evaluation, season: SeasonView | null, titleOf: (source: string) => string): WorkOnView[] {
  const rows: WorkOnRow[] = season?.recent
    ? season.workOn
    : (ev.drivers ?? []).filter((d) => d.impact < 0).slice(0, 3).map((d) => ({
        source: d.source, pillar: pillarOfSource(ev, d.source), impact: d.impact, value: d.value, reference: d.reference, label: d.label, past: null,
      }));
  return rows.map((w, i) => ({
    n: i + 1,
    title: titleOf(w.source),
    pillar: w.pillar ? t(`self.pillars.${w.pillar}`) : "",
    detail: evidenceText(t, locale, { label: w.label, delta: 0, source: w.source, value: w.value }),
    impact: t("self.workOn.impact", { value: signed(w.impact) }),
    past: w.past === null
      ? { text: t("self.workOn.noPast"), cls: "muted" }
      : w.past.change === "same"
        ? { text: t("self.workOn.same"), cls: "muted" }
        : { text: t(`self.workOn.${w.past.change}`, { value: formatEvidenceValue(locale, w.source, w.past.value) }), cls: w.past.change === "better" ? "tone-good" : "tone-bad" },
  }));
}

/** "Verdict for a group leader: INVITE 72 · context: …": the verdict as today, the context axes beside it. */
export function verdictLine(t: T, ev: Evaluation, informational: (key: AxisKey) => boolean): { badge: ReturnType<typeof verdictView>; context: string } {
  const items = AXIS_ORDER.filter((k) => k === "preparation" || k === "consistency" || k === "experience").flatMap((k) => {
    const a = ev.axes.find((x) => x.key === k);
    if (!a || a.score === null) return [];
    const item = t("self.contextItem", { name: axisTitle(t, k).toLocaleLowerCase(), score: a.score });
    return [informational(k) ? t("self.informational", { item }) : item];
  });
  return { badge: verdictView(t, ev), context: items.length > 0 ? t("self.context", { list: items.join(" · ") }) : "" };
}

export const headLine = (t: T, season: SeasonView, now = Date.now()): string =>
  t("self.head.runs", { count: season.state.runs }) + (season.checkedAt !== null ? t("self.head.checked", { age: fmtAge(t, season.checkedAt, now) }) : "");

export interface GridCell { text: string; band: Band; trend?: string }

export function seasonHeader(t: T, season: SeasonView): { cells: GridCell[]; overall: GridCell; runs: string } {
  const pillars = season.season?.pillars ?? [];
  return {
    cells: PILLAR_ORDER.map((key) => {
      const s = pillars.find((p) => p.key === key)?.score ?? null;
      const tr = trendView(t, season.trends.find((x) => x.key === key));
      return { text: scoreText(t, s), band: scoreBand(s), trend: key === "control" && s === null ? t("self.pillar.controlNote") : tr.text };
    }),
    overall: { text: scoreText(t, season.season?.global ?? null), band: scoreBand(season.season?.global ?? null) },
    runs: String(season.state.runs),
  };
}

export interface GridRow { encounterID: number; name: string; cells: GridCell[]; overall: GridCell; runs: string }

export const dungeonRows = (t: T, season: SeasonView): GridRow[] =>
  season.dungeons.map((d) => ({
    encounterID: d.encounterID,
    name: d.name,
    cells: PILLAR_ORDER.map((k) => ({ text: scoreText(t, d.pillars[k]), band: scoreBand(d.pillars[k]) })),
    overall: { text: scoreText(t, d.overall), band: scoreBand(d.overall) },
    runs: String(d.runs),
  }));

export interface PanelView {
  title: string;
  sub: string;
  avoidable: { id: number; name: string; pct: string; width: number }[];
  other: { pct: string; width: number } | null;
  killers: { ability: string; deaths: string }[];
  casts: { id: number; name: string; ofText: string; mine: string }[];
  runsLink: string;
  empty: boolean;
}

export function dungeonPanel(t: T, locale: Locale, row: DungeonRow): PanelView {
  const d = row.details;
  const share = (v: number): number => (d.avoidableTotal > 0 ? v / d.avoidableTotal : 0);
  const best = row.best ? t("self.panel.best", { level: row.best.level, result: t(row.best.timed === false ? "self.panel.depleted" : "self.panel.timed") }) : "";
  return {
    title: row.name,
    sub: t("self.panel.sub", { count: row.runs, best }),
    avoidable: d.avoidable.map((a) => ({ id: a.id, name: a.name, pct: pct(locale, share(a.total)), width: Math.round(share(a.total) * 100) })),
    other: d.avoidableOther > 0 ? { pct: pct(locale, share(d.avoidableOther)), width: Math.round(share(d.avoidableOther) * 100) } : null,
    killers: d.killers.map((k) => ({ ability: k.ability, deaths: t("self.panel.deaths", { count: k.deaths }) })),
    casts: d.casts.map((c) => ({ id: c.id, name: c.name, ofText: t("self.panel.castOf", { completed: c.completed, attempts: c.attempts }), mine: c.mine > 0 ? t("self.panel.mine", { n: c.mine }) : "" })),
    runsLink: t("self.panel.runsLink", { count: row.runs, name: row.name }),
    empty: row.analysed === 0,
  };
}

/** A season run as the run list's `MPlusRun` (`rowOf` in runs.ts renders both). */
export const runOf = (v: SeasonRunView): MPlusRun => ({
  encounterID: v.encounterID, encounterName: v.encounterName, keyLevel: v.keyLevel, amount: v.amount, parsePercent: v.parse,
  spec: v.spec, affixes: v.affixes, reportCode: v.reportCode, fightID: v.fightID, startTime: v.startTime, score: v.score,
  ...(v.signals ? { signals: v.signals } : {}),
});

export interface RunDetailView {
  deaths: { title: string; hits: { ability: string; share: string }[] }[];
  avoidable: { key: string; name: string; amount: string }[];
  casts: { id: number; name: string; ofText: string }[];
  kicked: string | null;
}

export function runDetail(t: T, locale: Locale, v: SeasonRunView): RunDetailView | null {
  const s = v.signals;
  if (!s) return null;
  const deaths = s.deaths.events.map((d) => {
    const hits = d.killingHits ?? [];
    const sum = hits.reduce((a, h) => a + h.amount, 0);
    return {
      title: t("self.detail.deathAt", { at: fmtDuration(d.atMs) }),
      hits: hits.map((h) => {
        const name = h.ability ?? "?";
        return { ability: h.friendly ? t("self.detail.self", { ability: name }) : name, share: t("self.detail.ofHits", { pct: pct(locale, sum > 0 ? h.amount / sum : 0) }) };
      }),
    };
  });
  const a = s.avoidableDamage;
  const avoidable = [
    ...(a?.abilities ?? []).map((x) => ({ key: String(x.id), name: x.name, amount: fmtAmount(x.total) })),
    ...(a?.other ? [{ key: "other", name: t("self.panel.other"), amount: fmtAmount(a.other) }] : []),
  ];
  const enemy = [...(s.interrupts.enemyCasts ?? [])].sort((x, y) => y.completed - x.completed).slice(0, 5);
  const interrupted = (s.interrupts.enemyCasts ?? []).reduce((n, c) => n + c.interrupted, 0);
  const mine = (s.interrupts.enemyCasts ?? []).reduce((n, c) => n + c.mine, 0);
  return {
    deaths,
    avoidable,
    casts: enemy.map((c) => ({ id: c.id, name: c.name, ofText: t("self.panel.castOf", { completed: c.completed, attempts: c.attempts }) })),
    kicked: enemy.length > 0 ? t("self.detail.kicked", { mine, interrupted }) : null,
  };
}

export type SyncCardView =
  | { kind: "nothing"; text: string }
  | { kind: "noClient"; text: string; link: string; without: string }
  | { kind: "ready"; found: string; cost: string; start: string }
  | { kind: "done"; text: string; failed: string | null };

/** Decision 3: hosted needs a usable own client; the estimate is stated before any point is spent. */
export function syncCard(t: T, season: SeasonView | null, hosted: boolean, ownClient: OwnClientView | null): SyncCardView {
  if (hosted && !ownClient?.usable) return { kind: "noClient", text: t("self.sync.noClient"), link: t("self.sync.addClient"), without: t("self.sync.without") };
  if (!season) return { kind: "nothing", text: t("self.sync.nothing") };
  const s = season.state;
  if (s.pending === 0) {
    return { kind: "done", text: t("self.sync.done", { analysed: s.analysed, runs: s.runs }), failed: s.failed > 0 ? t("self.sync.failed", { count: s.failed }) : null };
  }
  return {
    kind: "ready",
    found: t("self.sync.found", { runs: s.runs, pending: s.pending }),
    cost: t(hosted ? "self.sync.cost" : "self.sync.costLocal", { pts: s.estimate }),
    start: t("self.sync.start", { count: s.pending }),
  };
}

export const syncProgress = (t: T, p: { done: number; total: number; pts: number }): string => t("self.sync.progress", p);

export const MAX_ME = 5;
const sameCharacter = (c: MyCharacter, p: LookupPayload): boolean =>
  c.region === p.character.region && c.realm.toLowerCase() === p.character.realmSlug.toLowerCase() && c.name.toLowerCase() === p.character.name.toLowerCase();
export const isMe = (chars: MyCharacter[], p: LookupPayload): boolean => chars.some((c) => sameCharacter(c, p));

/** Adds or removes the payload's character; null when the list is full and it is not in it. */
export function toggleMe(chars: MyCharacter[], p: LookupPayload): MyCharacter[] | null {
  if (isMe(chars, p)) return chars.filter((c) => !sameCharacter(c, p));
  if (chars.length >= MAX_ME) return null;
  return [...chars, { name: p.character.name, realm: p.character.realmSlug, region: p.character.region, source: "manual" }];
}

export function meChip(t: T, chars: MyCharacter[], p: LookupPayload): { label: string; on: boolean; disabled: boolean; title?: string } {
  if (isMe(chars, p)) return { label: t("self.head.meOn"), on: true, disabled: false };
  if (chars.length >= MAX_ME) return { label: t("self.head.me"), on: false, disabled: true, title: t("self.head.meFull", { max: MAX_ME }) };
  return { label: t("self.head.me"), on: false, disabled: false };
}
```

If `AXIS_ORDER` is not exported from `verdict.ts` under that name, use the name it has (`web/src/lib/verdict.ts:4`). The `"?"` fallback for a nameless killing hit is a glyph, not copy.

- [ ] **Step 4: Run** — `bun test web/src` and `bun run --cwd web typecheck` → PASS. Numbers in messages go through `fmtNumber` (`web/src/lib/locale.ts`), whose group separator is U+202F in both languages (`1\u202f200`); `Intl`'s French percent uses U+00A0 (`38\u00a0%`). The assertions above already use them.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/self.ts web/src/lib/self.test.ts
git commit -m "feat(web): self-review view models"
```

---

### Task 13: Styles

**Files:**
- Modify: `web/src/styles/app.css`

- [ ] **Step 1: Append** (values lifted from the canvas files `SelfTabs.dc.html` / `SelfDungeonFirst.dc.html` / `SelfDetails.dc.html`, every colour a token):

```css
/* Self-review result tabs (canvas "self-review", variants A + C; spec 2026-10-09-self-review-pillars-design.md) */
.result-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.result-head h2 { margin: 0; font-size: 20px; font-weight: 700; }
.chip-me { color: var(--green); border-color: var(--green-border); background: var(--green-bg); }
.rtabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border-soft); }
.rtab { padding: 8px 14px; font-size: 13px; color: var(--muted); background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }
.rtab.on { color: var(--text); border-bottom-color: var(--link); font-weight: 600; }
.work-on { display: flex; flex-direction: column; gap: 4px; }
.work-on-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) 170px 170px; gap: 12px; align-items: center; font-size: 13px; padding: 8px 10px; }
.work-on-num { width: 20px; height: 20px; border-radius: 50%; background: var(--border-soft); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.pillars { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.pillar { display: flex; flex-direction: column; gap: 6px; }
.pillar-score { font-size: 28px; font-weight: 800; font-family: var(--mono); }
.pillar-trend { font-size: 12px; font-weight: 600; }
.pillar-text { font-size: 13px; color: var(--text-soft); }
.band-good { color: var(--green); }
.band-mid { color: var(--text-soft); }
.band-warn { color: var(--yellow); }
.band-bad { color: var(--red); }
.band-na { color: var(--faint); }
.wk { display: flex; align-items: flex-end; gap: 2px; height: 28px; }
.wk i { display: block; width: 8px; background: var(--border); }
.wk i.last { background: var(--link); }
.wk i.empty { opacity: .4; }
.verdict-line { font-size: 12px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.overview-rest { display: flex; flex-direction: column; gap: 16px; }
.side { display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 16px; align-items: start; }
.grid5 { display: grid; grid-template-columns: 210px repeat(5, minmax(0, 1fr)) 90px 60px; gap: 4px; font-size: 13px; align-items: center; }
.grid5-name { background: transparent; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.grid5-name.on { color: var(--link); font-weight: 600; }
.cell { border-radius: var(--radius); padding: 6px 0; text-align: center; font-family: var(--mono); font-weight: 700; }
.cell-big { font-size: 18px; }
.cell-good { background: var(--green-bg); color: var(--green); }
.cell-mid { background: var(--card); color: var(--text-soft); border: 1px solid var(--border-soft); }
.cell-warn { background: var(--yellow-bg); color: var(--yellow); }
.cell-bad { background: var(--red-bg); color: var(--red); }
.cell-na { color: var(--faint); border: 1px dashed var(--border-soft); }
.ab-row { display: grid; grid-template-columns: minmax(0, 1fr) 110px 110px; gap: 10px; font-size: 13px; align-items: center; }
.bar2 { display: block; height: 6px; background: var(--border-soft); border-radius: 3px; overflow: hidden; }
.bar2 > span { display: block; height: 100%; background: var(--yellow); }
.bar2.progress > span { background: var(--link); }
.run-detail { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 4px 10px 8px; }
.sync-card { display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
.link-btn { background: transparent; border: 0; padding: 0; color: var(--link); font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
@media (max-width: 1100px) {
  .pillars { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .side { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 2: Check** — `grep -nE '#[0-9a-fA-F]{3,6}' web/src/styles/app.css | tail -60` shows no hex in the new block.

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/app.css
git commit -m "feat(web): self-review styles from the canvas"
```

---

### Task 14: The season hook and the result header

**Files:**
- Create: `web/src/useSeason.ts`, `web/src/components/self/ResultHead.tsx`, `web/src/components/self/SyncCard.tsx`

**Interfaces:**
- Produces: `SelfActions` (in `ResultHead.tsx`, imported by `Detail.tsx` and `App.tsx`), `useSeason(payload, self): SeasonState`.

- [ ] **Step 1: `web/src/useSeason.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { LookupPayload, SeasonView } from "./types.ts";
import type { SelfActions } from "./components/self/ResultHead.tsx";

export interface SeasonState {
  view: SeasonView | null;
  loading: boolean;
  syncOpen: boolean;
  openSync: () => void;
  closeSync: () => void;
  running: boolean;
  progress: { done: number; total: number; pts: number } | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * The season of the payload's character (GET /api/season, 0 pts), reloaded whenever the payload object changes —
 * `reloadActive` in App replaces it after a deep-dive. The sync loops one batch per request (decision 3) until
 * nothing is pending, a batch fetches nothing, an error, or Cancel; leaving the page stops it, and the next sync
 * resumes from the cache.
 */
export function useSeason(payload: LookupPayload, self: SelfActions): SeasonState {
  const [view, setView] = useState<SeasonView | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SeasonState["progress"]>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const who = { name: payload.character.name, realm: payload.character.realmSlug, region: payload.character.region };

  const load = useCallback(async () => {
    const r = await api.season({ ...who, level: payload.targetLevel });
    if (r.ok) setView(r.season);
    setLoading(false);
  }, [payload]);

  useEffect(() => {
    setLoading(true);
    setView(null);
    void load();
    return () => { cancelled.current = true; };
  }, [load]);

  const start = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);
    setError(null);
    let done = 0;
    let pts = 0;
    let total = view?.state.pending ?? 0;
    let refresh = true;
    setProgress({ done, total, pts });
    while (!cancelled.current) {
      const r = await api.seasonSync({ ...who, refresh });
      refresh = false;
      if (!r.ok) { setError(r.error); break; }
      if (r.ownClient !== undefined) self.setOwnClient(r.ownClient);
      done += r.fetched + r.failed;
      pts += r.pointsSpent;
      total = Math.max(total, done + r.state.pending);
      setProgress({ done, total, pts });
      await load();
      if (r.state.pending === 0 || r.fetched + r.failed === 0) break;
    }
    setRunning(false);
    setProgress(null);
  }, [payload, view, load, self]);

  return {
    view, loading, syncOpen, running, progress, error, start,
    openSync: () => setSyncOpen(true),
    closeSync: () => setSyncOpen(false),
    stop: () => { cancelled.current = true; },
  };
}
```

- [ ] **Step 2: `web/src/components/self/ResultHead.tsx`**

```tsx
import { className as classNameOf } from "@shared/wow/classes.ts";
import type { LookupPayload, MyCharacter, OwnClientView } from "../../types.ts";
import { realmName } from "../../lib/format.ts";
import { headLine, meChip, toggleMe } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import type { SeasonState } from "../../useSeason.ts";

/** What the self-review needs from App: the mode, the member's own client and their characters (Settings). */
export interface SelfActions {
  hosted: boolean;
  ownClient: OwnClientView | null;
  setOwnClient: (v: OwnClientView | null) => void;
  characters: MyCharacter[];
  setCharacters: (v: MyCharacter[]) => void;
}

/** Canvas SelfTabs header row: name, realm, "This is me", the season count and the sync button. */
export function ResultHead({ payload, season, self }: { payload: LookupPayload; season: SeasonState; self: SelfActions }) {
  const { t } = useT();
  const chip = meChip(t, self.characters, payload);
  const c = payload.character;
  return (
    <div className="result-head">
      <h2>{c.name}</h2>
      <span className="muted">{realmName(c.realmSlug)} · {c.region.toUpperCase()} · {classNameOf(c.classID)}</span>
      <button
        type="button" className={"chip" + (chip.on ? " chip-me" : "")} disabled={chip.disabled} title={chip.title}
        onClick={() => { const next = toggleMe(self.characters, payload); if (next) self.setCharacters(next); }}
      >
        {chip.label}
      </button>
      <div className="grow" />
      {season.view && <span className="muted" style={{ fontSize: 12 }}>{headLine(t, season.view)}</span>}
      <button type="button" className="btn btn-sm" disabled={season.running} onClick={season.syncOpen ? season.closeSync : season.openSync}>
        {t("self.head.sync")}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: `web/src/components/self/SyncCard.tsx`**

```tsx
import { syncCard, syncProgress } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import type { SeasonState } from "../../useSeason.ts";
import type { SelfActions } from "./ResultHead.tsx";

/** Canvas SelfDetails "SYNC": the estimate before spending, the progress, the no-client guide. */
export function SyncCard({ season, self }: { season: SeasonState; self: SelfActions }) {
  const { t } = useT();
  if (season.running && season.progress) {
    const p = season.progress;
    return (
      <section className="card sync-card">
        <span className="section-title">{t("self.sync.running")}</span>
        <span className="bar2 progress"><span style={{ width: `${p.total > 0 ? Math.round((p.done / p.total) * 100) : 0}%` }} /></span>
        <span className="muted" style={{ fontSize: 12 }}>{syncProgress(t, p)}</span>
        <div><button type="button" className="btn btn-sm" onClick={season.stop}>{t("self.sync.cancel")}</button></div>
      </section>
    );
  }
  const v = syncCard(t, season.view, self.hosted, self.ownClient);
  return (
    <section className="card sync-card">
      <span className="section-title">{t("self.sync.title")}</span>
      {v.kind === "noClient" && (
        <>
          <span className="pillar-text">{v.text}</span>
          <a href="/settings" style={{ fontSize: 13 }}>{v.link}</a>
          <span className="faint" style={{ fontSize: 12 }}>{v.without}</span>
        </>
      )}
      {v.kind === "nothing" && <span className="pillar-text">{v.text}</span>}
      {v.kind === "done" && (
        <>
          <span className="pillar-text">{v.text}</span>
          {v.failed && <span className="faint" style={{ fontSize: 12 }}>{v.failed}</span>}
        </>
      )}
      {v.kind === "ready" && (
        <>
          <span className="pillar-text">{v.found}</span>
          <span className="muted" style={{ fontSize: 12 }}>{v.cost}</span>
          <div className="section-row">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void season.start()}>{v.start}</button>
            <button type="button" className="btn btn-sm" onClick={season.closeSync}>{t("self.sync.cancel")}</button>
          </div>
        </>
      )}
      {season.error && <span className="tone-bad" style={{ fontSize: 12 }}>{t("self.sync.stopped", { error: season.error })}</span>}
    </section>
  );
}
```

`/settings` is a path, not copy (the existing account links use the same form; if `App` navigates through a helper rather than plain links, use that helper).

- [ ] **Step 4: Typecheck** — `bun run --cwd web typecheck` → PASS (the components are not mounted yet).

- [ ] **Step 5: Commit**

```bash
git add web/src/useSeason.ts web/src/components/self/ResultHead.tsx web/src/components/self/SyncCard.tsx
git commit -m "feat(web): season loading, sync loop and result header"
```

---

### Task 15: Overview tab

**Files:**
- Create: `web/src/components/self/Overview.tsx`

- [ ] **Step 1: `Overview.tsx`**

```tsx
import { useState } from "react";
import type { AxisKey, LookupPayload, SeasonView } from "../../types.ts";
import type { ReevalHint } from "../../lib/keyLevel.ts";
import { axisIsInformational } from "../../lib/help.ts";
import { basisText, pillarCards, verdictLine, workOnRows } from "../../lib/self.ts";
import type { PillarCard } from "../../lib/self.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { RioSection } from "../RioSection.tsx";
import { SignalTiles } from "../SignalTiles.tsx";
import { VerdictHero } from "../VerdictHero.tsx";

/** Canvas SelfTabs "Overview": work on first, the five pillars, the verdict line; today's verdict block below. */
export function Overview({ payload, season, hint, onReevaluate }: { payload: LookupPayload; season: SeasonView | null; hint: ReevalHint | null; onReevaluate: () => void }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const ev = payload.evaluation;
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const work = workOnRows(t, locale, ev, season, titleOf);
  const line = verdictLine(t, ev, (k) => (docs ? axisIsInformational(docs.config.axisWeights, k) : false));
  return (
    <>
      <section className="card work-on">
        <div className="section-row">
          <span className="section-title">{t("self.workOn.title")}</span>
          <span className="muted" style={{ fontSize: 12 }}>{t("self.workOn.sub", { basis: basisText(t, ev, season) })}</span>
        </div>
        {work.length === 0 ? <div className="muted">{t("self.workOn.none")}</div> : (
          <>
            <div className="work-on-row label-caps" style={{ padding: "2px 10px" }}>
              <span /><span>{t("self.workOn.point")}</span><span>{t("self.workOn.vsAvg")}</span><span>{t("self.workOn.vsPast")}</span>
            </div>
            {work.map((w) => (
              <div key={w.n} className="work-on-row inset">
                <span className="work-on-num">{w.n}</span>
                <span><b>{w.title}</b> <span className="faint">{w.pillar && <>· {w.pillar} </>}· {w.detail}</span></span>
                <span className="tone-bad">{w.impact}</span>
                <span className={w.past.cls}>{w.past.text}</span>
              </div>
            ))}
          </>
        )}
      </section>
      <div className="pillars">{pillarCards(t, locale, ev, season).map((c) => <Pillar key={c.key} c={c} />)}</div>
      <div className="muted verdict-line">
        {t("self.verdictLine")}
        <span className={"badge badge-sm " + line.badge.cls}>
          <span className="badge-label">{line.badge.label}</span>
          {line.badge.score !== null && <span className="badge-score mono">{line.badge.score}</span>}
        </span>
        {line.context && <span>· {line.context}</span>}
      </div>
      <VerdictHero payload={payload} hint={hint} onReevaluate={onReevaluate} />
      <div className="overview-rest">
        <SignalTiles payload={payload} />
        <RioSection payload={payload} />
      </div>
    </>
  );
}

function Pillar({ c }: { c: PillarCard }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="card pillar">
      <span className="label-caps">{c.title}</span>
      <span className={"pillar-score band-" + c.band}>{c.score}</span>
      <span className={"pillar-trend " + c.trend.cls}>{c.trend.text}</span>
      {c.bars.length > 0 && (
        <span className="wk">{c.bars.map((b, i) => <i key={i} className={(b.last ? "last" : "") + (b.empty ? " empty" : "")} style={{ height: b.px }} />)}</span>
      )}
      <span className="pillar-text">{c.sentence}</span>
      {c.lines.length > 2 && (
        <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}>{open ? t("self.pillar.hide") : t("self.pillar.details")}</button>
      )}
      {open && c.lines.slice(2).map((l, i) => <span key={i} className="pillar-text">{l}</span>)}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** — PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/self/Overview.tsx
git commit -m "feat(web): Overview tab (work on first, pillars, verdict line)"
```

---

### Task 16: Dungeons tab

**Files:**
- Create: `web/src/components/self/DungeonsTab.tsx`, `web/src/components/self/DungeonPanel.tsx`

- [ ] **Step 1: `DungeonPanel.tsx`**

```tsx
import type { PanelView } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { SpellLink } from "../SpellLink.tsx";

/** Canvas SelfDungeonFirst, right-hand panel: what hits, what kills, what went through, the link to the runs. */
export function DungeonPanel({ v, onRuns }: { v: PanelView; onRuns: () => void }) {
  const { t } = useT();
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="section-row">
        <span className="section-title">{v.title}</span>
        <span className="muted" style={{ fontSize: 12 }}>{v.sub}</span>
      </div>
      {v.empty ? <div className="muted">{t("self.panel.empty")}</div> : (
        <>
          <div className="label-caps">{t("self.panel.avoidable")}</div>
          {v.avoidable.map((a) => (
            <div key={a.id} className="ab-row"><SpellLink id={a.id} name={a.name} /><span className="bar2"><span style={{ width: `${a.width}%` }} /></span><span className="mono">{a.pct}</span></div>
          ))}
          {v.other && (
            <div className="ab-row"><span className="faint">{t("self.panel.other")}</span><span className="bar2"><span style={{ width: `${v.other.width}%` }} /></span><span className="mono">{v.other.pct}</span></div>
          )}
          <div className="label-caps" style={{ marginTop: 6 }}>{t("self.panel.killers")}</div>
          {v.killers.map((k) => <div key={k.ability} className="ab-row"><span>{k.ability}</span><span className="faint">{k.deaths}</span><span /></div>)}
          <div className="label-caps" style={{ marginTop: 6 }}>{t("self.panel.casts")}</div>
          <div className="faint" style={{ fontSize: 12 }}>{t("self.panel.castsNote")}</div>
          {v.casts.map((c) => <div key={c.id} className="ab-row"><SpellLink id={c.id} name={c.name} /><span className="faint">{c.ofText}</span><span className="mono">{c.mine}</span></div>)}
        </>
      )}
      <button type="button" className="link-btn" onClick={onRuns}>{v.runsLink}</button>
    </section>
  );
}
```

- [ ] **Step 2: `DungeonsTab.tsx`**

```tsx
import { Fragment, useState } from "react";
import type { AxisKey, LookupPayload, SeasonView } from "../../types.ts";
import { PILLAR_ORDER, dungeonPanel, dungeonRows, seasonHeader, workOnRows } from "../../lib/self.ts";
import { useDocs } from "../../docs.tsx";
import { useT } from "../../locale.tsx";
import { DungeonPanel } from "./DungeonPanel.tsx";

/** Canvas SelfDungeonFirst (variant C) inside variant A's tab: the grid, its season header row, the panel. */
export function DungeonsTab({ payload, season, loading, onRuns }: { payload: LookupPayload; season: SeasonView | null; loading: boolean; onRuns: (encounterID: number) => void }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const [sel, setSel] = useState<number | null>(null);
  if (loading) return <section className="card muted">{t("self.loading")}</section>;
  if (!season || season.dungeons.length === 0) return <section className="card muted">{t("self.sync.nothing")}</section>;
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const head = seasonHeader(t, season);
  const rows = dungeonRows(t, season);
  const selected = season.dungeons.find((d) => d.encounterID === sel) ?? season.dungeons[0]!;
  const work = workOnRows(t, locale, payload.evaluation, season, titleOf);
  return (
    <div className="side">
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="grid5">
          <span className="label-caps">{t("self.grid.season")}</span>
          {head.cells.map((c, i) => (
            <span key={i} className={"cell cell-big cell-" + c.band}>{c.text}{c.trend && <div className="pillar-trend">{c.trend}</div>}</span>
          ))}
          <span className={"cell cell-big cell-" + head.overall.band}>{head.overall.text}</span>
          <span className="muted mono">{head.runs}</span>
        </div>
        <div className="grid5">
          <span className="label-caps">{t("self.grid.dungeon")}</span>
          {PILLAR_ORDER.map((k) => <span key={k} className="label-caps" style={{ textAlign: "center" }}>{t(`self.pillars.${k}`)}</span>)}
          <span className="label-caps" style={{ textAlign: "center" }}>{t("self.grid.overall")}</span>
          <span className="label-caps">{t("self.grid.runs")}</span>
          {rows.map((r) => (
            <Fragment key={r.encounterID}>
              <button type="button" className={"grid5-name" + (r.encounterID === selected.encounterID ? " on" : "")} onClick={() => setSel(r.encounterID)}>{r.name}</button>
              {r.cells.map((c, i) => <span key={i} className={"cell cell-" + c.band}>{c.text}</span>)}
              <span className={"cell cell-" + r.overall.band}>{r.overall.text}</span>
              <span className="muted mono">{r.runs}</span>
            </Fragment>
          ))}
        </div>
        {work.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t("self.workOn.line", { list: work.map((w) => w.title).join(" · ") })}</div>}
      </section>
      <DungeonPanel v={dungeonPanel(t, locale, selected)} onRuns={() => onRuns(selected.encounterID)} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck** — PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/self/DungeonsTab.tsx web/src/components/self/DungeonPanel.tsx
git commit -m "feat(web): Dungeons tab (grid and detail panel)"
```

---

### Task 17: Runs tab, then the three tabs in `Detail`

**Files:**
- Create: `web/src/components/self/RunsTab.tsx`, `web/src/components/self/RunDetailExtra.tsx`
- Modify: `web/src/components/Detail.tsx`, `web/src/App.tsx`

- [ ] **Step 1: `RunDetailExtra.tsx`**

```tsx
import type { RunDetailView } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { SpellLink } from "../SpellLink.tsx";

/** Canvas SelfDetails "RUN DETAIL": killing hits, avoidable abilities, casts that went through. */
export function RunDetailExtra({ d }: { d: RunDetailView }) {
  const { t } = useT();
  return (
    <div className="run-detail">
      <div>
        {d.deaths.length === 0 && <div className="faint">{t("self.detail.noDeath")}</div>}
        {d.deaths.map((x, i) => (
          <div key={i}>
            <div className="label-caps" style={{ marginBottom: 4 }}>{x.title}</div>
            {x.hits.map((h, j) => <div key={j} className="ab-row"><span>{h.ability}</span><span className="faint">{h.share}</span><span /></div>)}
          </div>
        ))}
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>{t("self.detail.avoidable")}</div>
        {d.avoidable.map((a) => <div key={a.key} className="ab-row"><span>{a.name}</span><span className="faint">{a.amount}</span><span /></div>)}
      </div>
      <div>
        <div className="label-caps" style={{ marginBottom: 4 }}>{t("self.detail.casts")}</div>
        {d.casts.map((c) => <div key={c.id} className="ab-row"><SpellLink id={c.id} name={c.name} /><span className="faint">{c.ofText}</span><span /></div>)}
        {d.kicked && <div className="faint" style={{ fontSize: 12 }}>{d.kicked}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `RunsTab.tsx`**

```tsx
import { Fragment, useState } from "react";
import type { LookupPayload, SeasonView } from "../../types.ts";
import { costText } from "../../lib/deepdive.ts";
import { rowOf } from "../../lib/runs.ts";
import { runDetail, runOf } from "../../lib/self.ts";
import { useT } from "../../locale.tsx";
import { track } from "../../usage.ts";
import type { DeepdiveActions } from "../Detail.tsx";
import { DungeonRuns } from "../DungeonRuns.tsx";
import { RunDeepDive } from "../RunDeepDive.tsx";
import { RunDetailExtra } from "./RunDetailExtra.tsx";

/** Today's list (best run per dungeon) until the season store has runs; then every run of the season, newest first. */
export function RunsTab({ payload, season, deepdive, encounterID, onClearFilter }: {
  payload: LookupPayload; season: SeasonView | null; deepdive: DeepdiveActions; encounterID: number | null; onClearFilter: () => void;
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (!season || season.runs.length === 0) return <DungeonRuns payload={payload} deepdive={deepdive} />;
  const now = Date.now();
  const runs = season.runs.filter((r) => encounterID === null || r.encounterID === encounterID);
  const filterName = encounterID === null ? null : season.dungeons.find((d) => d.encounterID === encounterID)?.name ?? null;
  return (
    <section className="card section">
      <div className="section-row">
        <span className="section-title">{t("self.runs.title")}</span>
        {filterName && <button type="button" className="chip chip-on" onClick={onClearFilter}>{t("self.runs.filter", { name: filterName })}</button>}
        <span className="muted">{t("self.runs.count", { count: runs.length })}</span>
      </div>
      <div className="runs">
        {runs.map((v) => {
          const r = rowOf(t, runOf(v), v.metric, now);
          const expanded = open === v.key;
          const d = expanded ? runDetail(t, locale, v) : null;
          const a = v.analysis;
          return (
            <Fragment key={v.key}>
              <div className="run inset">
                <div>
                  <span className="mono level">+{r.level}</span>{" "}
                  {r.keystone && <span className={r.keystone.timed ? "tone-good" : "tone-bad"} style={{ fontSize: 12 }}>{r.keystone.text}</span>}
                </div>
                <div className="run-main">
                  {r.dungeon}
                  {r.parts.length > 0 && <span className="run-signals">{r.parts.map((p, i) => <span key={i}> · <span className={p.cls}>{p.text}</span></span>)}</span>}
                </div>
                <div className="mono">{r.amount} <span className="muted" style={{ fontSize: 11 }}>{r.metric}</span></div>
                <div className={"mono " + r.parseCls} style={{ fontWeight: 600 }}>{r.parse}</div>
                <div className="muted">{r.spec}</div>
                <div className={r.stale ? "tone-warn" : "muted"}>{r.age}</div>
                {v.signals ? (
                  <button type="button" className={"btn btn-sm" + (expanded ? " active" : "")} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : v.key)}>
                    {expanded ? t("self.runs.hide") : t("self.runs.details")}
                  </button>
                ) : (
                  <span className="faint" title={v.failed ? t("self.runs.failed") : undefined}>{t("self.runs.notAnalysed")}</span>
                )}
                <a href={r.url} target="_blank" rel="noopener" title={t("runs.openLog")} onClick={() => track("external_log")}>↗</a>
              </div>
              {expanded && d && <RunDetailExtra d={d} />}
              {expanded && v.signals && a && (
                <RunDeepDive
                  d={a} tableWarning={payload.deepdiveSummary.tableWarning} busy={deepdive.analyzing !== null} canAfford={deepdive.canAfford(1)}
                  quotaTooltip={deepdive.quotaTooltip} mode={deepdive.mode}
                  onReanalyze={() => void deepdive.analyze(v, true)} onPatch={(patch) => deepdive.patch(a.className, a.spec, patch)}
                />
              )}
              {expanded && v.signals && !a && (
                <div style={{ padding: "0 10px 8px" }}>
                  <button
                    type="button" className="btn btn-sm" disabled={deepdive.analyzing !== null || !deepdive.canAfford(1)}
                    title={deepdive.canAfford(1) ? undefined : deepdive.quotaTooltip} onClick={() => void deepdive.analyze(v)}
                  >
                    {deepdive.analyzing === v.key ? <span className="spinner" /> : null} {t("runs.analyze", { cost: costText(t, 1) })}
                  </button>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: `Detail.tsx`** — replace the `Detail` function and `DetailProps` (keep `DeepdiveActions` as it is):

```tsx
import { useState } from "react";
import type { LookupPayload, OverrideEntry } from "../types.ts";
import type { ReevalHint } from "../lib/keyLevel.ts";
import type { ProposalMode } from "../lib/hostedMode.ts";
import { RESULT_TABS, type ResultTab } from "../lib/self.ts";
import { useT } from "../locale.tsx";
import { track } from "../usage.ts";
import { useSeason } from "../useSeason.ts";
import { DungeonsTab } from "./self/DungeonsTab.tsx";
import { Overview } from "./self/Overview.tsx";
import { ResultHead, type SelfActions } from "./self/ResultHead.tsx";
import { RunsTab } from "./self/RunsTab.tsx";
import { SyncCard } from "./self/SyncCard.tsx";

// (DeepdiveActions unchanged)

export interface DetailProps { payload: LookupPayload; hint: ReevalHint | null; onReevaluate: () => void; deepdive: DeepdiveActions; self: SelfActions }

/** The result page: header, three tabs (canvas "self-review", variants A + C). */
export function Detail({ payload, hint, onReevaluate, deepdive, self }: DetailProps) {
  const { t } = useT();
  const [tab, setTab] = useState<ResultTab>("overview");
  const [runsOf, setRunsOf] = useState<number | null>(null);
  const season = useSeason(payload, self);
  const pick = (next: ResultTab) => {
    if (next === "dungeons") track("self_tab_dungeons");
    if (next === "runs") track("self_tab_runs");
    setTab(next);
  };
  return (
    <>
      <ResultHead payload={payload} season={season} self={self} />
      {season.syncOpen && <SyncCard season={season} self={self} />}
      <div className="rtabs" role="tablist">
        {RESULT_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={"rtab" + (tab === k ? " on" : "")} onClick={() => pick(k)}>
            {t(`self.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview payload={payload} season={season.view} hint={hint} onReevaluate={onReevaluate} />}
      {tab === "dungeons" && (
        <DungeonsTab payload={payload} season={season.view} loading={season.loading} onRuns={(id) => { setRunsOf(id); pick("runs"); }} />
      )}
      {tab === "runs" && (
        <RunsTab payload={payload} season={season.view} deepdive={deepdive} encounterID={runsOf} onClearFilter={() => setRunsOf(null)} />
      )}
    </>
  );
}
```

The imports of `DungeonRuns`, `RioSection`, `SignalTiles` and `VerdictHero` leave `Detail.tsx` (they are used by the tab components). The `.detail-rest` rules stay in `app.css` until no component uses them (`grep -rn detail-rest web/src`); remove them in this commit if the grep is empty.

- [ ] **Step 4: `App.tsx`** — build the `SelfActions` next to `deepdiveActions` and pass it:

```tsx
  const selfActions: SelfActions = {
    hosted: status.hosted,
    ownClient,
    setOwnClient,
    characters: settings.characters,
    setCharacters: (characters) => updateSettings({ characters }),
  };
```

(`import type { SelfActions } from "./components/self/ResultHead.tsx";`) and `<Detail … deepdive={deepdiveActions} self={selfActions} />`.

- [ ] **Step 5: Run** — `bun test`, both typechecks, then `just build && ./bmpl serve` (or `bun run --cwd web build` then `bun src/cli.ts serve --no-open`) and check by hand on a looked-up character: the three tabs, the "This is me" toggle surviving a reload (local: `bmpl.characters`), the Dungeons grid and panel, the Runs list before and after a sync, the sync card's three states (local mode shows "ready"; hosted without a client shows the guide). Screenshots for the user (browser tools), then remove `web/dist` before the final test run.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/self/RunsTab.tsx web/src/components/self/RunDetailExtra.tsx web/src/components/Detail.tsx web/src/App.tsx web/src/styles/app.css
git commit -m "feat(web): result page in three tabs (Overview, Dungeons, Runs)"
```

---

### Task 18: The pillars on `/help`

**Files:**
- Modify: `src/evaluation/docs.ts`, `src/evaluation/docs.fr.ts`, `src/server/routes-shared.ts` (`DocsResponse`), `web/src/lib/help.ts`, `web/src/lib/help.test.ts`, `web/src/components/help/HelpPage.tsx`
- Test: `test/evaluation/docs.test.ts`, `test/server-docs.test.ts`

**Interfaces:**
- Produces: `EvaluationDocs.pillars: { intro: string; items: Record<PillarKey, { title: string; what: string }> }`; `DocsResponse.pillarSources: Record<PillarKey, readonly string[]>`; toc anchor `pillars` after the six axis entries.

- [ ] **Step 1: Failing tests**

`test/evaluation/docs.test.ts`:

```ts
import { PILLAR_KEYS } from "../../src/evaluation/types.ts";
test("every pillar has prose in both languages", () => {
  for (const docs of [EVALUATION_DOCS, EVALUATION_DOCS_FR]) {
    expect(Object.keys(docs.pillars.items).sort()).toEqual([...PILLAR_KEYS].sort());
    nonEmpty(docs.pillars, "pillars");
  }
});
```

`test/server-docs.test.ts` (in the test that reads `GET /api/docs`): `expect(body.pillarSources.control).toEqual(["utility.dispels"]);`.

`web/src/lib/help.test.ts`, the toc order test: insert `"pillars"` after `"axis-experience"` in the anchors and `"The five pillars"` after `"The six axes"` in the non-sub labels.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Prose** — `EvaluationDocs` gains `pillars: { intro: string; items: Record<PillarKey, { title: string; what: string }> };` (`import type { PillarKey } from "./types.ts";`). English:

```ts
  pillars: {
    intro: "The same sub-signals, grouped by what a player can work on: five pillars. A pillar's score is the weighted mean of its sub-signals, with the same curves and weights as the axes, so it never changes the verdict. Preparation, consistency and experience stay beside the pillars as context.",
    items: {
      damage: { title: "Damage", what: "Your parse: the median over the runs, and at the key level asked for." },
      survival: { title: "Survival", what: "Deaths outside wipes, deaths in wipes, teammates' deaths for a healer, and, once runs are analysed, the defensives you used and the deaths you could have prevented. A death's last three hits are listed in its run." },
      avoidable: { title: "Avoidable damage", what: "Damage from the season's avoidable mechanics and damage taken overall, against the other players of the same runs. The abilities that hit you most are listed per dungeon." },
      interrupts: { title: "Interrupts", what: "The share of your kick's cooldown you use, against the group and on its own. The enemy casts that went through are shown as group context, among the spells your group kicked at least once." },
      control: { title: "Control", what: "Dispels and purges per run, for a kit that has one; n/a otherwise, never 0. Crowd control (stuns, incapacitates, knock-backs) comes in a later phase." },
    },
  },
```

French (`docs.fr.ts`):

```ts
  pillars: {
    intro: "Les mêmes sous-signaux, regroupés selon ce qu'un joueur peut travailler : cinq piliers. Le score d'un pilier est la moyenne pondérée de ses sous-signaux, avec les mêmes courbes et les mêmes poids que les axes : il ne change jamais le verdict. Préparation, régularité et expérience restent à côté des piliers, comme contexte.",
    items: {
      damage: { title: "Dégâts", what: "Ton parse : la médiane des runs, et celle au niveau de clé demandé." },
      survival: { title: "Survie", what: "Les morts hors wipe, les morts en wipe, les morts des coéquipiers pour un soigneur et, une fois les runs analysés, les défensifs utilisés et les morts évitables. Les trois derniers coups de chaque mort sont listés dans son run." },
      avoidable: { title: "Dégâts évitables", what: "Les dégâts des mécaniques évitables de la saison et les dégâts subis au total, face aux autres joueurs des mêmes runs. Les capacités qui te touchent le plus sont listées par donjon." },
      interrupts: { title: "Interruptions", what: "La part du temps de recharge de ton interruption que tu utilises, face au groupe et en valeur absolue. Les sorts ennemis passés sont montrés comme contexte du groupe, parmi les sorts que ton groupe a interrompus au moins une fois." },
      control: { title: "Contrôle", what: "Les dispels et purges par run, pour un kit qui en a ; n/a sinon, jamais 0. Le contrôle des foules (étourdissements, incapacités, repoussements) viendra dans une phase suivante." },
    },
  },
```

(Use the axis names as `docs.fr.ts` already spells them for "Préparation", "régularité" (consistency) and "expérience"; align if it uses other words.)

- [ ] **Step 4: `pillarSources` in `/api/docs`** — `src/server/routes-shared.ts`: `DocsResponse` gains `pillarSources: Record<PillarKey, readonly string[]>;` and `docsResponse` returns `pillarSources: PILLAR_SOURCES,` (`import { PILLAR_SOURCES } from "../evaluation/pillars.ts";`, `import type { PillarKey } from "../evaluation/types.ts";`).

- [ ] **Step 5: Front** — `web/src/lib/help.ts` `toc`: after the `...AXIS_ORDER.map(…)` line, `{ anchor: "pillars", label: t("help.toc.pillars") },`. `web/src/components/help/HelpPage.tsx`: after the axis sections, a `Pillars` section:

```tsx
function Pillars({ t, data }: SectionProps) {
  const title = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return data.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  return (
    <section className="card help-card" id="pillars">
      <h2>{t("help.toc.pillars")}</h2>
      <p className="help-p">{data.docs.pillars.intro}</p>
      {PILLAR_ORDER.map((k) => (
        <div key={k} className="help-p">
          <b>{data.docs.pillars.items[k].title}</b> · {data.docs.pillars.items[k].what}
          <div className="faint" style={{ fontSize: 12 }}>{data.pillarSources[k].map(title).join(" · ")}</div>
        </div>
      ))}
    </section>
  );
}
```

(`PILLAR_ORDER` from `../../lib/self.ts`; `SectionProps` and `AxisKey` as the file already has them.) Render `<Pillars t={t} data={data} />` right after the axis sections.

- [ ] **Step 6: Run** — `bun test` and both typechecks → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/evaluation/docs.ts src/evaluation/docs.fr.ts src/server/routes-shared.ts web/src/lib/help.ts web/src/lib/help.test.ts web/src/components/help/HelpPage.tsx test/evaluation/docs.test.ts test/server-docs.test.ts
git commit -m "docs(help): the five pillars on /help"
```

---
### Task 19: Canvas — the personal page (gate)

The personal page (spec decision 8) is a visible UI with no mock-up yet. Nothing is coded for it before the user picks a variant.

**Files:**
- Modify: `docs/design/canvas/canvas.json`; create `docs/design/canvas/Me*.dc.html` (one per variant, plus a details board)

- [ ] **Step 1: Read the live canvas first** (`Artifact` read of https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s), in case the user edited it in the GUI; merge from that version.

- [ ] **Step 2: Three variants on a new canvas page "me"** (process: `docs/agents/web-front.md`, "Design first"; values lifted from `app.css` and `tokens.css`, never rounded):
  - **A · List:** one card per character (name in class colour, realm, region, main badge on the first), its season line ("142 runs · 118 not analysed · checked 2 h ago"), the five pillar scores of the 4-week window in small cells, buttons Open (from history, 0 pts, else a lookup with its cost shown) and Sync season; "Add a character" (name-realm field, manual) and remove/reorder controls; the Battle.net placeholder line ("Link Battle.net: coming next").
  - **B · Table:** one row per character with the same columns, the pillar cells coloured as in the Dungeons grid, actions at the end of the row; the add field above the table.
  - **C · Main first:** the main character as a large card (its Overview pillars and trends), the others as compact rows beneath.
  - **Details board:** the empty state (no character yet: how to add one, "This is me" on a result page), the full state (5 characters), local mode (no account: the list lives in this browser), the header link "My characters", the home page card for the main character ("Open Muleyoxo · from history, 0 pts").

- [ ] **Step 3: Publish** the same artifact with the new page, copy the sources back into `docs/design/canvas/`, commit:

```bash
git add docs/design/canvas/canvas.json docs/design/canvas/Me*.dc.html
git commit -m "docs: personal page canvas variants"
```

- [ ] **Step 4: Stop and ask the user** which variant (or combination) to build. Record the choice in the spec (decision 8: "canvas variant … chosen <date>").

---

### Task 20: The personal page (written once Task 19's choice is made)

What is already fixed, whatever the variant:
- Route `/me` through `pageOf` (`web/src/lib/hostedMode.ts`), readable in both modes; a header link "My characters" and, hosted, an entry in the user menu.
- Data: `settings.characters` (Task 9 and 10) for the list; `GET /api/season` per character (0 pts) for the season line and the pillar cells; the history (`GET /api/history`, `api.historyEntry`) to open a character at 0 pts; opening a character absent from history is an explicit lookup click, with its cost stated as the search form does.
- Adding by hand goes through `toggleMe`'s rules (`MAX_ME = 5`, `source: "manual"`); removing and reordering write `settings.characters`. The first entry is the main character.
- The home page offers to open the main character (from history at 0 pts); it never starts a lookup by itself.
- View models in `web/src/lib/me.ts` with `me.test.ts` (English plus one French assertion per prose function); strings under a new `me` section of `en.ts`/`fr.ts`.

This task is written in the same format as Tasks 10–17 (exact code, tests, commands) right after the choice, and appended here before it is executed.

---

### Task 21: Docs, live verification, issue #24

**Files:**
- Modify: `docs/agents/architecture.md`, `docs/agents/web-front.md`, `docs/agents/workflow.md`, `docs/scoring.md`, `docs/hosted.md`, `README.md`, `AGENTS.md`, `src/evaluation/docs.ts` and `docs.fr.ts` (sources text), the spec's status line

- [ ] **Step 1: Developer docs**
  - `docs/agents/architecture.md`: in "Data flow of a lookup", the `upsertSeasonRuns` step after the rankings (0 pts); in "SQLite cache", a `character_runs` row (key `(region, realm, name, report_code, fight_id)`, every ranked run of a character's lookups, kept for the season); a new section "Self-review — `src/self/`" (`weeks.ts`, `sync.ts`, `season.ts`, `characters.ts`, the two routes, the own-client rule, the batch and retry numbers); `/api/season` and `/api/season/sync` in the Server paragraph's route list; in "Invariants", "A season sync, hosted, runs only on the member's own WCL client; the rankings a lookup fetched are recorded at 0 extra points".
  - `docs/agents/web-front.md`: `lib/self.ts` in the view-model list, `useSeason.ts`, `components/self/*` in the components map, `Settings.characters` / `bmpl.characters` in the Settings rule; the canvas page "self-review" in "Design first".
  - `docs/agents/workflow.md` "Roadmap pointer" and `AGENTS.md` "Current state and roadmap" / "Where things are" (`src/self/`): self-review phase 1 shipped; phases 2 and 3 and Battle.net linking are the next pieces, issue #24 for the WCL items.
- [ ] **Step 2: User docs**
  - `docs/scoring.md#api-cost`: a season sync costs the rankings (21 pts measured, `ESTIMATE_RANKINGS` 20) plus 7.3–7.9 pts per run measured (`ESTIMATE_RUN` 10 stays the estimate), batches of 10, own client when hosted; a lookup now records the season's ranked runs at no extra cost.
  - `docs/hosted.md`: route table rows for `GET /api/season` and `POST /api/season/sync`; `characters` in the `PUT /api/settings` row.
  - `README.md`: one line on the three tabs and the season sync.
  - `src/evaluation/docs.ts` / `docs.fr.ts`, `sources[0]`: the rankings list every ranked run of the season; the run table still shows the best per dungeon on the Overview, every run on the Runs tab once synced.
  - The spec's status line: "Phase 1 implemented <date>".
- [ ] **Step 3: Live verification (spends WCL points; the user agreed to spend for checks, budget 18 000 pts/h on the env client)** — on a scratch database (`BMPL_DB_PATH` in the scratchpad), local mode:
  1. `bun src/cli.ts serve --no-open --port 3100`, then `POST /api/lookup` for `Noshiidk-Draenor` (rankings ~21 pts, displayed runs ~10 each): `GET /api/season` lists 100+ runs, about 8 analysed.
  2. `POST /api/season/sync` with `refresh: true`, then without, twice: record `pointsSpent` per batch against 10 × 10 pts; stop.
  3. Resume: the next `POST /api/season/sync` fetches only runs that are not in `wcl_run_raw` (check `fetched` and the `wcl_run_raw` count), no double spend.
  4. Hosted path: a script in the scratchpad starts `runServer({ hosted: true, hostedConfig: { …, encryptionKey } })`, logs a member in with `test/hosted/helpers.ts`' `loginAs`, saves the env credentials as that member's own client (`PUT /api/me/wcl-client`, real PING), runs one sync batch, and checks `usage_hourly` unchanged and `usage_hourly_own` charged.
  5. Time `GET /api/season` on the synced character (target: well under a second).
  Report the numbers to the user, tick issue #24 § 2 with them, and never print or write the credentials.
- [ ] **Step 4: Final gate** — `web/dist` removed, `bun test`, both typechecks; then one whole-branch review (`docs/agents/workflow.md`, "Execute with subagents"), findings fixed, deferred minors listed in the report.
- [ ] **Step 5: Commit**

```bash
git add docs/agents/architecture.md docs/agents/web-front.md docs/agents/workflow.md docs/scoring.md docs/hosted.md README.md AGENTS.md src/evaluation/docs.ts src/evaluation/docs.fr.ts docs/superpowers/specs/2026-10-09-self-review-pillars-design.md
git commit -m "docs: self-review phase 1"
```

## Out of this plan

- Phase 2 (Control: crowd control) and phase 3 (useful damage): own specs, issue #24 §§ 4–5.
- Battle.net linking and the owner-only question: own spec (spec decision 1, open question 2).
- A CLI view of the season: not asked for; `bmpl lookup` keeps its output, `--json` gains `evaluation.pillars` by construction.
