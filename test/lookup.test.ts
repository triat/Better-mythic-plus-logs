import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { performLookup } from "../src/lookup.ts";
import type { MPlusData, MPlusRun } from "../src/mplus.ts";
import { openStore } from "../src/signals/store.ts";
import { ESTIMATE_RANKINGS, ESTIMATE_RUN } from "../src/wcl/meter.ts";
import type { QuotaRefusal } from "../src/hosted/quota.ts";
import { loadWclFixture } from "./fixtures.ts";

// Dummy creds: if a future regression lets the real fetchMplusData/gql run instead of the fakes below,
// it fails at OAuth instead of spending real WCL points.
const saved = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
beforeAll(() => { process.env.WCL_CLIENT_ID = "bmpl-test"; process.env.WCL_CLIENT_SECRET = "bmpl-test"; });
afterAll(() => {
  if (saved.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = saved.id;
  if (saved.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = saved.secret;
});

const REFUSED: QuotaRefusal = { error: "quota", message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };

/** Two displayed runs (two dungeons): the fixture's, cached in the store, and a second one that is not. */
async function fixture() {
  const f = await loadWclFixture("s2-healer");
  const cached: MPlusRun = { ...f.run };
  const uncached: MPlusRun = { ...f.run, reportCode: "OTHERCODE", fightID: 7, encounterID: f.run.encounterID + 1, encounterName: "Other Dungeon" };
  const data: MPlusData = {
    zoneID: 1, zoneName: "z", partition: 1, metric: "hps", metricAutoSelected: true, alternateMetricHasData: false,
    character: { id: 1, name: f.character, classID: 6, spec: "Holy", scoreTop: null },
    runs: [cached, uncached],
    seasonDungeons: [{ id: cached.encounterID, name: cached.encounterName }, { id: uncached.encounterID, name: uncached.encounterName }],
    specFilter: null,
  };
  const store = openStore(":memory:");
  store.putWclRun(cached.reportCode, cached.fightID, f.report);
  const gqlCalls: string[] = [];
  const gql = async <T,>(_q: string, vars?: Record<string, unknown>) => { gqlCalls.push(String(vars?.code)); return { reportData: { report: f.report } } as T; };
  const fetchFn = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  let fetches = 0;
  const fetchMplus = async () => { fetches++; return data; };
  return { store, gql, gqlCalls, fetchFn, fetchMplus, fetches: () => fetches, name: f.character as string };
}

const opts = (name: string) => ({ name, realm: "Hyjal", level: null, spec: null, enrich: true });

describe("performLookup — quota reservations", () => {
  test("reserves the rankings, then one run's worth per uncached displayed run", async () => {
    const x = await fixture();
    const estimates: number[] = [];
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: (e) => { estimates.push(e); return null; } });
    expect(o.ok).toBe(true);
    expect(estimates).toEqual([ESTIMATE_RANKINGS, ESTIMATE_RUN]);
    expect(x.gqlCalls).toEqual(["OTHERCODE"]);
    x.store.close();
  });
  test("a refusal before the rankings fetches nothing", async () => {
    const x = await fixture();
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: () => REFUSED });
    expect(o).toEqual({ ok: false, status: 429, error: REFUSED.message, quota: REFUSED });
    expect(x.fetches()).toBe(0);
    expect(x.gqlCalls).toEqual([]);
    x.store.close();
  });
  test("a refusal before enrichment fails the lookup without fetching any run", async () => {
    const x = await fixture();
    let n = 0;
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: () => (++n === 2 ? REFUSED : null) });
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.status).toBe(429);
    expect(x.fetches()).toBe(1);
    expect(x.gqlCalls).toEqual([]);
    x.store.close();
  });
  test("no second reservation when every displayed run is cached; none at all without a gate", async () => {
    const x = await fixture();
    x.store.putWclRun("OTHERCODE", 7, (await loadWclFixture("s2-healer")).report);
    const estimates: number[] = [];
    await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: (e) => { estimates.push(e); return null; } });
    expect(estimates).toEqual([ESTIMATE_RANKINGS]);
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus });
    expect(o.ok).toBe(true);
    expect(x.gqlCalls).toEqual([]);
    x.store.close();
  });
});
