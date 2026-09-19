import { describe, expect, test } from "bun:test";
import { SEALED_PREFIX, decrypt, encrypt } from "../../src/hosted/crypto.ts";

const key = new Uint8Array(32).map((_, i) => i);
const other = new Uint8Array(32).fill(9);

describe("crypto", () => {
  test("round-trips, with a fresh iv each time", async () => {
    const a = await encrypt(key, "s3cret");
    const b = await encrypt(key, "s3cret");
    expect(a.startsWith(SEALED_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.split(".")).toHaveLength(3);
    expect(await decrypt(key, a)).toBe("s3cret");
    expect(await decrypt(key, b)).toBe("s3cret");
    expect(await decrypt(key, await encrypt(key, ""))).toBe("");
  });
  test("returns null on a wrong key, a tampered body, a bad prefix or bad base64", async () => {
    const sealed = await encrypt(key, "s3cret");
    expect(await decrypt(other, sealed)).toBeNull();
    const [v, iv, ct] = sealed.split(".") as [string, string, string];
    const flipped = Buffer.from(ct, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(await decrypt(key, `${v}.${iv}.${flipped.toString("base64")}`)).toBeNull();
    expect(await decrypt(key, `v0.${iv}.${ct}`)).toBeNull();
    expect(await decrypt(key, "v1.!!!.???")).toBeNull();
    expect(await decrypt(key, "")).toBeNull();
  });
});
