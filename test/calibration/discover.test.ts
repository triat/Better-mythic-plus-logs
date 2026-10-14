import { describe, expect, test } from "bun:test";
import { candidates, discoverCombo, schedule, type PoolEntry, type Ranking } from "../../src/calibration/discover.ts";

/** A ladder as WCL pages it: `levels[i]` is the key level of the i-th entry (0-based), 100 a page. */
const ladder = (levels: number[]) => {
  const asked: number[] = [];
  const get = async (p: number): Promise<Ranking[]> => {
    asked.push(p);
    return levels.slice((p - 1) * 100, p * 100).map((l, i) => ({ name: `P${(p - 1) * 100 + i}`, amount: 1, bracketData: l, server: { name: "Realm" } }));
  };
  return { get, asked };
};

describe("calibration discovery", () => {
  test("a short ladder: the head only, percentiles per band from 0 (best) to 1 (worst)", async () => {
    const levels = [...Array(10).fill(20), ...Array(30).fill(16), ...Array(50).fill(15), ...Array(20).fill(12)];
    const l = ladder(levels);
    const r = await discoverCombo(l.get, "Mage", "Fire", 7);
    expect(r.tailed).toBe(false);
    expect(l.asked).toEqual([1]); // page 1 already reaches below +15
    const band16 = r.entries.filter((e) => e.level === 16);
    expect(band16.length).toBe(30);
    expect(band16[0]!.percentile).toBe(0);
    expect(band16[29]!.percentile).toBe(1);
    expect(r.entries.every((e) => e.role === "dps" && e.encounterID === 7)).toBe(true);
    expect(r.entries.some((e) => e.level === 12)).toBe(false);
  });

  test("a deep +15 band: galloped, bisected, sampled; its slow end is in the pool", async () => {
    const levels = [...Array(100).fill(18), ...Array(2350).fill(15), ...Array(100).fill(14)];
    const l = ladder(levels);
    const r = await discoverCombo(l.get, "Priest", "Holy", 1);
    expect(r.tailed).toBe(true);
    expect(l.asked.length).toBeLessThan(25);
    const band15 = r.entries.filter((e) => e.level === 15);
    expect(Math.max(...band15.map((e) => e.percentile))).toBeGreaterThan(0.95);
    expect(band15[0]!.role).toBe("healer");
  });

  test("candidates and schedule: one per character and spec, cells taken in turn", () => {
    const e = (name: string, role: PoolEntry["role"], level: number, percentile: number): PoolEntry =>
      ({ name, server: "R", className: "C", spec: role === "tank" ? "Warrior:Protection" : "Mage:Fire", role, encounterID: 1, level, amount: 1, percentile });
    const pool = [e("A", "dps", 15, 0.1), e("A", "dps", 17, 0.3), e("B", "dps", 15, 0.1), e("C", "tank", 20, 0.9)];
    const cs = candidates(pool);
    expect(cs.length).toBe(3);
    const a = cs.find((c) => c.name === "A")!;
    expect([a.level, a.quintile]).toEqual([15, 0]);
    const order = schedule(cs);
    // Round 1 takes one per cell (dps|15|0 and tank|20|4) before the second dps|15|0.
    expect(new Set(order.slice(0, 2).map((c) => c.role))).toEqual(new Set(["dps", "tank"]));
  });
});
