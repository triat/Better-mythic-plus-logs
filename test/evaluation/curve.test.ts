import { describe, expect, test } from "bun:test";
import { clamp, curve, mean, stddev } from "../../src/evaluation/curve.ts";

const C: [number, number][] = [[0, 100], [1, 65], [3, 10]];

describe("curve", () => {
  test("hits control points exactly", () => {
    expect(curve(0, C)).toBe(100);
    expect(curve(1, C)).toBe(65);
    expect(curve(3, C)).toBe(10);
  });
  test("interpolates linearly between points", () => {
    expect(curve(0.5, C)).toBeCloseTo(82.5, 6);
    expect(curve(2, C)).toBeCloseTo(37.5, 6);
  });
  test("clamps outside the range", () => {
    expect(curve(-5, C)).toBe(100);
    expect(curve(99, C)).toBe(10);
  });
  test("single point → constant", () => {
    expect(curve(7, [[2, 40]])).toBe(40);
  });
  test("empty points → throws", () => {
    expect(() => curve(1, [])).toThrow();
  });
});

describe("stddev / mean / clamp", () => {
  test("population stddev", () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
    expect(stddev([5])).toBeNull();
    expect(stddev([])).toBeNull();
  });
  test("mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNull();
  });
  test("clamp", () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-3, 0, 100)).toBe(0);
    expect(clamp(42, 0, 100)).toBe(42);
  });
});
