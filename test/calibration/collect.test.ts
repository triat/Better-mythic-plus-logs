import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHour, type CollectDeps } from "../../src/calibration/collect.ts";
import type { Candidate } from "../../src/calibration/discover.ts";
import { openSamples, type SampleStore } from "../../src/calibration/samples.ts";
import { MEMBER_PAUSE_MS, PACE_MS } from "../../src/calibration/window.ts";
import { payloadWith, runWith } from "../evaluation/helpers.ts";

const START = Date.parse("2026-12-16T12:00:00Z"); // a Wednesday, outside the 03:00–06:00 window
const payload = payloadWith([runWith({})]);

/** A WCL double: one M+ zone, one dungeon, `ladder` entries for Mage:Fire (every other spec ranks nobody). */
function fakeWcl(opts: { spent: number; limit?: number; ladder?: number }) {
  const state = { spent: opts.spent, pages: 0, pings: 0 };
  const rl = () => ({ limitPerHour: opts.limit ?? 18000, pointsSpentThisHour: state.spent, pointsResetIn: 1800 });
  const gql = async <T>(q: string, v?: Record<string, unknown>): Promise<T> => {
    if (q.includes("zones")) return { worldData: { zones: [{ id: 49, name: "Mythic+ Season 2", frozen: false, partitions: null, expansion: { id: 1, name: "x" } }] } } as T;
    if (q.includes("encounters")) return { worldData: { zone: { encounters: [{ id: 7, name: "Dungeon" }] } } } as T;
    if (q.includes("characterRankings")) {
      state.pages++;
      state.spent += 1;
      const n = v!.c === "Mage" && v!.s === "Fire" && v!.p === 1 ? opts.ladder ?? 10 : 0;
      const rankings = Array.from({ length: n }, (_, i) => ({ name: `M${i}`, amount: 1, bracketData: 16, server: { name: "Realm" } }));
      return { rateLimitData: rl(), worldData: { encounter: { characterRankings: { rankings } } } } as T;
    }
    state.pings++;
    return { rateLimitData: rl() } as T;
  };
  return { state, gql };
}

let dir = "";
let samples: SampleStore;
afterEach(() => { samples?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

function setup(over: Partial<CollectDeps> & { wcl: ReturnType<typeof fakeWcl>; lookupCost?: number }) {
  dir = mkdtempSync(join(tmpdir(), "bmpl-collect-"));
  samples = openSamples(join(dir, "calibration.db"));
  let t = START;
  const starts: number[] = [];
  const looked: Candidate[] = [];
  const deps: CollectDeps = {
    samples, gql: over.wcl.gql, reserve: 3000, endAt: START + 55 * 60_000, memberAt: () => null,
    lookup: async (c) => { starts.push(t); looked.push(c); over.wcl.state.spent += over.lookupCost ?? 90; return { ok: true, payload }; },
    now: () => t, sleep: async (ms) => { t += ms; }, log: () => {},
    ...over,
  };
  return { deps, starts, looked, clock: () => t };
}

describe("bmpl calibrate --hourly", () => {
  test("discovers, then samples one character every 16 s, until the pool is done", async () => {
    const wcl = fakeWcl({ spent: 0, ladder: 5 });
    const s = setup({ wcl });
    const r = await collectHour(s.deps);
    expect(r.looked).toBe(5);
    expect(r.stopped).toContain("every candidate");
    for (let i = 1; i < s.starts.length; i++) expect(s.starts[i]! - s.starts[i - 1]!).toBeGreaterThanOrEqual(PACE_MS);
    expect(samples.count(49, 0).total).toBe(5);
    expect(samples.latestPool(49)!.pool.length).toBe(5);
    // A second run the same week: no page read again, nothing left to sample.
    const pages = wcl.state.pages;
    const again = await collectHour({ ...s.deps, endAt: s.clock() + 55 * 60_000 });
    expect(wcl.state.pages).toBe(pages);
    expect(again.looked).toBe(0);
  });

  test("stops when the counter reaches the limit minus the reserve, whatever is left to sample", async () => {
    const wcl = fakeWcl({ spent: 18000 - 3000 - 250 - 200, ladder: 50 });
    const s = setup({ wcl });
    const r = await collectHour(s.deps);
    expect(r.stopped).toContain("kept for the members");
    expect(r.looked).toBeLessThanOrEqual(3);
    expect(wcl.state.spent).toBeLessThanOrEqual(18000 - 3000 + 90);
  });

  test("waits 5 minutes after a member's request before the first lookup", async () => {
    const wcl = fakeWcl({ spent: 0, ladder: 2 });
    const s = setup({ wcl, memberAt: () => START - 60_000 });
    await collectHour(s.deps);
    expect(s.starts[0]! - START).toBeGreaterThanOrEqual(MEMBER_PAUSE_MS - 60_000);
  });

  test("stops at the target", async () => {
    const wcl = fakeWcl({ spent: 0, ladder: 20 });
    const s = setup({ wcl, target: 3 });
    const r = await collectHour(s.deps);
    expect(r.looked).toBe(3);
    expect(r.stopped).toContain("target reached");
    expect((await collectHour({ ...s.deps, endAt: s.clock() + 60_000 })).looked).toBe(0);
  });

  test("a lookup that fails is recorded and never retried; a 429 is retried after a pause", async () => {
    const wcl = fakeWcl({ spent: 0, ladder: 3 });
    let calls = 0;
    const s = setup({
      wcl,
      lookup: async (c) => {
        calls++;
        if (c.name === "M0" && calls === 1) throw new Error("HTTP 429: Too many requests");
        if (c.name === "M1") return { ok: false, error: "No runs found" };
        return { ok: true, payload };
      },
    });
    const r = await collectHour(s.deps);
    expect(r.looked).toBe(2);
    expect(r.failed).toBe(1);
    expect(samples.done("m1-realm-fire", 49, 0)).toBe(true);
  });

  test("the end of the hour stops discovery and lookups; the next run resumes the discovery from its cache", async () => {
    const wcl = fakeWcl({ spent: 0, ladder: 5 });
    const s = setup({ wcl, endAt: START + 10_000 });
    const first = await collectHour(s.deps);
    expect(first.stopped).toContain("hour is over");
    expect(samples.latestPool(49)).toBeNull();
    const read = wcl.state.pages;
    const second = await collectHour({ ...s.deps, endAt: s.clock() + 55 * 60_000 });
    expect(second.pages + read).toBe(41); // every spec's first page and Mage:Fire's second, once in all
    expect(second.looked).toBe(5);
  });
});
