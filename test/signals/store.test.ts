import { describe, expect, test } from "bun:test";
import { QUERY_VERSION, RIO_TTL_MS, openStore } from "../../src/signals/store.ts";
import { loadWclFixture } from "../fixtures.ts";

describe("store", () => {
  test("WCL raw round-trip, never expires", async () => {
    const s = openStore(":memory:");
    const f = await loadWclFixture("s1-tank");
    expect(s.getWclRun("QvhzaWwPNxMVY4Xd", 1)).toBeNull();
    s.putWclRun("QvhzaWwPNxMVY4Xd", 1, f.report);
    const back = s.getWclRun("QvhzaWwPNxMVY4Xd", 1);
    expect(back?.code).toBe("QvhzaWwPNxMVY4Xd");
    expect(back?.fights?.[0]?.keystoneBonus).toBe(1);
    s.close();
  });

  test("put overwrites an existing row", () => {
    const s = openStore(":memory:");
    s.putWclRun("A", 1, { code: "A", fights: [{ id: 1, keystoneBonus: 0 }] });
    s.putWclRun("A", 1, { code: "A", fights: [{ id: 1, keystoneBonus: 2 }] });
    expect(s.getWclRun("A", 1)?.fights?.[0]?.keystoneBonus).toBe(2);
    s.close();
  });

  test("rows from an older query version are hidden", () => {
    const s = openStore(":memory:");
    s.putWclRun("A", 1, { code: "A" });
    // Simulate a row written by an older build.
    s._db.run("UPDATE wcl_run_raw SET query_version = ? WHERE report_code = 'A'", [QUERY_VERSION - 1]);
    expect(s.getWclRun("A", 1)).toBeNull();
    s.close();
  });

  test("RIO TTL", () => {
    const s = openStore(":memory:");
    const t0 = 1_000_000;
    s.putRio("eu", "nerzhul", "Biwaadrood", { name: "Biwaadrood" }, t0);
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS - 1 })).toEqual({
      raw: { name: "Biwaadrood" }, fetchedAt: t0,
    });
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS + 1 })).toBeNull();
    expect(s.getRio("eu", "nerzhul", "Biwaadrood", { now: t0 + RIO_TTL_MS + 1, maxAgeMs: Infinity })).not.toBeNull();
    s.close();
  });

  test("RIO key is case-insensitive on name", () => {
    const s = openStore(":memory:");
    s.putRio("eu", "nerzhul", "Biwaadrood", { a: 1 }, 5);
    expect(s.getRio("EU", "nerzhul", "biwaadrood", { now: 6 })?.raw).toEqual({ a: 1 });
    s.close();
  });
});
