import { describe, expect, test } from "bun:test";
import {
  avoidableFilterExpression,
  avoidableSpellIdsFor,
} from "../../src/signals/avoidable/index.ts";

describe("avoidable list", () => {
  test("Voidscar Arena (S2) has a list", () => {
    const ids = avoidableSpellIdsFor(12923);
    expect(ids).not.toBeNull();
    expect(ids!.length).toBeGreaterThan(5);
    expect(ids).toContain(1222724); // Noxious Breath
  });
  test("Magisters' Terrace (S1) has no list", () => {
    expect(avoidableSpellIdsFor(12811)).toBeNull();
  });
  test("filter expression is a WCL `in` clause", () => {
    expect(avoidableFilterExpression([3, 1, 2])).toBe("ability.id in (1,2,3)");
  });
});
