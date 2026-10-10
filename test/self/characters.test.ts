import { describe, expect, test } from "bun:test";
import { CHARACTER_PATTERNS, MAX_CHARACTERS, parseCharacters } from "../../src/self/characters.ts";
import { ownsCharacter } from "../../src/self/characters.ts";
import { WOW_NAME, WOW_REALM } from "../../src/server/validate.ts";

describe("parseCharacters", () => {
  test("keeps valid entries, drops the rest, dedupes, caps at 5", () => {
    const ok = (name: string) => ({ name, realm: "hyjal", region: "eu", source: "manual" });
    const raw = JSON.stringify([ok("Biwaasham"), ok("biwaasham"), { name: "X" }, ok("A1"), ok("Bb"), ok("Cc"), ok("Dd"), ok("Ee"), ok("Ff")]);
    expect(parseCharacters(raw).map((c) => c.name)).toEqual(["Biwaasham", "Bb", "Cc", "Dd", "Ee"]);
    expect(MAX_CHARACTERS).toBe(5);
  });
  test("null, garbage and non-arrays are an empty list", () => {
    expect(parseCharacters(null)).toEqual([]);
    expect(parseCharacters("{")).toEqual([]);
    expect(parseCharacters("{}")).toEqual([]);
  });
});

test("patterns match validate.ts", () => {
  expect(CHARACTER_PATTERNS.name.source).toBe(WOW_NAME.source);
  expect(CHARACTER_PATTERNS.realm.source).toBe(WOW_REALM.source);
});

describe("ownsCharacter", () => {
  const list = [{ name: "Noshiidk", realm: "argent-dawn", region: "eu" as const, source: "manual" as const }];
  test("any realm spelling and name case of a listed character", () => {
    expect(ownsCharacter(list, { name: "noshiidk", realm: "Argent Dawn", region: "eu" })).toBe(true);
    expect(ownsCharacter(list, { name: "Noshiidk", realm: "argent-dawn", region: "eu" })).toBe(true);
  });
  test("another region, realm or name is not", () => {
    expect(ownsCharacter(list, { name: "Noshiidk", realm: "Argent Dawn", region: "us" })).toBe(false);
    expect(ownsCharacter(list, { name: "Noshiidk", realm: "Hyjal", region: "eu" })).toBe(false);
    expect(ownsCharacter(list, { name: "Other", realm: "Argent Dawn", region: "eu" })).toBe(false);
    expect(ownsCharacter([], { name: "Noshiidk", realm: "Argent Dawn", region: "eu" })).toBe(false);
  });
});
