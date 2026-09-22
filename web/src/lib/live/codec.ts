// The strip contract, shared with the Lua addon (addon/bmpl/encode.lua) and pinned by
// addon/bmpl/tests/vectors.txt. Pure: no DOM, no timers, no I/O.

export const STRIP = {
  cols: 40,
  rows: 16,
  /** Physical pixels per cell, as the addon draws them. */
  cell: 6,
  /** Cells outside the marker row and column. */
  dataCells: 39 * 15,
  /** Header (12) + payload; 73 bytes = 584 bits ≤ 585 data cells. */
  headerBytes: 12,
  frameBytes: 73,
  payloadMax: 61,
  version: 1,
} as const;

export interface LiveFrame {
  version: number;
  rosterSeq: number;
  chunkIndex: number;
  chunkCount: number;
  payload: Uint8Array;
}

const MAGIC = [0x62, 0x6d, 0x70, 0x6c]; // "bmpl"

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc & 0xffff;
}

export function encodeFrame(f: LiveFrame): Uint8Array {
  if (f.payload.length > STRIP.payloadMax) throw new Error(`payload of ${f.payload.length} bytes exceeds ${STRIP.payloadMax}`);
  const out = new Uint8Array(STRIP.headerBytes + f.payload.length);
  out.set(MAGIC, 0);
  out[4] = f.version;
  out[5] = f.rosterSeq & 0xff;
  out[6] = (f.rosterSeq >> 8) & 0xff;
  out[7] = f.chunkIndex;
  out[8] = f.chunkCount;
  out[9] = f.payload.length;
  const crcInput = new Uint8Array(10 + f.payload.length);
  crcInput.set(out.subarray(0, 10), 0);
  crcInput.set(f.payload, 10);
  const crc = crc16(crcInput);
  out[10] = crc & 0xff;
  out[11] = (crc >> 8) & 0xff;
  out.set(f.payload, STRIP.headerBytes);
  return out;
}

export function decodeFrame(bytes: Uint8Array): LiveFrame | null {
  if (bytes.length < STRIP.headerBytes) return null;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return null;
  if (bytes[4] !== STRIP.version) return null;
  const length = bytes[9]!;
  if (length > STRIP.payloadMax || bytes.length < STRIP.headerBytes + length) return null;
  const payload = bytes.slice(STRIP.headerBytes, STRIP.headerBytes + length);
  const crcInput = new Uint8Array(10 + length);
  crcInput.set(bytes.subarray(0, 10), 0);
  crcInput.set(payload, 10);
  if (crc16(crcInput) !== (bytes[10]! | (bytes[11]! << 8))) return null;
  return { version: bytes[4]!, rosterSeq: bytes[5]! | (bytes[6]! << 8), chunkIndex: bytes[7]!, chunkCount: bytes[8]!, payload };
}

/** MSB first; `count` bits, zero-padded when the buffer runs out. */
export function bytesToBits(bytes: Uint8Array, count: number): Uint8Array {
  const bits = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const byte = bytes[i >> 3] ?? 0;
    bits[i] = (byte >> (7 - (i & 7))) & 1;
  }
  return bits;
}

export function bitsToBytes(bits: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3]! |= 1 << (7 - (i & 7));
  return out;
}

/** The full 40×16 matrix (1 = white): marker row, marker column, then the frame's bits row-major. */
export function encodeCells(f: LiveFrame): Uint8Array {
  const cells = new Uint8Array(STRIP.cols * STRIP.rows);
  for (let x = 0; x < STRIP.cols; x++) cells[x] = x % 2 === 0 ? 1 : 0;
  for (let y = 1; y < STRIP.rows; y++) cells[y * STRIP.cols] = y % 2 === 0 ? 1 : 0;
  const bits = bytesToBits(encodeFrame(f), STRIP.dataCells);
  let i = 0;
  for (let y = 1; y < STRIP.rows; y++) for (let x = 1; x < STRIP.cols; x++) cells[y * STRIP.cols + x] = bits[i++]!;
  return cells;
}

export function decodeCells(cells: Uint8Array): LiveFrame | null {
  if (cells.length !== STRIP.cols * STRIP.rows) return null;
  const bits = new Uint8Array(STRIP.dataCells);
  let i = 0;
  for (let y = 1; y < STRIP.rows; y++) for (let x = 1; x < STRIP.cols; x++) bits[i++] = cells[y * STRIP.cols + x]!;
  return decodeFrame(bitsToBytes(bits));
}

/** Split a roster's UTF-8 text into frames; every frame of one roster carries the same `rosterSeq`. */
export function chunkRoster(text: string, rosterSeq: number): LiveFrame[] {
  const data = new TextEncoder().encode(text);
  const count = Math.max(1, Math.ceil(data.length / STRIP.payloadMax));
  if (count > 255) throw new Error(`roster too large: ${data.length} bytes needs ${count} chunks`);
  const frames: LiveFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({
      version: STRIP.version,
      rosterSeq: rosterSeq & 0xffff,
      chunkIndex: i,
      chunkCount: count,
      payload: data.slice(i * STRIP.payloadMax, (i + 1) * STRIP.payloadMax),
    });
  }
  return frames;
}
