import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candidate } from "../../src/calibration/discover.ts";
import { openSamples } from "../../src/calibration/samples.ts";
import type { EvalPayload } from "../../src/evaluation/inputs.ts";
import { openStore } from "../../src/signals/store.ts";
import { resolveCalibrationDbPath } from "../../src/setup.ts";
import { payloadWith, runWith } from "../evaluation/helpers.ts";

const study = (key: string, over: Partial<Candidate> = {}): Candidate =>
  ({ key, name: key, server: "Realm", className: "Mage", spec: "Mage:Fire", role: "dps", level: 16, percentile: 0.3, quintile: 1, ...over });
const payload: EvalPayload = payloadWith([runWith({}), runWith({})]);

let dir = "";
const fresh = () => { dir = mkdtempSync(join(tmpdir(), "bmpl-cal-")); return openSamples(join(dir, "calibration.db")); };
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

describe("calibration sample store", () => {
  test("put, list (payload round trip), count per cell, done", () => {
    const s = fresh();
    s.put(study("a"), payload, 49, 1000);
    s.put(study("b", { role: "tank", level: 20, quintile: 4 }), payload, 49, 2000);
    s.put(study("c"), payload, 49, 3000);
    expect(s.list(49, 0).map((x) => x.study.key)).toEqual(["a", "b", "c"]);
    expect(s.list(49, 0)[0]!.payload).toEqual(payload);
    const c = s.count(49, 1500);
    expect(c.total).toBe(2);
    expect(Object.fromEntries(c.cells)).toEqual({ "dps|16|1": 1, "tank|20|4": 1 });
    expect(s.done("a", 49, 0)).toBe(true);
    expect(s.done("a", 49, 1001)).toBe(false); // aged out of the window: collect it again
    expect(s.done("a", 50, 0)).toBe(false);
    s.fail("x", 49, 500, "not found");
    expect(s.done("x", 49, 0)).toBe(true);
    s.close();
  });

  test("prune: another season goes whole, this season keeps the window, the lookups' cache ages out too", () => {
    const s = fresh();
    const store = openStore(join(dir, "calibration.db"));
    store.putRio("eu", "realm", "old", { x: 1 }, 100);
    store.putRio("eu", "realm", "new", { x: 1 }, 5000);
    s.put(study("old"), payload, 49, 100);
    s.put(study("new"), payload, 49, 5000);
    s.put(study("prev"), payload, 48, 5000);
    s.putPage(48, 1, 7, "Mage:Fire", 1, []);
    s.putPool(48, 1, [], 1);
    s.putPool(49, 2, [], 2);
    s.prune(49, 1000);
    expect(s.list(49, 0).map((x) => x.study.key)).toEqual(["new"]);
    expect(s.list(48, 0)).toEqual([]);
    expect(s.getPage(48, 1, 7, "Mage:Fire", 1)).toBeNull();
    expect(s.latestPool(48)).toBeNull();
    expect(s.latestPool(49)!.cycle).toBe(2);
    expect(store.getRio("eu", "realm", "old", { now: 5000, maxAgeMs: 1e12 })).toBeNull();
    expect(store.getRio("eu", "realm", "new", { now: 5000, maxAgeMs: 1e12 })).not.toBeNull();
    store.close();
    s.close();
  });

  test("pages and pools: a new pool drops the older cycles' pages", () => {
    const s = fresh();
    s.putPage(49, 1, 7, "Mage:Fire", 1, [{ name: "A" }]);
    expect(s.getPage(49, 1, 7, "Mage:Fire", 1)).toEqual([{ name: "A" }]);
    s.putPool(49, 2, [], 10);
    expect(s.getPage(49, 1, 7, "Mage:Fire", 1)).toBeNull();
    s.close();
  });

  test("the path: next to .env or BMPL_CALIBRATION_DB, never the instance's bmpl.db", async () => {
    const saved = { cal: process.env.BMPL_CALIBRATION_DB, db: process.env.BMPL_DB_PATH };
    try {
      delete process.env.BMPL_CALIBRATION_DB;
      delete process.env.BMPL_DB_PATH;
      expect((await resolveCalibrationDbPath()).endsWith("calibration.db")).toBe(true);
      process.env.BMPL_CALIBRATION_DB = "/srv/x/cal.db";
      expect(await resolveCalibrationDbPath()).toBe("/srv/x/cal.db");
      process.env.BMPL_DB_PATH = "/srv/x/cal.db";
      await expect(resolveCalibrationDbPath()).rejects.toThrow("instance's database");
    } finally {
      for (const [k, v] of [["BMPL_CALIBRATION_DB", saved.cal], ["BMPL_DB_PATH", saved.db]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
