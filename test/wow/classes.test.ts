import { describe, expect, test } from "bun:test";
import { CLASS_COLORS, CLASS_NAMES, className, classHex } from "../../src/wow/classes.ts";
import { classNames } from "../../src/format.ts";

describe("wow/classes", () => {
  test("13 classes with names and hex colors", () => {
    expect(Object.keys(CLASS_NAMES)).toHaveLength(13);
    expect(Object.keys(CLASS_COLORS)).toHaveLength(13);
    expect(CLASS_NAMES[1]).toBe("Death Knight");
    expect(CLASS_NAMES[13]).toBe("Evoker");
    for (const hex of Object.values(CLASS_COLORS)) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  test("className/classHex fall back for unknown ids", () => {
    expect(className(7)).toBe("Priest");
    expect(className(99)).toBe("class #99");
    expect(classHex(12)).toBe("#A330C9");
    expect(classHex(99)).toBe("#8b949e");
  });

  test("format.ts re-exports the same table", () => {
    expect(classNames).toBe(CLASS_NAMES);
  });
});
