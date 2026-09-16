import { describe, expect, test } from "bun:test";
import { analyzeCached, attachDeepdive } from "../../src/deepdive/attach.ts";
import { SHIPPED } from "../../src/deepdive/table.ts";
import type { LoadedTables } from "../../src/deepdive/types.ts";
import { DEFAULT_CONFIG, validateConfig } from "../../src/evaluation/config.ts";
import { evaluate } from "../../src/evaluation/evaluate.ts";
import type { LookupPayload } from "../../src/lookup.ts";
import { analyzeLookup, type MPlusRun } from "../../src/mplus.ts";
import { openStore } from "../../src/signals/store.ts";
import { signalSummary } from "../../src/signals/summary.ts";
import { parseRunSignals } from "../../src/signals/wcl-run.ts";
import { loadDeepdiveFixture } from "../fixtures.ts";

const cfg = validateConfig(DEFAULT_CONFIG);
const tables: LoadedTables = { shipped: SHIPPED, override: {}, overridePath: "/dev/null" };

async function payloadFor(names: Array<"s2-healer" | "s2-rogue">) {
  const store = openStore(":memory:");
  const fixtures = await Promise.all(names.map(loadDeepdiveFixture));
  const runs: MPlusRun[] = fixtures.map((f) => {
    const run: MPlusRun = { ...f.run };
    run.signals = parseRunSignals(f.report, f.character, { keyLevel: run.keyLevel, affixes: run.affixes, encounterID: run.encounterID })!;
    store.putWclRun(run.reportCode, run.fightID, f.report);
    return run;
  });
  const character = fixtures[0]!.character as string;
  const result = analyzeLookup(runs, runs[0]!.keyLevel, runs.map((r) => ({ id: r.encounterID, name: r.encounterName })), true);
  const base = { metric: "hps" as const, targetLevel: result.targetLevel, perDungeon: result.perDungeon, prevLevelBest: result.prevLevelBest, rio: null, summary: signalSummary(runs, null) };
  const payload = {
    character: { id: 1, name: character, classID: 6, spec: "Holy", scoreTop: null, realmSlug: "hyjal", region: "eu" },
    zone: { id: 1, name: "z", partition: 1 }, metricAutoSelected: true, alternateMetricHasData: false, specFilter: null, runsIndexed: runs.length, seasonDungeons: [],
    targetAutoDetected: true, atOrAboveTargetCount: 0, rioError: null,
    ...base, evaluation: evaluate(base, cfg), deepdive: [], deepdiveSummary: { tableWarning: null, analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
  } as unknown as LookupPayload;
  return { payload, store, fixtures };
}

describe("analyzeCached", () => {
  test("null without a raw deep-dive row; analysis when both rows are cached", async () => {
    const { store, fixtures } = await payloadFor(["s2-healer"]);
    const f = fixtures[0]!;
    const run = { reportCode: f.run.reportCode as string, fightID: f.run.fightID as number };
    expect(analyzeCached(store, tables, run, f.character)).toBeNull();
    store.putDeepDive(run.reportCode, run.fightID, f.character, f.deepdive);
    const r = analyzeCached(store, tables, run, f.character)!;
    expect(r.spec).toBe("Holy");
    expect(r.defensives.find((d) => d.id === 498)!.casts).toBe(27);
    store.close();
  });
});

describe("attachDeepdive", () => {
  test("adds analyses of displayed runs, the summary and a re-run evaluation; pure on the input", async () => {
    const { payload, store, fixtures } = await payloadFor(["s2-healer"]);
    const before = JSON.stringify(payload);
    const none = attachDeepdive(payload, store, tables, cfg);
    expect(none.deepdive).toEqual([]);
    expect(none.deepdiveSummary.analyzedRuns).toBe(0);
    expect(none.evaluation.analyzedRuns).toBe(0);
    const f = fixtures[0]!;
    store.putDeepDive(f.run.reportCode, f.run.fightID, f.character, f.deepdive);
    const one = attachDeepdive(payload, store, tables, cfg);
    expect(one.deepdive.length).toBe(1);
    expect(one.deepdiveSummary.analyzedRuns).toBe(1);
    expect(one.evaluation.analyzedRuns).toBe(1);
    // Below deepdiveMinRuns: no deep-dive evidence yet.
    expect(one.evaluation.axes.find((a) => a.key === "survival")!.evidence.some((e) => e.source === "survival.defensiveUsage")).toBe(false);
    expect(JSON.stringify(payload)).toBe(before);
    expect(one.deepdiveSummary.tableWarning).toBeNull();
    // An ignored override file travels with the payload so the UI can name it.
    const warned = attachDeepdive(payload, store, { ...tables, warning: "bmpl: ignoring /x/defensives.json: bad" }, cfg);
    expect(warned.deepdiveSummary.tableWarning).toBe("bmpl: ignoring /x/defensives.json: bad");
    store.close();
  });
});
