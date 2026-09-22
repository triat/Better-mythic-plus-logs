import { describe, expect, test } from "bun:test";
import { STRIP, encodeCells } from "./codec.ts";
import { findStrip, readCells, toGray } from "./scan.ts";
import type { Gray } from "./scan.ts";

const FRAME = { version: 1, rosterSeq: 42, chunkIndex: 0, chunkCount: 1, payload: new TextEncoder().encode("a|Biwaadrood-Nerzhul|Druid|Restoration|H|3412") };

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

  test("survives an offset, a scaled capture (0.8x and 1.25x) and sensor noise", () => {
    for (const [scale, ox, oy, noise] of [[6, 13, 7, 0], [4.8, 0.5, 2.5, 0], [7.5, 21, 11, 0], [6, 4, 4, 30]] as const) {
      const img = paint(cells, scale, ox, oy, 700, 320, noise);
      const geom = findStrip(img);
      expect(geom, `scale ${scale} offset ${ox},${oy} noise ${noise}`).not.toBeNull();
      expect([...readCells(img, geom!)], `scale ${scale}`).toEqual([...cells]);
    }
  });

  test("returns null on a frame with no strip (a screenshot of the game)", () => {
    const img: Gray = { width: 400, height: 200, data: new Uint8Array(400 * 200).fill(90) };
    expect(findStrip(img)).toBeNull();
  });

  test("ignores a strip drawn outside the searched region", () => {
    const img = paint(encodeCells(FRAME), 6, 520, 260, 900, 500);
    expect(findStrip(img)).toBeNull();
  });
});
