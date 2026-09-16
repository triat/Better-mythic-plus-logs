export const CENTER = 150;
export const R = 110;
export const LABEL_R = 132;
export const RADAR_VIEWBOX = "-45 -5 390 310";
export const ANGLES_DEG: readonly number[] = [-90, -30, 30, 90, 150, 210];
export type Point = [number, number];

const round1 = (n: number) => Math.round(n * 10) / 10;
const rad = (i: number) => (ANGLES_DEG[i]! * Math.PI) / 180;

/** A null score sits at the center (hollow point in the component), never at 0. */
export function axisPoint(i: number, score: number | null): Point {
  if (score === null) return [CENTER, CENTER];
  const r = (R * score) / 100;
  return [round1(CENTER + r * Math.cos(rad(i))), round1(CENTER + r * Math.sin(rad(i)))];
}

export const polygonPoints = (scores: readonly (number | null)[]): string =>
  scores.map((s, i) => axisPoint(i, s).join(",")).join(" ");

export const ringPoints = (ring: number): string => polygonPoints([ring, ring, ring, ring, ring, ring]);

export function axisLabelPos(i: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const c = Math.cos(rad(i));
  return {
    x: round1(CENTER + LABEL_R * c),
    y: round1(CENTER + LABEL_R * Math.sin(rad(i))),
    anchor: c > 0.1 ? "start" : c < -0.1 ? "end" : "middle",
  };
}
