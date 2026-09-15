import { describe, expect, test } from "bun:test";
import type { MPlusRun } from "../../src/mplus.ts";
import { enrichRuns } from "../../src/signals/enrich.ts";
import { openStore } from "../../src/signals/store.ts";
import { loadWclFixture } from "../fixtures.ts";

const runFrom = (f: any): MPlusRun => ({ ...f.run, signals: undefined });

describe("enrichRuns", () => {
  test("fetches once, stores raw, parses signals; second call hits the cache", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const s2 = await loadWclFixture("s2-healer");
    const store = openStore(":memory:");
    const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
    const gql = async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      calls.push({ query, variables });
      const code = variables?.code;
      const report = code === s1.run.reportCode ? s1.report : s2.report;
      return { reportData: { report } } as T;
    };

    const runs = [runFrom(s1), runFrom(s2)];
    await enrichRuns(runs, "Biwaadrood", store, { gql });
    expect(calls.length).toBe(2);
    // S1 dungeon has no avoidable list → plain query; S2 → query with $avoidFilter.
    const s1Call = calls.find((c) => c.variables?.code === s1.run.reportCode)!;
    const s2Call = calls.find((c) => c.variables?.code === s2.run.reportCode)!;
    expect(s1Call.variables?.avoidFilter).toBeUndefined();
    expect(String(s2Call.variables?.avoidFilter)).toMatch(/^ability\.id in \(\d+(,\d+)*\)$/);
    expect(runs[0]!.signals?.keystone.timed).toBe(true);
    expect(runs[0]!.signals?.interrupts.count).toBe(23);
    expect(store.getWclRun(s1.run.reportCode, s1.run.fightID)).not.toBeNull();

    const again = [runFrom(s1), runFrom(s2)];
    await enrichRuns(again, "Biwaadrood", store, { gql });
    expect(calls.length).toBe(2); // no new network calls
    expect(again[0]!.signals?.interrupts.count).toBe(23);
    store.close();
  });

  test("a failing fetch leaves that run without signals and does not throw", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const store = openStore(":memory:");
    const gql = async <T,>(): Promise<T> => { throw new Error("boom"); };
    const runs = [runFrom(s1)];
    await enrichRuns(runs, "Biwaadrood", store, { gql });
    expect(runs[0]!.signals).toBeUndefined();
    expect(store.getWclRun(s1.run.reportCode, s1.run.fightID)).toBeNull();
    store.close();
  });

  test("duplicate runs (same report+fight) are fetched once", async () => {
    const s1 = await loadWclFixture("s1-tank");
    const store = openStore(":memory:");
    let n = 0;
    const gql = async <T,>(): Promise<T> => { n++; return { reportData: { report: s1.report } } as T; };
    const runs = [runFrom(s1), runFrom(s1)];
    await enrichRuns(runs, "Biwaadrood", store, { gql });
    expect(n).toBe(1);
    expect(runs[1]!.signals?.deaths.groupTotal).toBe(4);
    store.close();
  });
});
