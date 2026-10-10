import { describe, expect, test } from "bun:test";
import type { MPlusRun } from "../../src/mplus.ts";
import { enrichRuns, fetchRunControl } from "../../src/signals/enrich.ts";
import { CC_TABLE, ccFilterExpression } from "../../src/signals/control/table.ts";
import { openStore } from "../../src/signals/store.ts";
import { loadControlFixture, loadWclFixture } from "../fixtures.ts";

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

describe("fetchRunControl", () => {
  test("one page: events, pets with an owner, the table version", async () => {
    const calls: Record<string, unknown>[] = [];
    const gql = async <T,>(_q: string, v?: Record<string, unknown>): Promise<T> => {
      calls.push(v!);
      return { reportData: { report: {
        masterData: { actors: [{ id: 333, petOwner: 328 }, { id: 400, petOwner: null }] },
        cc: { data: [{ timestamp: 5, type: "applydebuff", sourceID: 333, abilityGameID: 91800 }], nextPageTimestamp: null },
      } } } as T;
    };
    const out = await fetchRunControl({ reportCode: "AbC", fightID: 9 }, gql);
    expect(out).toEqual({ tableVersion: CC_TABLE.version, pets: [{ id: 333, petOwner: 328 }], events: [{ timestamp: 5, type: "applydebuff", sourceID: 333, abilityGameID: 91800 }] });
    expect(calls).toEqual([{ code: "AbC", fightID: 9, filter: ccFilterExpression() }]);
  });
  test("follows nextPageTimestamp, then stops", async () => {
    let n = 0;
    const gql = async <T,>(_q: string, v?: Record<string, unknown>): Promise<T> => {
      n++;
      const first = v!.startTime === undefined;
      return { reportData: { report: { masterData: { actors: [] }, cc: { data: [{ timestamp: first ? 1 : 2, type: "cast", sourceID: 1, abilityGameID: 49576 }], nextPageTimestamp: first ? 2 : null } } } } as T;
    };
    const out = await fetchRunControl({ reportCode: "AbC", fightID: 9 }, gql);
    expect(n).toBe(2);
    expect(out!.events.map((e) => e.timestamp)).toEqual([1, 2]);
  });
  test("a report WCL does not return → null", async () => {
    const gql = async <T,>(): Promise<T> => ({ reportData: { report: null } }) as T;
    expect(await fetchRunControl({ reportCode: "AbC", fightID: 9 }, gql)).toBeNull();
  });
});

describe("enrichRuns — crowd control", () => {
  /** The DK fixture's run, its summary answered by the fake, its control answered on the control query. */
  async function setup(opts: { throwOnControl?: boolean } = {}) {
    const f = await loadControlFixture("s2-dk-frost");
    const store = openStore(":memory:");
    const calls: string[] = [];
    const gql = async <T,>(query: string): Promise<T> => {
      const kind = query.includes("ReportRunControl") ? "control" : "summary";
      calls.push(kind);
      if (kind === "control") {
        if (opts.throwOnControl) throw new Error("boom");
        return { reportData: { report: { masterData: { actors: f.control.pets }, cc: { data: f.control.events, nextPageTimestamp: null } } } } as T;
      }
      return { reportData: { report: f.report } } as T;
    };
    const run = (): MPlusRun => ({
      encounterID: f.report.fights[0].encounterID, encounterName: "Den of Nalorakk", keyLevel: 19, amount: 1, parsePercent: 50, spec: "Frost",
      affixes: [], reportCode: f.report.code, fightID: f.report.fights[0].id, startTime: 0, score: 0,
    });
    return { f, store, calls, gql, run };
  }

  test("without `control`: no control call, nothing attached", async () => {
    const x = await setup();
    const runs = [x.run()];
    await enrichRuns(runs, x.f.character, x.store, { gql: x.gql });
    expect(x.calls).toEqual(["summary"]);
    expect(runs[0]!.signals?.control).toBeUndefined();
  });
  test("with `control`: fetched once, stored, attached; then all from the cache", async () => {
    const x = await setup();
    const runs = [x.run()];
    await enrichRuns(runs, x.f.character, x.store, { gql: x.gql, control: true });
    expect(x.calls).toEqual(["summary", "control"]);
    expect(x.store.hasRunControl(x.f.report.code, x.f.report.fights[0].id, CC_TABLE.version)).toBe(true);
    expect(runs[0]!.signals!.control!.uses).toBeGreaterThan(0);
    const again = [x.run()];
    await enrichRuns(again, x.f.character, x.store, { gql: x.gql, control: true });
    expect(x.calls).toEqual(["summary", "control"]);
    expect(again[0]!.signals!.control!.uses).toBe(runs[0]!.signals!.control!.uses);
  });
  test("a cached control row is attached at 0 pts even without `control`", async () => {
    const x = await setup();
    x.store.putRunControl(x.f.report.code, x.f.report.fights[0].id, x.f.control);
    const runs = [x.run()];
    await enrichRuns(runs, x.f.character, x.store, { gql: x.gql });
    expect(x.calls).toEqual(["summary"]);
    expect(runs[0]!.signals!.control!.uses).toBeGreaterThan(0);
  });
  test("a row at another table version is refetched when asked, kept (stale) otherwise", async () => {
    const x = await setup();
    x.store.putRunControl(x.f.report.code, x.f.report.fights[0].id, { ...x.f.control, tableVersion: "mn-1.0" });
    const plain = [x.run()];
    await enrichRuns(plain, x.f.character, x.store, { gql: x.gql });
    expect(plain[0]!.signals!.control!.stale).toBe(true);
    const asked = [x.run()];
    await enrichRuns(asked, x.f.character, x.store, { gql: x.gql, control: true });
    expect(x.calls.filter((c) => c === "control")).toHaveLength(1);
    expect(asked[0]!.signals!.control!.stale).toBe(false);
    expect(x.store.getRunControl(x.f.report.code, x.f.report.fights[0].id)!.tableVersion).toBe(CC_TABLE.version);
  });
  test("a failing control call keeps the run's signals, without control", async () => {
    const x = await setup({ throwOnControl: true });
    const runs = [x.run()];
    await enrichRuns(runs, x.f.character, x.store, { gql: x.gql, control: true });
    expect(runs[0]!.signals).toBeDefined();
    expect(runs[0]!.signals!.control).toBeUndefined();
  });
});
