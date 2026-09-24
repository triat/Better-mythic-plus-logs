# Score drivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, under the verdict badge, which signals cost or earn the player points in the badge's own units ("−19 Individual deaths 1.6 / run · avg 0.7") as diverging bars, plus what it takes to reach the next verdict.

**Architecture:** `evaluate()` recomputes the final global score once per sub-signal with that sub-signal's curve input replaced by the role's median ("average player", stored in the config as `reference`), and the difference is the driver's impact; a greedy pass over the costs gives the path to the next verdict. The web front renders `Evaluation.drivers` / `nextVerdict` through a pure view model and a thin component; the CLI prints the same lines.

**Tech Stack:** Bun + TypeScript strict (`src/`), Vite + React 19 (`web/`), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-24-score-drivers-design.md` (canvas variant B: `docs/design/canvas/ScoreDriversBars.dc.html`, `ScoreDriversEdgeCases.dc.html`).

## Global Constraints

- `just check` and `bun test` green after every task, with `web/dist` absent for the final run.
- Tests never reach WCL; this feature spends 0 WCL points.
- English in code/docs/commits; every UI string in `web/src/i18n/en.ts`, mirrored key for key in `fr.ts`; no UI literal in a component.
- `web/` imports from `src/` are `import type` only.
- Colours/radii/fonts only from `web/src/styles/tokens.css` variables.
- "Average player" = the role's **median** of the calibration population; UI says "avg" / "average player" ("moy." / "joueur moyen").
- Drivers keep `|impact| ≥ 1`; the view shows at most 3 costs + 2 strengths; path uses at most **3** signals; bars **6 px per point, capped at 150 px**.
- `default-config.json` `version` becomes `"3"`.
- Stage files explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env*`, `bmpl.db*`, `.calibration/`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`.

---

### Task 1: Curve-input override and the `reference` config key

**Files:**
- Modify: `src/evaluation/axis.ts` (`scoreAxis`)
- Modify: `src/evaluation/axes/{survival,utility,throughput,consistency,preparation,experience}.ts`, `src/evaluation/axes/index.ts`
- Modify: `src/evaluation/types.ts`, `src/evaluation/config.ts`, `src/evaluation/default-config.json`
- Modify: `scripts/calibration/fit-global.ts`
- Test: `test/evaluation/axes.test.ts`, `test/evaluation/config.test.ts`

**Interfaces:**
- Produces: `type Override = Readonly<Record<string, number>>` (exported from `axis.ts`); `scoreAxis(key, subs, role, cfg, runsUsed, override?: Override)`; every `scoreX(i, cfg, override?: Override)`; `scoreAllAxes(i, cfg, override?: Override)`; `EvaluationConfig.reference: Record<Role, Record<string, { x: number; value: number }>>`.

- [ ] **Step 1: Failing tests**

In `test/evaluation/axes.test.ts` add:

```ts
import { scoreAxis } from "../../src/evaluation/axis.ts";

describe("scoreAxis override", () => {
  const subs = [
    { id: "individualDeaths", value: 2, label: (r: number) => `${r}` },
    { id: "wipeDeaths", value: 1, label: (r: number) => `${r}` },
  ];
  test("replaces only the named sub-signal's curve input", () => {
    const base = scoreAxis("survival", subs, "dps", cfg, 6);
    const over = scoreAxis("survival", subs, "dps", cfg, 6, { "survival.individualDeaths": 0 });
    const get = (a: typeof base, s: string) => a.evidence.find((e) => e.source === s)!;
    expect(get(over, "survival.individualDeaths").delta).toBeGreaterThan(get(base, "survival.individualDeaths").delta);
    expect(get(over, "survival.wipeDeaths").delta).toBeCloseTo(get(base, "survival.wipeDeaths").delta, 6);
    expect(get(over, "survival.individualDeaths").value).toBe(2); // the evidence still reports the actual value
    expect(over.score!).toBeGreaterThan(base.score!);
  });
});
```

(`cfg` is the file's existing `validateConfig(DEFAULT_CONFIG)`; add it if the file names it differently.)

In `test/evaluation/config.test.ts`, inside `describe("validateConfig", …)`:

```ts
  test("reference: every role, known sources, finite x and value", () => {
    const cfg = validateConfig(DEFAULT_CONFIG);
    for (const role of ["dps", "healer", "tank"] as const) {
      expect(cfg.reference[role]["survival.individualDeaths"]).toBeDefined();
      expect(cfg.reference[role]["survival.defensiveUsage"]).toBeUndefined(); // no deep-dive in the calibration sample
    }
    const unknown = deepMerge(DEFAULT_CONFIG, { reference: { dps: { "survival.nope": { x: 1, value: 1 } } } });
    expect(() => validateConfig(unknown)).toThrow(/reference\.dps\.survival\.nope: unknown source/);
    const missing = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, Record<string, unknown>>;
    delete missing.reference!.healer;
    expect(() => validateConfig(missing)).toThrow(/reference\.healer: missing/);
    const nan = deepMerge(DEFAULT_CONFIG, { reference: { tank: { "utility.dispels": { x: "a", value: 1 } } } });
    expect(() => validateConfig(nan)).toThrow(/reference\.tank\.utility\.dispels\.x/);
  });
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test test/evaluation/axes.test.ts test/evaluation/config.test.ts`
Expected: FAIL (`scoreAxis` ignores the 6th argument; `cfg.reference` undefined).

- [ ] **Step 3: Implement the override**

`src/evaluation/axis.ts`:

```ts
/** Curve inputs to use instead of the player's, by source ("survival.individualDeaths"): the score drivers'
 * "what if this signal were the average player's" (docs/superpowers/specs/2026-09-24-score-drivers-design.md). */
export type Override = Readonly<Record<string, number>>;
```

Change the signature to `scoreAxis(key: AxisKey, subs: SubSignalInput[], role: Role, cfg: EvaluationConfig, runsUsed: number, override?: Override)` and the curve line to:

```ts
    const source = `${key}.${sub.id}`;
    const x = override?.[source] ?? (sub.x ? sub.x(sub.value) : sub.value);
    const s = curve(x, sc.curve);
```

(use `source` in the `contributing.push` too). Each axis file: add `override?: Override` as the third parameter (`import type { Override } from "../axis.ts";`) and pass it as the last argument of its `scoreAxis(...)` call. `axes/index.ts`:

```ts
export const scoreAllAxes = (i: EvalInputs, cfg: EvaluationConfig, override?: Override): AxisScore[] => [
  scoreSurvival(i, cfg, override), scoreUtility(i, cfg, override), scoreThroughput(i, cfg, override),
  scoreConsistency(i, cfg, override), scorePreparation(i, cfg, override), scoreExperience(i, cfg, override),
];
```

- [ ] **Step 4: The `reference` key**

`types.ts`, in `EvaluationConfig` after `globalCurve`:

```ts
  /**
   * Per role, the calibration population's median ("the average player") of each sub-signal: `x` the curve
   * input, `value` the display value (`Evidence.value`). Feeds the score drivers; a source may be absent.
   */
  reference: Record<Role, Record<string, { x: number; value: number }>>;
```

`config.ts`: add `"reference"` to the top-level `expectKeys` list (after `"globalCurve"`), then before the verdict block:

```ts
  if (!isObj(obj.reference)) fail("reference", "must be an object");
  expectKeys(obj.reference as Record<string, unknown>, ROLES, "reference");
  const known = new Set(AXIS_KEYS.flatMap((k) => Object.keys(defaultAxes[k].subSignals).map((id) => `${k}.${id}`)));
  const finite = (v: unknown, path: string): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fail(path, "must be a finite number");
  const reference = {} as EvaluationConfig["reference"];
  for (const r of ROLES) {
    const byRole = (obj.reference as Record<string, unknown>)[r];
    if (!isObj(byRole)) fail(`reference.${r}`, "must be an object");
    reference[r] = {};
    for (const [src, ref] of Object.entries(byRole as Record<string, unknown>)) {
      const p = `reference.${r}.${src}`;
      if (!known.has(src)) fail(p, "unknown source");
      if (!isObj(ref)) fail(p, "must be an object");
      expectKeys(ref as Record<string, unknown>, ["x", "value"], p);
      reference[r][src] = { x: finite((ref as Record<string, unknown>).x, `${p}.x`), value: finite((ref as Record<string, unknown>).value, `${p}.value`) };
    }
  }
```

and add `reference` to the returned object. Note: `expectKeys` reports a missing role as `reference.healer: missing`.

- [ ] **Step 5: Fit the references**

In `scripts/calibration/fit-global.ts`, after the `globalCurve` loop, compute per role the median `x` of each configured source (`curveInputs(s.payload, cfg)` from `./analyze.ts`, keys already `axis.id`, `experience.prevSeasonBonus` never included) and the median `value` of the evidence entries with that source (`evaluate(s.payload, cfg).axes.flatMap((a) => a.evidence)`), both with `quantile(xs, 0.5)`, rounded to 4 decimals; skip a source with fewer than 40 values; print `JSON.stringify({ globalCurve, reference })`. Update the file's header comment to say it prints both. Run it:

Run: `bun scripts/calibration/fit-global.ts`
Expected: the same `globalCurve` as in `default-config.json` today, plus a `reference` object with three roles and no `survival.defensiveUsage` / `survival.avoidableDeaths`.

Paste `reference` into `src/evaluation/default-config.json` after `globalCurve` (one line per role is fine), and set `"version": "3"`.

- [ ] **Step 6: Run the tests**

Run: `bun test test/evaluation && just check`
Expected: PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add src/evaluation/axis.ts src/evaluation/axes src/evaluation/types.ts src/evaluation/config.ts src/evaluation/default-config.json scripts/calibration/fit-global.ts test/evaluation/axes.test.ts test/evaluation/config.test.ts
git commit -m "feat(evaluation): curve-input override and the average player's reference values"
```

---

### Task 2: Drivers and the path to the next verdict in `evaluate()`

**Files:**
- Create: `src/evaluation/global.ts`, `src/evaluation/drivers.ts`
- Modify: `src/evaluation/evaluate.ts`, `src/evaluation/types.ts`
- Test: `test/evaluation/drivers.test.ts` (create)

**Interfaces:**
- Consumes: `Override`, `scoreAllAxes(i, cfg, override?)`, `cfg.reference` (Task 1).
- Produces:
  - `globalScore(axes, role, cfg): number | null` moved to `global.ts` (still re-exported by `evaluate.ts`), plus `finalGlobal(axes: AxisScore[], role: Role, cfg: EvaluationConfig): number | null` = `Math.round(curve(globalScore, cfg.globalCurve[role]))`.
  - `types.ts`: `interface Driver { source: string; impact: number; value: number; reference: number; label: string }`, `interface NextVerdict { verdict: "maybe" | "invite"; threshold: number; sources: string[]; score: number; reachable: boolean }`, and on `Evaluation`: `drivers?: Driver[]; nextVerdict?: NextVerdict | null;`.
  - `drivers.ts`: `scoreDrivers(inputs: EvalInputs, axes: AxisScore[], global: number, verdict: Verdict, cfg: EvaluationConfig): { drivers: Driver[]; nextVerdict: NextVerdict | null }`.

- [ ] **Step 1: Failing tests** — `test/evaluation/drivers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, deepMerge, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import { deaths, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const run = (d: number, parse: number) => runWith({
  deaths: deaths(d), consumables: { potions: 4, healthstones: 1 },
  avoidableDamage: { total: 0, perMinute: 100, peer: { median: 100, count: 4 }, spellCount: 10 },
}, { parsePercent: parse, keyLevel: 16 });
const payload = (d: number, parse: number) => payloadWith(Array.from({ length: 8 }, () => run(d, parse)), { targetLevel: 16 });

describe("score drivers", () => {
  test("dying more than the average player costs points, dying less earns them", () => {
    const bad = evaluate(payload(3, 60), cfg).drivers!.find((d) => d.source === "survival.individualDeaths")!;
    const good = evaluate(payload(0, 60), cfg).drivers!.find((d) => d.source === "survival.individualDeaths")!;
    expect(bad.impact).toBeLessThan(0);
    expect(good.impact).toBeGreaterThan(0);
    expect(bad.value).toBeCloseTo(3, 6);
    expect(bad.reference).toBe(cfg.reference.dps["survival.individualDeaths"]!.value);
    expect(bad.label).toContain("individual deaths");
  });

  test("no impact when the reference is where the curve cannot tell the difference", () => {
    // A flat curve scores every input the same, so replacing the input by the reference changes nothing.
    const flat = validateConfig(deepMerge(DEFAULT_CONFIG, { axes: { survival: { subSignals: { individualDeaths: { curve: [[0, 60], [10, 60]] } } } } }));
    expect(evaluate(payload(3, 60), flat).drivers!.some((d) => d.source === "survival.individualDeaths")).toBe(false);
  });

  test("sorted costs first, only |impact| ≥ 1, no deep-dive or informational source", () => {
    const ds = evaluate(payload(3, 30), cfg).drivers!;
    expect(ds.length).toBeGreaterThan(0);
    for (let i = 1; i < ds.length; i++) expect(ds[i]!.impact).toBeGreaterThanOrEqual(ds[i - 1]!.impact);
    for (const d of ds) {
      expect(Math.abs(d.impact)).toBeGreaterThanOrEqual(1);
      expect(d.source.startsWith("consistency.")).toBe(false); // weight 0 → impact 0
    }
  });

  test("the path is the shortest prefix of the costs that reaches the next verdict", () => {
    const e = evaluate(payload(3, 30), cfg);
    expect(e.verdict).not.toBe("invite");
    const nv = e.nextVerdict!;
    expect(nv.verdict).toBe(e.verdict === "pass" ? "maybe" : "invite");
    expect(nv.threshold).toBe(nv.verdict === "maybe" ? cfg.verdict.maybe : cfg.verdict.invite);
    const costs = e.drivers!.filter((d) => d.impact < 0).map((d) => d.source);
    expect(nv.sources).toEqual(costs.slice(0, nv.sources.length));
    expect(nv.sources.length).toBeLessThanOrEqual(3);
    if (nv.reachable) expect(nv.score).toBeGreaterThanOrEqual(nv.threshold);
    else expect(nv.score).toBeLessThan(nv.threshold);
  });

  test("unreachable when three signals cannot get there", () => {
    const hard = validateConfig(deepMerge(DEFAULT_CONFIG, { verdict: { invite: 100, maybe: 99 } }));
    const nv = evaluate(payload(3, 30), hard).nextVerdict!;
    expect(nv.reachable).toBe(false);
    expect(nv.sources.length).toBeLessThanOrEqual(3);
  });

  test("no path for INVITE or INSUFFICIENT DATA", () => {
    const top = evaluate(payload(0, 99), cfg);
    expect(top.verdict).toBe("invite");
    expect(top.nextVerdict).toBeNull();
    const few = evaluate(payloadWith([run(3, 30)], { targetLevel: 16 }), cfg);
    expect(few.verdict).toBe("insufficient");
    expect(few.drivers).toEqual([]);
    expect(few.nextVerdict).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `bun test test/evaluation/drivers.test.ts`
Expected: FAIL (`drivers` undefined).

- [ ] **Step 3: `global.ts`**

```ts
import { curve } from "./curve.ts";
import type { AxisScore, EvaluationConfig, Role } from "./types.ts";

/** Weighted mean of the axis scores with the role's weights; n/a axes are left out of both sums. */
export function globalScore(axes: AxisScore[], role: Role, cfg: EvaluationConfig): number | null {
  let num = 0;
  let den = 0;
  for (const a of axes) {
    if (a.score === null) continue;
    const w = cfg.axisWeights[role][a.key];
    num += w * a.score;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** The number the badge shows: the weighted mean through the role's `globalCurve`, rounded once. */
export function finalGlobal(axes: AxisScore[], role: Role, cfg: EvaluationConfig): number | null {
  const raw = globalScore(axes, role, cfg);
  return raw === null ? null : Math.round(curve(raw, cfg.globalCurve[role]));
}
```

`evaluate.ts`: delete its own `globalScore`, `export { globalScore, finalGlobal } from "./global.ts";`, import `finalGlobal`, and compute `const global = finalGlobal(axes, inputs.role, cfg);` (keep the existing comment about rounding once).

- [ ] **Step 4: `drivers.ts`**

```ts
// Score drivers: for each sub-signal, how many badge points the player gains or loses against the role's average
// player (the calibration median, `cfg.reference`), and the fewest signals to bring to that level to reach the next
// verdict. Spec: docs/superpowers/specs/2026-09-24-score-drivers-design.md.
import { scoreAllAxes } from "./axes/index.ts";
import type { Override } from "./axis.ts";
import { finalGlobal } from "./global.ts";
import type { EvalInputs } from "./inputs.ts";
import type { AxisScore, Driver, EvaluationConfig, NextVerdict, Verdict } from "./types.ts";

/** At most this many signals in the path to the next verdict. */
export const PATH_MAX = 3;

export function scoreDrivers(inputs: EvalInputs, axes: AxisScore[], global: number, verdict: Verdict, cfg: EvaluationConfig):
  { drivers: Driver[]; nextVerdict: NextVerdict | null } {
  const ref = cfg.reference[inputs.role];
  const globalWith = (override: Override): number => finalGlobal(scoreAllAxes(inputs, cfg, override), inputs.role, cfg) ?? global;
  const drivers: Driver[] = [];
  for (const e of axes.flatMap((a) => a.evidence)) {
    const r = ref[e.source];
    if (!r) continue; // no reference: deep-dive signals, experience.prevSeasonBonus
    const impact = global - globalWith({ [e.source]: r.x });
    if (Math.abs(impact) >= 1) drivers.push({ source: e.source, impact, value: e.value, reference: r.value, label: e.label });
  }
  drivers.sort((a, b) => a.impact - b.impact || a.source.localeCompare(b.source));

  const target = verdict === "pass" ? "maybe" : verdict === "maybe" ? "invite" : null;
  if (!target) return { drivers, nextVerdict: null };
  const threshold = cfg.verdict[target];
  const override: Record<string, number> = {};
  const sources: string[] = [];
  let score = global;
  for (const d of drivers.filter((x) => x.impact < 0).slice(0, PATH_MAX)) {
    override[d.source] = ref[d.source]!.x;
    sources.push(d.source);
    score = globalWith(override);
    if (score >= threshold) return { drivers, nextVerdict: { verdict: target, threshold, sources, score, reachable: true } };
  }
  return { drivers, nextVerdict: { verdict: target, threshold, sources, score, reachable: false } };
}
```

In `evaluate.ts`, after `global` and the verdict:

```ts
  const verdict = verdictFor(global, inputs.runsUsed, cfg);
  const { drivers, nextVerdict } = global === null || verdict === "insufficient"
    ? { drivers: [], nextVerdict: null }
    : scoreDrivers(inputs, axes, global, verdict, cfg);
```

and return `verdict, drivers, nextVerdict` in the object. Add `Driver` and `NextVerdict` to `types.ts` (Interfaces above), with a doc comment on each field (`impact`: badge points vs the average player, negative = costs; `label`: the English evidence line, for the CLI).

- [ ] **Step 5: Run**

Run: `bun test test/evaluation && just check`
Expected: PASS. If `test/format.test.ts` or `web/src/lib/*.test.ts` fixtures fail to type-check, the new fields are optional, so they should not; fix only real errors.

- [ ] **Step 6: Commit**

```bash
git add src/evaluation/global.ts src/evaluation/drivers.ts src/evaluation/evaluate.ts src/evaluation/types.ts test/evaluation/drivers.test.ts
git commit -m "feat(evaluation): score drivers and the path to the next verdict"
```

---

### Task 3: CLI lines

**Files:**
- Modify: `src/format-mplus.ts` (`renderEvaluation`)
- Test: `test/format.test.ts`

**Interfaces:**
- Consumes: `Evaluation.drivers`, `Evaluation.nextVerdict` (Task 2); `EVALUATION_DOCS` from `src/evaluation/docs.ts` for sub-signal titles.

- [ ] **Step 1: Failing test** — in `describe("renderEvaluation", …)`:

```ts
  test("drivers and the path to the next verdict", () => {
    const out = strip(renderEvaluation(evalFixture({
      verdict: "maybe", global: 47,
      drivers: [
        { source: "survival.individualDeaths", impact: -19, value: 1.6, reference: 0.7, label: "1.6 individual deaths/run" },
        { source: "survival.avoidableVsPeers", impact: 6, value: -29, reference: -3, label: "avoidable −29% vs peers" },
      ],
      nextVerdict: { verdict: "invite", threshold: 70, sources: ["survival.individualDeaths"], score: 72, reachable: true },
    })));
    expect(out).toContain("Drivers      −19 1.6 individual deaths/run (avg 0.7)  ·  +6 avoidable −29% vs peers (avg −3)");
    expect(out).toContain("To reach INVITE (70): individual deaths at the average player's level → 72");
  });
  test("no drivers line for an evaluation saved before drivers existed", () => {
    expect(strip(renderEvaluation(evalFixture()))).not.toContain("Drivers");
  });
```

- [ ] **Step 2: Run** — `bun test test/format.test.ts` → FAIL.

- [ ] **Step 3: Implement** — at the end of `renderEvaluation`, before `return`:

```ts
  const title = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return (EVALUATION_DOCS.axes[axis]?.subSignals[id]?.title ?? source).toLowerCase();
  };
  const num = (v: number) => { const s = String(Math.round(v * 10) / 10); return s.startsWith("-") ? `−${s.slice(1)}` : s; };
  if (ev.drivers?.length) {
    const shown = [...ev.drivers.filter((d) => d.impact < 0).slice(0, 3), ...ev.drivers.filter((d) => d.impact > 0).reverse().slice(0, 2)];
    const parts = shown.map((d) => {
      const tag = `${d.impact > 0 ? "+" : "−"}${Math.abs(d.impact)}`;
      return `${d.impact > 0 ? pc.green(tag) : pc.red(tag)} ${d.label} ${dim(`(avg ${num(d.reference)})`)}`;
    });
    lines.push(`  ${"Drivers".padEnd(12)} ${parts.join(`  ${dim("·")}  `)}`);
  }
  const nv = ev.nextVerdict;
  if (nv) {
    const head = `To reach ${nv.verdict.toUpperCase()} (${nv.threshold}):`;
    lines.push(`  ${dim(nv.reachable
      ? `${head} ${nv.sources.map(title).join(", ")} at the average player's level → ${nv.score}`
      : `${head} out of reach by fixing ${nv.sources.length} signal${nv.sources.length === 1 ? "" : "s"}`)}`);
  }
```

(import `EVALUATION_DOCS`; `AxisKey` is already imported there.) Adjust the expected strings in the test only if `dim`/`strip` spacing differs — the words must stay.

- [ ] **Step 4: Run** — `bun test test/format.test.ts && just check` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format-mplus.ts test/format.test.ts
git commit -m "feat(cli): print the score drivers under the verdict"
```

---

### Task 4: Web view model and strings

**Files:**
- Create: `web/src/lib/drivers.ts`, `web/src/lib/drivers.test.ts`
- Modify: `web/src/lib/axes.ts` (export a value formatter), `web/src/types.ts` (re-export `Driver`, `NextVerdict`), `web/src/i18n/en.ts`, `web/src/i18n/fr.ts`

**Interfaces:**
- Consumes: `Evaluation.drivers` / `nextVerdict` (types re-exported via `web/src/types.ts` from `@shared/evaluation/types.ts`).
- Produces (`web/src/lib/drivers.ts`):

```ts
export const BAR_PX_PER_POINT = 6;
export const BAR_MAX_PX = 150;
export interface DriverRow { source: string; title: string; impact: string; tone: "good" | "bad"; barPx: number; value: string; reference: string }
export interface DriversPath { message: string; verdict: string; verdictCls: "badge-maybe" | "badge-invite"; threshold: string; list: string; score: string }
export interface DriversView { rows: DriverRow[]; path: DriversPath | null }
export function driversView(t: T, locale: Locale, ev: Evaluation, titleOf: (source: string) => string): DriversView | null;
```

and in `axes.ts`: `export function formatEvidenceValue(locale: Locale, source: string, v: number): string` (the existing `VALUE_FORMAT[source](locale, v)`, falling back to `String(v)` for an unknown source).

- [ ] **Step 1: Strings.** `en.ts`, new top-level section after `evidence`:

```ts
  drivers: {
    title: "What makes this score",
    costs: "costs points",
    earns: "earns points",
    avg: "avg {value}",
    unit: { perRun: "{value} / run", vsPeers: "{value}% vs peers", pct: "{value}%", plain: "{value}" },
    path: {
      reach: "To reach {verdict} ({threshold}): bring {list} to the average player's level → {score}",
      out: "To reach {verdict} ({threshold}): out of reach by fixing {count, plural, one {# signal} other {# signals}}",
    },
  },
```

`fr.ts`, same keys:

```ts
  drivers: {
    title: "Ce qui fait ce score",
    costs: "coûte des points",
    earns: "rapporte des points",
    avg: "moy. {value}",
    unit: { perRun: "{value} / run", vsPeers: "{value} % vs pairs", pct: "{value} %", plain: "{value}" },
    path: {
      reach: "Pour passer {verdict} ({threshold}) : ramener {list} au niveau du joueur moyen → {score}",
      out: "Pour passer {verdict} ({threshold}) : hors de portée en corrigeant {count, plural, one {# signal} other {# signaux}}",
    },
  },
```

- [ ] **Step 2: Failing tests** — `web/src/lib/drivers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { Evaluation } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { BAR_MAX_PX, driversView } from "./drivers.ts";

const tFr = makeT(fr, "fr");
const titles: Record<string, string> = { "survival.individualDeaths": "Individual deaths", "throughput.medianParse": "Median parse", "throughput.parseAtTarget": "Parse at target", "survival.avoidableVsPeers": "Avoidable damage", "experience.atTarget": "Dungeons at target", "utility.dispels": "Dispels" };
const titleOf = (s: string) => titles[s] ?? s;
const ev = (over: Partial<Evaluation>): Evaluation => ({
  role: "dps", targetLevel: 16, axes: [], global: 47, verdict: "maybe", runsUsed: 8, analyzedRuns: 0, configVersion: "x",
  drivers: [
    { source: "survival.individualDeaths", impact: -19, value: 1.6, reference: 0.7, label: "" },
    { source: "throughput.medianParse", impact: -13, value: 40.7, reference: 58.5, label: "" },
    { source: "throughput.parseAtTarget", impact: -6, value: 45.7, reference: 57.2, label: "" },
    { source: "utility.dispels", impact: -2, value: 1, reference: 2, label: "" },
    { source: "experience.atTarget", impact: 4, value: 1, reference: 0.625, label: "" },
    { source: "survival.avoidableVsPeers", impact: 6, value: -29.4, reference: -3.2, label: "" },
  ],
  nextVerdict: { verdict: "invite", threshold: 70, sources: ["survival.individualDeaths", "throughput.medianParse"], score: 72, reachable: true },
  ...over,
});

describe("driversView", () => {
  test("three costs then two strengths, largest first, bars 6 px a point", () => {
    const v = driversView(tEn, "en", ev({}), titleOf)!;
    expect(v.rows.map((r) => r.impact)).toEqual(["−19", "−13", "−6", "+6", "+4"]);
    expect(v.rows[0]).toEqual({ source: "survival.individualDeaths", title: "Individual deaths", impact: "−19", tone: "bad", barPx: 114, value: "1.6 / run", reference: "avg 0.7" });
    expect(v.rows[3]!.value).toBe("−29% vs peers");
    expect(v.rows[3]!.reference).toBe("avg −3%");
    expect(v.rows[4]!.value).toBe("100%");
  });
  test("bars cap at the half width", () => {
    const big = ev({ drivers: [{ source: "survival.individualDeaths", impact: -40, value: 3, reference: 0.7, label: "" }] });
    expect(driversView(tEn, "en", big, titleOf)!.rows[0]!.barPx).toBe(BAR_MAX_PX);
  });
  test("the path sentence, reachable and not", () => {
    const p = driversView(tEn, "en", ev({}), titleOf)!.path!;
    expect(p).toMatchObject({ verdict: "INVITE", verdictCls: "badge-invite", threshold: "70", list: "individual deaths and median parse", score: "72" });
    expect(p.message).toContain("{list}");
    const out = driversView(tEn, "en", ev({ nextVerdict: { verdict: "maybe", threshold: 30, sources: ["a", "b", "c"], score: 12, reachable: false } }), titleOf)!.path!;
    expect(out.message).toBe("To reach {verdict} ({threshold}): out of reach by fixing 3 signals");
    expect(driversView(tEn, "en", ev({ nextVerdict: null }), titleOf)!.path).toBeNull();
  });
  test("French: decimal comma, French list", () => {
    const v = driversView(tFr, "fr", ev({}), titleOf)!;
    expect(v.rows[0]!.value).toBe("1,6 / run");
    expect(v.rows[0]!.reference).toBe("moy. 0,7");
    expect(v.path!.list).toBe("individual deaths et median parse");
  });
  test("nothing to show for an evaluation saved before drivers, or with none", () => {
    expect(driversView(tEn, "en", ev({ drivers: undefined }), titleOf)).toBeNull();
    expect(driversView(tEn, "en", ev({ drivers: [] }), titleOf)).toBeNull();
  });
});
```

- [ ] **Step 3: Run** — `bun test web/src/lib/drivers.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement.** `axes.ts`: `export function formatEvidenceValue(locale: Locale, source: string, v: number): string { return isKnownSource(source) ? VALUE_FORMAT[source](locale, v) : String(v); }`. `web/src/types.ts`: add `Driver, NextVerdict` to the `@shared/evaluation/types.ts` re-export. `web/src/lib/drivers.ts`:

```ts
// The "What makes this score" block (canvas variant B, docs/design/canvas/ScoreDriversBars.dc.html): the view model
// behind components/ScoreDrivers.tsx. Spec: docs/superpowers/specs/2026-09-24-score-drivers-design.md.
import type { Evaluation } from "../types.ts";
import type { T } from "../i18n/t.ts";
import type { Locale } from "./locale.ts";
import { formatEvidenceValue } from "./axes.ts";

export const BAR_PX_PER_POINT = 6;
export const BAR_MAX_PX = 150;
const MAX_COSTS = 3;
const MAX_EARNS = 2;

type Unit = "perRun" | "vsPeers" | "pct" | "plain";
/** How each source reads with its unit; the reference drops "/ run" and "vs peers" to stay short. */
const UNIT: Record<string, Unit> = {
  "survival.individualDeaths": "perRun", "survival.wipeDeaths": "perRun", "survival.groupDeaths": "perRun",
  "survival.avoidableVsPeers": "vsPeers", "survival.dtpsVsPeers": "vsPeers", "utility.kicksVsPeers": "vsPeers",
  "utility.kicksAbsolute": "pct", "utility.dispels": "perRun",
  "preparation.potions": "perRun", "preparation.healthstones": "perRun",
  "experience.coverage": "pct", "experience.atTarget": "pct",
};
const REF_UNIT: Record<Unit, Unit> = { perRun: "plain", vsPeers: "pct", pct: "pct", plain: "plain" };

export interface DriverRow { source: string; title: string; impact: string; tone: "good" | "bad"; barPx: number; value: string; reference: string }
export interface DriversPath { message: string; verdict: string; verdictCls: "badge-maybe" | "badge-invite"; threshold: string; list: string; score: string }
export interface DriversView { rows: DriverRow[]; path: DriversPath | null }

const signedPoints = (n: number): string => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

export function driversView(t: T, locale: Locale, ev: Evaluation, titleOf: (source: string) => string): DriversView | null {
  const ds = ev.drivers ?? [];
  const costs = ds.filter((d) => d.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, MAX_COSTS);
  const earns = ds.filter((d) => d.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, MAX_EARNS);
  if (costs.length + earns.length === 0) return null;
  const fmt = (unit: Unit, source: string, v: number) => t(`drivers.unit.${unit}`, { value: formatEvidenceValue(locale, source, v) });
  const rows = [...costs, ...earns].map((d): DriverRow => {
    const unit = UNIT[d.source] ?? "plain";
    return {
      source: d.source,
      title: titleOf(d.source),
      impact: signedPoints(d.impact),
      tone: d.impact < 0 ? "bad" : "good",
      barPx: Math.min(BAR_MAX_PX, Math.abs(d.impact) * BAR_PX_PER_POINT),
      value: fmt(unit, d.source, d.value),
      reference: t("drivers.avg", { value: fmt(REF_UNIT[unit], d.source, d.reference) }),
    };
  });
  const nv = ev.nextVerdict;
  const path: DriversPath | null = nv ? {
    message: nv.reachable ? t("drivers.path.reach") : t("drivers.path.out", { count: nv.sources.length }),
    verdict: t(`verdict.words.${nv.verdict}`),
    verdictCls: nv.verdict === "invite" ? "badge-invite" : "badge-maybe",
    threshold: String(nv.threshold),
    list: new Intl.ListFormat(locale, { type: "conjunction" }).format(nv.sources.map((s) => titleOf(s).toLocaleLowerCase(locale))),
    score: String(nv.score),
  } : null;
  return { rows, path };
}
```

Note `t("drivers.path.out", { count })` fills `{count, plural…}` but leaves `{verdict}` / `{threshold}` for `<Around>` (formatMessage keeps unknown params). If `formatMessage` drops unknown placeholders instead, pass nothing and let the component substitute the count too — check `web/src/i18n/t.ts` `formatMessage` first.

- [ ] **Step 5: Run** — `bun test web/src/lib && just check` → PASS (the i18n mirror test must pass too).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/drivers.ts web/src/lib/drivers.test.ts web/src/lib/axes.ts web/src/types.ts web/src/i18n/en.ts web/src/i18n/fr.ts
git commit -m "feat(web): score drivers view model and strings"
```

---

### Task 5: The component, the Help paragraph and the docs

**Files:**
- Create: `web/src/components/ScoreDrivers.tsx`
- Modify: `web/src/components/VerdictHero.tsx`, `web/src/styles/app.css`
- Modify: `src/evaluation/docs.ts`, `src/evaluation/docs.fr.ts` (`verdict.drivers`), `web/src/components/help/HelpPage.tsx`
- Modify: `docs/scoring.md`, `docs/agents/web-front.md` (components map), the spec's status line
- Test: `test/evaluation/docs.test.ts` (if it lists `verdict` keys), `bun test` overall

**Interfaces:**
- Consumes: `driversView`, `DriversView` (Task 4); `useDocs().docs?.docs.axes[axis].subSignals[id].title` for titles.

- [ ] **Step 1: CSS** — append to `web/src/styles/app.css` (values from the canvas artboard, variables only):

```css
/* Score drivers — canvas variant B (docs/design/canvas/ScoreDriversBars.dc.html) */
.drivers { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; }
.drivers-row { display: grid; grid-template-columns: 150px 150px 1px 150px minmax(0, 1fr); align-items: center; font-size: 13px; min-height: 22px; }
.drivers-title { display: flex; align-items: center; gap: 6px; }
.drivers-caption { font-size: 11px; color: var(--faint); }
.drivers-caption.cost { text-align: right; padding-right: 8px; }
.drivers-caption.earn { padding-left: 8px; }
.drivers-side { display: flex; align-items: center; gap: 6px; }
.drivers-side.cost { justify-content: flex-end; }
.drivers-axis { width: 1px; height: 22px; background: var(--border); }
.drivers-bar { height: 10px; }
.drivers-side.cost .drivers-bar { background: var(--red); border-radius: 2px 0 0 2px; }
.drivers-side.earn .drivers-bar { background: var(--green); border-radius: 0 2px 2px 0; }
.drivers-impact { font-family: var(--mono); font-size: 12px; }
.drivers-value { font-size: 12px; color: var(--text-soft); padding-left: 12px; }
.drivers-path { font-size: 12px; color: var(--muted); border-top: 1px solid var(--border-soft); padding-top: 8px; margin-top: 4px; }
.drivers-path b { color: var(--text); font-weight: 600; }
.drivers-path .badge-invite, .drivers-path .badge-maybe { background: none; border: 0; }
```

- [ ] **Step 2: Component** — `web/src/components/ScoreDrivers.tsx`:

```tsx
import type { AxisKey, Evaluation } from "../types.ts";
import { driversView } from "../lib/drivers.ts";
import { useDocs } from "../docs.tsx";
import { useT } from "../locale.tsx";
import { Around } from "./Around.tsx";
import { HelpLink } from "./HelpLink.tsx";

/** "What makes this score": diverging bars of the score drivers (canvas variant B). Nothing for an evaluation saved
 * before drivers existed. */
export function ScoreDrivers({ evaluation }: { evaluation: Evaluation }) {
  const { t, locale } = useT();
  const { docs } = useDocs();
  const titleOf = (source: string): string => {
    const [axis, id] = source.split(".") as [AxisKey, string];
    return docs?.docs.axes[axis]?.subSignals[id]?.title ?? source;
  };
  const v = driversView(t, locale, evaluation, titleOf);
  if (!v) return null;
  return (
    <div className="drivers inset">
      <div className="drivers-row">
        <span className="drivers-title"><span className="label-caps">{t("drivers.title")}</span><HelpLink anchor="drivers" /></span>
        <span className="drivers-caption cost">{t("drivers.costs")}</span>
        <span />
        <span className="drivers-caption earn">{t("drivers.earns")}</span>
        <span />
      </div>
      {v.rows.map((r) => (
        <div key={r.source} className="drivers-row">
          <span>{r.title}</span>
          <span className="drivers-side cost">
            {r.tone === "bad" && <><span className="drivers-impact tone-bad">{r.impact}</span><span className="drivers-bar" style={{ width: r.barPx }} /></>}
          </span>
          <span className="drivers-axis" />
          <span className="drivers-side earn">
            {r.tone === "good" && <><span className="drivers-bar" style={{ width: r.barPx }} /><span className="drivers-impact tone-good">{r.impact}</span></>}
          </span>
          <span className="drivers-value">{r.value} <span className="faint">· {r.reference}</span></span>
        </div>
      ))}
      {v.path && (
        <div className="drivers-path">
          <Around
            message={v.path.message}
            params={{
              verdict: <b className={v.path.verdictCls}>{v.path.verdict}</b>,
              threshold: v.path.threshold,
              list: <b>{v.path.list}</b>,
              score: <span className="mono">{v.path.score}</span>,
            }}
          />
        </div>
      )}
    </div>
  );
}
```

(`docs?.docs` — check `Docs` = `Omit<DocsResponse,"ok">`, whose `docs` field is the registry; adjust the access path if `useDocs()` exposes it differently.) In `VerdictHero.tsx`, render `<ScoreDrivers evaluation={payload.evaluation} />` immediately before `<AxisRows rows={rows} />`.

- [ ] **Step 3: Help paragraph** — `src/evaluation/docs.ts`: add `drivers: string` to `EvaluationDocs["verdict"]` and the English text:

```ts
    drivers: "What makes this score: for each signal, how many points of the global score the player gains or loses against the average player of the role — the median of about a thousand EU players logging +15 to +20 keys. −19 on deaths means that dying as often as the average player, everything else unchanged, would score 19 more. The median rather than the mean because deaths and avoidable damage are lopsided: a few players at three deaths a run pull a mean up, and \"average\" would then mean worse than most. The effects do not add up exactly to the score, because the global is a percentile, not a sum. The closing line lists the fewest signals, at most three, that would reach the next verdict if brought to the average player's level. Deep-dive signals have no average yet and are left out.",
```

`docs.fr.ts`:

```ts
    drivers: "Ce qui fait ce score : pour chaque signal, combien de points du score global le joueur gagne ou perd face au joueur moyen du rôle — la médiane d'environ un millier de joueurs EU qui loguent des clés +15 à +20. −19 sur les morts veut dire que mourir aussi souvent que le joueur moyen, tout le reste égal, rapporterait 19 points. La médiane plutôt que la moyenne parce que les morts et les dégâts évitables sont déséquilibrés : quelques joueurs à trois morts par run tirent une moyenne vers le haut, et « moyen » voudrait alors dire pire que la plupart. Les effets ne s'additionnent pas exactement au score, parce que le global est un percentile, pas une somme. La dernière ligne cite le moins de signaux possible, trois au plus, qui suffiraient pour atteindre le verdict suivant s'ils étaient au niveau du joueur moyen. Les signaux du deep-dive n'ont pas encore de moyenne et sont laissés de côté.",
```

`HelpPage.tsx` `Verdict` section: after `<p className="help-p">{v.global}</p>` add `<p className="help-p" id="drivers">{v.drivers}</p>`.

- [ ] **Step 4: Docs** — `docs/scoring.md`, after the global-score paragraph:

```md
**What makes this score.** Under the badge, bars show the signals that cost
or earn the most points of the global score against the role's average player
(the calibration median, `reference` in `default-config.json`, refitted with
`globalCurve`), and the fewest signals — three at most — that would reach the
next verdict at that level. Each effect is "this signal alone at the average
player's level"; they do not add up exactly to the score.
```

`docs/agents/web-front.md` components map: after `VerdictHero (verdict, radar, ` insert `ScoreDrivers — the diverging-bar "What makes this score" block, `. Spec status line: append "Implemented 2026-09-24."

- [ ] **Step 5: Verify**

Run: `just check && bun test` then, with `web/dist` moved aside, `bun test` again.
Expected: all green. Then `just build` and look at a saved lookup in `just serve --no-open` only if the user asks for a visual check.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ScoreDrivers.tsx web/src/components/VerdictHero.tsx web/src/styles/app.css src/evaluation/docs.ts src/evaluation/docs.fr.ts web/src/components/help/HelpPage.tsx docs/scoring.md docs/agents/web-front.md docs/superpowers/specs/2026-09-24-score-drivers-design.md
git commit -m "feat(web): What makes this score — diverging bars under the verdict"
```
