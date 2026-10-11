import { describe, expect, test } from "bun:test";
import { CHARACTER_PATTERNS, MAX_CHARACTERS, characterKey, parseCharacters, restrictToStored } from "../../src/self/characters.ts";
import { ownsCharacter, type MyCharacter } from "../../src/self/characters.ts";
import { WOW_NAME, WOW_REALM } from "../../src/server/validate.ts";

describe("parseCharacters", () => {
  test("keeps valid entries, drops the rest, dedupes, caps at 20", () => {
    const ok = (name: string) => ({ name, realm: "hyjal", region: "eu", source: "manual" });
    const names = Array.from({ length: 21 }, (_, i) => `N${String.fromCharCode(97 + i)}`);
    const raw = JSON.stringify([ok("Biwaasham"), ok("biwaasham"), { name: "X" }, ok("A1"), ...names.map(ok)]);
    expect(parseCharacters(raw).map((c) => c.name)).toEqual(["Biwaasham", ...names.slice(0, 19)]);
    expect(MAX_CHARACTERS).toBe(20);
  });
  test("keeps bnetId and verifiedAt on a bnet entry only", () => {
    const bnet = { name: "Noshiidk", realm: "argent-dawn", region: "eu", source: "bnet", bnetId: 123456, verifiedAt: 1_760_000_000_000 };
    const manual = { name: "Biwaasham", realm: "hyjal", region: "eu", source: "manual", bnetId: 7, verifiedAt: 1_760_000_000_000 };
    expect(parseCharacters(JSON.stringify([bnet, manual]))).toEqual([
      bnet as MyCharacter,
      { name: "Biwaasham", realm: "hyjal", region: "eu", source: "manual" },
    ]);
  });
  test("drops a bnet entry without a positive integer bnetId or verifiedAt", () => {
    const bnet = (over: Record<string, unknown>) => ({ name: "Noshiidk", realm: "argent-dawn", region: "eu", source: "bnet", bnetId: 1, verifiedAt: 1, ...over });
    for (const over of [{ bnetId: 0 }, { bnetId: -3 }, { bnetId: 1.5 }, { bnetId: "12" }, { bnetId: undefined }, { verifiedAt: 0 }, { verifiedAt: undefined }]) {
      expect(parseCharacters(JSON.stringify([bnet(over)]))).toEqual([]);
    }
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

describe("restrictToStored", () => {
  const m = (name: string, realm = "argent-dawn", region: MyCharacter["region"] = "eu"): MyCharacter => ({ name, realm, region, source: "manual" });
  const b = (name: string, bnetId: number): MyCharacter => ({ name, realm: "hyjal", region: "eu", source: "bnet", bnetId, verifiedAt: 1000 });
  const stored = [m("Aa"), b("Bb", 2), m("Cc", "silvermoon", "us")];
  test("returns the stored objects in next's order", () => {
    const next = [{ name: "Cc", realm: "silvermoon", region: "us" as const }, { name: "Aa", realm: "argent-dawn", region: "eu" as const }, { name: "Bb", realm: "hyjal", region: "eu" as const, source: "manual" }];
    const out = restrictToStored(next, stored);
    expect(out).toEqual([stored[2]!, stored[0]!, stored[1]!]);
    expect(out![2]).toBe(stored[1]!);
  });
  test("null when next holds an entry absent from stored", () => {
    expect(restrictToStored([{ name: "Aa", realm: "argent-dawn", region: "eu" }, { name: "Zz", realm: "hyjal", region: "eu" }], stored)).toBeNull();
    expect(restrictToStored([{ name: "Aa", realm: "argent-dawn", region: "us" }], stored)).toBeNull();
  });
  test("matches case-insensitively on realm and name", () => {
    expect(restrictToStored([{ name: "bB", realm: "HYJAL", region: "eu" }], stored)).toEqual([stored[1]!]);
    expect(characterKey({ name: "Noshiidk", realm: "Argent-Dawn", region: "eu" })).toBe(characterKey({ name: "noshiidk", realm: "argent-dawn", region: "eu" }));
  });
  test("an empty next is an empty list", () => {
    expect(restrictToStored([], stored)).toEqual([]);
  });
});
