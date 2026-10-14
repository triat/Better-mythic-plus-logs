import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMarker, memberMarker, memberMarkerAt } from "../../src/calibration/marker.ts";

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("member marker", () => {
  test("the server never creates it; the collector does, at the epoch; a touch sets now, at most once a minute", async () => {
    dir = mkdtempSync(join(tmpdir(), "bmpl-marker-"));
    const p = join(dir, "last-member-wcl");
    let t = 1_800_000_000_000;
    const touch = memberMarker(p, () => t);
    touch();
    await settle();
    expect(existsSync(p)).toBe(false);
    expect(memberMarkerAt(p)).toBeNull();

    ensureMarker(p);
    expect(memberMarkerAt(p)).toBe(0);
    const touch2 = memberMarker(p, () => t);
    touch2();
    await settle();
    expect(memberMarkerAt(p)).toBe(t);
    const first = t;
    t += 30_000;
    touch2();
    await settle();
    expect(memberMarkerAt(p)).toBe(first);
    t += 60_000;
    touch2();
    await settle();
    expect(memberMarkerAt(p)).toBe(t);
    ensureMarker(p); // an existing marker keeps its time
    expect(memberMarkerAt(p)).toBe(t);
  });
});
