import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/config.ts";
import { REGIONS, REGION_LABELS, isRegion, parseRegion, regionFlag } from "../src/wow/regions.ts";

const saved = process.env.BMPL_REGION;
afterEach(() => { if (saved === undefined) delete process.env.BMPL_REGION; else process.env.BMPL_REGION = saved; });

describe("regions", () => {
  test("the four WCL regions, in order, with labels", () => {
    expect(REGIONS).toEqual(["eu", "us", "kr", "tw"]);
    expect(Object.keys(REGION_LABELS)).toEqual(["eu", "us", "kr", "tw"]);
    expect(isRegion("us")).toBe(true);
    expect(isRegion("cn")).toBe(false);
    expect(isRegion("US")).toBe(false);
  });
  test("parseRegion is case-insensitive and null otherwise", () => {
    expect(parseRegion(" KR ")).toBe("kr");
    expect(parseRegion("cn")).toBeNull();
    expect(parseRegion(undefined)).toBeNull();
  });
  test("config.region follows BMPL_REGION, defaults to eu, ignores junk", () => {
    delete process.env.BMPL_REGION;
    expect(config.region).toBe("eu");
    process.env.BMPL_REGION = "US";
    expect(config.region).toBe("us");
    process.env.BMPL_REGION = "mars";
    expect(config.region).toBe("eu");
  });
  test("regionFlag reads --region, case-insensitive, and reports junk", () => {
    expect(regionFlag(["Biwaasham-Hyjal", "--region", "US"])).toEqual({ region: "us", invalid: null });
    expect(regionFlag(["Biwaasham-Hyjal"])).toEqual({ region: null, invalid: null });
    expect(regionFlag(["--region", "cn"])).toEqual({ region: null, invalid: "cn" });
    expect(regionFlag(["--region"])).toEqual({ region: null, invalid: "" });
  });
});
