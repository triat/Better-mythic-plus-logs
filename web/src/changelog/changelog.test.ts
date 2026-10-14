import { describe, expect, test } from "bun:test";
import { CHANGELOG_EN } from "./en.ts";
import { CHANGELOG_FR } from "./fr.ts";

const VERSION = /^(next|\d+\.\d+\.\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Internal words a player would not understand (spec decision 2). */
const INTERNAL = /deep-dive|deepdive|config version|evaluation\.json|sub-signal|\bAPI\b|WCL points/i;

describe("changelog", () => {
  test("fr mirrors en: same versions in the same order, same dates, same number of lines", () => {
    expect(CHANGELOG_FR.map((e) => [e.version, e.date ?? null, e.items.length]))
      .toEqual(CHANGELOG_EN.map((e) => [e.version, e.date ?? null, e.items.length]));
  });
  test("versions are valid and unique, newest first, \"next\" only on top and without a date", () => {
    const versions = CHANGELOG_EN.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const e of CHANGELOG_EN) {
      expect(e.version).toMatch(VERSION);
      if (e.version === "next") expect(e.date).toBeUndefined();
      else expect(e.date ?? "").toMatch(DATE);
    }
    expect(versions.slice(1)).not.toContain("next");
    const released = CHANGELOG_EN.filter((e) => e.version !== "next");
    const n = (v: string) => v.split(".").map(Number).reduce((a, x) => a * 1000 + x, 0);
    expect(released.map((e) => n(e.version))).toEqual([...released.map((e) => n(e.version))].sort((a, b) => b - a));
  });
  test("every line is a non-empty sentence in player language", () => {
    for (const e of [...CHANGELOG_EN, ...CHANGELOG_FR]) {
      expect(e.items.length).toBeGreaterThan(0);
      expect(e.items.length).toBeLessThanOrEqual(6);
      for (const item of e.items) {
        expect(item.trim().length).toBeGreaterThan(0);
        expect(item).not.toMatch(INTERNAL);
      }
    }
  });
});
