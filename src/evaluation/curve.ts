import { median } from "../signals/peers.ts";
import type { CurvePoints } from "./types.ts";

export { median };

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Signed, fixed-precision string: `+12`, `-3.5`, `+0`. */
export const signed = (v: number, digits = 0): string => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

/** Piecewise-linear interpolation over sorted [x, y] points, clamped at both ends. */
export function curve(x: number, points: CurvePoints): number {
  if (points.length === 0) throw new Error("curve: no control points");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

export const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Population standard deviation; null under 2 samples. */
export const stddev = (xs: number[]): number | null => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};
