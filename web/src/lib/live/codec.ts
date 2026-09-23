// The strip contract, shared with the Lua addon (addon/bmpl/encode.lua) and pinned by
// addon/bmpl/tests/vectors.txt. Pure: no DOM, no timers, no I/O.
//
// v3 (2026-09-23): 48x30 px at the addon's default 3 px cell (16x10 cells), a third less area than
// v2's 24x10 and ~6% of v1's. Only the grid changed: the 7-byte header is v2's, byte for byte (high
// nibble 0xB, low nibble the version; rosterSeq wraps at 256). The narrower grid costs payload —
// 9 bytes a frame instead of 18 — which is affordable because the addon no longer transmits
// continuously (addon/bmpl/cadence.lua). See docs/superpowers/specs/2026-09-22-game-integration-design.md,
// "The strip format", for the byte-exact layout.

export const STRIP = {
  cols: 16,
  rows: 10,
  /** Physical pixels per cell, as the addon draws by default; `/bmpl cell 3`-`10` overrides it per
   * session — the decoder never reads this constant, it derives the real cell size from the marker. */
  cell: 3,
  /** Cells outside the marker row and column: 15 x 9 = 135, carrying 16 bytes (128 bits) per frame. */
  dataCells: 15 * 9,
  /** `magic|version` (1) + rosterSeq (1) + chunkIndex (1) + chunkCount (1) + length (1) + crc16 (2). */
  headerBytes: 7,
  /** header (7) + max payload (9) = 16 bytes = 128 bits ≤ 135 data cells. */
  frameBytes: 16,
  payloadMax: 9,
  version: 3,
} as const;

export interface LiveFrame {
  version: number;
  /** Wraps at 256 — one byte on the wire. */
  rosterSeq: number;
  chunkIndex: number;
  chunkCount: number;
  payload: Uint8Array;
}

/** High nibble of byte 0: identifies the strip protocol regardless of version. */
const MAGIC_NIBBLE = 0xb;

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
  // Sized to the real payload, never padded to STRIP.frameBytes: the CRC below must cover exactly what is sent.
  const out = new Uint8Array(STRIP.headerBytes + f.payload.length);
  out[0] = (MAGIC_NIBBLE << 4) | (f.version & 0xf);
  out[1] = f.rosterSeq & 0xff;
  out[2] = f.chunkIndex & 0xff;
  out[3] = f.chunkCount & 0xff;
  out[4] = f.payload.length;
  const crcInput = new Uint8Array(5 + f.payload.length);
  crcInput.set(out.subarray(0, 5), 0);
  crcInput.set(f.payload, 5);
  const crc = crc16(crcInput);
  out[5] = crc & 0xff;
  out[6] = (crc >> 8) & 0xff;
  out.set(f.payload, STRIP.headerBytes);
  return out;
}

export function decodeFrame(bytes: Uint8Array): LiveFrame | null {
  if (bytes.length < STRIP.headerBytes) return null;
  if (bytes[0]! >> 4 !== MAGIC_NIBBLE) return null;
  const version = bytes[0]! & 0xf;
  if (version !== STRIP.version) return null;
  const length = bytes[4]!;
  if (length > STRIP.payloadMax || bytes.length < STRIP.headerBytes + length) return null;
  const payload = bytes.slice(STRIP.headerBytes, STRIP.headerBytes + length);
  const crcInput = new Uint8Array(5 + length);
  crcInput.set(bytes.subarray(0, 5), 0);
  crcInput.set(payload, 5);
  if (crc16(crcInput) !== (bytes[5]! | (bytes[6]! << 8))) return null;
  return { version, rosterSeq: bytes[1]!, chunkIndex: bytes[2]!, chunkCount: bytes[3]!, payload };
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

/** The full 16×10 matrix (1 = light): marker row, marker column, then the frame's bits row-major. */
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
      rosterSeq: rosterSeq & 0xff,
      chunkIndex: i,
      chunkCount: count,
      payload: data.slice(i * STRIP.payloadMax, (i + 1) * STRIP.payloadMax),
    });
  }
  return frames;
}
