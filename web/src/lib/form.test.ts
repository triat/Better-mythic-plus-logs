import { describe, expect, test } from "bun:test";
import type { Evaluation, PillarKey, PillarScore, PillarTrend, SeasonRunView, SeasonView, WorkOnRow } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { CHART, CHART_WEEKS_NARROW, chartBox, formView } from "./form.ts";
import type { SynthesisDocs } from "./synthesis.ts";

const tFr = makeT(fr, "fr");
const KEY = "eu|Biwaasham-Hyjal|19";

const TITLES: Record<string, string> = {
  "preparation.healthstones": "Healthstones", "preparation.potions": "Potions", "throughput.parseAtTarget": "Parse à la cible",
  "throughput.medianParse": "Parse médian", "preparation.ilvlVsLevel": "Item level vs cible", "survival.individualDeaths": "Morts individuelles",
};
const docs: SynthesisDocs = {
  titleOf: (s) => TITLES[s] ?? s,
  axisWeights: {
    dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 },
    healer: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 },
    tank: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 },
  },
  verdict: { invite: 70, maybe: 30, minRuns: 3 },
  confidence: { high: 10 },
};

let n = 0;
const run = (week: number, keyLevel: number, timed: boolean | null, encounterName = "Murder Row", durationMs: number | null = 1_800_000): SeasonRunView => ({
  key: `r${++n}`, reportCode: `c${n}`, fightID: n, encounterID: encounterName.length, encounterName, keyLevel, startTime: n, durationMs, timed,
  parse: 50, amount: 1, metric: "dps", spec: "Elemental", affixes: [], score: 0, week, analysed: true, failed: false, signals: null,
  analysis: null, pillars: null,
});
const pillar = (key: PillarKey, score: number | null): PillarScore => ({ key, score, evidence: [] });
const trend = (key: PillarKey, delta: number | null, recentRuns = 5, beforeRuns = 8): PillarTrend => ({
  key, delta, direction: delta === null ? null : delta > 2 ? "up" : delta < -2 ? "down" : "same", recentRuns, beforeRuns, weekly: [],
});
// The mockup's pillars (F-Moi-Forme): global 66.
const PILLARS = [pillar("damage", 64), pillar("survival", 66), pillar("avoidable", 76), pillar("interrupts", 68), pillar("control", 55)];
const WORK: WorkOnRow[] = [
  { source: "preparation.potions", pillar: null, impact: -1.2, value: 4.1, reference: 5, label: "", past: { value: 4.1, change: "same" } },
  { source: "preparation.healthstones", pillar: null, impact: -3.6, value: 0, reference: 1.6, label: "", past: { value: 0.7, change: "worse" } },
  { source: "throughput.parseAtTarget", pillar: "damage", impact: -2.8, value: 51, reference: 59, label: "", past: null },
];

// The mockup's last game week (current week 10 has no run): +19 TS ✓, +19 DN ✓, +12 RL ✓, +20 TS ✗ 32:55, +12 VA ✓, +12 KR —.
const LAST_WEEK = [
  run(9, 19, true, "Temple of Sethraliss"), run(9, 19, true, "Den of Nalorakk"), run(9, 12, true, "Ruby Life Pools"),
  run(9, 20, false, "Temple of Sethraliss", 1_975_000), run(9, 12, true, "Voidscar Arena"), run(9, 12, null, "Kings' Rest", null),
];
const EARLIER = [run(8, 18, true), run(8, 19, true), run(8, 18, false), run(7, 18, true), run(7, 12, true), run(7, 18, true), run(6, 18, false)];

const season = (over: Partial<SeasonView> = {}): SeasonView => ({
  character: { name: "Biwaasham", realm: "hyjal", region: "eu" }, zoneID: 55, targetLevel: 19, currentWeek: 10, checkedAt: 0,
  state: { runs: 94, analysed: 94, pending: 0, controlOnly: 0, failed: 0, estimate: 0 },
  runs: [...LAST_WEEK, ...EARLIER], recent: { runs: 20, pillars: PILLARS, overall: 66 }, season: null,
  trends: [trend("damage", 4), trend("survival", -5), trend("avoidable", 0), trend("interrupts", 1), trend("control", null, 2, 8)],
  workOn: WORK, dungeons: [],
  ...over,
});

// MAYBE 54 for a +19, INVITE at 70 through the median parse and the item level.
const ev = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 19, global: 54, verdict: "maybe", runsUsed: 20, analyzedRuns: 20, configVersion: "x", axes: [],
  drivers: [
    { source: "throughput.medianParse", impact: -6, value: 57, reference: 62, label: "" },
    { source: "preparation.ilvlVsLevel", impact: -4, value: -3, reference: 0, label: "" },
    { source: "survival.individualDeaths", impact: -3, value: 1.1, reference: 0.7, label: "" },
  ],
  nextVerdict: { verdict: "invite", threshold: 70, sources: ["throughput.medianParse", "preparation.ilvlVsLevel", "survival.individualDeaths"], score: 71, reachable: true },
  ...over,
});

describe("formView · week", () => {
  test("the mockup's week (French): 6 runs, best timed +19, 4/6, the first +20 attempted", () => {
    const w = formView(tFr, "fr", ev(), season(), docs, KEY).week!;
    expect(w).toMatchObject({ label: "Ta dernière semaine de jeu", runs: "6", bestTimed: "+19", timed: "4/6" });
    expect(w.chips.map((c) => [c.level, c.abbr, c.result])).toEqual([
      ["+19", "TS", "timed"], ["+19", "DN", "timed"], ["+12", "RL", "timed"], ["+20", "TS", "depleted"], ["+12", "VA", "timed"], ["+12", "KR", "none"],
    ]);
    expect(w.chips[3]!.title).toBe("+20 Temple of Sethraliss · depleted");
    expect(w.chips[5]!.title).toBe("+12 Kings' Rest · sans temps");
    expect(w.note).toBe("Première +20 tentée (Temple of Sethraliss, depleted 32:55).");
  });
  test("the current week when it has runs; no note when an earlier week went as high", () => {
    const w = formView(tEn, "en", ev(), season({ runs: [run(10, 18, true), run(10, 17, false), ...LAST_WEEK] }), docs, KEY).week!;
    expect(w).toMatchObject({ label: "Your current game week", runs: "2", bestTimed: "+18", timed: "1/2", note: null });
  });
  test("a week without depleted keys, and no earlier week: no note", () => {
    const w = formView(tEn, "en", ev(), season({ runs: [run(9, 15, true, "Murder Row"), run(9, 14, true, "Murder Row")] }), docs, KEY).week!;
    expect(w.chips.map((c) => c.result)).toEqual(["timed", "timed"]);
    expect(w).toMatchObject({ label: "Your last game week", runs: "2", bestTimed: "+15", timed: "2/2", note: null });
  });
  test("a timed first key reads with its time; a key without time reads without", () => {
    const timed = formView(tEn, "en", ev(), season({ runs: [run(9, 21, true, "Murder Row", 1_500_000), ...EARLIER] }), docs, KEY).week!;
    expect(timed.note).toBe("First +21 attempted (Murder Row, timed 25:00).");
    const none = formView(tEn, "en", ev(), season({ runs: [run(9, 21, null, "Murder Row", null), ...EARLIER] }), docs, KEY).week!;
    expect(none.note).toBe("First +21 attempted (Murder Row, no time).");
    expect(none.bestTimed).toBeNull();
  });
});

describe("formView · pillars", () => {
  test("the window's pillars in order, the global, bands and trends", () => {
    const p = formView(tFr, "fr", ev(), season(), docs, KEY).pillars;
    expect(p.global).toBe("global 66");
    expect(p.rows.map((r) => [r.name, r.score, r.band])).toEqual([
      ["Dégâts", 64, "neutral"], ["Survie", 66, "neutral"], ["Dégâts évitables", 76, "better"], ["Interruptions", 68, "neutral"], ["Contrôle", 55, "neutral"],
    ]);
    expect(p.rows.map((r) => r.trend)).toEqual(["↗ +4", "↘ −5", "→ stable", "→ stable", null]);
    expect(p.note).toBe("trait = joueur moyen · tendances dès 3 runs récents et 3 avant (tu en as 5 et 8)");
  });
  test("every scored pillar with a trend: the short note; the season window without a recent one", () => {
    const s = season({
      recent: null, season: { runs: 40, pillars: [pillar("damage", 44), pillar("survival", 90)], overall: 61.6 },
      trends: [trend("damage", 3), trend("survival", 0)],
    });
    const p = formView(tEn, "en", ev(), s, docs, KEY).pillars;
    expect(p.global).toBe("overall 62");
    expect(p.rows.map((r) => [r.score, r.band])).toEqual([[44, "worse"], [90, "better"], [null, "neutral"], [null, "neutral"], [null, "neutral"]]);
    expect(p.note).toBe("tick = average player");
  });
});

describe("formView · chart", () => {
  test("the last 4 weeks with runs, evenly spaced; levels from the lowest to the highest; the target line", () => {
    const c = formView(tFr, "fr", ev(), season(), docs, KEY).chart!;
    expect(c.weeks).toEqual([
      { label: "il y a 4 sem.", x: 168 }, { label: "il y a 3 sem.", x: 403 }, { label: "il y a 2 sem.", x: 638 }, { label: "la semaine dernière", x: 873 },
    ]);
    // 12 → 20: 25 px per level, as the mockup.
    expect(c.levels).toEqual([
      { y: 40, label: "+20" }, { y: 90, label: "+18" }, { y: 140, label: "+16" }, { y: 190, label: "+14" }, { y: 240, label: "+12" },
    ]);
    expect(c.target).toEqual({ y: 65, label: "ta clé cible +19" });
    expect(c.dots).toHaveLength(LAST_WEEK.length + EARLIER.length);
    expect(c.aria).toBe("Niveau de clé de chaque run sur les 4 dernières semaines avec des runs");
  });
  test("runs at the same level spread sideways in play order: 0, −20, +20", () => {
    const c = formView(tEn, "en", ev(), season(), docs, KEY).chart!;
    // Last week, oldest first: +12 KR, +12 VA, +20 TS, +12 RL, +19 DN, +19 TS.
    const last = c.dots.slice(-6);
    expect(last.map((d) => [d.x, d.y, d.timed])).toEqual([
      [873, 240, null], [853, 240, true], [873, 40, false], [893, 240, true], [873, 65, true], [853, 65, true],
    ]);
    expect(last[0]!.title).toBe("+12 Kings' Rest · no time");
  });
  test("one level only: padded by one each side; the target widens the range", () => {
    const c = formView(tEn, "en", ev(), season({ targetLevel: 0, runs: [run(10, 15, true)] }), docs, KEY).chart!;
    expect(c.target).toBeNull();
    expect(c.levels.map((l) => l.label)).toEqual(["+16", "+15", "+14"]);
    expect(c.dots).toEqual([{ x: Math.round(CHART.left + (CHART.right - CHART.left) / 2), y: 140, timed: true, title: "+15 Murder Row · timed" }]);
    expect(c.weeks).toEqual([{ label: "this week", x: 520 }]);
    const t = formView(tEn, "en", ev(), season({ targetLevel: 20, runs: [run(10, 15, true)] }), docs, KEY).chart!;
    expect(t.target!.y).toBe(CHART.top);
    expect(t.levels.map((l) => l.label)).toEqual(["+20", "+19", "+18", "+17", "+16", "+15"]);
  });
  test("a crowded level narrows the spread to stay inside its column", () => {
    const many = Array.from({ length: 30 }, () => run(9, 18, true));
    const c = formView(tEn, "en", ev(), season({ runs: many }), docs, KEY).chart!;
    const xs = c.dots.map((d) => d.x);
    const half = (CHART.right - CHART.left) / 2;
    expect(Math.max(...xs) - 520).toBeLessThanOrEqual(half - 10);
    expect(520 - Math.min(...xs)).toBeLessThanOrEqual(half - 10);
  });
});

describe("chartBox · readable on a phone", () => {
  test("the full-width box is the mockup's; one user unit per px below 1000", () => {
    expect(chartBox(1000)).toEqual({ ...CHART, narrow: false });
    expect(chartBox(1400)).toEqual({ ...CHART, narrow: false });
    expect(chartBox(700)).toEqual({ width: 700, height: 300, left: 50, right: 690, top: 40, bottom: 240, narrow: false });
    expect(chartBox(560).narrow).toBe(false);
  });
  test("under 560 px: a shorter plot, clamped at 280", () => {
    expect(chartBox(326)).toEqual({ width: 326, height: 240, left: 40, right: 318, top: 24, bottom: 196, narrow: true });
    expect(chartBox(559).narrow).toBe(true);
    expect(chartBox(100).width).toBe(280);
  });
  test("a phone chart: 3 weeks, short labels, columns inside the box", () => {
    const c = formView(tFr, "fr", ev(), season(), docs, KEY, 326).chart!;
    expect(c.box.narrow).toBe(true);
    expect(c.weeks).toHaveLength(CHART_WEEKS_NARROW);
    // (318 − 40) / 3 = 92.7 px per column.
    expect(c.weeks).toEqual([{ label: "−3 sem.", x: 86 }, { label: "−2 sem.", x: 179 }, { label: "−1 sem.", x: 272 }]);
    expect(c.levels[0]!.y).toBe(24);
    expect(c.levels.at(-1)!.y).toBe(196);
    for (const d of c.dots) {
      expect(d.x).toBeGreaterThanOrEqual(c.box.left);
      expect(d.x).toBeLessThanOrEqual(c.box.right);
    }
    const en = formView(tEn, "en", ev(), season({ runs: [run(10, 15, true)] }), docs, KEY, 326).chart!;
    expect(en.weeks.map((w) => w.label)).toEqual(["this wk"]);
  });
});

describe("formView · season without runs", () => {
  test("no week, no chart; pillars and checklist from the lookup", () => {
    const s = season({ runs: [], recent: null, season: null, trends: [], workOn: [], state: { runs: 0, analysed: 0, pending: 0, controlOnly: 0, failed: 0, estimate: 0 } });
    const f = formView(tEn, "en", ev(), s, docs, KEY);
    expect(f.week).toBeNull();
    expect(f.chart).toBeNull();
    expect(f.pillars.global).toBeNull();
    expect(f.pillars.rows.every((r) => r.score === null && r.trend === null)).toBe(true);
    expect(f.pillars.note).toBe("tick = average player");
    // No window: the lookup's own costs, without a past.
    expect(f.checklistNote).toBe("the runs behind the verdict");
    expect(f.checklist.map((c) => [c.title, c.before, c.now, c.nowTone, c.cost])).toEqual([
      ["Parse médian", null, "now 57", "neutral", "−6"], ["Item level vs cible", null, "now −3", "neutral", "−4"],
      ["Morts individuelles", null, "now 1.1", "neutral", "−3"],
    ]);
  });
});

describe("formView · no season stored", () => {
  test("the same as a season without runs", () => {
    const s = season({ runs: [], recent: null, season: null, trends: [], workOn: [], state: { runs: 0, analysed: 0, pending: 0, controlOnly: 0, failed: 0, estimate: 0 } });
    const { chef: _a, ...none } = formView(tEn, "en", ev(), null, docs, KEY);
    const { chef: _b, ...empty } = formView(tEn, "en", ev(), s, docs, KEY);
    expect(none).toEqual(empty);
  });
});

describe("formView · checklist", () => {
  test("the window's points, costliest first, goal, before → now (French)", () => {
    const f = formView(tFr, "fr", ev(), season(), docs, KEY);
    expect(f.checklistNote).toBe("4 dernières semaines vs 4 d'avant");
    expect(f.checklist).toEqual([
      { title: "Healthstones", hint: "Pierres de soins utilisées par run (seulement les runs avec un démoniste).", goal: "objectif 1,6 / run", before: "avant 0,7", now: "maintenant 0,0", nowTone: "worse", cost: "−4" },
      { title: "Parse à la cible", hint: "Le même parse, mais seulement sur ses runs au niveau de clé cible ou un niveau en dessous.", goal: "objectif 59", before: null, now: "maintenant 51", nowTone: "neutral", cost: "−3" },
      { title: "Potions", hint: "Potions de combat utilisées par run.", goal: "objectif 5,0 / run", before: "avant 4,1", now: "maintenant 4,1", nowTone: "neutral", cost: "−1" },
    ]);
  });
  test("better than before reads in the better tone", () => {
    const work: WorkOnRow[] = [{ source: "preparation.potions", pillar: null, impact: -1, value: 4.6, reference: 5, label: "", past: { value: 3.2, change: "better" } }];
    expect(formView(tEn, "en", ev(), season({ workOn: work }), docs, KEY).checklist[0]).toMatchObject({ before: "before 3.2", now: "now 4.6", nowTone: "better" });
  });
});

describe("formView · chef card", () => {
  test("MAYBE: the verdict, the target and the path through the first two signals (French)", () => {
    const c = formView(tFr, "fr", ev(), season(), docs, KEY).chef;
    expect(c.verdict).toEqual({ cls: "badge-maybe", label: "MAYBE", score: "54" });
    expect(c.title).toBe("Comment un chef de groupe te voit en +19");
    expect(c.path).toBe("INVITE à 70 : remonte parse médian (57) et item level vs cible (−3)");
    expect(c.vettingHref).toBe("/candidate?open=eu%7CBiwaasham-Hyjal%7C19&as=vetting");
  });
  test("out of reach: says so", () => {
    const c = formView(tEn, "en", ev({ nextVerdict: { verdict: "invite", threshold: 70, sources: ["throughput.medianParse"], score: 60, reachable: false } }), season(), docs, KEY).chef;
    expect(c.path).toBe("INVITE at 70: bringing these signals to the average player's level is not enough");
  });
  test("INVITE: no path", () => {
    const c = formView(tEn, "en", ev({ global: 78, verdict: "invite", nextVerdict: null }), season(), docs, KEY).chef;
    expect(c.verdict).toEqual({ cls: "badge-invite", label: "INVITE", score: "78" });
    expect(c.title).toBe("How a group leader sees you at +19");
    expect(c.path).toBeNull();
  });
  test("not enough data: no score, no path, even with a stray next verdict", () => {
    const c = formView(tEn, "en", ev({ global: null, verdict: "insufficient", runsUsed: 2 }), season(), docs, KEY).chef;
    expect(c.verdict).toEqual({ cls: "badge-insufficient", label: "NOT ENOUGH DATA", score: null });
    expect(c.path).toBeNull();
  });
});
