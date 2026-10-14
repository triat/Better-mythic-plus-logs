import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sample } from "../../src/calibration/fit.ts";
import { comparisonMarkdown, fitAndCompare, readFit, writeFit } from "../../src/calibration/report.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { payloadWith, runWith } from "../evaluation/helpers.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const NOW = 1_800_000_000_000;

/** `n` DPS characters, six runs each at `parse(i)`; the fit and test halves are the hash split. */
const dps = (n: number, parse: (i: number) => number): Sample[] => Array.from({ length: n }, (_, i) => ({
  study: { key: `k${i}`, name: `Name${i}`, server: "Realm", className: "Mage", spec: "Fire", role: "dps", level: 16, percentile: 0.5, quintile: 2 },
  payload: payloadWith(Array.from({ length: 6 }, () => runWith({}, { parsePercent: parse(i), keyLevel: 16 })), { targetLevel: 16 }),
}));

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

describe("weekly fit and threshold", () => {
  test("too few samples: no role refitted, never above the threshold", () => {
    const r = fitAndCompare(dps(30, (i) => i), cfg, NOW);
    expect(r.thresholdMet).toBe(false);
    expect(r.reason).toContain("not enough samples");
    expect(r.candidate.globalCurve).toEqual(cfg.globalCurve);
    expect(r.baseVersion).toBe(cfg.version);
  });

  test("a population unlike today's curve: verdicts move, above the threshold", () => {
    // Everyone parses 95: today's curve puts them high; refitted on themselves they spread around 50.
    const r = fitAndCompare(dps(200, (i) => 90 + (i % 10)), cfg, NOW);
    expect(r.roles.dps.refitted).toBe(true);
    expect(r.roles.healer.refitted).toBe(false);
    expect(r.thresholdMet).toBe(true);
    expect(r.roles.dps.medianCandidate).not.toBe(r.roles.dps.medianCurrent);
  });

  test("today's config fitted on its own population: below the threshold", () => {
    const once = fitAndCompare(dps(200, (i) => (i * 37) % 100), cfg, NOW);
    const settled = { ...cfg, globalCurve: once.candidate.globalCurve, reference: once.candidate.reference };
    const again = fitAndCompare(dps(200, (i) => (i * 37) % 100), settled, NOW);
    expect(again.thresholdMet).toBe(false);
    expect(again.reason).toContain("below the threshold");
  });

  test("the files: written whole, read back; the markdown names no character", () => {
    dir = mkdtempSync(join(tmpdir(), "bmpl-fit-"));
    const db = join(dir, "calibration.db");
    expect(readFit(db)).toBeNull();
    const r = fitAndCompare(dps(200, (i) => 90 + (i % 10)), cfg, NOW);
    writeFit(db, r);
    const back = readFit(db)!;
    expect(back.result).toEqual(r);
    expect(back.comparison).toBe(comparisonMarkdown(r));
    expect(back.comparison).toContain("| dps |");
    expect(JSON.stringify(back)).not.toContain("Name1");
  });
});
