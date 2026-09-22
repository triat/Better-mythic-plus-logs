import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED, applyPatch, layerPatches, loadDefensives, mergeEntry, saveOverride, specDefensives, specKey, tagOrigin, validateOverride } from "../../src/deepdive/table.ts";
import type { Override } from "../../src/deepdive/types.ts";

describe("shipped table", () => {
  test("covers every kick-table spec except Devourer, with valid entries", () => {
    const specs = Object.keys(SHIPPED.specs);
    expect(specs).toContain("Paladin:*");
    expect(specs).toContain("Paladin:Holy");
    for (const [key, entries] of Object.entries(SHIPPED.specs)) {
      expect(key).toMatch(/^([A-Za-z]+:(\*|[A-Za-z]+)|\*:\*)$/);
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
  test("the universal *:* key (health potions) reaches every spec, first in the merge, without making a spec 'present'", () => {
    const d = specDefensives(SHIPPED, {}, "Druid", "Guardian");
    expect(d.entries.slice(0, 2).map((e) => e.id)).toEqual([1234768, 1295247]);
    expect(d.entries.find((e) => e.id === 1295247)).toMatchObject({ name: "Concentrated Silvermoon Health Potion", cooldownS: 300, durationS: 0, kind: "minor", origin: "shipped" });
    expect(specDefensives(SHIPPED, {}, "Demon Hunter", "Devourer").tableMissing).toBe(true);
    // A spec key wins over the universal one on the same id; an override can patch or ignore it under any key.
    const shipped = { ...SHIPPED, specs: { ...SHIPPED.specs, "Druid:Guardian": [...SHIPPED.specs["Druid:Guardian"]!, { id: 1234768, name: "Potion (spec)", cooldownS: 60, durationS: 0, kind: "minor" as const }] } };
    expect(specDefensives(shipped, {}, "Druid", "Guardian").entries.find((e) => e.id === 1234768)!.cooldownS).toBe(60);
    const d2 = specDefensives(SHIPPED, { "*:*": [{ id: 1234768, cooldownS: 240 }], "Druid:Guardian": [{ id: 1295247, ignore: true }] }, "Druid", "Guardian");
    expect(d2.entries.find((e) => e.id === 1234768)).toMatchObject({ cooldownS: 240, origin: "override" });
    expect(d2.entries.some((e) => e.id === 1295247)).toBe(false);
    expect(d2.ignored).toEqual([1295247]);
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
    expect(d.entries.map((e) => e.id)).toEqual([1234768, 1295247, 1]); // the potions come first, then the override
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

describe("mergeEntry / layerPatches / origins", () => {
  test("mergeEntry merges fields over a previous patch, ignore replaces, origin is kept from the patch", () => {
    const a = mergeEntry([], { id: 498, cooldownS: 45 });
    expect(a).toEqual([{ id: 498, cooldownS: 45 }]);
    const b = mergeEntry(a, { id: 498, durationS: 9, origin: "pending" });
    expect(b).toEqual([{ id: 498, cooldownS: 45, durationS: 9, origin: "pending" }]);
    const c = mergeEntry(b, { id: 498, ignore: true, origin: "shared" });
    expect(c).toEqual([{ id: 498, ignore: true, origin: "shared" }]);
    const d = mergeEntry(c, { id: 498, cooldownS: 50 });
    expect(d).toEqual([{ id: 498, cooldownS: 50 }]); // a patch after ignore starts over
    expect(mergeEntry(d, { id: 1, name: "X" })).toEqual([{ id: 498, cooldownS: 50 }, { id: 1, name: "X" }]);
  });

  test("specDefensives reports the entry's origin, defaulting to override", () => {
    const override: Override = { "Paladin:Holy": [{ id: 498, cooldownS: 45, origin: "shared" }, { id: 31821, cooldownS: 170, origin: "pending" }, { id: 642, cooldownS: 250 }] };
    const d = specDefensives(SHIPPED, override, "Paladin", "Holy");
    const origin = (id: number) => d.entries.find((e) => e.id === id)?.origin;
    expect([origin(498), origin(31821), origin(642)]).toEqual(["shared", "pending", "override"]);
    expect(d.entries.find((e) => e.id === 498)?.cooldownS).toBe(45);
  });

  test("layerPatches applies key/patch pairs tagged with the layer; tagOrigin tags every entry", () => {
    const shared = tagOrigin({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] }, "shared");
    expect(shared).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45, origin: "shared" }] });
    const mine = layerPatches(shared, [
      { key: "Paladin:Holy", patch: { id: 498, durationS: 9 } },
      { key: "Paladin:*", patch: { id: 642, ignore: true } },
    ], "pending");
    expect(mine).toEqual({
      "Paladin:Holy": [{ id: 498, cooldownS: 45, durationS: 9, origin: "pending" }],
      "Paladin:*": [{ id: 642, ignore: true, origin: "pending" }],
    });
    expect(shared["Paladin:Holy"]).toEqual([{ id: 498, cooldownS: 45, origin: "shared" }]); // pure
  });

  test("validateOverride strips origin from file entries", () => {
    expect(validateOverride({ "Paladin:Holy": [{ id: 498, cooldownS: 45, origin: "shared" }] })).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] });
  });

  test("applyPatch still refuses an incomplete unknown id and keeps its merge semantics", () => {
    const eff = specDefensives(SHIPPED, {}, "Paladin", "Holy");
    expect(() => applyPatch({}, "Paladin:Holy", { id: 999999, cooldownS: 30 }, eff)).toThrow(/999999/);
    expect(applyPatch({}, "Paladin:Holy", { id: 498, cooldownS: 45 }, eff)).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] });
  });
});
