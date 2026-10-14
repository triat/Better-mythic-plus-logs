import { describe, expect, test } from "bun:test";
import type { ChangelogEntry } from "../changelog/types.ts";
import { compareVersions, isVersion, whatsNew } from "./whatsNew.ts";

const log: ChangelogEntry[] = [
  { version: "next", items: ["n"] },
  { version: "0.11.0", date: "2026-10-20", items: ["e"] },
  { version: "0.10.2", date: "2026-10-14", items: ["c", "d"] },
  { version: "0.10.1", date: "2026-10-12", items: ["b"] },
  { version: "0.9.9", date: "2026-10-01", items: ["a"] },
];
const versions = (es: ChangelogEntry[]) => es.map((e) => e.version);

describe("compareVersions / isVersion", () => {
  test("numeric per part, never as strings", () => {
    expect(compareVersions("0.10.2", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.2", "0.10.2")).toBe(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.10.1", "0.10.2")).toBeLessThan(0);
  });
  test("isVersion: X.Y.Z only", () => {
    expect(isVersion("0.10.2")).toBe(true);
    expect([isVersion("next"), isVersion("1.2"), isVersion(""), isVersion(null)]).toEqual([false, false, false, false]);
  });
});

describe("whatsNew", () => {
  test("since the last visit: newer than lastSeen, up to the running version, newest first; the mark is on", () => {
    const w = whatsNew(log, "0.10.1", "0.10.2");
    expect(w.mark).toBe(true);
    expect(versions(w.since)).toEqual(["0.10.2"]);
    expect(versions(w.all)).toEqual(["0.10.2", "0.10.1", "0.9.9"]);
  });
  test("nothing new: no mark, empty since", () => {
    const w = whatsNew(log, "0.10.2", "0.10.2");
    expect([w.mark, w.since.length]).toEqual([false, 0]);
  });
  test("first visit (no lastSeen): nothing is new", () => {
    const w = whatsNew(log, null, "0.10.2");
    expect([w.mark, w.since.length, w.all.length]).toEqual([false, 0, 3]);
  });
  test("rollback (lastSeen newer than running): no mark, nothing shown", () => {
    const w = whatsNew(log, "0.11.0", "0.10.2");
    expect([w.mark, w.since.length]).toEqual([false, 0]);
  });
  test("a running version missing from the file still lights the mark and lists what exists in between", () => {
    const w = whatsNew(log, "0.9.9", "0.10.3");
    expect(w.mark).toBe(true);
    expect(versions(w.since)).toEqual(["0.10.2", "0.10.1"]);
  });
  test("\"next\" is never shown; an unknown running version shows nothing", () => {
    expect(versions(whatsNew(log, "0.9.9", "0.11.0").all)).not.toContain("next");
    expect(whatsNew(log, "0.9.9", null)).toEqual({ mark: false, since: [], all: [] });
  });
});
