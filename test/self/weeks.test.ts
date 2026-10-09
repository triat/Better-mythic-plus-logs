import { describe, expect, test } from "bun:test";
import { WEEK_ANCHOR, weekOf, weekStart } from "../../src/self/weeks.ts";

// Raider.IO GET /api/v1/periods, captured 2026-10-09 (period 1084 = "current"): spec decision 5.
const RIO = {
  us: { previous: "2026-09-29T15:00:00Z", current: "2026-10-06T15:00:00Z" },
  eu: { previous: "2026-09-30T04:00:00Z", current: "2026-10-07T04:00:00Z" },
  kr: { previous: "2026-09-30T23:00:00Z", current: "2026-10-07T23:00:00Z" },
  tw: { previous: "2026-09-30T23:00:00Z", current: "2026-10-07T23:00:00Z" },
} as const;

describe("game weeks", () => {
  test("anchors are Raider.IO's period boundaries", () => {
    for (const region of ["us", "eu", "kr", "tw"] as const) {
      expect(WEEK_ANCHOR[region]).toBe(Date.parse(RIO[region].current));
      expect(weekStart(region, -1)).toBe(Date.parse(RIO[region].previous));
    }
  });
  test("a run belongs to the week whose reset it follows", () => {
    expect(weekOf("us", Date.parse("2026-10-06T14:59:59Z"))).toBe(-1);
    expect(weekOf("us", Date.parse("2026-10-06T15:00:00Z"))).toBe(0);
    expect(weekOf("eu", Date.parse("2026-10-14T04:00:00Z"))).toBe(1);
    expect(weekOf("eu", Date.parse("2026-08-19T07:30:52Z"))).toBe(-7);
  });
});
