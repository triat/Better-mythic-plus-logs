import { describe, expect, test } from "bun:test";
import { KEY_MAX, KEY_MIN, parseStoredKey, reevalHint, stepKey } from "./keyLevel.ts";

describe("key level", () => {
  test("bounds", () => {
    expect(KEY_MIN).toBe(2);
    expect(KEY_MAX).toBe(40);
  });
  test("stepKey clamps and leaves auto from the fallback level", () => {
    expect(stepKey(18, +1, 15)).toBe(19);
    expect(stepKey(18, -1, 15)).toBe(17);
    expect(stepKey(KEY_MAX, +1, 15)).toBe(KEY_MAX);
    expect(stepKey(KEY_MIN, -1, 15)).toBe(KEY_MIN);
    // From auto, the first press starts at the fallback (the active tab's evaluated level).
    expect(stepKey(null, +1, 21)).toBe(21);
    expect(stepKey(null, -1, 21)).toBe(21);
    expect(stepKey(null, +1, null)).toBe(18);
  });
  test("parseStoredKey tolerates garbage", () => {
    expect(parseStoredKey("18")).toBe(18);
    expect(parseStoredKey("auto")).toBeNull();
    expect(parseStoredKey(null)).toBeNull();
    expect(parseStoredKey("99")).toBeNull();
    expect(parseStoredKey("x")).toBeNull();
  });
  test("reevalHint compares against the tab's effective level", () => {
    const auto21 = { targetLevel: 21, targetAutoDetected: true };
    const explicit18 = { targetLevel: 18, targetAutoDetected: false };
    expect(reevalHint(18, auto21)).toEqual({ label: "Your key is +18", action: "re-evaluate for +18" });
    expect(reevalHint(21, auto21)).toBeNull();            // auto resolved to 21 = same tab
    expect(reevalHint(null, auto21)).toBeNull();
    expect(reevalHint(null, explicit18)).toEqual({ label: "Your key is auto", action: "re-evaluate with auto-detected level" });
    expect(reevalHint(18, explicit18)).toBeNull();
  });
});
