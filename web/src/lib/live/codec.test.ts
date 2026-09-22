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
  const frame = { version: 1, rosterSeq: 513, chunkIndex: 2, chunkCount: 5, payload: new TextEncoder().encode("a|Tom-Hyjal|Druid|Feral|D|0") };

  test("encode → decode round-trip", () => {
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
  test("rejects a wrong magic, a wrong version, a bad CRC and a short buffer", () => {
    const good = encodeFrame(frame);
    const badMagic = Uint8Array.from(good); badMagic[0] = 0x62 ^ 0xff;
    const badVersion = Uint8Array.from(good); badVersion[4] = 2;
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
});

describe("cells", () => {
  const frame = { version: 1, rosterSeq: 1, chunkIndex: 0, chunkCount: 1, payload: new TextEncoder().encode("p|Tom-Hyjal|Warrior|Fury|D|2890") };

  test("the matrix is 40x16, marker included, and decodes back", () => {
    const cells = encodeCells(frame);
    expect(cells.length).toBe(STRIP.cols * STRIP.rows);
    expect(cells[0]).toBe(1);                                  // origin white
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
  test("one chunk for a short roster, several for a long one, all decodable", () => {
    const short = chunkRoster("a|Tom-Hyjal|Druid|Feral|D|0\n", 7);
    expect(short.length).toBe(1);
    expect(short[0]).toMatchObject({ rosterSeq: 7, chunkIndex: 0, chunkCount: 1 });

    const long = chunkRoster(Array.from({ length: 20 }, (_, i) => `a|Name${i}-Nerzhul|Druid|Restoration|H|${3000 + i}`).join("\n") + "\n", 8);
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
