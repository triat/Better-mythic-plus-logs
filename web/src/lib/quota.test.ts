import { describe, expect, test } from "bun:test";
import { canAfford, pointsLeft, quotaLabel } from "./quota.ts";

describe("quota view model", () => {
  test("pointsLeft: limit minus used, never negative; null without a limit or a quota", () => {
    expect(pointsLeft({ used: 120, limit: 300, resetInS: 10 })).toBe(180);
    expect(pointsLeft({ used: 310, limit: 300, resetInS: 10 })).toBe(0);
    expect(pointsLeft({ used: 5, limit: null, resetInS: 10 })).toBeNull();
    expect(pointsLeft(null)).toBeNull();
  });
  test("quotaLabel rounds down and says when it resets once exhausted", () => {
    expect(quotaLabel({ used: 120.4, limit: 300, resetInS: 900 })).toBe("179 pts left this hour");
    expect(quotaLabel({ used: 300, limit: 300, resetInS: 90 })).toBe("quota reached · resets in 2 min");
    expect(quotaLabel({ used: 1, limit: null, resetInS: 900 })).toBeNull();
    expect(quotaLabel(null)).toBeNull();
  });
  test("canAfford compares the estimate with what is left; unlimited always can", () => {
    expect(canAfford({ used: 298, limit: 300, resetInS: 1 }, 3)).toBe(false);
    expect(canAfford({ used: 297, limit: 300, resetInS: 1 }, 3)).toBe(true);
    expect(canAfford({ used: 5000, limit: null, resetInS: 1 }, 30)).toBe(true);
    expect(canAfford(null, 30)).toBe(true);
  });
});
