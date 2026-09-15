# Evaluation Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every lookup on six 0–100 axes (Survival, Utility, Throughput, Consistency, Preparation, Experience) with evidence, a role-weighted global score and a verdict, driven by a data-only `evaluation.json` the user can override.

**Architecture:** A pure `src/evaluation/` module: `curve.ts` (interpolation/statistics), `config.ts` (default JSON + validation + deep-merge override + version hash), `inputs.ts` (payload → raw per-axis inputs), one file per axis built on a generic `scoreAxis` engine, `evaluate.ts` (role, global, verdict). `performLookup` adds `evaluation` to the payload; CLI/web render it minimally; `bmpl evaluate <payload.json>` re-runs the model offline for tuning. One small signals-layer extension: `RunSignals.consumables`.

**Tech Stack:** Bun 1.3, TypeScript strict, `bun test`. No new dependencies (`Bun.CryptoHasher` for the config hash).

**Spec:** `docs/superpowers/specs/2026-09-15-evaluation-model-design.md`

## Global Constraints

- TypeScript strict; `bun run typecheck` (covers `src/**` and `test/**`) and `bun test` must stay green after every task. No new dependencies.
- Everything in `src/evaluation/` is pure except `config.ts`'s file read; `evaluate(payload, cfg)` takes the **payload object** (same JSON the server/CLI emit) so it can run offline.
- Axis scores are 0–100; a missing sub-signal is **ignored, never counted as 0**; no available sub-signal → `score: null`.
- Evidence `delta = weight × (subScore − 50)`, sorted by `|delta|` desc.
- Confidence: `high` if `runsUsed ≥ 6`, `medium` if `3–5`, `low` otherwise; Consistency is `null` (and `low`) when `runsUsed < 5`.
- Verdict: `insufficient` if `runsUsed < 3` or `global === null`; else `invite ≥ 70`, `maybe ≥ 45`, else `pass`. Thresholds live in the config.
- Level-sensitive death inputs are multiplied by `levelScale(targetLevel)`; labels show the raw value.
- Previous-season score: bonus `+min(10, all/400)` on Experience when present, **nothing** when absent.
- Timed/depleted is never used by the model.
- Config: default in `src/evaluation/default-config.json`; user override `evaluation.json` next to `.env` (`BMPL_EVAL_CONFIG` env override), deep-merged (objects merge, arrays replace); invalid default = startup error, invalid override = stderr warning + default; `configVersion` = first 8 hex chars of SHA-256 over canonical (sorted-key) JSON.
- All curve values below are the spec's initial values; copy them exactly into `default-config.json`.

## Reference: shared shapes

```ts
export type Role = "dps" | "healer" | "tank";
export type AxisKey = "survival" | "utility" | "throughput" | "consistency" | "preparation" | "experience";
export const AXIS_KEYS: AxisKey[] = ["survival", "utility", "throughput", "consistency", "preparation", "experience"];
export type CurvePoints = [number, number][];
```

Fixture facts used by tests (`test/fixtures/`, real captured data):
- S1 tank run (Biwaadrood, Magisters' Terrace +18, fight 1700498 ms): Biwaadrood `potionUse 1, healthstoneUse 0`; Mstercheif `6 / 3`; Aicham `2 / 2`. Biwaadrood: 0 deaths, interrupts 23 (usage 23/(1700.498/15) ≈ 0.2029, peer median ≈ 0.2117), dispels 0, no avoidable list (S1 dungeon), role tank.
- S2 healer run (Muleyoxo, Voidscar Arena +21): Muleyoxo `5 / 3`; 1 death in a wipe; group deaths 5; avoidable perMinute peer comparison present; Holy Priest → `kickCooldownS null`; dispels 9.
- RIO fixture (Muleyoxo): ilvl 322, `runsLast7d` 10 (with `now = 2026-09-15T12:00Z`), seasons `[season-mn-2 all 3942.8, season-mn-1 all 4152.7]`.

---

### Task 1: `RunSignals.consumables`

**Files:**
- Modify: `src/signals/types.ts` (RunSignals)
- Modify: `src/signals/wcl-run.ts`
- Test: `test/signals/wcl-run.test.ts` (append)

**Interfaces:**
- Produces: `RunSignals.consumables: { potions: number; healthstones: number } | null`.

- [ ] **Step 1: Write the failing tests** — append to `test/signals/wcl-run.test.ts`:

```ts
describe("parseRunSignals — consumables", () => {
  test("potions and healthstones from playerDetails", async () => {
    const f = await loadWclFixture("s1-tank");
    const fb = { keyLevel: 18, affixes: f.run.affixes, encounterID: f.run.encounterID };
    expect(parseRunSignals(f.report, "Mstercheif", fb)!.consumables).toEqual({ potions: 6, healthstones: 3 });
    expect(parseRunSignals(f.report, "Biwaadrood", fb)!.consumables).toEqual({ potions: 1, healthstones: 0 });
  });
  test("player absent from playerDetails → null", async () => {
    const f = await loadWclFixture("s1-tank");
    const fb = { keyLevel: 18, affixes: f.run.affixes, encounterID: f.run.encounterID };
    expect(parseRunSignals(f.report, "Nobody", fb)!.consumables).toBeNull();
    expect(parseRunSignals({ ...f.report, summary: null }, "Biwaadrood", fb)!.consumables).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `bun test test/signals/wcl-run.test.ts` — expected: the two new tests FAIL (`consumables` undefined).

- [ ] **Step 3: Implement.** In `src/signals/types.ts`, add to `RunSignals` after `itemLevel`:

```ts
  consumables: { potions: number; healthstones: number } | null; // null when player not in playerDetails
```

and extend `RawTable.data.playerDetails` group entries to `Array<{ name: string; minItemLevel?: number; potionUse?: number; healthstoneUse?: number }>` (all three groups). In `src/signals/wcl-run.ts`, next to `itemLevelFor`:

```ts
const playerDetailFor = (summary: RawTable | null | undefined, name: string) => {
  const pd = summary?.data?.playerDetails;
  for (const group of [pd?.dps, pd?.healers, pd?.tanks]) {
    const hit = group?.find((p) => p.name === name);
    if (hit) return hit;
  }
  return null;
};

const consumablesFor = (summary: RawTable | null | undefined, name: string) => {
  const p = playerDetailFor(summary, name);
  if (!p) return null;
  return { potions: p.potionUse ?? 0, healthstones: p.healthstoneUse ?? 0 };
};
```

Refactor `itemLevelFor` to use `playerDetailFor` (same behaviour: `minItemLevel` if numeric, else null). Add `consumables: consumablesFor(report.summary, characterName),` to the returned object after `itemLevel`.

- [ ] **Step 4: Run** `bun test && bun run typecheck` — expected: green (fixture-based `toEqual` on whole `RunSignals` objects don't exist, so no other test breaks; if one does, add the `consumables` field to its expectation).

- [ ] **Step 5: Commit** — `git add src/signals/types.ts src/signals/wcl-run.ts test/signals/wcl-run.test.ts && git commit -m "feat(signals): consumables (potions, healthstones) from Summary.playerDetails"`

---

### Task 2: Evaluation types and curve primitives

**Files:**
- Create: `src/evaluation/types.ts`
- Create: `src/evaluation/curve.ts`
- Test: `test/evaluation/curve.test.ts`

**Interfaces:**
- Produces (types.ts): `Role`, `AxisKey`, `AXIS_KEYS`, `CurvePoints`, `Evidence`, `AxisScore`, `Evaluation`, `Verdict`, `Confidence`, `SubSignalConfig`, `AxisConfig`, `EvaluationConfig`.
- Produces (curve.ts): `curve(x, points): number`, `stddev(xs): number | null`, `mean(xs): number | null`, `median` (re-exported from `../signals/peers.ts`), `clamp(x, lo, hi)`.

- [ ] **Step 1: Write types** — `src/evaluation/types.ts`:

```ts
export type Role = "dps" | "healer" | "tank";
export type AxisKey = "survival" | "utility" | "throughput" | "consistency" | "preparation" | "experience";
export const AXIS_KEYS: readonly AxisKey[] = ["survival", "utility", "throughput", "consistency", "preparation", "experience"];
export type Verdict = "invite" | "maybe" | "pass" | "insufficient";
export type Confidence = "high" | "medium" | "low";
export type CurvePoints = [number, number][];

export interface Evidence {
  label: string;
  delta: number;
  source: string; // "<axis>.<subSignalId>"
}

export interface AxisScore {
  key: AxisKey;
  score: number | null;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface Evaluation {
  role: Role;
  targetLevel: number;
  axes: AxisScore[];
  global: number | null;
  verdict: Verdict;
  runsUsed: number;
  configVersion: string;
}

export interface SubSignalConfig {
  curve: CurvePoints;
  weights: Record<Role, number>;
}
export interface AxisConfig {
  subSignals: Record<string, SubSignalConfig>;
}
export interface EvaluationConfig {
  version: string;
  levelScale: CurvePoints;
  expectedIlvl: Record<string, CurvePoints>; // keyed by Raider.IO season slug
  axes: Record<AxisKey, AxisConfig>;
  axisWeights: Record<Role, Record<AxisKey, number>>;
  verdict: { invite: number; maybe: number; minRuns: number };
  confidence: { high: number; medium: number; consistencyMinRuns: number };
}
```

- [ ] **Step 2: Write the failing test** — `test/evaluation/curve.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { clamp, curve, mean, stddev } from "../../src/evaluation/curve.ts";

const C: [number, number][] = [[0, 100], [1, 65], [3, 10]];

describe("curve", () => {
  test("hits control points exactly", () => {
    expect(curve(0, C)).toBe(100);
    expect(curve(1, C)).toBe(65);
    expect(curve(3, C)).toBe(10);
  });
  test("interpolates linearly between points", () => {
    expect(curve(0.5, C)).toBeCloseTo(82.5, 6);
    expect(curve(2, C)).toBeCloseTo(37.5, 6);
  });
  test("clamps outside the range", () => {
    expect(curve(-5, C)).toBe(100);
    expect(curve(99, C)).toBe(10);
  });
  test("single point → constant", () => {
    expect(curve(7, [[2, 40]])).toBe(40);
  });
  test("empty points → throws", () => {
    expect(() => curve(1, [])).toThrow();
  });
});

describe("stddev / mean / clamp", () => {
  test("population stddev", () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
    expect(stddev([5])).toBeNull();
    expect(stddev([])).toBeNull();
  });
  test("mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNull();
  });
  test("clamp", () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-3, 0, 100)).toBe(0);
    expect(clamp(42, 0, 100)).toBe(42);
  });
});
```

- [ ] **Step 3: Run** `bun test test/evaluation/curve.test.ts` — expected: FAIL (module not found).

- [ ] **Step 4: Implement** — `src/evaluation/curve.ts`:

```ts
import { median } from "../signals/peers.ts";
import type { CurvePoints } from "./types.ts";

export { median };

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Piecewise-linear interpolation over sorted [x, y] points, clamped at both ends. */
export function curve(x: number, points: CurvePoints): number {
  if (points.length === 0) throw new Error("curve: no control points");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

export const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Population standard deviation; null under 2 samples. */
export const stddev = (xs: number[]): number | null => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};
```

- [ ] **Step 5: Run** `bun test test/evaluation/curve.test.ts && bun run typecheck` — expected: pass.

- [ ] **Step 6: Commit** — `git add src/evaluation/types.ts src/evaluation/curve.ts test/evaluation/curve.test.ts && git commit -m "feat(evaluation): types and curve/statistics primitives"`

---

### Task 3: Default config, validation, override merge, version hash

**Files:**
- Create: `src/evaluation/default-config.json`
- Create: `src/evaluation/config.ts`
- Modify: `src/setup.ts` (add `resolveEvalConfigPath`)
- Test: `test/evaluation/config.test.ts`

**Interfaces:**
- Produces (config.ts): `DEFAULT_CONFIG: EvaluationConfig`; `validateConfig(obj: unknown): EvaluationConfig` (throws `Error` whose message names the offending path); `deepMerge(base, override): unknown`; `configVersion(cfg): string`; `loadConfig(userPath: string | null): Promise<{ config: EvaluationConfig; warning?: string }>`; `getEvalConfig(): Promise<EvaluationConfig>` (process-wide cached, uses `resolveEvalConfigPath()`).
- Produces (setup.ts): `resolveEvalConfigPath(): Promise<string>` — `BMPL_EVAL_CONFIG` else `evaluation.json` next to `.env` (may not exist).

- [ ] **Step 1: Write the default config** — `src/evaluation/default-config.json`:

```json
{
  "version": "1",
  "levelScale": [[8, 1.6], [12, 1.3], [16, 1.0], [20, 0.8], [25, 0.65]],
  "expectedIlvl": {
    "season-mn-2": [[10, 300], [15, 315], [20, 325], [25, 332]]
  },
  "axes": {
    "survival": {
      "subSignals": {
        "individualDeaths": { "curve": [[0, 100], [0.5, 85], [1, 65], [2, 35], [3, 10]], "weights": { "dps": 3, "healer": 3, "tank": 3 } },
        "wipeDeaths":       { "curve": [[0, 100], [1, 70], [2, 45]],                      "weights": { "dps": 1, "healer": 1, "tank": 1 } },
        "avoidableVsPeers": { "curve": [[-40, 100], [-10, 80], [0, 65], [20, 40], [50, 10]], "weights": { "dps": 2, "healer": 2, "tank": 2 } },
        "dtpsVsPeers":      { "curve": [[-40, 100], [-10, 80], [0, 65], [20, 40], [50, 10]], "weights": { "dps": 1, "healer": 1, "tank": 0 } },
        "groupDeaths":      { "curve": [[0, 100], [2, 75], [4, 45], [7, 15]],              "weights": { "dps": 0, "healer": 2, "tank": 0 } }
      }
    },
    "utility": {
      "subSignals": {
        "kicksVsPeers":  { "curve": [[-40, 10], [-20, 40], [0, 65], [15, 85], [30, 100]], "weights": { "dps": 3, "healer": 1, "tank": 3 } },
        "kicksAbsolute": { "curve": [[0, 20], [0.15, 50], [0.3, 80], [0.45, 100]],      "weights": { "dps": 1, "healer": 1, "tank": 1 } },
        "dispels":       { "curve": [[0, 40], [3, 60], [10, 85], [20, 100]],            "weights": { "dps": 1, "healer": 3, "tank": 1 } }
      }
    },
    "throughput": {
      "subSignals": {
        "medianParse":   { "curve": [[0, 10], [25, 35], [50, 60], [75, 80], [95, 100]], "weights": { "dps": 3, "healer": 3, "tank": 3 } },
        "parseAtTarget": { "curve": [[0, 10], [25, 35], [50, 60], [75, 80], [95, 100]], "weights": { "dps": 2, "healer": 2, "tank": 2 } }
      }
    },
    "consistency": {
      "subSignals": {
        "parseSpread":  { "curve": [[0, 100], [10, 85], [20, 60], [35, 30]],   "weights": { "dps": 2, "healer": 2, "tank": 2 } },
        "deathsSpread": { "curve": [[0, 100], [0.7, 75], [1.5, 45], [2.5, 20]], "weights": { "dps": 2, "healer": 2, "tank": 2 } },
        "damageSpread": { "curve": [[0, 100], [15, 75], [30, 45], [50, 20]],   "weights": { "dps": 1, "healer": 1, "tank": 1 } }
      }
    },
    "preparation": {
      "subSignals": {
        "potions":      { "curve": [[0, 20], [2, 55], [4, 85], [6, 100]],      "weights": { "dps": 2, "healer": 2, "tank": 2 } },
        "healthstones": { "curve": [[0, 40], [1, 70], [2, 90], [3, 100]],      "weights": { "dps": 1, "healer": 1, "tank": 1 } },
        "ilvlVsLevel":  { "curve": [[-20, 10], [-10, 45], [0, 75], [10, 100]], "weights": { "dps": 2, "healer": 2, "tank": 2 } }
      }
    },
    "experience": {
      "subSignals": {
        "coverage":       { "curve": [[0, 10], [0.5, 45], [0.75, 70], [1, 100]], "weights": { "dps": 2, "healer": 2, "tank": 2 } },
        "atTarget":       { "curve": [[0, 20], [0.25, 50], [0.5, 75], [1, 100]], "weights": { "dps": 3, "healer": 3, "tank": 3 } },
        "medianVsTarget": { "curve": [[-4, 10], [-2, 40], [0, 70], [2, 100]],    "weights": { "dps": 2, "healer": 2, "tank": 2 } },
        "activity":       { "curve": [[0, 30], [2, 60], [5, 85], [10, 100]],     "weights": { "dps": 1, "healer": 1, "tank": 1 } }
      }
    }
  },
  "axisWeights": {
    "dps":    { "survival": 3, "utility": 2,   "throughput": 3, "consistency": 1.5, "preparation": 1, "experience": 2 },
    "healer": { "survival": 3, "utility": 2.5, "throughput": 2, "consistency": 1.5, "preparation": 1, "experience": 2 },
    "tank":   { "survival": 3, "utility": 2,   "throughput": 2, "consistency": 1.5, "preparation": 1, "experience": 2.5 }
  },
  "verdict": { "invite": 70, "maybe": 45, "minRuns": 3 },
  "confidence": { "high": 6, "medium": 3, "consistencyMinRuns": 5 }
}
```

(A weight of `0` means "not used for this role" — the engine skips sub-signals with weight 0. The spec's `—` cells are `0` here.)

- [ ] **Step 2: Add `resolveEvalConfigPath`** — append to `src/setup.ts`:

```ts
/** User override for the evaluation rules: BMPL_EVAL_CONFIG, else `evaluation.json` next to .env. May not exist. */
export async function resolveEvalConfigPath(): Promise<string> {
  const override = (process.env.BMPL_EVAL_CONFIG ?? "").trim();
  if (override) return override;
  return path.join(path.dirname(await resolveEnvPath()), "evaluation.json");
}
```

- [ ] **Step 3: Write the failing tests** — `test/evaluation/config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import {
  DEFAULT_CONFIG,
  configVersion,
  deepMerge,
  loadConfig,
  validateConfig,
} from "../../src/evaluation/config.ts";
import { AXIS_KEYS } from "../../src/evaluation/types.ts";

const tmp = (name: string) => path.join(import.meta.dir, "..", "..", ".superpowers-test-tmp", name);

describe("default config", () => {
  test("validates and has every axis, role and threshold", () => {
    const cfg = validateConfig(DEFAULT_CONFIG);
    for (const k of AXIS_KEYS) expect(Object.keys(cfg.axes[k].subSignals).length).toBeGreaterThan(0);
    expect(cfg.axisWeights.tank.experience).toBe(2.5);
    expect(cfg.verdict).toEqual({ invite: 70, maybe: 45, minRuns: 3 });
    expect(cfg.expectedIlvl["season-mn-2"]).toBeDefined();
  });
});

describe("validateConfig", () => {
  test("rejects a non-monotonic curve, naming the path", () => {
    const bad = deepMerge(DEFAULT_CONFIG, { axes: { survival: { subSignals: { wipeDeaths: { curve: [[0, 100], [0, 70]] } } } } });
    expect(() => validateConfig(bad)).toThrow(/axes\.survival\.subSignals\.wipeDeaths\.curve/);
  });
  test("rejects a score outside 0-100", () => {
    const bad = deepMerge(DEFAULT_CONFIG, { axes: { utility: { subSignals: { dispels: { curve: [[0, 40], [5, 120]] } } } } });
    expect(() => validateConfig(bad)).toThrow(/axes\.utility\.subSignals\.dispels\.curve/);
  });
  test("rejects a negative weight and a missing role", () => {
    expect(() => validateConfig(deepMerge(DEFAULT_CONFIG, { axisWeights: { dps: { survival: -1 } } }))).toThrow(/axisWeights\.dps\.survival/);
    const noTank = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    delete noTank.axisWeights.tank;
    expect(() => validateConfig(noTank)).toThrow(/axisWeights\.tank/);
  });
  test("rejects unknown keys", () => {
    expect(() => validateConfig(deepMerge(DEFAULT_CONFIG, { axes: { survival: { subSignals: { foo: { curve: [[0, 1]], weights: { dps: 1, healer: 1, tank: 1 } } } } } }))).toThrow(/axes\.survival\.subSignals\.foo/);
    expect(() => validateConfig(deepMerge(DEFAULT_CONFIG, { bogus: 1 }))).toThrow(/bogus/);
  });
});

describe("deepMerge", () => {
  test("objects merge, arrays replace, scalars override", () => {
    const out = deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [9] }, d: 2 }) as any;
    expect(out).toEqual({ a: { b: 1, c: [9] }, d: 2 });
  });
});

describe("configVersion", () => {
  test("stable across key order, changes with values", () => {
    const a = configVersion(validateConfig(DEFAULT_CONFIG));
    const reordered = { confidence: DEFAULT_CONFIG.confidence, verdict: DEFAULT_CONFIG.verdict, ...DEFAULT_CONFIG };
    expect(configVersion(validateConfig(reordered))).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    const b = configVersion(validateConfig(deepMerge(DEFAULT_CONFIG, { verdict: { invite: 71 } })));
    expect(b).not.toBe(a);
  });
});

describe("loadConfig", () => {
  test("no user file → default, no warning", async () => {
    const r = await loadConfig(tmp("does-not-exist.json"));
    expect(r.warning).toBeUndefined();
    expect(r.config.verdict.invite).toBe(70);
  });
  test("valid user file overrides one threshold and one curve", async () => {
    const p = tmp("ok.json");
    await Bun.write(p, JSON.stringify({ verdict: { invite: 75 }, axes: { utility: { subSignals: { dispels: { curve: [[0, 30], [10, 100]] } } } } }));
    const r = await loadConfig(p);
    expect(r.warning).toBeUndefined();
    expect(r.config.verdict.invite).toBe(75);
    expect(r.config.verdict.maybe).toBe(45);
    expect(r.config.axes.utility.subSignals.dispels.curve).toEqual([[0, 30], [10, 100]]);
    expect(r.config.axes.utility.subSignals.dispels.weights.healer).toBe(3);
  });
  test("invalid user file → default + warning naming the file and path", async () => {
    const p = tmp("bad.json");
    await Bun.write(p, JSON.stringify({ verdict: { invite: "high" } }));
    const r = await loadConfig(p);
    expect(r.config.verdict.invite).toBe(70);
    expect(r.warning).toMatch(/bad\.json/);
    expect(r.warning).toMatch(/verdict\.invite/);
  });
  test("unparseable user file → default + warning", async () => {
    const p = tmp("broken.json");
    await Bun.write(p, "{ not json");
    const r = await loadConfig(p);
    expect(r.config.verdict.invite).toBe(70);
    expect(r.warning).toMatch(/broken\.json/);
  });
});
```

Add `.superpowers-test-tmp/` to `.gitignore`.

- [ ] **Step 4: Run** `bun test test/evaluation/config.test.ts` — expected: FAIL (module not found).

- [ ] **Step 5: Implement** — `src/evaluation/config.ts`:

```ts
import defaultJson from "./default-config.json";
import { resolveEvalConfigPath } from "../setup.ts";
import { AXIS_KEYS, type AxisKey, type CurvePoints, type EvaluationConfig, type Role } from "./types.ts";

export const DEFAULT_CONFIG = defaultJson as unknown as EvaluationConfig;
const ROLES: readonly Role[] = ["dps", "healer", "tank"];

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Objects merge recursively, arrays and scalars replace. Never mutates inputs. */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isObj(base) || !isObj(override)) return override === undefined ? base : structuredClone(override);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v);
  return out;
}

class ConfigError extends Error {}
const fail = (path: string, msg: string): never => { throw new ConfigError(`${path}: ${msg}`); };

const expectKeys = (obj: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`${path}.${k}`, "unknown key");
  for (const k of allowed) if (!(k in obj)) fail(`${path}.${k}`, "missing");
};

const checkCurve = (v: unknown, path: string, yLo: number, yHi: number): CurvePoints => {
  if (!Array.isArray(v) || v.length < 1) return fail(path, "must be a non-empty array of [x, y]");
  let prevX = -Infinity;
  for (const [i, p] of v.entries()) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number")
      return fail(`${path}[${i}]`, "must be [number, number]");
    if (p[0] <= prevX) return fail(path, `x must be strictly increasing (at index ${i})`);
    if (p[1] < yLo || p[1] > yHi) return fail(`${path}[${i}]`, `y must be within ${yLo}..${yHi}`);
    prevX = p[0];
  }
  return v as CurvePoints;
};

const checkNumber = (v: unknown, path: string, min = 0): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) return fail(path, `must be a number ≥ ${min}`);
  return v;
};

const checkWeights = (v: unknown, path: string): Record<Role, number> => {
  if (!isObj(v)) return fail(path, "must be an object");
  expectKeys(v, ROLES, path);
  const out = {} as Record<Role, number>;
  for (const r of ROLES) out[r] = checkNumber(v[r], `${path}.${r}`);
  return out;
};

/** Structural + semantic validation. Throws with the offending path in the message. */
export function validateConfig(obj: unknown): EvaluationConfig {
  if (!isObj(obj)) return fail("config", "must be an object");
  expectKeys(obj, ["version", "levelScale", "expectedIlvl", "axes", "axisWeights", "verdict", "confidence"], "config");
  if (typeof obj.version !== "string") fail("version", "must be a string");
  const levelScale = checkCurve(obj.levelScale, "levelScale", 0, 10);

  if (!isObj(obj.expectedIlvl)) fail("expectedIlvl", "must be an object");
  const expectedIlvl: Record<string, CurvePoints> = {};
  for (const [slug, c] of Object.entries(obj.expectedIlvl as Record<string, unknown>))
    expectedIlvl[slug] = checkCurve(c, `expectedIlvl.${slug}`, 0, 1000);

  if (!isObj(obj.axes)) fail("axes", "must be an object");
  expectKeys(obj.axes as Record<string, unknown>, AXIS_KEYS, "axes");
  const axes = {} as EvaluationConfig["axes"];
  const defaultAxes = (defaultJson as unknown as EvaluationConfig).axes;
  for (const k of AXIS_KEYS) {
    const a = (obj.axes as Record<string, unknown>)[k];
    if (!isObj(a)) fail(`axes.${k}`, "must be an object");
    expectKeys(a as Record<string, unknown>, ["subSignals"], `axes.${k}`);
    const subs = (a as Record<string, unknown>).subSignals;
    if (!isObj(subs)) fail(`axes.${k}.subSignals`, "must be an object");
    expectKeys(subs as Record<string, unknown>, Object.keys(defaultAxes[k].subSignals), `axes.${k}.subSignals`);
    const outSubs: EvaluationConfig["axes"][AxisKey]["subSignals"] = {};
    for (const [id, s] of Object.entries(subs as Record<string, unknown>)) {
      const p = `axes.${k}.subSignals.${id}`;
      if (!isObj(s)) fail(p, "must be an object");
      expectKeys(s as Record<string, unknown>, ["curve", "weights"], p);
      outSubs[id] = {
        curve: checkCurve((s as Record<string, unknown>).curve, `${p}.curve`, 0, 100),
        weights: checkWeights((s as Record<string, unknown>).weights, `${p}.weights`),
      };
    }
    axes[k] = { subSignals: outSubs };
  }

  if (!isObj(obj.axisWeights)) fail("axisWeights", "must be an object");
  expectKeys(obj.axisWeights as Record<string, unknown>, ROLES, "axisWeights");
  const axisWeights = {} as EvaluationConfig["axisWeights"];
  for (const r of ROLES) {
    const w = (obj.axisWeights as Record<string, unknown>)[r];
    if (!isObj(w)) fail(`axisWeights.${r}`, "must be an object");
    expectKeys(w as Record<string, unknown>, AXIS_KEYS, `axisWeights.${r}`);
    const out = {} as Record<AxisKey, number>;
    for (const k of AXIS_KEYS) out[k] = checkNumber((w as Record<string, unknown>)[k], `axisWeights.${r}.${k}`);
    axisWeights[r] = out;
  }

  if (!isObj(obj.verdict)) fail("verdict", "must be an object");
  expectKeys(obj.verdict as Record<string, unknown>, ["invite", "maybe", "minRuns"], "verdict");
  const vd = obj.verdict as Record<string, unknown>;
  const verdict = { invite: checkNumber(vd.invite, "verdict.invite"), maybe: checkNumber(vd.maybe, "verdict.maybe"), minRuns: checkNumber(vd.minRuns, "verdict.minRuns") };
  if (verdict.maybe > verdict.invite) fail("verdict.maybe", "must be ≤ verdict.invite");

  if (!isObj(obj.confidence)) fail("confidence", "must be an object");
  expectKeys(obj.confidence as Record<string, unknown>, ["high", "medium", "consistencyMinRuns"], "confidence");
  const cf = obj.confidence as Record<string, unknown>;
  const confidence = { high: checkNumber(cf.high, "confidence.high"), medium: checkNumber(cf.medium, "confidence.medium"), consistencyMinRuns: checkNumber(cf.consistencyMinRuns, "confidence.consistencyMinRuns") };

  return { version: obj.version as string, levelScale, expectedIlvl, axes, axisWeights, verdict, confidence };
}

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

/** First 8 hex chars of SHA-256 over canonical (sorted-key) JSON. */
export const configVersion = (cfg: EvaluationConfig): string =>
  new Bun.CryptoHasher("sha256").update(canonical(cfg)).digest("hex").slice(0, 8);

/** Default config, deep-merged with the user's file when it exists and is valid. */
export async function loadConfig(userPath: string | null): Promise<{ config: EvaluationConfig; warning?: string }> {
  const base = validateConfig(DEFAULT_CONFIG);
  if (!userPath) return { config: base };
  const file = Bun.file(userPath);
  if (!(await file.exists())) return { config: base };
  let override: unknown;
  try {
    override = JSON.parse(await file.text());
  } catch (e) {
    return { config: base, warning: `bmpl: ignoring ${userPath}: not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  try {
    return { config: validateConfig(deepMerge(DEFAULT_CONFIG, override)) };
  } catch (e) {
    return { config: base, warning: `bmpl: ignoring ${userPath}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

let cached: Promise<EvaluationConfig> | null = null;
/** Process-wide effective config (user override next to .env, if any). Warns once on stderr. */
export const getEvalConfig = (): Promise<EvaluationConfig> => {
  if (!cached) {
    cached = resolveEvalConfigPath().then(loadConfig).then((r) => {
      if (r.warning) console.error(r.warning);
      return r.config;
    });
  }
  return cached;
};
```

- [ ] **Step 6: Run** `bun test test/evaluation/config.test.ts && bun run typecheck` — expected: pass. The `unknown key` test with `bogus` must fail at `config.bogus`; adjust the regex if the message reads `config.bogus: unknown key` (it should match `/bogus/` already).

- [ ] **Step 7: Commit** — `git add .gitignore src/evaluation/default-config.json src/evaluation/config.ts src/setup.ts test/evaluation/config.test.ts && git commit -m "feat(evaluation): default rules config, validation, user override merge, version hash"`

---

### Task 4: Inputs — payload → raw per-axis values

**Files:**
- Create: `src/evaluation/inputs.ts`
- Create: `test/evaluation/helpers.ts` (payload builders shared by evaluation tests)
- Test: `test/evaluation/inputs.test.ts`

**Interfaces:**
- Produces (inputs.ts):
  ```ts
  export interface EvalRun { keyLevel: number; parsePercent: number; reportCode: string; fightID: number; signals?: RunSignals }
  export interface EvalPayload {
    metric: "dps" | "hps";
    targetLevel: number;
    perDungeon: { runs: EvalRun[]; dungeonsCovered: number; totalDungeonsInSeason: number; dungeonsAtOrAboveTarget: number; medianLevel: number; medianParse: number };
    prevLevelBest: { best: EvalRun } | null;
    rio: RioProfile | null;
    summary: SignalSummary;
  }
  export interface EvalInputs {
    role: Role; targetLevel: number; runsUsed: number; seasonSlug: string | null;
    survival: { individualDeaths: number | null; wipeDeaths: number | null; avoidableVsPeers: number | null; dtpsVsPeers: number | null; groupDeaths: number | null };
    utility: { hasKick: boolean; kicksVsPeers: number | null; kicksAbsolute: number | null; dispels: number | null; anyDispel: boolean };
    throughput: { medianParse: number | null; parseAtTarget: number | null };
    consistency: { sample: number; parseSpread: number | null; deathsSpread: number | null; damageSpread: number | null };
    preparation: { potions: number | null; healthstones: number | null; ilvl: number | null };
    experience: { coverage: number | null; atTarget: number | null; medianVsTarget: number | null; activity: number | null; prevSeasonAll: number | null };
  }
  export function evalRuns(payload: EvalPayload): EvalRun[]   // prevLevelBest.best + perDungeon.runs, de-duplicated by reportCode:fightID
  export function detectRole(runs: EvalRun[], metric: "dps" | "hps"): Role
  export function collectInputs(payload: EvalPayload): EvalInputs
  ```
  `LookupPayload` is structurally assignable to `EvalPayload`.
- Produces (helpers.ts): `runWith(signals: Partial<RunSignals> & { role?: GroupRole }, extra?: Partial<EvalRun>): EvalRun` (fills a complete `RunSignals` with neutral defaults: 0 deaths, no peers, `usage null`, `kickCooldownS null`, `dispels 0`, `avoidableDamage null`, `consumables null`, `keystone` timed +15) and `payloadWith(runs: EvalRun[], extra?: Partial<EvalPayload>): EvalPayload` (targetLevel 15, coverage 8/8, `atOrAbove` = runs ≥ 15, `medianLevel` / `medianParse` computed from the runs, `rio: null`, `summary` computed via `signalSummary`), plus `fixturePayload(name: "s1-tank" | "s2-healer", withRio: boolean): Promise<EvalPayload>` that builds a one-run payload from the fixtures via `parseRunSignals` + `analyzeLookup` + `parseRioProfile(loadRioFixture(), Date.parse("2026-09-15T12:00:00Z"))`.

Rules (pure, all medians via `median`, means via `mean`):
- `runsUsed` = runs with `signals`. `seasonSlug` = `rio?.seasons[0]?.slug ?? null`.
- `detectRole`: majority of `signals.role` among `dps|healer|tank`; tie → first encountered; none → `metric === "hps" ? "healer" : "dps"`.
- survival: `individualDeaths` = mean over runs with signals of `events.filter(!inWipe).length` (raw, unscaled); `wipeDeaths` = mean of `events.filter(inWipe).length`; `avoidableVsPeers` = median of `Δ%` over runs where `avoidableDamage?.peer` and `peer.median > 0`; `dtpsVsPeers` = median of `Δ%` over runs with `damageTaken.peer` and `peer.median > 0`; `groupDeaths` = mean of `groupTotal − count`. All `null` when their sample is empty.
- utility: `hasKick` = any run with `interrupts.kickCooldownS !== null`; `kicksVsPeers` = median over runs with `usage !== null && peer` of `(usage − peer.median) × 100`; `kicksAbsolute` = median `usage` over runs with `usage !== null`; `dispels` = median `dispels.count` over runs with signals; `anyDispel` = any `dispels.count > 0`.
- throughput: `medianParse` = `perDungeon.medianParse` (null if no runs); `parseAtTarget` = median `parsePercent` of eval runs (with or without signals) where `keyLevel ≥ targetLevel − 1`, null if none.
- consistency: `sample` = `runsUsed`; spreads = `stddev` over runs with signals of `parsePercent`, `deaths.count`, and per-run `Δ%` (avoidable if it has a peer, else dtps if it has a peer, else skip) — `null` when `stddev` returns null.
- preparation: `potions`/`healthstones` = mean over runs with `consumables`; `ilvl` = `rio?.itemLevel ?? null` (the delta vs expected is computed in the axis, it needs the config).
- experience: `coverage` = `dungeonsCovered / totalDungeonsInSeason` (null if total 0); `atTarget` = `dungeonsAtOrAboveTarget / total`; `medianVsTarget` = `medianLevel − targetLevel` (null if no runs); `activity` = `rio?.derived.runsLast7d ?? null`; `prevSeasonAll` = `summary.prevSeason?.all ?? null`.

- [ ] **Step 1: Write the helpers** — `test/evaluation/helpers.ts` (complete code; `signalSummary` from `src/signals/summary.ts`, `analyzeLookup` from `src/mplus.ts`):

```ts
import { analyzeLookup, type MPlusRun } from "../../src/mplus.ts";
import type { EvalPayload, EvalRun } from "../../src/evaluation/inputs.ts";
import { parseRioProfile } from "../../src/signals/rio-profile.ts";
import { signalSummary } from "../../src/signals/summary.ts";
import type { GroupRole, RunSignals } from "../../src/signals/types.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadRioFixture, loadWclFixture } from "../fixtures.ts";

let seq = 0;

export const neutralSignals = (over: Partial<RunSignals> = {}): RunSignals => ({
  role: "dps",
  keystone: { level: 15, chests: 1, timed: true, timeMs: 1_500_000, affixes: [] },
  itemLevel: null,
  consumables: null,
  deaths: { count: 0, groupTotal: 0, events: [] },
  damageTaken: { total: 0, dtps: 0, peer: null },
  interrupts: { count: 0, kickCooldownS: null, capacity: null, usage: null, peer: null },
  dispels: { count: 0 },
  avoidableDamage: null,
  fightDurationMs: 1_500_000,
  ...over,
});

export const deaths = (individual: number, inWipe = 0, groupTotal?: number): RunSignals["deaths"] => ({
  count: individual + inWipe,
  groupTotal: groupTotal ?? individual + inWipe,
  events: [
    ...Array.from({ length: individual }, (_, i) => ({ atMs: 1000 * (i + 1), cause: null, source: null, overkill: 0, inWipe: false })),
    ...Array.from({ length: inWipe }, (_, i) => ({ atMs: 100_000 * (i + 1), cause: null, source: null, overkill: 0, inWipe: true })),
  ],
});

export const runWith = (signals: Partial<RunSignals> | null, extra: Partial<EvalRun> = {}): EvalRun => {
  seq++;
  return {
    keyLevel: 15,
    parsePercent: 70,
    reportCode: `R${seq}`,
    fightID: 1,
    ...(signals === null ? {} : { signals: neutralSignals(signals) }),
    ...extra,
  };
};

export const payloadWith = (runs: EvalRun[], extra: Partial<EvalPayload> = {}): EvalPayload => {
  const targetLevel = extra.targetLevel ?? 15;
  const levels = runs.map((r) => r.keyLevel).sort((a, b) => a - b);
  const parses = runs.map((r) => r.parsePercent).sort((a, b) => a - b);
  const mid = (xs: number[]) => (xs.length === 0 ? 0 : xs.length % 2 ? xs[(xs.length - 1) / 2]! : (xs[xs.length / 2 - 1]! + xs[xs.length / 2]!) / 2);
  const base: EvalPayload = {
    metric: "dps",
    targetLevel,
    perDungeon: {
      runs,
      dungeonsCovered: runs.length,
      totalDungeonsInSeason: 8,
      dungeonsAtOrAboveTarget: runs.filter((r) => r.keyLevel >= targetLevel).length,
      medianLevel: mid(levels),
      medianParse: mid(parses),
    },
    prevLevelBest: null,
    rio: null,
    summary: signalSummary(runs as MPlusRun[], extra.rio ?? null),
  };
  return { ...base, ...extra, perDungeon: { ...base.perDungeon, ...(extra.perDungeon ?? {}) } };
};

export async function fixturePayload(name: "s1-tank" | "s2-healer", withRio: boolean): Promise<EvalPayload> {
  const f = await loadWclFixture(name);
  const run: MPlusRun = { ...f.run };
  run.signals = parseRunSignals(f.report, f.character, { keyLevel: run.keyLevel, affixes: run.affixes, encounterID: run.encounterID })!;
  const result = analyzeLookup([run], run.keyLevel, [{ id: run.encounterID, name: run.encounterName }], true);
  const rio = withRio ? parseRioProfile(await loadRioFixture(), Date.parse("2026-09-15T12:00:00Z")) : null;
  return {
    metric: name === "s2-healer" ? "hps" : "dps",
    targetLevel: result.targetLevel,
    perDungeon: result.perDungeon,
    prevLevelBest: result.prevLevelBest,
    rio,
    summary: signalSummary([run], rio),
  };
}

export type { GroupRole };
```

- [ ] **Step 2: Write the failing tests** — `test/evaluation/inputs.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { collectInputs, detectRole, evalRuns } from "../../src/evaluation/inputs.ts";
import { deaths, fixturePayload, payloadWith, runWith } from "./helpers.ts";

describe("evalRuns / detectRole", () => {
  test("dedupes prevLevelBest against perDungeon", () => {
    const a = runWith({});
    const p = payloadWith([a, runWith({})], { prevLevelBest: { best: a } });
    expect(evalRuns(p).length).toBe(2);
  });
  test("majority role, metric fallback", () => {
    expect(detectRole([runWith({ role: "tank" }), runWith({ role: "dps" }), runWith({ role: "tank" })], "dps")).toBe("tank");
    expect(detectRole([runWith(null)], "hps")).toBe("healer");
    expect(detectRole([], "dps")).toBe("dps");
  });
});

describe("collectInputs — survival", () => {
  test("means and peer medians, nulls when no sample", () => {
    const p = payloadWith([
      runWith({ deaths: deaths(1, 1, 5), damageTaken: { total: 0, dtps: 110, peer: { median: 100, count: 2 } }, avoidableDamage: { total: 0, perMinute: 90, peer: { median: 100, count: 4 }, spellCount: 10 } }),
      runWith({ deaths: deaths(0, 0, 2), damageTaken: { total: 0, dtps: 80, peer: { median: 100, count: 2 } } }),
      runWith(null),
    ]);
    const i = collectInputs(p);
    expect(i.runsUsed).toBe(2);
    expect(i.survival.individualDeaths).toBe(0.5);
    expect(i.survival.wipeDeaths).toBe(0.5);
    expect(i.survival.groupDeaths).toBe(2.5);       // (5-2 + 2-0)/2
    expect(i.survival.dtpsVsPeers).toBe(-5);        // median of +10, -20
    expect(i.survival.avoidableVsPeers).toBe(-10);
    expect(collectInputs(payloadWith([runWith(null)])).survival.individualDeaths).toBeNull();
  });
});

describe("collectInputs — utility", () => {
  test("kick usage vs peers, absolute, dispels, hasKick", () => {
    const p = payloadWith([
      runWith({ interrupts: { count: 5, kickCooldownS: 15, capacity: 100, usage: 0.3, peer: { median: 0.2, count: 3 } }, dispels: { count: 4 } }),
      runWith({ interrupts: { count: 1, kickCooldownS: 15, capacity: 100, usage: 0.1, peer: { median: 0.2, count: 3 } }, dispels: { count: 0 } }),
    ]);
    const i = collectInputs(p);
    expect(i.utility.hasKick).toBe(true);
    expect(i.utility.kicksVsPeers).toBe(0);          // median of +10, -10
    expect(i.utility.kicksAbsolute).toBeCloseTo(0.2, 9);
    expect(i.utility.dispels).toBe(2);
    expect(i.utility.anyDispel).toBe(true);
    const noKick = collectInputs(payloadWith([runWith({})]));
    expect(noKick.utility.hasKick).toBe(false);
    expect(noKick.utility.kicksVsPeers).toBeNull();
    expect(noKick.utility.anyDispel).toBe(false);
  });
});

describe("collectInputs — throughput / consistency / preparation / experience", () => {
  test("parseAtTarget uses runs ≥ target-1 (with or without signals)", () => {
    const p = payloadWith([runWith({}, { keyLevel: 15, parsePercent: 90 }), runWith(null, { keyLevel: 14, parsePercent: 50 }), runWith(null, { keyLevel: 10, parsePercent: 10 })]);
    const i = collectInputs(p);
    expect(i.throughput.medianParse).toBe(50);
    expect(i.throughput.parseAtTarget).toBe(70);
  });
  test("consistency spreads need ≥2 samples", () => {
    const one = collectInputs(payloadWith([runWith({})]));
    expect(one.consistency.parseSpread).toBeNull();
    const two = collectInputs(payloadWith([runWith({ deaths: deaths(2) }, { parsePercent: 60 }), runWith({ deaths: deaths(0) }, { parsePercent: 80 })]));
    expect(two.consistency.sample).toBe(2);
    expect(two.consistency.parseSpread).toBe(10);
    expect(two.consistency.deathsSpread).toBe(1);
    expect(two.consistency.damageSpread).toBeNull();
  });
  test("preparation and experience", () => {
    const p = payloadWith(
      [runWith({ consumables: { potions: 6, healthstones: 2 } }, { keyLevel: 16 }), runWith({ consumables: { potions: 2, healthstones: 0 } }, { keyLevel: 14 }), runWith({})],
      { targetLevel: 15 },
    );
    const i = collectInputs(p);
    expect(i.preparation.potions).toBe(4);
    expect(i.preparation.healthstones).toBe(1);
    expect(i.preparation.ilvl).toBeNull();
    expect(i.experience.coverage).toBe(3 / 8);
    expect(i.experience.atTarget).toBe(2 / 8);
    expect(i.experience.medianVsTarget).toBe(0);
    expect(i.experience.activity).toBeNull();
    expect(i.experience.prevSeasonAll).toBeNull();
  });
});

describe("collectInputs — fixtures", () => {
  test("S1 tank run", async () => {
    const i = collectInputs(await fixturePayload("s1-tank", false));
    expect(i.role).toBe("tank");
    expect(i.runsUsed).toBe(1);
    expect(i.survival.individualDeaths).toBe(0);
    expect(i.survival.avoidableVsPeers).toBeNull();
    expect(i.utility.hasKick).toBe(true);
    expect(i.utility.kicksAbsolute).toBeCloseTo(23 / (1700.498 / 15), 4);
    expect(i.preparation.potions).toBe(1);
    expect(i.seasonSlug).toBeNull();
  });
  test("S2 healer run with RIO", async () => {
    const i = collectInputs(await fixturePayload("s2-healer", true));
    expect(i.role).toBe("healer");
    expect(i.survival.wipeDeaths).toBe(1);
    expect(i.survival.groupDeaths).toBe(4);
    expect(i.utility.hasKick).toBe(false);
    expect(i.utility.dispels).toBe(9);
    expect(i.preparation.ilvl).toBe(322);
    expect(i.preparation.potions).toBe(5);
    expect(i.experience.activity).toBe(10);
    expect(i.experience.prevSeasonAll).toBe(4152.7);
    expect(i.seasonSlug).toBe("season-mn-2");
  });
});
```

- [ ] **Step 3: Run** `bun test test/evaluation/inputs.test.ts` — expected: FAIL (module not found).

- [ ] **Step 4: Implement** — `src/evaluation/inputs.ts` per the rules above. Skeleton (fill every field exactly as specified; keep it a single pure function plus small helpers):

```ts
import type { SignalSummary } from "../signals/summary.ts";
import type { RioProfile, RunSignals } from "../signals/types.ts";
import { mean, median, stddev } from "./curve.ts";
import type { Role } from "./types.ts";

export interface EvalRun { keyLevel: number; parsePercent: number; reportCode: string; fightID: number; signals?: RunSignals }
export interface EvalPayload { /* as in Interfaces */ }
export interface EvalInputs { /* as in Interfaces */ }

const pct = (mine: number, peerMedian: number): number | null => (peerMedian > 0 ? ((mine - peerMedian) / peerMedian) * 100 : null);
const nums = (xs: Array<number | null | undefined>): number[] => xs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

export function evalRuns(payload: EvalPayload): EvalRun[] {
  const all: EvalRun[] = [];
  if (payload.prevLevelBest) all.push(payload.prevLevelBest.best);
  all.push(...payload.perDungeon.runs);
  return [...new Map(all.map((r) => [`${r.reportCode}:${r.fightID}`, r])).values()];
}

export function detectRole(runs: EvalRun[], metric: "dps" | "hps"): Role {
  const counts = new Map<Role, number>();
  for (const r of runs) {
    const role = r.signals?.role;
    if (role === "dps" || role === "healer" || role === "tank") counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  let best: Role | null = null;
  for (const [role, n] of counts) if (best === null || n > counts.get(best)!) best = role;
  return best ?? (metric === "hps" ? "healer" : "dps");
}

export function collectInputs(payload: EvalPayload): EvalInputs {
  const runs = evalRuns(payload);
  const sig = runs.map((r) => r.signals).filter((s): s is RunSignals => s !== undefined);
  const withSig = runs.filter((r) => r.signals !== undefined);
  // …survival / utility / throughput / consistency / preparation / experience per the rules…
}
```

Per-run damage `Δ%` for `damageSpread`: `s.avoidableDamage?.peer ? pct(perMinute, peer.median) : s.damageTaken.peer ? pct(dtps, peer.median) : null`.

- [ ] **Step 5: Run** `bun test test/evaluation/ && bun run typecheck` — expected: pass (`test/evaluation/helpers.ts` must typecheck too — it is under `test/**`).

- [ ] **Step 6: Commit** — `git add src/evaluation/inputs.ts test/evaluation/helpers.ts test/evaluation/inputs.test.ts && git commit -m "feat(evaluation): collect raw per-axis inputs from a lookup payload"`

---

### Task 5: Axis engine and the six axes

**Files:**
- Create: `src/evaluation/axis.ts` (generic engine)
- Create: `src/evaluation/axes/survival.ts`, `utility.ts`, `throughput.ts`, `consistency.ts`, `preparation.ts`, `experience.ts`
- Create: `src/evaluation/axes/index.ts`
- Test: `test/evaluation/axes.test.ts`

**Interfaces:**
- Produces (axis.ts):
  ```ts
  export interface SubSignalInput { id: string; value: number | null; label: (raw: number) => string; x?: (raw: number) => number }  // x = optional transform (level scaling) applied before the curve; label gets the RAW value
  export function confidenceFor(runsUsed: number, cfg: EvaluationConfig): Confidence
  export function scoreAxis(key: AxisKey, subs: SubSignalInput[], role: Role, cfg: EvaluationConfig, runsUsed: number): AxisScore
  ```
  Engine: for each sub with `value !== null` and `weights[role] > 0`: `s = curve(x?.(value) ?? value, curve)`, evidence `{ label: label(value), delta: w × (s − 50), source: "<key>.<id>" }`; score = weighted mean; no contributing sub → `score: null`, `evidence: []`; evidence sorted by `|delta|` desc; confidence = `confidenceFor(runsUsed)`.
- Produces (each axis): `scoreSurvival(inputs, cfg): AxisScore` etc.; (index.ts) `scoreAllAxes(inputs, cfg): AxisScore[]` in `AXIS_KEYS` order.

Axis specifics:
- **survival**: `individualDeaths` and `groupDeaths` use `x: raw => raw × curve(targetLevel, cfg.levelScale)`; labels: `"{raw.toFixed(1)} individual deaths/run"`, `"{raw.toFixed(1)} deaths in wipes/run"`, `"avoidable {±raw.toFixed(0)}% vs peers"`, `"DTPS {±raw.toFixed(0)}% vs peers"`, `"{raw.toFixed(1)} teammate deaths/run"`.
- **utility**: if `!hasKick`, drop `kicksVsPeers`/`kicksAbsolute` (value null). If `!hasKick && !anyDispel && role !== "healer"` → return `{ key, score: null, confidence, evidence: [] }` directly. Labels: `"kicks {±raw.toFixed(0)} pts vs peers"`, `"{(raw×100).toFixed(0)}% of kick capacity used"`, `"{raw.toFixed(1)} dispels/run"`.
- **throughput**: labels `"median parse {raw.toFixed(0)}%"`, `"parse {raw.toFixed(0)}% at target level"`.
- **consistency**: if `inputs.consistency.sample < cfg.confidence.consistencyMinRuns` → `{ key, score: null, confidence: "low", evidence: [] }`; else labels `"parse spread ±{raw.toFixed(0)}%"`, `"deaths spread ±{raw.toFixed(1)}"`, `"damage-vs-peers spread ±{raw.toFixed(0)}%"`; confidence forced `"low"` when `sample < consistencyMinRuns` (already null) — otherwise normal.
- **preparation**: `ilvlVsLevel` value = `ilvl − curve(targetLevel, cfg.expectedIlvl[seasonSlug ?? firstKey])` (null if `ilvl` null; use the first `expectedIlvl` key when `seasonSlug` is null or unknown); labels `"{raw.toFixed(1)} potions/run"`, `"{raw.toFixed(1)} healthstones/run"`, `"ilvl {±raw.toFixed(0)} vs expected"`.
- **experience**: labels `"{(raw×100).toFixed(0)}% dungeons covered"`, `"{(raw×100).toFixed(0)}% dungeons at/above target"`, `"median key {±raw.toFixed(0)} vs target"`, `"{raw} runs in last 7 days"`; after `scoreAxis`, if `prevSeasonAll !== null`: `bonus = Math.min(10, prevSeasonAll / 400)`, `score = clamp(score + bonus, 0, 100)` (only when score is not null), push evidence `{ label: "previous season {all.toFixed(0)}", delta: bonus, source: "experience.prevSeasonBonus" }` and re-sort.

- [ ] **Step 1: Write the failing tests** — `test/evaluation/axes.test.ts` (inputs chosen on curve control points so expected scores are exact):

```ts
import { describe, expect, test } from "bun:test";
import { scoreAxis } from "../../src/evaluation/axis.ts";
import { scoreAllAxes } from "../../src/evaluation/axes/index.ts";
import { scoreConsistency } from "../../src/evaluation/axes/consistency.ts";
import { scoreExperience } from "../../src/evaluation/axes/experience.ts";
import { scorePreparation } from "../../src/evaluation/axes/preparation.ts";
import { scoreSurvival } from "../../src/evaluation/axes/survival.ts";
import { scoreUtility } from "../../src/evaluation/axes/utility.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import type { EvalInputs } from "../../src/evaluation/inputs.ts";

const cfg = validateConfig(DEFAULT_CONFIG);

const baseInputs = (over: Partial<EvalInputs> = {}): EvalInputs => ({
  role: "dps", targetLevel: 16, runsUsed: 6, seasonSlug: "season-mn-2",
  survival: { individualDeaths: null, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: null, groupDeaths: null },
  utility: { hasKick: false, kicksVsPeers: null, kicksAbsolute: null, dispels: null, anyDispel: false },
  throughput: { medianParse: null, parseAtTarget: null },
  consistency: { sample: 6, parseSpread: null, deathsSpread: null, damageSpread: null },
  preparation: { potions: null, healthstones: null, ilvl: null },
  experience: { coverage: null, atTarget: null, medianVsTarget: null, activity: null, prevSeasonAll: null },
  ...over,
});

describe("scoreAxis engine", () => {
  test("weighted mean, evidence delta and order, skips null and zero-weight", () => {
    const a = scoreAxis("survival", [
      { id: "individualDeaths", value: 1, label: (r) => `${r} deaths` },   // 65, w3 → delta +45
      { id: "wipeDeaths", value: null, label: () => "x" },
      { id: "avoidableVsPeers", value: 50, label: (r) => `${r}%` },        // 10, w2 → delta -80
      { id: "groupDeaths", value: 0, label: () => "g" },                    // weight 0 for dps → skipped
    ], "dps", cfg, 6);
    expect(a.score).toBeCloseTo((3 * 65 + 2 * 10) / 5, 6);
    expect(a.evidence.map((e) => e.source)).toEqual(["survival.avoidableVsPeers", "survival.individualDeaths"]);
    expect(a.evidence[0]!.delta).toBe(-80);
    expect(a.evidence[1]!.label).toBe("1 deaths");
    expect(a.confidence).toBe("high");
  });
  test("no contributing sub-signal → null score", () => {
    const a = scoreAxis("throughput", [{ id: "medianParse", value: null, label: () => "" }], "dps", cfg, 2);
    expect(a.score).toBeNull();
    expect(a.evidence).toEqual([]);
    expect(a.confidence).toBe("low");
  });
  test("x transform applies before the curve, label gets raw", () => {
    const a = scoreAxis("survival", [{ id: "individualDeaths", value: 2, x: (r) => r / 2, label: (r) => `${r}` }], "tank", cfg, 4);
    expect(a.score).toBe(65);
    expect(a.evidence[0]!.label).toBe("2");
    expect(a.confidence).toBe("medium");
  });
});

describe("survival", () => {
  test("level scaling: 2 deaths at +8 score like 1.25 at +16; tank has no dtps sub-signal", () => {
    const at8 = scoreSurvival(baseInputs({ targetLevel: 8, survival: { individualDeaths: 1.25, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: 20, groupDeaths: null } }), cfg);
    // 1.25 × 1.6 = 2 → 35 ; dtps +20 → 40 ; dps weights 3,1 → (105+40)/4
    expect(at8.score).toBeCloseTo(145 / 4, 6);
    const tank = scoreSurvival(baseInputs({ role: "tank", survival: { individualDeaths: 0, wipeDeaths: 0, avoidableVsPeers: 0, dtpsVsPeers: 50, groupDeaths: 9 } }), cfg);
    expect(tank.evidence.map((e) => e.source)).not.toContain("survival.dtpsVsPeers");
    expect(tank.evidence.map((e) => e.source)).not.toContain("survival.groupDeaths");
    expect(tank.score).toBeCloseTo((3 * 100 + 1 * 100 + 2 * 65) / 6, 6);
  });
  test("healer counts teammate deaths", () => {
    const h = scoreSurvival(baseInputs({ role: "healer", survival: { individualDeaths: 0, wipeDeaths: null, avoidableVsPeers: null, dtpsVsPeers: null, groupDeaths: 4 } }), cfg);
    expect(h.evidence.map((e) => e.source)).toContain("survival.groupDeaths");
    expect(h.score).toBeCloseTo((3 * 100 + 2 * 45) / 5, 6);
  });
});

describe("utility", () => {
  test("no kick, no dispel, dps → null", () => {
    expect(scoreUtility(baseInputs(), cfg).score).toBeNull();
  });
  test("healer without kick still scored on dispels (0 dispels is information)", () => {
    const h = scoreUtility(baseInputs({ role: "healer", utility: { hasKick: false, kicksVsPeers: null, kicksAbsolute: null, dispels: 0, anyDispel: false } }), cfg);
    expect(h.score).toBe(40);
  });
  test("dps with kicks: peers and absolute", () => {
    const d = scoreUtility(baseInputs({ utility: { hasKick: true, kicksVsPeers: 15, kicksAbsolute: 0.3, dispels: 3, anyDispel: true } }), cfg);
    expect(d.score).toBeCloseTo((3 * 85 + 1 * 80 + 1 * 60) / 5, 6);
  });
});

describe("consistency", () => {
  test("null and low under the minimum sample", () => {
    const c = scoreConsistency(baseInputs({ consistency: { sample: 4, parseSpread: 0, deathsSpread: 0, damageSpread: 0 } }), cfg);
    expect(c.score).toBeNull();
    expect(c.confidence).toBe("low");
  });
  test("scores spreads", () => {
    const c = scoreConsistency(baseInputs({ consistency: { sample: 6, parseSpread: 10, deathsSpread: 1.5, damageSpread: null } }), cfg);
    expect(c.score).toBeCloseTo((2 * 85 + 2 * 45) / 4, 6);
  });
});

describe("preparation", () => {
  test("ilvl vs expected uses the season curve", () => {
    const p = scorePreparation(baseInputs({ targetLevel: 20, preparation: { potions: 6, healthstones: 3, ilvl: 335 } }), cfg);
    // expected at +20 = 325 → +10 → 100 ; potions 6 → 100 ; hs 3 → 100
    expect(p.score).toBe(100);
    expect(p.evidence.find((e) => e.source === "preparation.ilvlVsLevel")!.label).toBe("ilvl +10 vs expected");
  });
  test("unknown season slug falls back to the first curve", () => {
    const p = scorePreparation(baseInputs({ seasonSlug: "season-xx-9", targetLevel: 20, preparation: { potions: null, healthstones: null, ilvl: 315 } }), cfg);
    expect(p.score).toBe(45);
  });
});

describe("experience", () => {
  test("previous season is a capped bonus; absent adds nothing", () => {
    const base = { coverage: 1, atTarget: 1, medianVsTarget: 0, activity: null };
    const none = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: null } }), cfg);
    expect(none.score).toBeCloseTo((2 * 100 + 3 * 100 + 2 * 70) / 7, 6);
    expect(none.evidence.find((e) => e.source === "experience.prevSeasonBonus")).toBeUndefined();
    const some = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: 2000 } }), cfg);
    expect(some.score).toBeCloseTo((2 * 100 + 3 * 100 + 2 * 70) / 7 + 5, 6);
    const big = scoreExperience(baseInputs({ experience: { ...base, prevSeasonAll: 9000 } }), cfg);
    expect(big.score).toBeCloseTo((2 * 100 + 3 * 100 + 2 * 70) / 7 + 10, 6);
    expect(big.evidence.find((e) => e.source === "experience.prevSeasonBonus")!.delta).toBe(10);
  });
  test("bonus is clamped to 100", () => {
    const e = scoreExperience(baseInputs({ experience: { coverage: 1, atTarget: 1, medianVsTarget: 2, activity: 10, prevSeasonAll: 4000 } }), cfg);
    expect(e.score).toBe(100);
  });
});

describe("scoreAllAxes", () => {
  test("six axes in radar order", () => {
    const axes = scoreAllAxes(baseInputs(), cfg);
    expect(axes.map((a) => a.key)).toEqual(["survival", "utility", "throughput", "consistency", "preparation", "experience"]);
  });
});
```

- [ ] **Step 2: Run** `bun test test/evaluation/axes.test.ts` — expected: FAIL (modules not found).

- [ ] **Step 3: Implement the engine** — `src/evaluation/axis.ts`:

```ts
import { curve } from "./curve.ts";
import type { AxisKey, AxisScore, Confidence, EvaluationConfig, Evidence, Role } from "./types.ts";

export interface SubSignalInput {
  id: string;
  value: number | null;
  label: (raw: number) => string;
  x?: (raw: number) => number;
}

export const confidenceFor = (runsUsed: number, cfg: EvaluationConfig): Confidence =>
  runsUsed >= cfg.confidence.high ? "high" : runsUsed >= cfg.confidence.medium ? "medium" : "low";

export function scoreAxis(key: AxisKey, subs: SubSignalInput[], role: Role, cfg: EvaluationConfig, runsUsed: number): AxisScore {
  const conf = cfg.axes[key].subSignals;
  let num = 0;
  let den = 0;
  const evidence: Evidence[] = [];
  for (const sub of subs) {
    const sc = conf[sub.id];
    if (!sc) throw new Error(`no config for ${key}.${sub.id}`);
    const w = sc.weights[role];
    if (sub.value === null || w <= 0) continue;
    const s = curve(sub.x ? sub.x(sub.value) : sub.value, sc.curve);
    num += w * s;
    den += w;
    evidence.push({ label: sub.label(sub.value), delta: w * (s - 50), source: `${key}.${sub.id}` });
  }
  evidence.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { key, score: den > 0 ? num / den : null, confidence: confidenceFor(runsUsed, cfg), evidence };
}
```

- [ ] **Step 4: Implement the six axes** — one file each, following the "Axis specifics" above. Example `src/evaluation/axes/survival.ts`:

```ts
import { curve } from "../curve.ts";
import { scoreAxis } from "../axis.ts";
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";

const signed = (v: number, digits = 0) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export function scoreSurvival(i: EvalInputs, cfg: EvaluationConfig): AxisScore {
  const scale = curve(i.targetLevel, cfg.levelScale);
  const s = i.survival;
  return scoreAxis("survival", [
    { id: "individualDeaths", value: s.individualDeaths, x: (r) => r * scale, label: (r) => `${r.toFixed(1)} individual deaths/run` },
    { id: "wipeDeaths", value: s.wipeDeaths, label: (r) => `${r.toFixed(1)} deaths in wipes/run` },
    { id: "avoidableVsPeers", value: s.avoidableVsPeers, label: (r) => `avoidable ${signed(r)}% vs peers` },
    { id: "dtpsVsPeers", value: s.dtpsVsPeers, label: (r) => `DTPS ${signed(r)}% vs peers` },
    { id: "groupDeaths", value: s.groupDeaths, x: (r) => r * scale, label: (r) => `${r.toFixed(1)} teammate deaths/run` },
  ], i.role, cfg, i.runsUsed);
}
```

`utility.ts`, `throughput.ts`, `consistency.ts`, `preparation.ts`, `experience.ts` in the same shape with the rules and labels from "Axis specifics" (experience applies the bonus after `scoreAxis`; consistency and utility return the early `null` results described). `axes/index.ts`:

```ts
import type { EvalInputs } from "../inputs.ts";
import type { AxisScore, EvaluationConfig } from "../types.ts";
import { scoreConsistency } from "./consistency.ts";
import { scoreExperience } from "./experience.ts";
import { scorePreparation } from "./preparation.ts";
import { scoreSurvival } from "./survival.ts";
import { scoreThroughput } from "./throughput.ts";
import { scoreUtility } from "./utility.ts";

export const scoreAllAxes = (i: EvalInputs, cfg: EvaluationConfig): AxisScore[] => [
  scoreSurvival(i, cfg), scoreUtility(i, cfg), scoreThroughput(i, cfg),
  scoreConsistency(i, cfg), scorePreparation(i, cfg), scoreExperience(i, cfg),
];
```

- [ ] **Step 5: Run** `bun test test/evaluation/ && bun run typecheck` — expected: pass. If a `toBeCloseTo` differs only by float rounding, loosen digits; if an integer/exact expectation differs, the implementation is wrong — fix the implementation.

- [ ] **Step 6: Commit** — `git add src/evaluation/axis.ts src/evaluation/axes test/evaluation/axes.test.ts && git commit -m "feat(evaluation): generic axis engine and the six axes"`

---

### Task 6: `evaluate()` — role, global, verdict

**Files:**
- Create: `src/evaluation/evaluate.ts`
- Test: `test/evaluation/evaluate.test.ts`

**Interfaces:**
- Produces: `evaluate(payload: EvalPayload, cfg: EvaluationConfig): Evaluation`; `globalScore(axes, role, cfg): number | null`; `verdictFor(global, runsUsed, cfg): Verdict`.

- [ ] **Step 1: Write the failing tests** — `test/evaluation/evaluate.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, configVersion, deepMerge, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate, globalScore, verdictFor } from "../../src/evaluation/evaluate.ts";
import type { AxisScore } from "../../src/evaluation/types.ts";
import { deaths, fixturePayload, payloadWith, runWith } from "./helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const ax = (key: AxisScore["key"], score: number | null): AxisScore => ({ key, score, confidence: "high", evidence: [] });

describe("globalScore / verdictFor", () => {
  test("weighted mean excludes null axes; all null → null", () => {
    const axes = [ax("survival", 100), ax("utility", null), ax("throughput", 50), ax("consistency", null), ax("preparation", null), ax("experience", null)];
    expect(globalScore(axes, "dps", cfg)).toBeCloseTo((3 * 100 + 3 * 50) / 6, 6);
    expect(globalScore(axes.map((a) => ({ ...a, score: null })), "dps", cfg)).toBeNull();
  });
  test("thresholds at the boundaries and insufficient", () => {
    expect(verdictFor(70, 3, cfg)).toBe("invite");
    expect(verdictFor(69.99, 3, cfg)).toBe("maybe");
    expect(verdictFor(45, 3, cfg)).toBe("maybe");
    expect(verdictFor(44.99, 3, cfg)).toBe("pass");
    expect(verdictFor(90, 2, cfg)).toBe("insufficient");
    expect(verdictFor(null, 9, cfg)).toBe("insufficient");
  });
});

describe("evaluate", () => {
  const good = () => runWith({
    deaths: deaths(0), consumables: { potions: 6, healthstones: 3 },
    interrupts: { count: 30, kickCooldownS: 15, capacity: 100, usage: 0.3, peer: { median: 0.2, count: 3 } },
    avoidableDamage: { total: 0, perMinute: 60, peer: { median: 100, count: 4 }, spellCount: 10 },
    damageTaken: { total: 0, dtps: 90, peer: { median: 100, count: 2 } },
  }, { parsePercent: 90, keyLevel: 16 });

  test("a strong DPS profile is invited, six axes, config version present", () => {
    const p = payloadWith(Array.from({ length: 8 }, good), { targetLevel: 16 });
    const e = evaluate(p, cfg);
    expect(e.role).toBe("dps");
    expect(e.targetLevel).toBe(16);
    expect(e.runsUsed).toBe(8);
    expect(e.axes.map((a) => a.key)).toEqual(["survival", "utility", "throughput", "consistency", "preparation", "experience"]);
    expect(e.axes.every((a) => a.confidence === "high")).toBe(true);
    expect(e.global!).toBeGreaterThan(85);
    expect(e.verdict).toBe("invite");
    expect(e.configVersion).toBe(configVersion(cfg));
  });

  test("a weak profile passes; user thresholds are honoured", () => {
    const bad = () => runWith({ deaths: deaths(3, 1), avoidableDamage: { total: 0, perMinute: 150, peer: { median: 100, count: 4 }, spellCount: 10 } }, { parsePercent: 10, keyLevel: 10 });
    const p = payloadWith(Array.from({ length: 6 }, bad), { targetLevel: 16 });
    expect(evaluate(p, cfg).verdict).toBe("pass");
    const lenient = validateConfig(deepMerge(DEFAULT_CONFIG, { verdict: { invite: 20, maybe: 10 } }));
    expect(evaluate(p, lenient).verdict).toBe("invite");
  });

  test("fewer than minRuns runs with signals → insufficient, axes still scored", () => {
    const p = payloadWith([good(), good(), runWith(null), runWith(null)], { targetLevel: 16 });
    const e = evaluate(p, cfg);
    expect(e.runsUsed).toBe(2);
    expect(e.verdict).toBe("insufficient");
    expect(e.axes[0]!.score).not.toBeNull();
    expect(e.axes[3]!.score).toBeNull(); // consistency needs 5
  });

  test("fixtures: single-run payloads evaluate without throwing and are insufficient", async () => {
    const tank = evaluate(await fixturePayload("s1-tank", false), cfg);
    expect(tank.role).toBe("tank");
    expect(tank.verdict).toBe("insufficient");
    expect(tank.axes[0]!.score).toBe(100);                       // 0 deaths, no avoidable list, no dtps for tank
    expect(tank.axes[1]!.score!).toBeGreaterThan(50);            // kicks ≈ peers
    expect(tank.axes[1]!.score!).toBeLessThan(70);
    const heal = evaluate(await fixturePayload("s2-healer", true), cfg);
    expect(heal.role).toBe("healer");
    expect(heal.axes[1]!.evidence.map((e) => e.source)).toEqual(["utility.dispels"]);
    expect(heal.axes[4]!.evidence.map((e) => e.source)).toContain("preparation.ilvlVsLevel");
    expect(heal.axes[5]!.evidence.map((e) => e.source)).toContain("experience.prevSeasonBonus");
  });
});
```

- [ ] **Step 2: Run** `bun test test/evaluation/evaluate.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/evaluation/evaluate.ts`:

```ts
import { scoreAllAxes } from "./axes/index.ts";
import { configVersion } from "./config.ts";
import { collectInputs, type EvalPayload } from "./inputs.ts";
import type { AxisScore, Evaluation, EvaluationConfig, Role, Verdict } from "./types.ts";

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

export function verdictFor(global: number | null, runsUsed: number, cfg: EvaluationConfig): Verdict {
  if (global === null || runsUsed < cfg.verdict.minRuns) return "insufficient";
  if (global >= cfg.verdict.invite) return "invite";
  if (global >= cfg.verdict.maybe) return "maybe";
  return "pass";
}

/** Pure: same payload + same config → same evaluation. */
export function evaluate(payload: EvalPayload, cfg: EvaluationConfig): Evaluation {
  const inputs = collectInputs(payload);
  const axes = scoreAllAxes(inputs, cfg);
  const global = globalScore(axes, inputs.role, cfg);
  return {
    role: inputs.role,
    targetLevel: inputs.targetLevel,
    axes,
    global,
    verdict: verdictFor(global, inputs.runsUsed, cfg),
    runsUsed: inputs.runsUsed,
    configVersion: configVersion(cfg),
  };
}
```

- [ ] **Step 4: Run** `bun test test/evaluation/ && bun run typecheck` — expected: pass. If the "strong DPS" global is not > 85, print the axes and check which sub-signal drags — the inputs sit on 100-point control points except `kicksVsPeers` (+10 pts → 78.3) and `dtps −10%` (80); expected global ≈ 92.

- [ ] **Step 5: Commit** — `git add src/evaluation/evaluate.ts test/evaluation/evaluate.test.ts && git commit -m "feat(evaluation): evaluate(): role, global score, verdict"`

---

### Task 7: Lookup integration, CLI rendering, `bmpl evaluate`

**Files:**
- Modify: `src/lookup.ts` (outcome + payload gain `evaluation`)
- Modify: `src/format-mplus.ts` (add `renderEvaluation`, call it in `renderLookup` right after `renderSummaryLine`)
- Modify: `src/cli.ts` (pass `o.evaluation` to `renderLookup`; new `evaluate` command; usage text; `just` recipe)
- Modify: `src/watch.ts` (pass `o.evaluation`)
- Modify: `justfile` (recipe `evaluate file`)
- Test: `test/format.test.ts` (append), `test/evaluation/cli.test.ts`

**Interfaces:**
- `LookupOutcome` (ok) gains `evaluation: Evaluation`; `buildLookupPayload` emits `evaluation`.
- `renderLookup(data, result, rio, rioError, summary, evaluation)`; `renderEvaluation(ev: Evaluation): string` exported.
- CLI: `bmpl evaluate <payload.json>` — reads a saved `--json` payload, runs `evaluate` with the effective config, prints `renderEvaluation`; `--json` prints the `Evaluation` object.

Rendering rules for `renderEvaluation` (ANSI via picocolors; tests strip it):
```
Verdict: INVITE 78  ·  Survival 82  Utility 61  Throughput 88  Consistency n/a  Preparation 55  Experience 74  (high confidence, 9 runs)
  Survival     +18 0.2 individual deaths/run  ·  −6 avoidable +12% vs peers
  Utility      …
```
- Verdict word upper-case, colored green/yellow/red/dim for invite/maybe/pass/insufficient; `INSUFFICIENT DATA (2 runs)` replaces `INVITE 78` when insufficient (global still shown if not null: `INSUFFICIENT DATA (2 runs, 81)`).
- Axis scores `Math.round`; `n/a` when null; per-axis line lists the two evidences with largest `|delta|` as `±delta label` (delta rounded, sign always shown), skipped when an axis has no evidence.
- Confidence label = the minimum confidence across non-null axes (`low` < `medium` < `high`).

- [ ] **Step 1: Write the failing tests** — append to `test/format.test.ts`:

```ts
import { renderEvaluation } from "../src/format-mplus.ts";
import type { Evaluation } from "../src/evaluation/types.ts";

const evalFixture = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 16, runsUsed: 9, global: 78.4, verdict: "invite", configVersion: "deadbeef",
  axes: [
    { key: "survival", score: 82, confidence: "high", evidence: [{ label: "0.2 individual deaths/run", delta: 18, source: "survival.individualDeaths" }, { label: "avoidable +12% vs peers", delta: -6, source: "survival.avoidableVsPeers" }, { label: "x", delta: 1, source: "survival.wipeDeaths" }] },
    { key: "utility", score: 61, confidence: "high", evidence: [] },
    { key: "throughput", score: 88, confidence: "high", evidence: [] },
    { key: "consistency", score: null, confidence: "low", evidence: [] },
    { key: "preparation", score: 55, confidence: "medium", evidence: [] },
    { key: "experience", score: 74, confidence: "high", evidence: [] },
  ],
  ...over,
});

describe("renderEvaluation", () => {
  test("verdict line, axis scores, n/a, two evidences, min confidence", () => {
    const out = strip(renderEvaluation(evalFixture()));
    expect(out).toContain("Verdict: INVITE 78");
    expect(out).toContain("Survival 82");
    expect(out).toContain("Consistency n/a");
    expect(out).toContain("(medium confidence, 9 runs)");
    expect(out).toMatch(/Survival\s+\+18 0\.2 individual deaths\/run\s+·\s+-6 avoidable \+12% vs peers/);
    expect(out).not.toContain("+1 x");
  });
  test("insufficient data", () => {
    const out = strip(renderEvaluation(evalFixture({ verdict: "insufficient", runsUsed: 2, global: 81 })));
    expect(out).toContain("INSUFFICIENT DATA (2 runs, 81)");
    const out2 = strip(renderEvaluation(evalFixture({ verdict: "insufficient", runsUsed: 0, global: null })));
    expect(out2).toContain("INSUFFICIENT DATA (0 runs)");
  });
});
```

and `test/evaluation/cli.test.ts` (end-to-end through the CLI on a saved payload; no network):

```ts
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { fixturePayload } from "./helpers.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const tmp = path.join(import.meta.dir, "..", "..", ".superpowers-test-tmp");

describe("bmpl evaluate <payload.json>", () => {
  test("prints the evaluation for a saved payload, --json emits the object", async () => {
    const p = path.join(tmp, "payload.json");
    await Bun.write(p, JSON.stringify(await fixturePayload("s2-healer", true)));
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", p], { cwd: path.join(import.meta.dir, "..", ".."), env: { ...process.env, BMPL_EVAL_CONFIG: path.join(tmp, "none.json") } });
    expect(proc.exitCode).toBe(0);
    const out = strip(proc.stdout.toString());
    expect(out).toContain("INSUFFICIENT DATA (1 run");
    expect(out).toContain("Survival");
    const js = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", p, "--json"], { cwd: path.join(import.meta.dir, "..", ".."), env: { ...process.env, BMPL_EVAL_CONFIG: path.join(tmp, "none.json") } });
    const ev = JSON.parse(js.stdout.toString());
    expect(ev.role).toBe("healer");
    expect(ev.axes.length).toBe(6);
  });
  test("missing file → exit 1 with a message", () => {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", "evaluate", path.join(tmp, "nope.json")], { cwd: path.join(import.meta.dir, "..", "..") });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toMatch(/nope\.json/);
  });
});
```

(`"1 run"` — pluralize: `1 run`, `2 runs`.)

- [ ] **Step 2: Run** `bun test test/format.test.ts test/evaluation/cli.test.ts` — expected: FAIL.

- [ ] **Step 3: Integrate in `lookup.ts`**: import `evaluate` and `getEvalConfig`; add `evaluation: Evaluation` to the ok outcome; in `performLookup`, after computing `summary`, build `const payloadForEval = { metric: data.metric, targetLevel: result.targetLevel, perDungeon: result.perDungeon, prevLevelBest: result.prevLevelBest, rio: rioRes.profile, summary }` and `evaluation: evaluate(payloadForEval, deps.evalConfig ?? (await getEvalConfig()))` (add `evalConfig?: EvaluationConfig` to `Deps`); add `evaluation: o.evaluation` to `buildLookupPayload`. `MPlusRun` must be assignable to `EvalRun` (it is: same field names).

- [ ] **Step 4: `renderEvaluation` in `format-mplus.ts`** (add the import of `Evaluation`, `AxisKey`):

```ts
const AXIS_LABEL: Record<AxisKey, string> = {
  survival: "Survival", utility: "Utility", throughput: "Throughput",
  consistency: "Consistency", preparation: "Preparation", experience: "Experience",
};
const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;

export const renderEvaluation = (ev: Evaluation): string => {
  const runs = `${ev.runsUsed} run${ev.runsUsed === 1 ? "" : "s"}`;
  const g = ev.global === null ? null : Math.round(ev.global);
  let verdict: string;
  switch (ev.verdict) {
    case "invite": verdict = pc.green(pc.bold(`INVITE ${g}`)); break;
    case "maybe": verdict = pc.yellow(pc.bold(`MAYBE ${g}`)); break;
    case "pass": verdict = pc.red(pc.bold(`PASS ${g}`)); break;
    default: verdict = dim(`INSUFFICIENT DATA (${runs}${g === null ? "" : `, ${g}`})`);
  }
  const scored = ev.axes.filter((a) => a.score !== null);
  const minConf = scored.length === 0 ? "low" : scored.reduce((m, a) => (CONF_RANK[a.confidence] < CONF_RANK[m] ? a.confidence : m), "high" as Evaluation["axes"][number]["confidence"]);
  const axisPart = ev.axes.map((a) => `${AXIS_LABEL[a.key]} ${a.score === null ? dim("n/a") : pc.bold(String(Math.round(a.score)))}`).join("  ");
  const lines = [`${heading("Verdict:")} ${verdict}  ${dim("·")}  ${axisPart}  ${dim(`(${minConf} confidence, ${runs})`)}`];
  for (const a of ev.axes) {
    if (a.evidence.length === 0) continue;
    const ev2 = a.evidence.slice(0, 2).map((e) => {
      const d = Math.round(e.delta);
      const tag = `${d >= 0 ? "+" : "-"}${Math.abs(d)}`;
      return `${d >= 0 ? pc.green(tag) : pc.red(tag)} ${e.label}`;
    });
    lines.push(`  ${AXIS_LABEL[a.key].padEnd(12)} ${ev2.join(`  ${dim("·")}  `)}`);
  }
  return lines.join("\n");
};
```

In `renderLookup`, add the parameter `evaluation: Evaluation` and push `renderEvaluation(evaluation)` right after `renderSummaryLine(summary)` (blank line between). Update `cli.ts` (`cmdLookup`) and `watch.ts` call sites to pass `o.evaluation`.

- [ ] **Step 5: `bmpl evaluate` command** in `cli.ts`:

```ts
async function cmdEvaluate(file: string, json: boolean): Promise<void> {
  const f = Bun.file(file);
  if (!(await f.exists())) {
    console.error(err(`✗ file not found: ${file}`));
    process.exit(1);
  }
  const payload = JSON.parse(await f.text()) as EvalPayload;
  const ev = evaluate(payload, await getEvalConfig());
  if (json) console.log(JSON.stringify(ev, null, 2));
  else console.log(renderEvaluation(ev));
}
```

Wire `case "evaluate"` (first positional = file, `--json` flag; usage error → exit 2), add to the usage text under the main commands: `bmpl evaluate <payload.json> [--json]   Re-run the evaluation model on a saved lookup (--json output). Uses evaluation.json next to .env if present.` Add to `justfile`:

```make
# re-run the evaluation model on a saved `bmpl lookup --json` payload
evaluate file *flags:
    bun src/cli.ts evaluate {{file}} {{flags}}
```

- [ ] **Step 6: Run** `bun test && bun run typecheck` — expected: green (the CLI test spawns `bun src/cli.ts` — it must not need WCL credentials for `evaluate`; make sure `cmdEvaluate` does not call `requireCredentials`).

- [ ] **Step 7: Smoke (live, allowed once)** — `timeout 90 bun src/cli.ts lookup Muleyoxo-Silvermoon | head -20` shows the `Verdict:` block after the summary line; `bun src/cli.ts lookup Muleyoxo-Silvermoon --json > /tmp/p.json && bun src/cli.ts evaluate /tmp/p.json` prints the same block.

- [ ] **Step 8: Commit** — `git add src/lookup.ts src/format-mplus.ts src/cli.ts src/watch.ts justfile test/format.test.ts test/evaluation/cli.test.ts && git commit -m "feat: evaluation in the lookup payload, CLI verdict block, bmpl evaluate <payload.json>"`

---

### Task 8: Web UI and README

**Files:**
- Modify: `src/server-ui.ts` (client JS in the template string + CSS)
- Modify: `README.md`

No automated tests for the client JS: gates are `bun run typecheck`, `bun test`, and `node --check` on the extracted inline script, plus a served-page check via curl with a saved payload is not possible (the page fetches live) — use `just serve` + one live lookup (allowed once) and eyeball; or execute `render()`/`renderCompareTable()` on the saved `/tmp/p.json` payload in a scratch `node` script as Task 12 of the previous plan did.

- [ ] **Step 1: Verdict badge + axis tiles in `render`.** After the `.metaline` block and before the existing `// Stat tiles`, insert:

```js
  const ev = payload.evaluation;
  const AXIS_LABEL = { survival: 'Survival', utility: 'Utility', throughput: 'Throughput', consistency: 'Consistency', preparation: 'Preparation', experience: 'Experience' };
  const verdictCls = { invite: 'verdict-invite', maybe: 'verdict-maybe', pass: 'verdict-pass', insufficient: 'verdict-insufficient' }[ev.verdict];
  const g = ev.global === null ? null : Math.round(ev.global);
  const runsTxt = ev.runsUsed + ' run' + (ev.runsUsed === 1 ? '' : 's');
  const verdictTxt = ev.verdict === 'insufficient'
    ? 'INSUFFICIENT DATA (' + runsTxt + (g === null ? '' : ', ' + g) + ')'
    : ev.verdict.toUpperCase() + ' ' + g;
  html += '<div class="verdict ' + verdictCls + '">' + verdictTxt + '<span class="verdict-sub">' + runsTxt + ' · config ' + esc(ev.configVersion) + '</span></div>';
  html += '<div class="axes">';
  for (const a of ev.axes) {
    const dot = '<span class="conf conf-' + a.confidence + '" title="' + a.confidence + ' confidence"></span>';
    const val = a.score === null ? '<span class="dim">n/a</span>' : String(Math.round(a.score));
    const evid = a.evidence.map((e) => {
      const d = Math.round(e.delta);
      return '<li><span class="' + (d >= 0 ? 'deaths-0' : 'deaths-high') + '">' + (d >= 0 ? '+' : '-') + Math.abs(d) + '</span> ' + esc(e.label) + '</li>';
    }).join('');
    html += '<details class="axis"><summary><span class="axis-label">' + AXIS_LABEL[a.key] + '</span> ' + dot + '<span class="axis-score">' + val + '</span></summary>' +
      (evid ? '<ul class="evidence">' + evid + '</ul>' : '<div class="dim" style="padding:.25rem .5rem">no data</div>') + '</details>';
  }
  html += '</div>';
```

CSS additions in `COMMON_CSS` (dark theme, matching existing tokens):

```css
.verdict { margin-top: .75rem; padding: .45rem .75rem; border-radius: 6px; font-weight: 700; letter-spacing: .03em; display: inline-flex; gap: .75rem; align-items: baseline; }
.verdict .verdict-sub { font-weight: 400; font-size: .75rem; color: #8b949e; letter-spacing: 0; }
.verdict-invite { background: #0a2e1a; color: #56d364; border: 1px solid #1f6f3a; }
.verdict-maybe { background: #2e2a0a; color: #e3b341; border: 1px solid #7a6a1f; }
.verdict-pass { background: #2e0a0a; color: #f85149; border: 1px solid #7a1f1f; }
.verdict-insufficient { background: #161b22; color: #8b949e; border: 1px solid #30363d; }
.axes { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .6rem; }
.axis { background: #0b0f14; border: 1px solid #21262d; border-radius: 6px; min-width: 9rem; }
.axis summary { list-style: none; cursor: pointer; padding: .4rem .65rem; display: flex; gap: .4rem; align-items: center; }
.axis summary::-webkit-details-marker { display: none; }
.axis .axis-label { color: #8b949e; font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; flex: 1; }
.axis .axis-score { font-size: 1rem; font-weight: 600; color: #e6edf3; }
.conf { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.conf-high { background: #56d364; } .conf-medium { background: #e3b341; } .conf-low { background: #6e7681; }
.evidence { list-style: none; padding: .25rem .65rem .5rem; margin: 0; font-size: .78rem; color: #c9d1d9; }
.evidence li { padding: .1rem 0; }
```

- [ ] **Step 2: Compare table.** In `summaryStatsFromPayload` add `evaluation: payload.evaluation`. In `renderCompareTable`, insert after the `Target level` row a `Verdict` row (`mode: 'none'`, cell = the same `verdictTxt` logic with the badge class on a `<span>`), a `Global` row (`mode: 'higher'`, values `e.stats.evaluation.global`, cell rounded or `—`), and six axis rows (`mode: 'higher'`, values `axes[i].score`, cell rounded or `n/a`), labelled with `AXIS_LABEL` (hoist `AXIS_LABEL` to a module-level `const` next to `CLASSES` so both functions share it).

- [ ] **Step 3: Verify.** `bun run typecheck && bun test`; extract both inline scripts (`renderMainPage()` / `renderSetupPage()`) and `node --check` them; run `render(payload)` and `renderCompareTable([{tab:{key:'a'}, payload}, {tab:{key:'b'}, payload}])` in a scratch script against `/tmp/p.json` from Task 7 (stub `document`/`esc` as the previous plan's Task 12 did) and confirm the HTML contains `class="verdict `, six `<details class="axis">`, and the `Global` compare row. Then `just serve`, look up one character, confirm the badge and tiles render and the `<details>` expand.

- [ ] **Step 4: README.** Add a section **"Verdict and axes"** after "What you get": what the six axes measure (one line each), that the score is rule-based and every axis lists its evidence, that timed/depleted is deliberately not scored, that fewer than 3 enriched runs yields "insufficient data", and how to tune: copy `src/evaluation/default-config.json` to `evaluation.json` next to `.env` (or `BMPL_EVAL_CONFIG=…`), override only the keys you want (deep-merged), and use `bmpl evaluate saved.json` on payloads captured with `bmpl lookup … --json` to see the effect without spending API points. Add `bmpl evaluate` to the commands list and `just evaluate` to the recipes.

- [ ] **Step 5: Commit** — `git add src/server-ui.ts README.md && git commit -m "feat(web): verdict badge, axis tiles with evidence, compare rows; README: evaluation model"`

---

## Self-review

**Spec coverage.** Output model → T2/T6. Curve/levelScale/stddev/aggregation/evidence/confidence → T2/T5. Consumables → T1. Inputs incl. dedupe, role detection, `Δ%`/pts, parseAtTarget, spreads, ilvl, activity, prev season → T4. Six axes with role weights, utility null rule, consistency ≥5 rule, expectedIlvl per season with fallback, prev-season bonus/no-malus → T3 (config) + T5. Global/verdict/insufficient → T6. Config validation (monotonic curves, 0–100, weights ≥ 0, roles/axes present, unknown keys with path), override deep-merge, invalid override warning, `configVersion` hash → T3. Payload `evaluation`, CLI block, `bmpl evaluate`, web badge/tiles/compare, README → T7/T8. Timed never used: no task reads `keystone.timed` in `src/evaluation/`.

**Deviations from the spec:** the spec's "—" weights are encoded as `0` in the JSON and skipped by the engine (simpler than optional keys); `expectedIlvl` falls back to the first configured season when the slug is unknown (spec left it implicit).

**Placeholders.** `inputs.ts` Step 4 gives a skeleton plus exhaustive rules in the Interfaces block; the five non-example axis files are described by the "Axis specifics" list with every label and rule. Everything else carries full code.

**Type consistency.** `EvalRun`/`EvalPayload`/`EvalInputs` (T4) are consumed by T5/T6/T7 with the same field names; `scoreAxis(key, subs, role, cfg, runsUsed)` (T5) is used by every axis; `evaluate(payload, cfg)` (T6) by T7; `renderLookup` gains a sixth parameter `evaluation` and both call sites are updated in T7.
