import { describe, expect, test } from "bun:test";
import type { LookupPayload } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { runListView } from "./runList.ts";
import { runDetail } from "./runView.ts";
import { NOW, payload, runs, sig, temple, templeAnalysis } from "./vachaman.fixture.ts";

const tFr = makeT(fr, "fr");
const NB = " ";

describe("runDetail", () => {
  test("the mockup's Temple of Sethraliss run (French)", () => {
    const d = runDetail(tFr, "fr", payload(), temple, templeAnalysis, NOW);
    expect(d).toMatchObject({
      title: "Temple of Sethraliss", key: "+20", upgrade: { text: "✓ +1", timed: true }, time: "30:31",
      when: tFr("common.age.hours", { n: 22 }), spec: "Elemental Shaman", notAnalysed: null,
      wcl: "https://www.warcraftlogs.com/reports/TS#fight=1",
    });
    expect(d.stats).toEqual([
      { key: "deaths", label: "Morts", value: "3", tone: "pass" },
      { key: "dtps", label: "DTPS", value: `+14${NB}%`, tone: "worse" },
      { key: "avoidable", label: "Évitable", value: `−100${NB}%`, tone: "better" },
      { key: "kicks", label: "Kicks", value: "37/146", tone: "neutral" },
      { key: "dispels", label: "Dispels", value: "8", tone: "neutral" },
      { key: "parse", label: "Parse", value: `72,2${NB}%`, tone: "tier-blue" },
    ]);
    expect(d.defensives).toEqual([
      { name: "Astral Shift", id: 108271, used: "10/15", pct: 67 },
      { name: "Earth Elemental", id: 198103, used: "3/6", pct: 50 },
      { name: "Potions de soin", id: null, used: "0", pct: null },
    ]);
    expect(d.also).toBe(`Aussi sur ce run : kicks 37/146 (pairs 32${NB}%) · dispels 8 · DTPS +14${NB}% vs pairs`);
    expect(d.killers).toEqual([
      { id: 1003, name: "Storm Strikes", share: `31${NB}%` },
      { id: 1001, name: "Ground Pound", share: `24${NB}%` },
      { id: 1004, name: "Spark Step", share: `21${NB}%` },
      { id: 1005, name: "Release Charge", share: `13${NB}%` },
      { id: 1002, name: "Slither Strike", share: `10${NB}%` },
    ]);
    expect(d.enemySpells).toEqual([
      { id: 3001, name: "Lightning Bolt", text: "passés 4 / 12 · ses kicks 3" },
      { id: 3002, name: "Healing Wave", text: "passés 1 / 6 · ses kicks 2" },
    ]);
    expect(d.avoidable).toEqual([]);
  });

  test("stats match the run list's cells", () => {
    const row = runListView(tEn, "en", payload(), "best", "parse", NOW).rows[0]!;
    const d = runDetail(tEn, "en", payload(), temple, templeAnalysis, NOW);
    const v = (k: string) => d.stats.find((s) => s.key === k)!.value;
    expect([v("dtps"), v("avoidable"), v("kicks"), v("parse")]).toEqual([row.dtps!.text, row.avoidable!.text, row.util!.text, row.parse.text]);
  });

  test("a run without analysis: what is already known, killers from the signals", () => {
    const va = runs[1]!;
    const withHits = {
      ...temple, reportCode: "X",
      signals: { ...temple.signals!, deaths: { ...temple.signals!.deaths, events: temple.signals!.deaths.events.slice(0, 1) } },
    };
    const d = runDetail(tFr, "fr", payload(), withHits, null, NOW);
    expect(d.notAnalysed).toBe(`Déjà connu : 3 morts · parse 72,2${NB}%`);
    expect(d.defensives).toEqual([{ name: "Potions de soin", id: null, used: "0", pct: null }]);
    expect(d.killers).toEqual([{ id: 1001, name: "Ground Pound", share: `71${NB}%` }, { id: 1002, name: "Slither Strike", share: `29${NB}%` }]);
    const other = runDetail(tEn, "en", payload(), va, null, NOW);
    expect(other.notAnalysed).toBe("Already known: 0 deaths · parse 68.3%");
    expect(other.avoidable).toEqual([{ id: 2001, name: "Static Pool", amount: "1.20m" }, { id: null, name: "other avoidable damage", amount: "300.0k" }]);
  });

  test("a healer: dispels replace kicks", () => {
    const p = payload({ evaluation: { role: "healer" } as LookupPayload["evaluation"] });
    const d = runDetail(tEn, "en", p, temple, templeAnalysis, NOW);
    expect(d.stats.map((s) => s.key)).toEqual(["deaths", "dtps", "avoidable", "dispels", "parse"]);
    expect(d.also).toBe("Also on this run: kicks 37/146 (peer 32%) · dispels 8 · DTPS +14% vs peers");
  });

  test("a run without signals: only key, time and parse", () => {
    const bare = { ...runs[2]!, signals: undefined };
    const d = runDetail(tEn, "en", payload(), bare, null, NOW);
    expect(d).toMatchObject({
      key: "+20", upgrade: { text: "✓", timed: true }, time: "31:33", also: null, killers: [], enemySpells: null, avoidable: null,
      notAnalysed: null, defensives: [],
    });
    expect(d.stats).toEqual([{ key: "parse", label: "Parse", value: "64.4%", tone: "tier-blue" }]);
  });

  test("no peers, no consumables, no enemy casts", () => {
    const solo = {
      ...temple,
      signals: sig({ damageTaken: { total: 1, dtps: 9_000, peer: null }, avoidableDamage: null, consumables: null, interrupts: { count: 4, kickCooldownS: null, capacity: null, usage: null, peer: null } }),
    };
    const d = runDetail(tEn, "en", payload(), solo, null, NOW);
    expect(d.stats).toEqual([
      { key: "deaths", label: "Deaths", value: "0", tone: "neutral" },
      { key: "dtps", label: "DTPS", value: "9.0k", tone: "neutral" },
      { key: "kicks", label: "Kicks", value: "4", tone: "neutral" },
      { key: "dispels", label: "Dispels", value: "8", tone: "neutral" },
      { key: "parse", label: "Parse", value: "72.2%", tone: "tier-blue" },
    ]);
    expect(d.also).toBe("Also on this run: kicks 4 (no kick on spec) · dispels 8");
    expect(d.defensives).toEqual([]);
    expect(d.enemySpells).toBeNull();
    expect(d.avoidable).toBeNull();
  });
});
