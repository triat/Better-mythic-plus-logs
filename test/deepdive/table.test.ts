import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED, applyPatch, loadDefensives, saveOverride, specDefensives, specKey, validateOverride } from "../../src/deepdive/table.ts";
import type { Override } from "../../src/deepdive/types.ts";

describe("shipped table", () => {
  test("covers every kick-table spec except Devourer, with valid entries", () => {
    const specs = Object.keys(SHIPPED.specs);
    expect(specs).toContain("Paladin:*");
    expect(specs).toContain("Paladin:Holy");
    for (const [key, entries] of Object.entries(SHIPPED.specs)) {
      expect(key).toMatch(/^[A-Za-z]+:(\*|[A-Za-z]+)$/);
      for (const e of entries) {
        expect(e.id).toBeGreaterThan(0);
        expect(e.cooldownS).toBeGreaterThan(0);
        expect(e.durationS).toBeGreaterThanOrEqual(0);
        expect(["major", "immunity", "minor"]).toContain(e.kind);
      }
    }
    expect(specDefensives(SHIPPED, {}, "Demon Hunter", "Devourer").tableMissing).toBe(true);
    expect(specDefensives(SHIPPED, {}, "DeathKnight", "Frost").tableMissing).toBe(false);
  });
});

describe("specKey / specDefensives", () => {
  test("normalizes class spacing", () => {
    expect(specKey("Death Knight", "Blood")).toBe("DeathKnight:Blood");
    expect(specKey("Paladin", "*")).toBe("Paladin:*");
  });
  test("merges Class:* then Class:Spec; spec wins on the same id", () => {
    const d = specDefensives(SHIPPED, {}, "Druid", "Guardian");
    const ids = d.entries.map((e) => e.id);
    expect(ids).toContain(22812);   // Barkskin from Druid:*
    expect(ids).toContain(61336);   // Survival Instincts from Druid:Guardian
    expect(ids.filter((i) => i === 61336).length).toBe(1);
    expect(d.entries.every((e) => e.origin === "shipped")).toBe(true);
  });
  test("override patches, adds, ignores", () => {
    const override: Override = {
      "Paladin:Holy": [
        { id: 498, cooldownS: 30 },
        { id: 642, ignore: true },
        { id: 999999, name: "Test Spell", cooldownS: 90, durationS: 6, kind: "major" },
      ],
    };
    const d = specDefensives(SHIPPED, override, "Paladin", "Holy");
    const dp = d.entries.find((e) => e.id === 498)!;
    expect(dp.cooldownS).toBe(30);
    expect(dp.name).toBe("Divine Protection");
    expect(dp.origin).toBe("override");
    expect(d.entries.find((e) => e.id === 642)).toBeUndefined();
    expect(d.ignored).toEqual([642]);
    const added = d.entries.find((e) => e.id === 999999)!;
    expect(added.kind).toBe("major");
    expect(added.origin).toBe("override");
    expect(d.tableMissing).toBe(false);
  });
  test("override alone makes a missing spec present", () => {
    const d = specDefensives(SHIPPED, { "DemonHunter:Devourer": [{ id: 1, name: "X", cooldownS: 60, durationS: 5, kind: "major" }] }, "DemonHunter", "Devourer");
    expect(d.tableMissing).toBe(false);
    expect(d.entries.length).toBe(1);
  });
});

describe("validateOverride", () => {
  test("accepts the documented shapes", () => {
    expect(() => validateOverride({ "Paladin:Holy": [{ id: 498, cooldownS: 30 }, { id: 1, ignore: true }] })).not.toThrow();
  });
  test("rejects bad keys, ids and kinds with the path in the message", () => {
    expect(() => validateOverride({ "Paladin": [] })).toThrow(/Paladin/);
    expect(() => validateOverride({ "Paladin:Holy": [{ id: "x" }] })).toThrow(/Paladin:Holy.*id/);
    expect(() => validateOverride({ "Paladin:Holy": [{ id: 1, kind: "huge" }] })).toThrow(/kind/);
    expect(() => validateOverride([])).toThrow(/object/);
  });
});

describe("applyPatch", () => {
  const effective = specDefensives(SHIPPED, {}, "Paladin", "Holy");
  test("patching a known id keeps only the changed fields in the override", () => {
    const o = applyPatch({}, "Paladin:Holy", { id: 498, cooldownS: 45 }, effective);
    expect(o).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] });
    const o2 = applyPatch(o, "Paladin:Holy", { id: 498, durationS: 9 }, effective);
    expect(o2["Paladin:Holy"]).toEqual([{ id: 498, cooldownS: 45, durationS: 9 }]);
  });
  test("ignore replaces any previous patch for that id", () => {
    const o = applyPatch({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] }, "Paladin:Holy", { id: 498, ignore: true }, effective);
    expect(o["Paladin:Holy"]).toEqual([{ id: 498, ignore: true }]);
  });
  test("adding an unknown id requires name, cooldownS, durationS and kind", () => {
    expect(() => applyPatch({}, "Paladin:Holy", { id: 424242, cooldownS: 60 }, effective)).toThrow(/424242/);
    const o = applyPatch({}, "Paladin:Holy", { id: 424242, name: "New", cooldownS: 60, durationS: 5, kind: "minor" }, effective);
    expect(o["Paladin:Holy"]![0]!.name).toBe("New");
  });
});

describe("loadDefensives / saveOverride", () => {
  test("round trip through a temp file; invalid JSON yields a warning and shipped only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-def-"));
    const p = join(dir, "defensives.json");
    try {
      process.env.BMPL_DEFENSIVES = p;
      const empty = await loadDefensives();
      expect(empty.override).toEqual({});
      expect(empty.overridePath).toBe(p);
      await saveOverride(p, { "Paladin:Holy": [{ id: 498, cooldownS: 30 }] });
      const loaded = await loadDefensives();
      expect(loaded.override["Paladin:Holy"]![0]!.cooldownS).toBe(30);
      expect(loaded.warning).toBeUndefined();
      writeFileSync(p, "{ not json");
      const broken = await loadDefensives();
      expect(broken.override).toEqual({});
      expect(broken.warning).toMatch(/defensives\.json/);
    } finally {
      delete process.env.BMPL_DEFENSIVES;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
