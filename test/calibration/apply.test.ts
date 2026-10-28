import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCandidate, applyProposal, configText, planApply, STALE_MS } from "../../src/calibration/apply.ts";
import type { FitResult } from "../../src/calibration/report.ts";
import { validateConfig } from "../../src/evaluation/config.ts";

const TEXT = readFileSync("src/evaluation/default-config.json", "utf8");
const cfg = validateConfig(JSON.parse(TEXT));
const NOW = 1_800_000_000_000;
const fit = (over: Partial<FitResult> = {}): FitResult => ({
  fittedAt: NOW, baseVersion: cfg.version, candidate: { globalCurve: cfg.globalCurve, reference: cfg.reference },
  roles: {} as FitResult["roles"], test: 300, verdictChanges: 12, thresholdMet: true, reason: "4.0 % change verdict", ...over,
});

describe("calibration pull request", () => {
  test("plan: above the threshold → apply; below or on another config version → nothing; stale → fail", () => {
    expect(planApply(fit(), cfg.version, NOW)).toEqual({ apply: true, reason: "4.0 % change verdict" });
    expect(planApply(fit({ thresholdMet: false, reason: "below" }), cfg.version, NOW)).toEqual({ apply: false, fail: false, reason: "below" });
    expect(planApply(fit({ baseVersion: "7" }), cfg.version, NOW)).toMatchObject({ apply: false, fail: false });
    expect(planApply(fit({ fittedAt: NOW - STALE_MS - 1 }), cfg.version, NOW)).toMatchObject({ apply: false, fail: true });
  });

  test("apply: today's blocks written back give the same file, version aside", () => {
    const out = applyCandidate(TEXT, fit().candidate);
    expect(out.version).toBe(String(Number(cfg.version) + 1));
    expect(out.text.replace(`"version": "${out.version}"`, `"version": "${cfg.version}"`)).toBe(TEXT);
  });

  test("apply: moved numbers land in their blocks, nothing else changes", () => {
    const moved = structuredClone(cfg.globalCurve);
    const point: [number, number] = [Math.round(((moved.dps[5]![0] + moved.dps[6]![0]) / 2) * 10) / 10, moved.dps[6]![1]];
    moved.dps[6] = point;
    const ref = structuredClone(cfg.reference);
    const dispels = { x: ref.tank["utility.dispels"]!.x + 1, value: ref.tank["utility.dispels"]!.value + 1 };
    ref.tank["utility.dispels"] = dispels;
    const out = applyCandidate(TEXT, { globalCurve: moved, reference: ref });
    const parsed = validateConfig(JSON.parse(out.text));
    expect(parsed.globalCurve.dps[6]).toEqual(point);
    expect(parsed.reference.tank["utility.dispels"]).toEqual(dispels);
    expect(parsed.axes).toEqual(cfg.axes);
    expect(parsed.verdict).toEqual(cfg.verdict);
    const changed = out.text.split("\n").filter((l, i) => l !== TEXT.split("\n")[i]);
    expect(changed.length).toBe(3); // the version, dps's curve, tank's reference
  });

  test("apply: a fitted expected item level replaces its block, in the file's layout", () => {
    const expectedIlvl = { "season-mn-2": [[10, 307], [15, 322], [20, 333], [25, 340]] as [number, number][] };
    const out = applyCandidate(TEXT, { ...fit().candidate, expectedIlvl });
    expect(validateConfig(JSON.parse(out.text)).expectedIlvl).toEqual(expectedIlvl);
    const changed = out.text.split("\n").filter((l, i) => l !== TEXT.split("\n")[i]);
    expect(changed).toEqual([`  "version": "${out.version}",`, `    "season-mn-2": [[10, 307], [15, 322], [20, 333], [25, 340]]`]);
    // Today's table written back is the same line.
    expect(applyCandidate(TEXT, { ...fit().candidate, expectedIlvl: cfg.expectedIlvl }).text).toBe(applyCandidate(TEXT, fit().candidate).text);
  });

  test("the study's proposal: the whole file rewritten in its layout, the next version, read back as the proposal", () => {
    expect(validateConfig(JSON.parse(configText(cfg)))).toEqual(cfg);
    // On config 10 as pinned (hand-set curves, no per-role curve), so the lines below do not move with the default.
    const V10 = readFileSync("test/fixtures/evaluation-config-v10.json", "utf8");
    const v10 = validateConfig(JSON.parse(V10));
    const axes = structuredClone(v10.axes);
    axes.survival.subSignals.individualDeaths!.curves = { dps: [[0, 90], [1, 50], [3, 5]], tank: [[0, 60], [2, 10]] };
    axes.utility.subSignals.dispels!.weights.healer = 1;
    const proposal = { ...v10, axes, shrinkage: { dps: { "survival.individualDeaths": 10.82, "throughput.medianParse": 2.44 } } };
    const out = applyProposal(V10, proposal);
    expect(out.version).toBe(String(Number(v10.version) + 1));
    expect(validateConfig(JSON.parse(out.text))).toEqual(validateConfig({ ...proposal, version: out.version }));
    expect(out.text).toContain(`        "individualDeaths": { "curve": [[0, 100], [0.5, 85], [1, 65], [2, 35], [3, 10]], "weights": { "dps": 3, "healer": 3, "tank": 3 },
          "curves": { "dps": [[0, 90], [1, 50], [3, 5]], "tank": [[0, 60], [2, 10]] } },`);
    expect(out.text).toContain(`  "shrinkage": {\n    "dps": { "survival.individualDeaths": 10.82, "throughput.medianParse": 2.44 }\n  },\n`);
  });

  test("apply refuses a file whose layout moved", () => {
    expect(() => applyCandidate(TEXT.replace(`  "globalCurve": {\n`, `  "globalCurve":{\n`), fit().candidate)).toThrow("not where expected");
  });

  test("the workflow's script on an ops answer: applies above the threshold, says why below, fails on a stale fit", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-apply-"));
    try {
      const cfgPath = join(dir, "default-config.json");
      const run = (f: FitResult) => {
        writeFileSync(cfgPath, TEXT);
        writeFileSync(join(dir, "fit.json"), JSON.stringify({ ok: true, ...f, comparison: "# Weekly recalibration\n" }));
        const p = Bun.spawnSync(["bun", "scripts/calibration/apply-candidate.ts", join(dir, "fit.json"), cfgPath, join(dir, "body.md")]);
        return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
      };
      const moved = structuredClone(cfg.globalCurve);
      moved.tank[3] = [Math.round(((moved.tank[2]![0] + moved.tank[3]![0]) / 2) * 10) / 10, moved.tank[3]![1]];
      const yes = run(fit({ fittedAt: Date.now(), candidate: { globalCurve: moved, reference: cfg.reference } }));
      expect(yes.code).toBe(0);
      expect(yes.out).toBe(`apply=true\nversion=${Number(cfg.version) + 1}\n`);
      expect(validateConfig(JSON.parse(readFileSync(cfgPath, "utf8"))).globalCurve.tank[3]).toEqual(moved.tank[3]);
      expect(readFileSync(join(dir, "body.md"), "utf8")).toContain(`Config version ${cfg.version} → ${Number(cfg.version) + 1}.`);
      const no = run(fit({ fittedAt: Date.now(), thresholdMet: false, reason: "below the threshold: 0.3 %" }));
      expect([no.code, no.out, no.err.trim()]).toEqual([0, "apply=false\n", "below the threshold: 0.3 %"]);
      expect(readFileSync(cfgPath, "utf8")).toBe(TEXT);
      expect(run(fit({ fittedAt: Date.now() - STALE_MS - 60_000 })).code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
