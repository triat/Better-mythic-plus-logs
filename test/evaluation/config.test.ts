import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
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
mkdirSync(tmp(""), { recursive: true });

describe("default config", () => {
  test("validates and has every axis, role and threshold", () => {
    const cfg = validateConfig(DEFAULT_CONFIG);
    for (const k of AXIS_KEYS) expect(Object.keys(cfg.axes[k].subSignals).length).toBeGreaterThan(0);
    expect(cfg.axisWeights.tank.experience).toBe(2.5);
    expect(cfg.verdict).toEqual({ invite: 70, maybe: 30, minRuns: 3 });
    for (const role of ["dps", "healer", "tank"] as const) {
      expect(cfg.globalCurve[role][0]).toEqual([0, 0]);
      expect(cfg.globalCurve[role].at(-1)).toEqual([100, 100]);
    }
    expect(cfg.expectedIlvl["season-mn-2"]).toBeDefined();
  });
});

describe("validateConfig", () => {
  test("globalCurve: every role required, y within 0..100 and never decreasing", () => {
    const missing = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, Record<string, unknown>>;
    delete missing.globalCurve!.tank;
    expect(() => validateConfig(missing)).toThrow(/globalCurve\.tank: missing/);
    const falling = deepMerge(DEFAULT_CONFIG, { globalCurve: { dps: [[0, 0], [50, 60], [70, 40], [100, 100]] } });
    expect(() => validateConfig(falling)).toThrow(/globalCurve\.dps: y must not decrease/);
    const tooHigh = deepMerge(DEFAULT_CONFIG, { globalCurve: { healer: [[0, 0], [100, 120]] } });
    expect(() => validateConfig(tooHigh)).toThrow(/globalCurve\.healer\[1\]/);
  });
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
  test("confidence.deepdiveMinRuns is required and numeric", () => {
    expect(validateConfig(DEFAULT_CONFIG).confidence.deepdiveMinRuns).toBe(2);
    expect(() => validateConfig(deepMerge(DEFAULT_CONFIG, { confidence: { deepdiveMinRuns: "x" } }))).toThrow(/deepdiveMinRuns/);
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
    const { confidence, verdict, ...rest } = DEFAULT_CONFIG;
    const reordered = { confidence, verdict, ...rest };
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
    expect(r.config.verdict.maybe).toBe(30);
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
