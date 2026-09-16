import { describe, expect, test } from "bun:test";
import { hasDispel } from "../../src/signals/dispel-capability.ts";

describe("hasDispel", () => {
  test("classes with no dispel or purge of any kind", () => {
    expect(hasDispel("Rogue", "Assassination")).toBe(false);
    expect(hasDispel("Warrior", "Fury")).toBe(false);
    expect(hasDispel("DeathKnight", "Unholy")).toBe(false);
    expect(hasDispel("Death Knight", "Blood")).toBe(false);
  });
  test("healers, purgers and pet dispellers count", () => {
    expect(hasDispel("Priest", "Holy")).toBe(true);
    expect(hasDispel("Shaman", "Elemental")).toBe(true);   // Purge
    expect(hasDispel("Mage", "Fire")).toBe(true);          // Spellsteal
    expect(hasDispel("Warlock", "Affliction")).toBe(true); // Devour Magic / Singe Magic (pet)
    expect(hasDispel("Demon Hunter", "Havoc")).toBe(true); // Consume Magic
    expect(hasDispel("Evoker", "Devastation")).toBe(true); // Expunge
  });
  test("unknown spec is assumed to have one (never penalize silently)", () => {
    expect(hasDispel("Tinker", "Gadgets")).toBe(true);
  });
});
