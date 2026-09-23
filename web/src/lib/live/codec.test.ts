import { describe, expect, test } from "bun:test";
import { STRIP, bitsToBytes, bytesToBits, chunkRoster, crc16, decodeCells, decodeFrame, encodeCells, encodeFrame } from "./codec.ts";

const bytes = (...v: number[]) => new Uint8Array(v);

describe("crc16", () => {
  test("CRC-16/CCITT-FALSE reference vectors", () => {
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);
    expect(crc16(new Uint8Array(0))).toBe(0xffff);
  });
});

describe("bits", () => {
  test("round-trips MSB first", () => {
    const b = bytes(0b10110010, 0x00, 0xff);
    const bits = bytesToBits(b, 24);
    expect([...bits.slice(0, 8)]).toEqual([1, 0, 1, 1, 0, 0, 1, 0]);
    expect([...bitsToBytes(bits)]).toEqual([...b]);
  });
  test("pads the last byte with zeros", () => {
    expect([...bitsToBytes(new Uint8Array([1, 1]))]).toEqual([0b11000000]);
  });
});

describe("frames", () => {
  // 9 bytes, the v3 maximum: no roster line fits in one frame any more (the shortest is ~11 bytes),
  // so a frame's payload is a slice of the roster text, not a line.
  const frame = { version: STRIP.version, rosterSeq: 200, chunkIndex: 2, chunkCount: 5, payload: new TextEncoder().encode("a|Tom-Hy|") };

  test("encode → decode round-trip", () => {
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
  test("rejects a wrong magic, a wrong version, a bad CRC and a short buffer", () => {
    const good = encodeFrame(frame);
    const badMagic = Uint8Array.from(good); badMagic[0] ^= 0xf0; // flips the high (magic) nibble
    const badVersion = Uint8Array.from(good); badVersion[0] = (badVersion[0]! & 0xf0) | 0x2; // magic intact, the previous version
    const badCrc = Uint8Array.from(good); badCrc[good.length - 1] ^= 0x01;
    expect(decodeFrame(badMagic)).toBeNull();
    expect(decodeFrame(badVersion)).toBeNull();
    expect(decodeFrame(badCrc)).toBeNull();
    expect(decodeFrame(good.slice(0, 5))).toBeNull();
  });
  test("a frame never exceeds the strip's capacity", () => {
    const max = { ...frame, payload: new Uint8Array(STRIP.payloadMax).fill(0x41) };
    expect(encodeFrame(max).length).toBe(STRIP.frameBytes);
    expect(STRIP.frameBytes * 8).toBeLessThanOrEqual(STRIP.dataCells);
  });
  test("rosterSeq wraps at 256 on the wire", () => {
    const wrapped = { ...frame, rosterSeq: 256 + 3 };
    expect(decodeFrame(encodeFrame(wrapped))!.rosterSeq).toBe(3);
  });
});

describe("cells", () => {
  const frame = { version: STRIP.version, rosterSeq: 1, chunkIndex: 0, chunkCount: 1, payload: new TextEncoder().encode("p|Tom-Hy|") };

  test("the matrix is 16x10, marker included, and decodes back", () => {
    const cells = encodeCells(frame);
    expect(cells.length).toBe(STRIP.cols * STRIP.rows);
    expect(cells[0]).toBe(1);                                  // origin light
    expect([...cells.slice(0, 4)]).toEqual([1, 0, 1, 0]);      // marker row
    expect([cells[STRIP.cols], cells[STRIP.cols * 2]]).toEqual([0, 1]); // marker column
    expect(decodeCells(cells)).toEqual(frame);
  });
  test("a flipped data cell fails the CRC and yields null", () => {
    const cells = encodeCells(frame);
    cells[STRIP.cols + 1] ^= 1;
    expect(decodeCells(cells)).toBeNull();
  });
});

describe("chunkRoster", () => {
  test("one chunk for a payload that fits, several for a roster line, all decodable", () => {
    const short = chunkRoster("a|Tom-Hy|", 7);
    expect(short.length).toBe(1);
    expect(short[0]).toMatchObject({ rosterSeq: 7, chunkIndex: 0, chunkCount: 1 });

    // A single roster line is already two frames at 9 payload bytes — the v3 grid's real cost.
    expect(chunkRoster("a|Tom-Hyjal|2|D|0\n", 7).length).toBe(2);

    const long = chunkRoster(Array.from({ length: 20 }, (_, i) => `a|Name${i}-Nerzhul|2|H|${3000 + i}`).join("\n") + "\n", 8);
    expect(long.length).toBeGreaterThan(5);
    expect(long.every((f, i) => f.chunkIndex === i && f.chunkCount === long.length)).toBe(true);
    const joined = long.map((f) => new TextDecoder().decode(f.payload)).join("");
    expect(joined.startsWith("a|Name0-Nerzhul")).toBe(true);
    expect(joined.endsWith("|3019\n")).toBe(true);
  });
  test("refuses more than 255 chunks", () => {
    expect(() => chunkRoster("x".repeat(256 * STRIP.payloadMax + 1), 1)).toThrow(/too large/);
  });
});
