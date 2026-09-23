// Pixels → cells. Pure: it takes plain typed arrays, so every case is testable without a browser.
//
// Nothing here assumes the strip is drawn in pure black and white. The addon paints two *greys* by
// default (`/bmpl contrast`, addon/bmpl/strip.lua) so the strip reads as a faint patch rather than a
// flashing checkerboard, which means fixed luminance thresholds cannot work: the levels are the
// addon's choice and the capture pipeline shifts them further. Both thresholds are therefore derived
// from the image itself — a local light/dark envelope to find the marker, then the marker's own two
// levels to read the cells. All the scanner requires is that the two levels stay `MIN_AMPLITUDE`
// apart once captured.
import { STRIP } from "./codec.ts";

export interface Gray { width: number; height: number; data: Uint8Array }
/** `threshold` is the cell-reading midpoint measured on this strip's own marker, not a constant. */
export interface StripGeometry { x: number; y: number; cell: number; threshold: number }

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

/**
 * The smallest light-to-dark distance, in luma, still read as a strip. Below it a region counts as
 * flat: it keeps a gradient or a noisy texture from passing for the marker, and it is the contrast
 * floor the addon's dim palette has to clear once the capture has compressed it.
 */
export const MIN_AMPLITUDE = 45;
/** Dead zone around the local midpoint, as a fraction of the local amplitude: the pixels straddling
 * two cells land here and end a run rather than extending the wrong one. */
const MARGIN = 0.15;
/**
 * Width of the windows the local light/dark envelope is measured over. Every window is read on its
 * own, with no neighbour merging and no overlap: the envelope has to stay LOCAL, because the strip is
 * drawn over whatever the game renders behind it and a bright neighbour would otherwise drag the
 * midpoint above the dim palette's own light level. 24 px always spans a full light+dark pair of the
 * marker row for any cell size the addon can draw (`/bmpl cell` caps at 10, so a period of at most
 * 20 px) — and the marker row is the only row this envelope is ever used on, so it always alternates.
 */
const BLOCK = 24;

/**
 * The number of equal alternating runs that makes a marker candidate. One clean window is 8 cells at
 * the default 3 px, and the window straddling the strip's left edge eats into that, so demanding 8
 * whole runs would need two clean windows — more than the 48 px v3 strip has to spare. 6 is what a
 * single clean window reliably yields; every candidate is still gated by `markerThreshold` (the whole
 * marker row AND column) and then by the caller's CRC check, so a looser signature costs candidates,
 * never correctness.
 */
const MARKER_RUNS = 6;

/**
 * Fills `lo`/`hi` with the darkest and lightest luma of each pixel's window on row `y`. Window-wise
 * rather than a true sliding window: same O(n) and a fraction of the code. A window that straddles the
 * strip's edge IS polluted by the background, which is why neither the origin nor the cell size read
 * off the first candidate run can be trusted — see `MAX_ORIGIN_SHIFT` and `findStrip`'s retry loop.
 */
function rowLevels(img: Gray, y: number, maxX: number, lo: Uint8Array, hi: Uint8Array): void {
  const row = y * img.width;
  for (let start = 0; start < maxX; start += BLOCK) {
    const end = Math.min(maxX, start + BLOCK);
    let l = 255;
    let h = 0;
    for (let x = start; x < end; x++) {
      const v = img.data[row + x]!;
      if (v < l) l = v;
      if (v > h) h = v;
    }
    for (let x = start; x < end; x++) { lo[x] = l; hi[x] = h; }
  }
}

/**
 * The first candidate marker at or after `from` on row `y`: a light-first run of 8 alternating runs of
 * equal length. Null when the row has none. `from` makes the row resumable, which `findStrip` needs —
 * a background pixel fused onto the strip's first cell inflates the measured cell size (3.125 rather
 * than 3), and no origin shift repairs a wrong cell size; the fix is to look further right on the same
 * row, where the runs are whole.
 */
function markerRun(img: Gray, y: number, maxX: number, lo: Uint8Array, hi: Uint8Array, from: number): { x: number; cell: number } | null {
  const row = y * img.width;
  // A pixel is light (1), dark (-1) or neither (0: too close to the local midpoint, or in a region
  // with no contrast at all). 0 always ends the run in progress.
  const level = (x: number): number => {
    const amp = hi[x]! - lo[x]!;
    if (amp < MIN_AMPLITUDE) return 0;
    const v = img.data[row + x]!;
    const mid = (hi[x]! + lo[x]!) / 2;
    const margin = amp * MARGIN;
    if (v >= mid + margin) return 1;
    if (v <= mid - margin) return -1;
    return 0;
  };

  let x = from;
  while (x < maxX) {
    while (x < maxX && level(x) !== 1) x++;
    const start = x;
    if (start >= maxX) break;
    // A run shorter than 2 px cannot be the first cell of a strip (`cell >= 3` and every run within
    // 34 % of it), so measure it and move on without walking the window — this is what keeps a row of
    // single-pixel alternation (game textures, dithering, text) linear instead of quadratic.
    let head = 0;
    while (start + head < maxX && level(start + head) === 1) head++;
    if (head < 2) { x = start + head; continue; }

    x = start;
    const runs: number[] = [];
    let want = 1;
    while (x < maxX && runs.length < MARKER_RUNS + 1) {
      const runFrom = x;
      while (x < maxX && level(x) === want) x++;
      if (x === runFrom) break;
      runs.push(x - runFrom);
      want = -want;
    }
    if (runs.length >= MARKER_RUNS) {
      const head = runs.slice(0, MARKER_RUNS);
      const cell = head.reduce((a, b) => a + b, 0) / MARKER_RUNS;
      if (cell >= 3 && head.every((r) => Math.abs(r - cell) <= Math.max(1, cell * 0.34))) return { x: start, cell };
    }
    // Resume after this candidate's FIRST run, not after every run it consumed: the run that fails is
    // often a partial cell where the local envelope changes (the strip's own first cells, clipped by a
    // block that also saw the background), and skipping the whole window would skip the real marker
    // with it. Advancing by one pixel instead would re-walk every run per pixel — 20 to 100x the cost of
    // a frame on ordinary bright content, well past the 50 ms tick period.
    x = start + runs[0]!;
  }
  return null;
}

/**
 * The reading threshold for a strip at (x0, y0, cell), measured on its own marker: row 0 and column 0
 * alternate light/dark from a known phase, so between them they carry one sample of each level per
 * cell. Returns null when the two levels are not `MIN_AMPLITUDE` apart, or when a marker cell falls on
 * the wrong side of the midpoint — which doubles as the marker-column check the scanner needs anyway.
 */
function markerThreshold(img: Gray, x0: number, y0: number, cell: number): number | null {
  let lightSum = 0;
  let lightN = 0;
  let darkSum = 0;
  let darkN = 0;
  const add = (v: number, light: boolean) => {
    if (light) { lightSum += v; lightN++; } else { darkSum += v; darkN++; }
  };
  for (let c = 0; c < STRIP.cols; c++) add(sample(img, x0 + c * cell, y0, cell), c % 2 === 0);
  for (let r = 1; r < STRIP.rows; r++) add(sample(img, x0, y0 + r * cell, cell), r % 2 === 0);
  const light = lightSum / lightN;
  const dark = darkSum / darkN;
  if (light - dark < MIN_AMPLITUDE) return null;
  const threshold = (light + dark) / 2;
  // Every marker cell must individually land on its own side, or this is not a marker.
  for (let c = 0; c < STRIP.cols; c++) {
    const v = sample(img, x0 + c * cell, y0, cell);
    if (c % 2 === 0 ? v < threshold : v >= threshold) return null;
  }
  for (let r = 1; r < STRIP.rows; r++) {
    const v = sample(img, x0, y0 + r * cell, cell);
    if (r % 2 === 0 ? v < threshold : v >= threshold) return null;
  }
  return threshold;
}

/**
 * How many cells to the left of the first detected light run the origin is looked for. The 8 runs that
 * establish the geometry need not be the strip's first 8: a block whose envelope straddles the strip's
 * left edge can swallow the leading cells, and taking that later run as cell (0,0) would put every
 * sample a whole number of cells off. Each candidate origin is validated by `markerThreshold`, which
 * checks the marker row AND column, so a wrong shift is rejected rather than guessed at.
 */
const MAX_ORIGIN_SHIFT = 8;

/**
 * How many candidate markers are tried per row before moving on. The first one is not always the
 * strip: where the background fuses onto the strip's leading cells the first candidate carries a
 * corrupted cell size, and only a later, whole-celled one reads correctly. Bounded because each retry
 * re-scans the rest of the row, and a row of the capture is walked 20 times a second.
 */
const MAX_CANDIDATES_PER_ROW = 6;

/**
 * The marker row and column give the origin, the cell size and the reading threshold; null when no
 * strip is on screen. Keeps scanning candidate rows until `accept` (default: anything) is satisfied by
 * the cells read at that geometry — a lone row that merely looks like a marker (e.g. a decoy
 * checkerboard) is skipped rather than returned, so a caller that can validate a decode (Task 6's
 * `decodeCells(cells) !== null`) finds the real strip even when it sits below something that
 * structurally mimics the marker.
 */
export function findStrip(img: Gray, accept: (cells: Uint8Array) => boolean = () => true): StripGeometry | null {
  const maxY = Math.floor(img.height * SCAN_REGION.h);
  const maxX = Math.floor(img.width * SCAN_REGION.w);
  const lo = new Uint8Array(maxX);
  const hi = new Uint8Array(maxX);
  for (let y = 0; y < maxY; y++) {
    rowLevels(img, y, maxX, lo, hi);
    let from = 0;
    for (let candidate = 0; candidate < MAX_CANDIDATES_PER_ROW; candidate++) {
      const row = markerRun(img, y, maxX, lo, hi, from);
      if (!row) break;
      from = row.x + 1;
      const cell = row.cell;
      const y0 = y + cell / 2;
      if (y0 + (STRIP.rows - 1) * cell >= img.height) continue;
      for (let shift = 0; shift <= MAX_ORIGIN_SHIFT; shift++) {
        const x0 = row.x + cell / 2 - shift * cell;
        // The whole strip, sampled at cell centres, must lie inside the image.
        if (x0 < 0 || x0 + (STRIP.cols - 1) * cell >= img.width) continue;
        const threshold = markerThreshold(img, x0, y0, cell);
        if (threshold === null) continue;
        const geom = { x: x0, y: y0, cell, threshold };
        if (accept(readCells(img, geom))) return geom;
      }
    }
  }
  return null;
}

/** Below this cell size the 3×3 average blurs a cell with its neighbours, so `sample` reads the centre
 * pixel alone (spec: "at 3 px a cell is sampled at its centre pixel alone"). */
const SMALL_CELL = 5;

/**
 * A cell's sampled luminance at (cx, cy). From `SMALL_CELL` px up, the central 3×3 pixels are averaged
 * (robust to compression ringing at the edges); below it, a 3×3 box can spill into the next cell, so
 * only the centre pixel is read.
 */
function sample(img: Gray, cx: number, cy: number, cell: number): number {
  if (cell < SMALL_CELL) {
    // `floor`, not `round`: `findStrip` puts the sample point at `start + cell / 2`, which at cell = 3 is
    // `start + 1.5` — rounding lands on the cell's LAST pixel (2 of 0,1,2), exactly the boundary a
    // subsampled capture bleeds across. Flooring reads the true centre pixel the spec calls for.
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
    return img.data[y * img.width + x]!;
  }
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

/** The 24×10 matrix read at `geom`; 1 = light. The threshold is the strip's own, from its marker. */
export function readCells(img: Gray, geom: StripGeometry): Uint8Array {
  const cells = new Uint8Array(STRIP.cols * STRIP.rows);
  for (let y = 0; y < STRIP.rows; y++) {
    for (let x = 0; x < STRIP.cols; x++) {
      cells[y * STRIP.cols + x] = sample(img, geom.x + x * geom.cell, geom.y + y * geom.cell, geom.cell) >= geom.threshold ? 1 : 0;
    }
  }
  return cells;
}
