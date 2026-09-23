// The addon's golden vectors (Task 8): `scripts/live-vectors.ts` generates
// `addon/bmpl/tests/vectors.txt` from today's codec; this test proves the committed file still
// matches. The Lua encoder (`addon/bmpl/encode.lua`) is checked against the same file in game via
// `/bmpl selftest`, never by this test — bun never runs Lua. What this test CAN do, and does below,
// is prove that the Lua copy of those vectors (`SELFTEST_VECTORS` in `addon/bmpl/main.lua`) still
// says the same thing as the .txt, so the in-game check can never drift into testing stale
// expectations (final review, Important 5).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bitsToBytes, chunkRoster, encodeCells, encodeFrame } from "../web/src/lib/live/codec.ts";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

interface FrameVector { text: string; seq: number; frames: string[] }
interface CellVector { seq: number; chunkIndex: number; cells: string }

function readVectors(): { frames: FrameVector[]; cells: CellVector[] } {
  const lines = readFileSync("addon/bmpl/tests/vectors.txt", "utf8").trim().split("\n").filter((l) => l && !l.startsWith("#"));
  const frames: FrameVector[] = [];
  const cells: CellVector[] = [];
  for (const line of lines) {
    const [kind, ...rest] = line.split("\t");
    if (kind === "frame") frames.push({ text: rest[0]!.replaceAll("\\n", "\n"), seq: Number(rest[1]), frames: rest.slice(2) });
    else if (kind === "cells") cells.push({ seq: Number(rest[0]), chunkIndex: Number(rest[1]), cells: rest[2]! });
    else throw new Error(`unknown vectors.txt record: ${kind}`);
  }
  return { frames, cells };
}

describe("addon golden vectors", () => {
  test("every committed frame vector matches today's codec", () => {
    const { frames } = readVectors();
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const v of frames) {
      const got = chunkRoster(v.text, v.seq).map((f) => hex(encodeFrame(f)));
      expect(got, `vector ${v.text}`).toEqual(v.frames);
    }
  });

  // The frame bytes say nothing about the marker row/column or the MSB-first row-major bit placement:
  // flip a sign in the addon's `cellIndex` and every frame vector stays green while nothing decodes in
  // game. These records pin the 24×10 matrix itself, and `/bmpl selftest` checks the same 60 hex chars.
  test("every committed cell matrix matches today's codec", () => {
    const { frames, cells } = readVectors();
    expect(cells.length).toBe(frames.length); // one matrix per roster
    for (const v of cells) {
      const vector = frames.find((f) => f.seq === v.seq);
      expect(vector, `no frame vector for rosterSeq ${v.seq}`).toBeDefined();
      const frame = chunkRoster(vector!.text, vector!.seq)[v.chunkIndex]!;
      expect(v.cells.length).toBe(2 * 30); // 240 cells, 8 per byte
      expect(hex(bitsToBytes(encodeCells(frame))), `cells for rosterSeq ${v.seq}`).toBe(v.cells);
    }
  });

  // `SELFTEST_VECTORS` is a hand-copied snapshot (the WoW addon sandbox has no filesystem access, so
  // the addon cannot read vectors.txt at runtime). Parsed as text — no Lua runtime in CI.
  test("main.lua's SELFTEST_VECTORS is a faithful copy of vectors.txt", () => {
    const { frames, cells } = readVectors();
    const lua = readFileSync("addon/bmpl/main.lua", "utf8");
    const table = lua.slice(lua.indexOf("local SELFTEST_VECTORS = {"), lua.indexOf("local function selftest()"));
    expect(table.length).toBeGreaterThan(0);

    const texts = [...table.matchAll(/^\s*text = "(.*)",$/gm)].map((m) => m[1]!);
    const seqs = [...table.matchAll(/^\s*seq = (\d+),$/gm)].map((m) => Number(m[1]));
    const luaCells = [...table.matchAll(/^\s*cells = "([0-9a-f]+)",$/gm)].map((m) => m[1]!);
    // Every hex literal that is not a cell matrix is a frame, in file order. The minimum bound is the
    // header alone (7 bytes = 14 hex chars): v1's 12-byte header always produced frames of at least 24
    // hex chars, but v2's 18-byte payload cap means a roster's last chunk can be much shorter (as low
    // as a lone header-and-a-few-bytes frame) — a 24-char floor silently dropped that short frame from
    // this match, so the bound is set to the real minimum instead. `luaCells` is still excluded by
    // value below, not by length, so lowering this cannot accidentally start counting a cells matrix.
    const luaFrames = [...table.matchAll(/"([0-9a-f]{14,})"/g)].map((m) => m[1]!).filter((h) => !luaCells.includes(h));

    expect(texts).toEqual(frames.map((v) => v.text.replaceAll("\n", "\\n")));
    expect(seqs).toEqual(frames.map((v) => v.seq));
    expect(luaFrames).toEqual(frames.flatMap((v) => v.frames));
    expect(luaCells).toEqual(cells.map((v) => v.cells));
  });
});
