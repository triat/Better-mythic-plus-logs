// The addon's golden vectors (Task 8): `scripts/live-vectors.ts` generates
// `addon/bmpl/tests/vectors.txt` from today's codec; this test proves the committed file still
// matches. The Lua encoder (`addon/bmpl/encode.lua`) is checked against the same file in game via
// `/bmpl selftest`, never by this test — bun never runs Lua.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chunkRoster, encodeFrame } from "../web/src/lib/live/codec.ts";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("addon golden vectors", () => {
  test("every committed vector matches today's codec", () => {
    const lines = readFileSync("addon/bmpl/tests/vectors.txt", "utf8").trim().split("\n").filter((l) => l && !l.startsWith("#"));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const [text, seq, ...frames] = line.split("\t");
      const got = chunkRoster(text!.replaceAll("\\n", "\n"), Number(seq)).map((f) => hex(encodeFrame(f)));
      expect(got, `vector ${text}`).toEqual(frames);
    }
  });
});
