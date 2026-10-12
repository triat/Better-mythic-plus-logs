import { describe, expect, test } from "bun:test";
import type { MPlusRun, SeasonRunView, SeasonView } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  ALL_RUNS, filterLabels, filterMenus, filterOptions, keyPresets, pickMenu, revealRun, mainSpec, matches, normFilters, ownerRunsView, stepKey, targetFilters, weekLabel, weeksFor,
  type RunFilters,
} from "./ownerRuns.ts";
import { runListRow } from "./runList.ts";
import { NOW, payload, runs, sig, templeAnalysis } from "./vachaman.fixture.ts";

const tFr = makeT(fr, "fr");
const H = 3600e3;

/** A season run from one of the fixture's best runs, moved to `week` and `ageH` hours ago. */
const fromRun = (r: MPlusRun, week: number, ageH: number, over: Partial<SeasonRunView> = {}): SeasonRunView => ({
  key: `${r.reportCode}:${r.fightID}`, reportCode: r.reportCode, fightID: r.fightID, encounterID: r.encounterID, encounterName: r.encounterName,
  keyLevel: r.keyLevel, startTime: NOW - ageH * H, durationMs: r.durationMs ?? null, timed: r.timed ?? null, parse: r.parsePercent,
  amount: r.amount, metric: "dps", spec: r.spec, affixes: [], score: 0, week, analysed: true, failed: false, signals: r.signals ?? null,
  analysis: null, pillars: null, ...over,
});

// Week 10 is the current game week. Eight runs: the fixture's best runs spread over weeks 10, 9, 7 and 5, plus a
// depleted run, a run without time and an Enhancement run.
const seasonRuns: SeasonRunView[] = [
  fromRun(runs[0]!, 10, 22, { analysis: templeAnalysis }), // TS +20 timed
  fromRun(runs[1]!, 10, 26), // VA +19 timed
  fromRun({ ...runs[2]!, reportCode: "KRd", timed: false, signals: sig({ keystone: { level: 20, chests: 0, timed: false, timeMs: 2_100_000, affixes: [] } }) }, 9, 30, {
    timed: false,
  }), // KR +20 depleted
  fromRun(runs[3]!, 9, 40, { spec: "Enhancement" }), // AF +19 timed, other spec
  fromRun({ ...runs[4]!, reportCode: "RLn" }, 7, 300, { timed: null, durationMs: null, signals: null, analysed: false }), // RL +19 no time
  fromRun(runs[5]!, 7, 310), // BV +20 timed
  fromRun({ ...runs[6]!, keyLevel: 16 }, 5, 600, { keyLevel: 16 }), // DN +16 timed
  fromRun(runs[7]!, 5, 610), // MR +20 timed
];

const season = (over: Partial<SeasonView> = {}): SeasonView => ({
  character: { name: "Vachâman", realm: "hyjal", region: "eu" }, zoneID: 55, targetLevel: 19, currentWeek: 10, checkedAt: NOW - H,
  state: { runs: seasonRuns.length, analysed: 7, pending: 1, controlOnly: 0, failed: 0, estimate: 12 },
  runs: seasonRuns, recent: null, season: null, trends: [], workOn: [], dungeons: [], ...over,
});

const keys = (v: ReturnType<typeof ownerRunsView>) => v.weeks.flatMap((w) => w.rows.map((r) => r.key));

describe("filterOptions", () => {
  test("dungeons, specs, key range, periods, target and defaults", () => {
    const o = filterOptions(tEn, season());
    expect(o.dungeons[0]).toEqual({ value: null, label: "Dungeon: all" });
    expect(o.dungeons.slice(1).map((d) => d.label)).toEqual([
      "Altar of Fangs", "Den of Nalorakk", "Kings' Rest", "Murder Row", "Ruby Life Pools", "Temple of Sethraliss", "The Blinding Vale", "Voidscar Arena",
    ]);
    expect(o.specs).toEqual([
      { value: null, label: "Spec: all" }, { value: "Elemental", label: "Elemental", count: 7 }, { value: "Enhancement", label: "Enhancement", count: 1 },
    ]);
    expect(o.keys).toEqual({ min: 16, max: 20 });
    expect(o.weeks.map((w) => w.label)).toEqual(["This week", "Last 3 weeks", "Last 8 weeks", "Whole season"]);
    expect(filterOptions(tFr, season()).weeks.map((w) => w.label)).toEqual(["Cette semaine", "3 dernières semaines", "8 dernières semaines", "Toute la saison"]);
    expect(o.results.map((r) => r.label)).toEqual(["All", "Timed", "Depleted", "No time"]);
    expect(o.target).toBe(19);
    expect(o.defaults).toEqual({ ...ALL_RUNS, keyMin: 16, keyMax: 20 });
    expect(filterOptions(tEn, season({ runs: [] })).keys).toBeNull();
  });

  test("select labels", () => {
    const o = filterOptions(tFr, season());
    expect(filterLabels(tFr, o.defaults, o)).toEqual({ dungeon: "Donjon : tous", spec: "Spé : toutes", weeks: "Toute la saison" });
    expect(filterLabels(tFr, { ...o.defaults, dungeon: 5, spec: "Enhancement", weeks: 3 }, o))
      .toEqual({ dungeon: "Donjon : Ruby Life Pools", spec: "Spé : Enhancement", weeks: "3 dernières semaines" });
  });
});

describe("filters", () => {
  const s = season();
  const shown = (f: RunFilters) => s.runs.filter((v) => matches(v, f, s.currentWeek)).map((v) => v.reportCode);
  test("each filter alone", () => {
    expect(shown(ALL_RUNS)).toHaveLength(8);
    expect(shown({ ...ALL_RUNS, dungeon: 1 })).toEqual(["TS"]);
    expect(shown({ ...ALL_RUNS, spec: "Enhancement" })).toEqual(["AF"]);
    expect(shown({ ...ALL_RUNS, result: "timed" })).toEqual(["TS", "VA", "AF", "BV", "DN", "MR"]);
    expect(shown({ ...ALL_RUNS, result: "depleted" })).toEqual(["KRd"]);
    expect(shown({ ...ALL_RUNS, result: "none" })).toEqual(["RLn"]);
    expect(shown({ ...ALL_RUNS, weeks: 1 })).toEqual(["TS", "VA"]);
    expect(shown({ ...ALL_RUNS, weeks: 2 })).toEqual(["TS", "VA", "KRd", "AF"]);
    expect(shown({ ...ALL_RUNS, keyMin: 20 })).toEqual(["TS", "KRd", "BV", "MR"]);
    expect(shown({ ...ALL_RUNS, keyMax: 16 })).toEqual(["DN"]);
  });
  test("combined", () => {
    expect(shown({ ...ALL_RUNS, result: "timed", weeks: 3, keyMin: 20, keyMax: 20 })).toEqual(["TS"]);
    expect(shown({ ...ALL_RUNS, spec: "Elemental", keyMin: 19, keyMax: 19, weeks: 8 })).toEqual(["VA", "RLn"]);
  });
  test("a minimum above the maximum is swapped", () => {
    expect(normFilters({ ...ALL_RUNS, keyMin: 20, keyMax: 16 })).toEqual({ ...ALL_RUNS, keyMin: 16, keyMax: 20 });
    expect(shown({ ...ALL_RUNS, keyMin: 20, keyMax: 19 })).toEqual(shown({ ...ALL_RUNS, keyMin: 19, keyMax: 20 }));
  });
  test("steppers stay in the range seen and keep min ≤ max", () => {
    const o = filterOptions(tEn, s);
    const f = o.defaults;
    expect(stepKey(f, "min", -1, o.keys)).toEqual(f);
    expect(stepKey(f, "min", 1, o.keys)).toMatchObject({ keyMin: 17, keyMax: 20 });
    expect(stepKey(f, "max", 1, o.keys)).toEqual(f);
    expect(stepKey({ ...f, keyMin: 18, keyMax: 18 }, "min", 1, o.keys)).toMatchObject({ keyMin: 18, keyMax: 18 });
    expect(stepKey({ ...f, keyMin: 18, keyMax: 18 }, "max", -1, o.keys)).toMatchObject({ keyMin: 18, keyMax: 18 });
    expect(stepKey({ ...ALL_RUNS }, "max", -1, o.keys)).toMatchObject({ keyMin: 16, keyMax: 19 });
    expect(stepKey(f, "min", 1, null)).toEqual(f);
  });
  test("the target button sets min = max = target", () => {
    const o = filterOptions(tEn, s);
    expect(targetFilters(o.defaults, 19)).toMatchObject({ keyMin: 19, keyMax: 19 });
    expect(shown(targetFilters(ALL_RUNS, 19))).toEqual(["VA", "AF", "RLn"]);
    const p = keyPresets(tFr, o.defaults, o);
    expect(p.map((x) => [x.label, x.on])).toEqual([["Niveau cible · +19", false], ["Toutes les clés", true]]);
    expect(keyPresets(tEn, p[0]!.filters, o).map((x) => x.on)).toEqual([true, false]);
    expect(p[1]!.filters).toEqual(o.defaults);
  });
});

describe("ownerRunsView", () => {
  test("week groups: newest first, labels, counts, best timed", () => {
    const v = ownerRunsView(tEn, "en", season(), ALL_RUNS, null, 3, NOW);
    expect(v.weeks.map((w) => [w.label, w.line])).toEqual([
      ["This week", "2 runs · 2 timed · best timed +20"],
      ["1 week ago", "2 runs · 1 timed · best timed +19"],
      ["3 weeks ago", "2 runs · 1 timed · best timed +20"],
    ]);
    expect(keys(v)).toEqual(["TS:1", "VA:1", "KRd:1", "AF:1", "RLn:1", "BV:1"]);
    const f = ownerRunsView(tFr, "fr", season(), ALL_RUNS, null, 3, NOW);
    expect(f.weeks.map((w) => w.label)).toEqual(["Cette semaine", "Il y a 1 semaine", "Il y a 3 semaines"]);
    expect(f.weeks[1]!.line).toBe("2 runs · 1 timed · meilleure timée +19");
    expect(weekLabel(tEn, 8, 10)).toBe("2 weeks ago");
  });

  test("a week with no shown run says so; its best timed is a dash", () => {
    const v = ownerRunsView(tFr, "fr", season(), { ...ALL_RUNS, dungeon: 1 }, null, 3, NOW);
    expect(v.weeks.map((w) => w.count)).toEqual([1, 0, 0]);
    expect(v.weeks[1]!.empty).toBe("Aucun run de cette semaine ne correspond aux filtres.");
    expect(v.weeks[1]!.line).toBe("0 run · 0 timed · meilleure timée —");
    expect(v.weeks[0]!.empty).toBeNull();
  });

  test("paging: loaded weeks, the more button and the footer", () => {
    const v = ownerRunsView(tEn, "en", season(), ALL_RUNS, null, 2, NOW);
    expect(v.weeks).toHaveLength(2);
    expect(v.more).toEqual({ label: "Load earlier weeks · 4 runs", weeks: 2 });
    expect(v.footer).toBe("4 runs shown · 4 loaded of 8");
    const all = ownerRunsView(tEn, "en", season(), ALL_RUNS, null, 10, NOW);
    expect(all.more).toBeNull();
    expect(all.footer).toBe("8 runs shown · 8 loaded of 8");
    const fil = ownerRunsView(tFr, "fr", season(), { ...ALL_RUNS, result: "timed" }, null, 1, NOW);
    expect(fil.footer).toBe("2 runs affichés · 2 chargés sur 8");
    expect(fil.more!.label).toBe("Charger les semaines précédentes · 6 runs");
    // The period filter drops the weeks outside it from the list, not only their rows.
    const p = ownerRunsView(tEn, "en", season(), { ...ALL_RUNS, weeks: 3 }, null, 3, NOW);
    expect(p.weeks.map((w) => w.week)).toEqual([10, 9]);
    expect(p.more).toBeNull();
  });

  test("tiles: every run by week, newest first, dimmed when filtered out, dashed in another spec", () => {
    const v = ownerRunsView(tEn, "en", season(), { ...ALL_RUNS, keyMin: 20 }, "TS:1", 1, NOW);
    expect(v.tiles.map((w) => [w.label, w.tiles.map((x) => x.level)])).toEqual([
      ["This week", [20, 19]], ["1 week ago", [20, 19]], ["3 weeks ago", [19, 20]], ["5 weeks ago", [16, 20]],
    ]);
    const flat = v.tiles.flatMap((w) => w.tiles);
    expect(flat.filter((x) => x.shown).map((x) => x.key)).toEqual(["TS:1", "KRd:1", "BV:1", "MR:1"]);
    expect(flat.filter((x) => x.otherSpec).map((x) => x.key)).toEqual(["AF:1"]);
    expect(flat.map((x) => x.result)).toEqual(["timed", "timed", "depleted", "timed", "none", "timed", "timed", "timed"]);
    expect(flat.filter((x) => x.open).map((x) => x.key)).toEqual(["TS:1"]);
    expect(flat[0]!.title).toBe("+20 Temple of Sethraliss · Timed");
    expect(v.legend.otherSpec).toBe("Enhancement");
    expect(v.summary).toMatchObject({ timed: 3, count: 4, depleted: 1, none: 0, rest: "1 depleted · 0 no time" });
    expect(ownerRunsView(tFr, "fr", season(), ALL_RUNS, null, 1, NOW).summary.rest).toBe("1 depleted · 1 sans temps");
  });

  test("rows: the same numbers as the candidate run list for the same run", () => {
    const v = ownerRunsView(tFr, "fr", season(), ALL_RUNS, null, 3, NOW);
    const ts = v.weeks[0]!.rows[0]!;
    const cand = runListRow(tFr, "fr", payload({ deepdive: [templeAnalysis] }), runs[0]!, "dps", NOW);
    for (const k of ["key", "abbr", "dungeon", "analysed", "level", "upgrade", "time", "deaths", "dtps", "avoidable", "util", "parse", "when", "url"] as const) {
      expect(ts[k]).toEqual(cand[k]);
    }
    const va = v.weeks[0]!.rows[1]!;
    const candVa = runListRow(tFr, "fr", payload(), runs[1]!, "dps", NOW);
    expect([va.dtps, va.avoidable, va.util, va.parse, va.time, va.analysed]).toEqual([candVa.dtps, candVa.avoidable, candVa.util, candVa.parse, candVa.time, false]);
    expect(ts.specLine).toBe("Elemental · 400.0k dps");
    expect(ts.dtpsAbs).toBe("114.0k");
    expect(ts.avoidableAbs).toBe("0/min");
    expect(ts.kicksPeers).toBe(`pairs ${tFr("cand.runs.pct", { v: 32 })}`);
    expect(ts.consumables).toBe("0 · 1");
    expect(ts.wipe).toBeNull();
  });

  test("rows without signals keep the rankings' result and time; wipes are counted", () => {
    const wiped = fromRun({ ...runs[6]!, reportCode: "W" }, 10, 1);
    wiped.signals = sig({
      deaths: { count: 2, groupTotal: 8, events: [
        { atMs: 1, cause: null, source: null, overkill: 0, inWipe: true },
        { atMs: 2, cause: null, source: null, overkill: 0, inWipe: true },
      ] },
    });
    const s = season({ runs: [wiped, ...seasonRuns] });
    const v = ownerRunsView(tEn, "en", s, ALL_RUNS, null, 3, NOW);
    expect(v.weeks[0]!.rows[0]!.wipe).toBe("2 in wipes");
    expect(ownerRunsView(tFr, "fr", s, ALL_RUNS, null, 3, NOW).weeks[0]!.rows[0]!.wipe).toBe("2 en wipe");
    const rl = v.weeks[2]!.rows.find((r) => r.key === "RLn:1")!;
    expect([rl.upgrade, rl.time, rl.dtps, rl.dtpsAbs, rl.consumables, rl.result]).toEqual([null, "—", null, null, null, "none"]);
    const depleted = v.weeks[1]!.rows.find((r) => r.key === "KRd:1")!;
    expect(depleted.upgrade).toEqual({ text: "✗ depleted", timed: false });
  });

  test("expanded: only a shown run; detail, analyse button, links", () => {
    const v = ownerRunsView(tEn, "en", season(), ALL_RUNS, "VA:1", 3, NOW);
    const e = v.expanded!;
    expect(e.key).toBe("VA:1");
    expect(e.detail!.casts.map((c) => c.name)).toEqual(["Lightning Bolt", "Healing Wave"]);
    expect(e.detail!.kicked).toBe("You kicked 5 of the 13 interrupted.");
    expect([e.analysed, e.analyse, e.note]).toEqual([false, "Analyze · ~3 pts", null]);
    expect(e.wcl.href).toBe("https://www.warcraftlogs.com/reports/VA#fight=1");
    expect(e.facts).toBe("1d ago · dispels 8");
    expect(e.run.reportCode).toBe("VA");
    expect(v.weeks[0]!.rows.map((r) => r.open)).toEqual([false, true]);

    const ts = ownerRunsView(tEn, "en", season(), ALL_RUNS, "TS:1", 3, NOW).expanded!;
    expect([ts.analysed, ts.analyse, ts.analysis]).toEqual([true, null, templeAnalysis]);
    expect(ts.detail!.deaths.map((d) => d.title)).toEqual(["Death at 1:53", "Death at 13:45", "Death at 17:50"]);

    const rl = ownerRunsView(tFr, "fr", season(), ALL_RUNS, "RLn:1", 3, NOW).expanded!;
    expect([rl.detail, rl.analyse]).toEqual([null, null]);
    expect(rl.note).toBe("Morts, sorts passés et contrôle de ce run s'affichent après l'analyse.");
    expect("timed" in rl.run || "durationMs" in rl.run).toBe(false);

    expect(ownerRunsView(tEn, "en", season(), { ...ALL_RUNS, dungeon: 1 }, "VA:1", 3, NOW).expanded).toBeNull();
    expect(ownerRunsView(tEn, "en", season(), ALL_RUNS, "nope:1", 3, NOW).expanded).toBeNull();
  });

  test("weeksFor: how many weeks to load for a picked tile", () => {
    expect(weeksFor(season(), ALL_RUNS, "TS:1")).toBe(1);
    expect(weeksFor(season(), ALL_RUNS, "MR:1")).toBe(4);
    expect(weeksFor(season(), { ...ALL_RUNS, weeks: 3 }, "MR:1")).toBeNull();
    expect(weeksFor(season(), ALL_RUNS, "nope:1")).toBeNull();
  });

  test("main spec and the util column", () => {
    expect(mainSpec(season())).toBe("Elemental");
    expect(mainSpec(season({ runs: [] }))).toBeNull();
    expect(ownerRunsView(tEn, "en", season(), ALL_RUNS, null, 1, NOW).util).toBe("kicks");
    const heal = seasonRuns.map((r) => (r.signals ? { ...r, signals: { ...r.signals, role: "healer" as const } } : r));
    const v = ownerRunsView(tEn, "en", season({ runs: heal }), ALL_RUNS, null, 1, NOW);
    expect(v.util).toBe("dispels");
    expect(v.weeks[0]!.rows[0]!.util).toEqual({ label: "dispels", text: "8" });
    expect(v.weeks[0]!.rows[0]!.kicksPeers).toBeNull();
  });
});

describe("filter menus", () => {
  test("rows with counts, the current choice ticked, values as text", () => {
    const o = filterOptions(tEn, season());
    const m = filterMenus({ ...o.defaults, spec: "Enhancement", weeks: 3 }, o);
    expect(m.dungeon[0]).toEqual({ value: "", label: "Dungeon: all", hint: null, on: true });
    expect(m.dungeon[1]).toEqual({ value: String(runs[3]!.encounterID), label: "Altar of Fangs", hint: "1", on: false });
    expect(m.spec.filter((x) => x.on).map((x) => x.value)).toEqual(["Enhancement"]);
    expect(m.weeks.map((x) => [x.value, x.on])).toEqual([["1", false], ["3", true], ["8", false], ["", false]]);
  });
  test("a pick sets that filter; empty is all", () => {
    expect(pickMenu(ALL_RUNS, "dungeon", "12").dungeon).toBe(12);
    expect(pickMenu({ ...ALL_RUNS, dungeon: 12 }, "dungeon", "").dungeon).toBeNull();
    expect(pickMenu(ALL_RUNS, "spec", "Elemental").spec).toBe("Elemental");
    expect(pickMenu(ALL_RUNS, "weeks", "8").weeks).toBe(8);
    expect(pickMenu({ ...ALL_RUNS, weeks: 3 }, "weeks", "").weeks).toBeNull();
  });
  test("revealRun: a hidden tile resets the filters, the weeks to load cover its row", () => {
    const s = season();
    const o = filterOptions(tEn, s);
    const old = seasonRuns[7]!; // MR +20, week 5: the 4th week with runs
    const key = `${old.reportCode}:${old.fightID}`;
    expect(revealRun(s, o.defaults, o, key, 3)).toEqual({ filters: o.defaults, loaded: 4 });
    const hidden = { ...o.defaults, result: "depleted" as const };
    expect(revealRun(s, hidden, o, key, 3)).toEqual({ filters: o.defaults, loaded: 4 });
    const recent = `${seasonRuns[0]!.reportCode}:${seasonRuns[0]!.fightID}`;
    expect(revealRun(s, o.defaults, o, recent, 3)).toEqual({ filters: o.defaults, loaded: 3 });
  });
});
