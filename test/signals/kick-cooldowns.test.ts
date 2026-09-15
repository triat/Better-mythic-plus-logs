import { describe, expect, test } from "bun:test";
import { kickCooldownFor } from "../../src/signals/kick-cooldowns.ts";

describe("kickCooldownFor", () => {
  test("melee kicks are 15 s", () => {
    expect(kickCooldownFor("Rogue", "Assassination")).toBe(15);
    expect(kickCooldownFor("Warrior", "Arms")).toBe(15);
    expect(kickCooldownFor("Druid", "Guardian")).toBe(15);
  });
  test("caster kicks have longer cooldowns", () => {
    expect(kickCooldownFor("Mage", "Frost")).toBe(24);
    expect(kickCooldownFor("Hunter", "BeastMastery")).toBe(24);
    expect(kickCooldownFor("Druid", "Balance")).toBe(60);
    expect(kickCooldownFor("Evoker", "Devastation")).toBe(40);
    expect(kickCooldownFor("Priest", "Shadow")).toBe(45);
    expect(kickCooldownFor("Shaman", "Elemental")).toBe(12);
  });
  test("same spec name, different class", () => {
    expect(kickCooldownFor("Shaman", "Restoration")).toBe(12);
    expect(kickCooldownFor("Druid", "Restoration")).toBeNull();
    expect(kickCooldownFor("Paladin", "Holy")).toBeNull();
    expect(kickCooldownFor("Priest", "Holy")).toBeNull();
  });
  test("specs without a kick and unknown specs → null", () => {
    expect(kickCooldownFor("Monk", "Mistweaver")).toBeNull();
    expect(kickCooldownFor("Priest", "Discipline")).toBeNull();
    expect(kickCooldownFor("Bard", "Lute")).toBeNull();
  });
});
