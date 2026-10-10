import { describe, expect, test } from "bun:test";
import { controlOf, parseRunControl, USE_WINDOW_MS } from "../../src/signals/control/parse.ts";
import { referenceFor, type ControlReference } from "../../src/signals/control/reference.ts";
import type { CcTable } from "../../src/signals/control/table.ts";
import type { RawRunControl } from "../../src/signals/types.ts";
import { loadControlFixture } from "../fixtures.ts";

const TABLE: CcTable = { version: "t1", source: "", specs: {
  "Rogue:*": [{ id: 408, name: "Kidney Shot", category: "stun", kind: "debuff" }, { id: 2094, name: "Blind", category: "disorient", kind: "debuff" }],
  "DeathKnight:*": [{ id: 91800, name: "Gnaw", category: "stun", kind: "debuff", pet: true }, { id: 49576, name: "Death Grip", category: "knock", kind: "cast" }],
} };
const REF: ControlReference = { version: "r", tableVersion: "t1", source: "", scope: "", specs: {
  "Rogue:Outlaw": { median: 4, p25: 2, p75: 6, samples: 30 },
  "Rogue:Subtlety": { median: 4, p25: 2, p75: 6, samples: 19 },
  "Warrior:Fury": { median: 0.4, p25: 0, p75: 1, samples: 30 },
} };
const ROGUE = { actorID: 10, className: "Rogue", spec: "Outlaw" };
const raw = (events: RawRunControl["events"], pets: RawRunControl["pets"] = [], tableVersion = "t1"): RawRunControl => ({ tableVersion, pets, events });
const ev = (timestamp: number, sourceID: number, abilityGameID: number, type = "applydebuff") => ({ timestamp, type, sourceID, abilityGameID, targetID: 1 });
const TEN_MIN = 600_000;

describe("parseRunControl", () => {
  test("applications within 1 s are one use; enemies count every application", () => {
    const c = parseRunControl(raw([ev(0, 10, 408), ev(400, 10, 408), ev(USE_WINDOW_MS, 10, 408), ev(USE_WINDOW_MS + 1, 10, 408)]), ROGUE, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.spells).toEqual([{ id: 408, name: "Kidney Shot", category: "stun", uses: 2, enemies: 4 }]);
    expect(c.uses).toBe(2);
    expect(c.enemies).toBe(4);
  });
  test("other players, unknown ids and other event types do not count", () => {
    const c = parseRunControl(raw([ev(0, 11, 408), ev(0, 10, 999), ev(0, 10, 408, "removedebuff")]), ROGUE, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.uses).toBe(0);
    expect(c.spells).toEqual([]);
  });
  test("a pet's application goes to its owner; a knock cast is one use and no enemy", () => {
    const dk = { actorID: 328, className: "DeathKnight", spec: "Frost" };
    const c = parseRunControl(raw([ev(0, 333, 91800), ev(5_000, 328, 49576, "cast"), ev(5_100, 328, 49576, "cast")], [{ id: 333, petOwner: 328 }]), dk, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.spells).toEqual([
      { id: 49576, name: "Death Grip", category: "knock", uses: 2, enemies: 0 },
      { id: 91800, name: "Gnaw", category: "stun", uses: 1, enemies: 1 },
    ]);
  });
  test("rate per 10 minutes and the comparison with the spec's reference", () => {
    const events = [0, 2_000, 4_000, 6_000, 8_000, 10_000].map((t) => ev(t, 10, 2094));
    const c = parseRunControl(raw(events), ROGUE, 20 * 60_000, { table: TABLE, reference: REF });
    expect(c.perTenMin).toBe(3);
    expect(c.reference).toBe(4);
    expect(c.vsReference).toBe(-25);
    expect(c.stale).toBe(false);
  });
  test("no usable reference → null comparison; an older table version → stale", () => {
    const c = parseRunControl(raw([ev(0, 10, 408)], [], "t0"), { ...ROGUE, spec: "Subtlety" }, TEN_MIN, { table: TABLE, reference: REF });
    expect(c.reference).toBeNull();
    expect(c.vsReference).toBeNull();
    expect(c.stale).toBe(true);
  });
});

describe("referenceFor", () => {
  test("samples floor, kit floor, table version", () => {
    expect(referenceFor("Rogue", "Outlaw", REF, TABLE)).toBe(4);
    expect(referenceFor("Rogue", "Subtlety", REF, TABLE)).toBeNull();
    expect(referenceFor("Warrior", "Fury", REF, TABLE)).toBeNull();
    expect(referenceFor("Rogue", "Outlaw", { ...REF, tableVersion: "t0" }, TABLE)).toBeNull();
    expect(referenceFor("Mage", "Fire", REF, TABLE)).toBeNull();
  });
});

describe("controlOf on captured runs", () => {
  test("Frost death knight: the ghoul's Gnaw is credited, Blinding Sleet and Death Grip are there", async () => {
    const f = await loadControlFixture("s2-dk-frost");
    const c = controlOf(f.report, f.control, f.character, 30 * 60_000)!;
    const ids = c.spells.map((s) => s.id);
    expect(ids).toContain(91800);
    expect(ids).toContain(207167);
    expect(ids).toContain(49576);
    expect(c.uses).toBeGreaterThan(0);
  });
  test("a name missing from the report → null", async () => {
    const f = await loadControlFixture("s2-second");
    expect(controlOf(f.report, f.control, "Nobody", 30 * 60_000)).toBeNull();
  });
});
