import { describe, expect, test } from "bun:test";
import { CC_CATEGORIES, CC_TABLE, ccFilterExpression, ccIds, ccIndex, specCc } from "../../src/signals/control/table.ts";
import { CLASS_NAMES } from "../../src/wow/classes.ts";

const CLASS_KEYS = new Set(Object.values(CLASS_NAMES).map((n) => n.replace(/\s+/g, "")));

describe("crowd-control table", () => {
  test("version and keys", () => {
    expect(CC_TABLE.version).toBe("mn-2.0");
    for (const key of Object.keys(CC_TABLE.specs)) {
      const [cls, spec] = key.split(":");
      expect(CLASS_KEYS.has(cls!)).toBe(true);
      expect(spec && spec.length > 0).toBe(true);
    }
  });
  test("every entry is well-formed; knocks are casts, the rest debuffs", () => {
    for (const entries of Object.values(CC_TABLE.specs)) {
      for (const e of entries) {
        expect(Number.isInteger(e.id) && e.id > 0).toBe(true);
        expect(e.name.length > 0).toBe(true);
        expect(CC_CATEGORIES).toContain(e.category);
        expect(e.kind).toBe(e.category === "knock" ? "cast" : "debuff");
      }
    }
  });
  test("ids and the filter", () => {
    const { debuffs, casts } = ccIds();
    expect(debuffs).toContain(2094); // Blind
    expect(casts).toContain(49576);  // Death Grip
    expect([...debuffs].sort((a, b) => a - b)).toEqual(debuffs);
    expect(ccFilterExpression({ version: "x", source: "", specs: { "Rogue:*": [
      { id: 408, name: "Kidney Shot", category: "stun", kind: "debuff" },
      { id: 2094, name: "Blind", category: "disorient", kind: "debuff" },
    ], "Monk:*": [{ id: 116844, name: "Ring of Peace", category: "knock", kind: "cast" }] } }))
      .toBe('(type = "applydebuff" and ability.id in (408,2094)) or (type = "cast" and ability.id in (116844))');
  });
  test("a table without casts filters on debuffs only", () => {
    expect(ccFilterExpression({ version: "x", source: "", specs: { "Rogue:*": [{ id: 408, name: "Kidney Shot", category: "stun", kind: "debuff" }] } }))
      .toBe('(type = "applydebuff" and ability.id in (408))');
  });
  test("index and spec lookup", () => {
    expect(ccIndex().get("debuff:91800")?.pet).toBe(true); // Gnaw, the ghoul's
    expect(specCc("Rogue", "Outlaw").map((e) => e.id)).toContain(2094);
  });
});
