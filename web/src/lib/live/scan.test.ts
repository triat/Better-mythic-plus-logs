import { describe, expect, test } from "bun:test";
import { STRIP, decodeCells, encodeCells } from "./codec.ts";
import { findStrip, readCells, toGray } from "./scan.ts";
import type { Gray } from "./scan.ts";

// Mirrors scan.ts's private thresholds, for tests that assert noise genuinely approaches them.
const DARK = 70;
const LIGHT = 185;

const FRAME = { version: 2, rosterSeq: 42, chunkIndex: 0, chunkCount: 1, payload: new TextEncoder().encode("a|Bee-Nz|2|H|3412") };

/** Paint the cell matrix into a grey image at `scale` px per cell, offset by (ox, oy). */
function paint(cells: Uint8Array, scale: number, ox: number, oy: number, w = 600, h = 300, noise = 0): Gray {
  const data = new Uint8Array(w * h).fill(28); // the app's near-black background
  for (let y = 0; y < STRIP.rows; y++) {
    for (let x = 0; x < STRIP.cols; x++) {
      const v = cells[y * STRIP.cols + x] ? 255 : 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = Math.round(ox + x * scale + dx);
          const py = Math.round(oy + y * scale + dy);
          if (px >= 0 && px < w && py >= 0 && py < h) data[py * w + px] = v;
        }
      }
    }
  }
  if (noise > 0) for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, data[i]! + ((i * 2654435761) % (2 * noise)) - noise));
  return { width: w, height: h, data };
}

/** Paint cells onto an existing image without clearing it, to composite two features into one frame. */
function paintOnto(img: Gray, cells: Uint8Array, scale: number, ox: number, oy: number): void {
  for (let y = 0; y < STRIP.rows; y++) {
    for (let x = 0; x < STRIP.cols; x++) {
      const v = cells[y * STRIP.cols + x] ? 255 : 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = Math.round(ox + x * scale + dx);
          const py = Math.round(oy + y * scale + dy);
          if (px >= 0 && px < img.width && py >= 0 && py < img.height) img.data[py * img.width + px] = v;
        }
      }
    }
  }
}

describe("toGray", () => {
  test("uses Rec. 601 luma", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const g = toGray(rgba, 2, 1);
    expect(g.data[0]).toBe(255);
    expect(g.data[1]).toBe(0);
  });
});

describe("findStrip / readCells", () => {
  const cells = encodeCells(FRAME);

  test("finds the strip at the native cell size and reads it back exactly", () => {
    const img = paint(cells, 6, 0, 0);
    const geom = findStrip(img)!;
    expect(geom).not.toBeNull();
    expect(geom.cell).toBeCloseTo(6, 0);
    expect([...readCells(img, geom)]).toEqual([...cells]);
  });

  test("survives an offset and a scaled capture (0.8x and 1.25x)", () => {
    for (const [scale, ox, oy] of [[6, 13, 7], [4.8, 0.5, 2.5], [7.5, 21, 11]] as const) {
      const img = paint(cells, scale, ox, oy, 700, 320, 0);
      const geom = findStrip(img);
      expect(geom, `scale ${scale} offset ${ox},${oy}`).not.toBeNull();
      expect([...readCells(img, geom!)], `scale ${scale}`).toEqual([...cells]);
    }
  });

  // The addon's default cell (`STRIP.cell`, 3 px): below `SMALL_CELL` (5) `sample()` must read the centre
  // pixel alone rather than the 3×3 average, which at this size would blur a cell with its neighbours.
  // Covers the native size plus an offset and a scaled capture, same as the >=5px case above; the
  // scale stays >=3 (the addon's own minimum, `/bmpl cell 3`-`10`) since a capture never draws smaller.
  test("reads a 3px strip with centre-pixel sampling, with an offset and a scaled capture", () => {
    for (const [scale, ox, oy] of [[STRIP.cell, 0, 0], [STRIP.cell, 5, 4], [3.75, 6, 3]] as const) {
      expect(scale).toBeLessThan(5); // sanity: this really exercises the centre-pixel path, not the 3x3 average.
      const img = paint(cells, scale, ox, oy, 300, 150, 0);
      const geom = findStrip(img);
      expect(geom, `scale ${scale} offset ${ox},${oy}`).not.toBeNull();
      expect(geom!.cell, `scale ${scale}`).toBeGreaterThanOrEqual(3);
      expect([...readCells(img, geom!)], `scale ${scale}`).toEqual([...cells]);
    }
  });

  test("survives sensor noise that genuinely approaches the light/dark thresholds", () => {
    const scale = 6;
    const ox = 4;
    const oy = 4;
    const w = 700;
    const h = 320;
    const noise = 75;
    const img = paint(cells, scale, ox, oy, w, h, noise);

    // The noise formula is deterministic (index-based, not random): recompute the actual extreme
    // values it produced within the strip's footprint, to pin that this test genuinely stresses
    // DARK/LIGHT rather than staying comfortably clear of them (a noise of 30 never came within
    // 40 of either threshold — see the fix-round-1 report).
    let minLight = 255;
    let maxDark = 0;
    for (let y = 0; y < STRIP.rows; y++) {
      for (let x = 0; x < STRIP.cols; x++) {
        const light = cells[y * STRIP.cols + x] === 1;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = Math.round(ox + x * scale + dx);
            const py = Math.round(oy + y * scale + dy);
            if (px < 0 || px >= w || py < 0 || py >= h) continue;
            const v = img.data[py * w + px]!;
            if (light) minLight = Math.min(minLight, v);
            else maxDark = Math.max(maxDark, v);
          }
        }
      }
    }
    expect(minLight, "light minimum should approach LIGHT").toBeGreaterThanOrEqual(LIGHT - 15);
    expect(minLight, "light minimum should approach LIGHT").toBeLessThanOrEqual(LIGHT + 15);
    expect(maxDark, "dark maximum should approach DARK").toBeGreaterThanOrEqual(DARK - 15);
    expect(maxDark, "dark maximum should approach DARK").toBeLessThanOrEqual(DARK + 15);

    const geom = findStrip(img);
    expect(geom).not.toBeNull();
    expect([...readCells(img, geom!)]).toEqual([...cells]);
  });

  test("returns null on a frame with no strip (a screenshot of the game)", () => {
    const img: Gray = { width: 400, height: 200, data: new Uint8Array(400 * 200).fill(90) };
    expect(findStrip(img)).toBeNull();
  });

  test("ignores a strip drawn outside the searched region", () => {
    const img = paint(encodeCells(FRAME), 6, 520, 260, 900, 500);
    expect(findStrip(img)).toBeNull();
  });

  test("rejects a strip that overflows the image instead of misreading its edge cells", () => {
    // 24x10 cells at 6px is 144x60; this image is 6px too small in both dimensions.
    const img = paint(cells, 6, 0, 0, 138, 54);
    expect(findStrip(img)).toBeNull();
  });

  test("skips a decoy checkerboard and finds the real strip when accept requires a valid decode", () => {
    const w = 700;
    const h = 320;
    const img: Gray = { width: w, height: h, data: new Uint8Array(w * h).fill(28) };
    // A plain checkerboard alternates along both its top row and its left column by construction,
    // so it satisfies findStrip's structural marker check without being a real, decodable frame.
    const decoy = new Uint8Array(STRIP.cols * STRIP.rows);
    for (let y = 0; y < STRIP.rows; y++) for (let x = 0; x < STRIP.cols; x++) decoy[y * STRIP.cols + x] = (x + y) % 2;
    paintOnto(img, decoy, 6, 10, 5);
    paintOnto(img, cells, 6, 10, 5 + STRIP.rows * 6 + 12);

    const geom = findStrip(img, (c) => decodeCells(c) !== null);
    expect(geom).not.toBeNull();
    expect([...readCells(img, geom!)]).toEqual([...cells]);
  });
});
