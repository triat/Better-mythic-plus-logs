import { describe, expect, test } from "bun:test";
import { REGIONS, effectiveRegion, isRegion, regionLabel } from "./regions.ts";

describe("regions", () => {
  test("labels and effective region", () => {
    expect(REGIONS).toEqual(["eu", "us", "kr", "tw"]);
    expect(regionLabel("us")).toBe("US");
    expect(effectiveRegion(null, "eu")).toBe("eu");
    expect(effectiveRegion("kr", "eu")).toBe("kr");
  });

  test("isRegion", () => {
    expect(isRegion("eu")).toBe(true);
    expect(isRegion("us")).toBe(true);
    expect(isRegion("kr")).toBe(true);
    expect(isRegion("tw")).toBe(true);
    expect(isRegion("cn")).toBe(false);
    expect(isRegion("")).toBe(false);
    expect(isRegion(null)).toBe(false);
    expect(isRegion(undefined)).toBe(false);
    expect(isRegion(1)).toBe(false);
  });
});
