import { expect, test } from "bun:test";
import { LOCALES, isLocale } from "../../src/hosted/locale.ts";

// The front has its own copy (web/src/lib/locale.ts, types only cross); this pins that both agree.
test("the server knows the same two locales as the front", () => {
  expect(LOCALES).toEqual(["en", "fr"]);
  expect(isLocale("en")).toBe(true);
  expect(isLocale("fr")).toBe(true);
  expect(isLocale("de")).toBe(false);
  expect(isLocale(null)).toBe(false);
  expect(isLocale(undefined)).toBe(false);
});
