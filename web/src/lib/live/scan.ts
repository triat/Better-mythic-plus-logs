// Pixels → cells. Pure: it takes plain typed arrays, so every case is testable without a browser.
import { STRIP } from "./codec.ts";

export interface Gray { width: number; height: number; data: Uint8Array }
export interface StripGeometry { x: number; y: number; cell: number }

/** Only the top-left quarter of the captured frame is searched — the addon draws in the corner. */
export const SCAN_REGION = { w: 0.5, h: 0.5 } as const;

/** Rec. 601 luma, the same weighting a video pipeline preserves best. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = (rgba[p]! * 77 + rgba[p + 1]! * 150 + rgba[p + 2]! * 29) >> 8;
  }
  return { width, height, data };
}

const DARK = 70;
const LIGHT = 185;

/** Run lengths of the alternating light/dark marker on one row, starting at the first light pixel. */
function markerRun(img: Gray, y: number, maxX: number): { x: number; cell: number } | null {
  let x = 0;
  while (x < maxX) {
    while (x < maxX && img.data[y * img.width + x]! < LIGHT) x++;
    const start = x;
    const runs: number[] = [];
    let want = LIGHT;
    while (x < maxX && runs.length < 9) {
      const from = x;
      while (x < maxX && (want === LIGHT ? img.data[y * img.width + x]! >= LIGHT : img.data[y * img.width + x]! <= DARK)) x++;
      if (x === from) break;
      runs.push(x - from);
      want = want === LIGHT ? DARK : LIGHT;
    }
    if (runs.length >= 8) {
      const cell = runs.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      if (cell >= 3 && runs.slice(0, 8).every((r) => Math.abs(r - cell) <= Math.max(1, cell * 0.34))) return { x: start, cell };
    }
    if (x === start) x++;
  }
  return null;
}

/**
 * The marker row and column give the origin and the cell size; null when no strip is on screen.
 * Keeps scanning candidate rows until `accept` (default: anything) is satisfied by the cells read at
 * that geometry — a lone row that merely looks like a marker (e.g. a decoy checkerboard) is skipped
 * rather than returned, so a caller that can validate a decode (Task 6's `decodeCells(cells) !== null`)
 * finds the real strip even when it sits below something that structurally mimics the marker.
 */
export function findStrip(img: Gray, accept: (cells: Uint8Array) => boolean = () => true): StripGeometry | null {
  const maxY = Math.floor(img.height * SCAN_REGION.h);
  const maxX = Math.floor(img.width * SCAN_REGION.w);
  for (let y = 0; y < maxY; y++) {
    const row = markerRun(img, y, maxX);
    if (!row) continue;
    const cell = row.cell;
    const x0 = row.x + cell / 2;
    const y0 = y + cell / 2;
    // The whole strip, sampled at cell centres, must lie inside the image.
    const lastX = x0 + (STRIP.cols - 1) * cell;
    const lastY = y0 + (STRIP.rows - 1) * cell;
    if (lastX >= img.width || lastY >= img.height) continue;
    // Verify the marker column: cell (0,0) light, then alternating down the strip.
    let ok = true;
    for (let r = 0; r < STRIP.rows && ok; r++) {
      const v = sample(img, x0, y0 + r * cell);
      ok = r % 2 === 0 ? v >= LIGHT : v <= DARK;
    }
    if (!ok) continue;
    const geom = { x: x0, y: y0, cell };
    if (accept(readCells(img, geom))) return geom;
  }
  return null;
}

/** Average of the central 3×3 pixels of a cell — robust to compression ringing at the edges. */
function sample(img: Gray, cx: number, cy: number): number {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      sum += img.data[y * img.width + x]!;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** The 40×16 matrix read at `geom`; 1 = white. Values between the thresholds fall to the nearer side. */
export function readCells(img: Gray, geom: StripGeometry): Uint8Array {
  const cells = new Uint8Array(STRIP.cols * STRIP.rows);
  for (let y = 0; y < STRIP.rows; y++) {
    for (let x = 0; x < STRIP.cols; x++) {
      cells[y * STRIP.cols + x] = sample(img, geom.x + x * geom.cell, geom.y + y * geom.cell) >= 128 ? 1 : 0;
    }
  }
  return cells;
}
