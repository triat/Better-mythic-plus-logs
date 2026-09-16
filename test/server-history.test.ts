import { describe, expect, test } from "bun:test";
import { History, cacheKey } from "../src/server-history.ts";

const req = (character: string, level: number | null = null) => ({ character, level, spec: null, metric: null });
const entry = (over: Partial<Parameters<History["record"]>[1]> = {}) => ({
  result: { any: "payload" },
  label: "Muleyoxo-Silvermoon",
  charClass: 7,
  spec: "Holy",
  targetLevel: 21,
  targetAutoDetected: true,
  ...over,
});

describe("History — keyed by effective level", () => {
  test("cacheKey normalizes and carries the level", () => {
    expect(cacheKey(req(" Muleyoxo-Silvermoon ", 18))).toBe(JSON.stringify(["muleyoxo-silvermoon", 18, "", ""]));
  });

  test("an auto lookup that resolves to +21 merges with an explicit +21 entry", () => {
    const h = new History(20, () => 1000);
    const explicit = h.record(req("Muleyoxo-Silvermoon", 21), entry({ targetAutoDetected: false }));
    const auto = h.record(req("Muleyoxo-Silvermoon", null), entry({ targetAutoDetected: true }));
    expect(auto.key).toBe(explicit.key);
    expect(h.size).toBe(1);
    expect(h.get(auto.key)!.targetAutoDetected).toBe(true); // newest wins
  });

  test("an auto request hits the cache once its effective level is known", () => {
    const h = new History(20, () => 1000);
    expect(h.cached(req("Muleyoxo-Silvermoon", null))).toBeNull();
    const e = h.record(req("Muleyoxo-Silvermoon", null), entry());
    expect(h.cached(req("Muleyoxo-Silvermoon", null))?.key).toBe(e.key);
    expect(h.cached(req("muleyoxo-silvermoon", 21))?.key).toBe(e.key);
    expect(h.cached(req("Muleyoxo-Silvermoon", 18))).toBeNull();
  });

  test("a cache hit moves the entry to the newest position", () => {
    const h = new History(20, () => 1000);
    h.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false }));
    h.record(req("B-X", 18), entry({ label: "B-X", targetLevel: 18, targetAutoDetected: false }));
    h.cached(req("A-X", 18));
    expect(h.list().map((e) => e.label)).toEqual(["A-X", "B-X"]); // newest first
  });

  test("an auto re-evaluation that lands on a new level replaces the old auto entry, not an explicit one", () => {
    const h = new History(20, () => 1000);
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 20, targetAutoDetected: true }));
    h.record(req("Muleyoxo-Silvermoon", 18), entry({ targetLevel: 18, targetAutoDetected: false }));
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 21, targetAutoDetected: true }));
    expect(h.list().map((e) => [e.targetLevel, e.targetAutoDetected])).toEqual([[21, true], [18, false]]);
  });

  test("evicts the oldest past the cap; remove/clear also forget auto levels", () => {
    const h = new History(2, () => 1000);
    h.record(req("A-X", 18), entry({ label: "A-X" }));
    h.record(req("B-X", 18), entry({ label: "B-X" }));
    h.record(req("C-X", null), entry({ label: "C-X", targetLevel: 19 }));
    expect(h.list().map((e) => e.label)).toEqual(["C-X", "B-X"]);
    expect(h.remove(cacheKey(req("C-X", 19)))).toBe(true);
    expect(h.cached(req("C-X", null))).toBeNull();
    h.clear();
    expect(h.size).toBe(0);
  });
});
