import { describe, expect, test } from "bun:test";
import type { LookupPayload } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { rowOf, signalParts } from "./runs.ts";
import { dungeonAbbr, pickRun, runListView, signedPct } from "./runList.ts";
import { NOW, payload, runs, sig, temple } from "./vachaman.fixture.ts";

const tFr = makeT(fr, "fr");
const NB = " ";

describe("signedPct", () => {
  test("rounds before choosing the sign: no −0", () => {
    expect([-0.3, -0.49, 0, 0.4, -0.6, 12.4, -3.5].map((d) => signedPct(tEn, d))).toEqual(["+0%", "+0%", "+0%", "+0%", "−1%", "+12%", "−4%"]);
    expect(signedPct(tFr, -0.2)).toBe(`+0${NB}%`);
  });
});

describe("dungeonAbbr", () => {
  test("first letters of the words that matter", () => {
    expect(dungeonAbbr("Temple of Sethraliss")).toBe("TS");
    expect(dungeonAbbr("The Blinding Vale")).toBe("BV");
    expect(dungeonAbbr("Kings' Rest")).toBe("KR");
    expect(dungeonAbbr("Ruby Life Pools")).toBe("RL");
    expect(dungeonAbbr("Ara-Kara, City of Echoes")).toBe("AK");
    expect(dungeonAbbr("Skyreach")).toBe("SK");
  });
});

describe("runListView", () => {
  test("the mockup's top row (French)", () => {
    const v = runListView(tFr, "fr", payload(), "best", "parse", NOW);
    expect(v.rows.map((r) => r.abbr)).toEqual(["TS", "VA", "KR", "AF", "RL", "BV", "DN", "MR"]);
    expect(v.rows[0]).toEqual({
      key: "TS:1", abbr: "TS", dungeon: "Temple of Sethraliss", analysed: true, hasSignals: true,
      level: "+20", upgrade: { text: "✓ +1", timed: true }, time: "30:31",
      deaths: { text: "3 morts", tone: "pass" },
      dtps: { text: `+14${NB}%`, tone: "worse" },
      avoidable: { text: `−100${NB}%`, tone: "better" },
      util: { label: "kicks", text: "37/146" },
      parse: { text: `72,2${NB}%`, tier: "blue" },
      when: tFr("common.age.hours", { n: 22 }), stale: false,
      url: "https://www.warcraftlogs.com/reports/TS#fight=1",
    });
    expect(v.rows[1]!.deaths).toEqual({ text: "0 mort", tone: "dim" });
    expect(v.rows[3]!.parse.text).toBe(`61,0${NB}%`);
    expect(v.rows.find((r) => r.abbr === "BV")!.deaths).toEqual({ text: "1 mort", tone: "neutral" });
    expect(v.analysedLine).toBe("1/8 analysé");
    expect(v.pending).toBe(7);
    expect(v.batchLabel).toBe("Analyser les 7 autres · ~21 pts");
    expect(v.missing).toEqual(["Eco-Dome Al'dani"]);
  });

  test("numbers match today's run rows", () => {
    const row = runListView(tEn, "en", payload(), "best", "parse", NOW).rows[0]!;
    const old = rowOf(tEn, temple, "dps", NOW);
    expect(old.parse).toBe("72.2%");
    expect(row.parse.text).toBe("72.2%");
    expect(old.keystone!.text).toBe("✓+1 30:31");
    const parts = signalParts(tEn, temple.signals!).map((p) => p.text);
    expect(parts).toContain("114.0k dtps +14% vs 4 dps");
    expect(parts).toContain("avoidable 0/min (−100%)");
    expect(parts).toContain("kicks 37/146 (peer 32%)");
    expect([row.dtps!.text, row.avoidable!.text, row.util!.text]).toEqual(["+14%", "−100%", "37/146"]);
  });

  test("filters and sorts", () => {
    const p = payload();
    expect(runListView(tEn, "en", p, "deaths", "parse", NOW).rows.map((r) => r.abbr)).toEqual(["TS", "BV", "DN"]);
    expect(runListView(tEn, "en", p, "best", "when", NOW).rows.map((r) => r.abbr)).toEqual(["BV", "AF", "TS", "MR", "KR", "DN", "VA", "RL"]);
    expect(runListView(tEn, "en", p, "best", "key", NOW).rows.map((r) => r.abbr)).toEqual(["TS", "KR", "BV", "DN", "MR", "VA", "AF", "RL"]);
    expect(runListView(tEn, "en", p, "best", "deaths", NOW).rows.map((r) => r.abbr)).toEqual(["TS", "BV", "DN", "VA", "KR", "AF", "RL", "MR"]);
  });

  test("healers see dispels, a run without signals keeps time and parse", () => {
    const bare = { ...runs[1]!, signals: undefined, parsePercent: 0, timed: false };
    const p = payload({ evaluation: { role: "healer" } as LookupPayload["evaluation"], perDungeon: { ...payload().perDungeon, runs: [runs[0]!, bare] }, deepdive: [] });
    const v = runListView(tEn, "en", p, "best", "parse", NOW);
    expect(v.rows[0]!.util).toEqual({ label: "dispels", text: "8" });
    expect(v.util).toBe("dispels");
    expect(runListView(tEn, "en", payload(), "best", "parse", NOW).util).toBe("kicks");
    expect(v.rows[1]).toMatchObject({
      hasSignals: false, analysed: false, upgrade: { text: "✗ depleted", timed: false }, time: "28:44",
      deaths: { text: "—", tone: "dim" }, dtps: null, avoidable: null, util: null, parse: { text: "unranked", tier: null },
    });
    expect(v.analysedLine).toBe("0/2 analysed");
    expect(v.batchLabel).toBe("Analyse the run · ~3 pts");
  });

  test("no peers: raw figures; nothing left to analyse", () => {
    const solo = { ...runs[0]!, signals: sig({ damageTaken: { total: 1, dtps: 9_000, peer: null }, avoidableDamage: { total: 1, perMinute: 362_000, peer: null, spellCount: 3 } }) };
    const p = payload({ perDungeon: { ...payload().perDungeon, runs: [solo] } });
    const v = runListView(tEn, "en", p, "best", "parse", NOW);
    expect(v.rows[0]!.dtps).toEqual({ text: "9.0k", tone: "neutral" });
    expect(v.rows[0]!.avoidable).toEqual({ text: "362.0k/min", tone: "neutral" });
    expect(v.pending).toBe(0);
    expect(v.batchLabel).toBeNull();
  });
  test("pickRun: the URL's run when the payload holds it, else the first row", () => {
    const p = payload();
    const v = runListView(tEn, "en", p, "best", "parse", NOW);
    expect(pickRun(p, v.rows, `${runs[3]!.reportCode}:${runs[3]!.fightID}`)).toBe(runs[3]!);
    expect(pickRun(p, v.rows, "nope:9")!.encounterName).toBe(v.rows[0]!.dungeon);
    expect(pickRun(p, v.rows, null)!.encounterName).toBe(v.rows[0]!.dungeon);
    expect(pickRun(p, [], null)).toBeNull();
  });
});
