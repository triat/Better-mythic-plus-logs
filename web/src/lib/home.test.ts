import { describe, expect, test } from "bun:test";
import type { DungeonRow, HistoryItem, PillarKey, PillarScore, SeasonRunView, SeasonView } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { candidateRows, homeSelf, progressPoints, progressText, scoreTone } from "./home.ts";

const tFr = makeT(fr, "fr");
const titleOf = (s: string) => s;

const run = (week: number, keyLevel: number, timed: boolean | null): SeasonRunView => ({
  key: `r${week}-${keyLevel}-${String(timed)}`, reportCode: "abc", fightID: 1, encounterID: 1, encounterName: "Murder Row", keyLevel,
  startTime: 0, durationMs: 1, timed, parse: 50, amount: 1, metric: "dps", spec: "Elemental", affixes: [], score: 0, week,
  analysed: true, failed: false, signals: null, analysis: null, pillars: null,
});

const pillar = (key: PillarKey, score: number | null): PillarScore => ({ key, score, evidence: [] });
// Biwaasham-like numbers from the F-Accueil mockup.
const PILLARS = [pillar("damage", 64), pillar("survival", 66), pillar("avoidable", 76), pillar("interrupts", 68), pillar("control", 55)];

const dungeon = (name: string, overall: number | null, pillars: Partial<Record<PillarKey, number | null>>): DungeonRow => ({
  encounterID: name.length, name, runs: 3, analysed: 3, overall, best: null,
  pillars: { damage: null, survival: null, avoidable: null, interrupts: null, control: null, ...pillars },
  details: { avoidable: [], avoidableOther: 0, avoidableTotal: 0, killers: [], casts: [], control: [], controlRuns: 0 },
});

const season = (over: Partial<SeasonView> = {}): SeasonView => ({
  character: { name: "Biwaasham", realm: "hyjal", region: "eu" }, zoneID: 55, targetLevel: 19, currentWeek: 10, checkedAt: 0,
  state: { runs: 94, analysed: 94, pending: 0, controlOnly: 0, failed: 0, estimate: 0 },
  runs: [], recent: { runs: 20, pillars: PILLARS, overall: 66 }, season: null, trends: [], workOn: [],
  dungeons: [
    dungeon("Den of Nalorakk", 75, { damage: 70, control: 60 }),
    dungeon("Kings' Rest", 58, { damage: 43, survival: 60 }),
    dungeon("Voidscar Arena", 61, { damage: 66, control: 38 }),
    dungeon("Murder Row", 73, { damage: 72 }),
  ],
  ...over,
});

describe("homeSelf · week", () => {
  test("null without any run", () => {
    expect(homeSelf(tEn, "en", season(), titleOf).week).toBeNull();
  });
  test("the current week when it has runs", () => {
    const w = homeSelf(tEn, "en", season({ runs: [run(10, 12, true), run(9, 20, true)] }), titleOf).week;
    expect(w).toEqual({ label: "this week", runs: 1, bestTimed: 12, timed: 1, scored: 1 });
  });
  test("falls back to the previous week; best timed ignores a higher depleted key", () => {
    const runs = [run(9, 20, false), run(9, 19, true), run(9, 18, true), run(9, 17, null), run(8, 25, true)];
    const w = homeSelf(tEn, "en", season({ runs }), titleOf).week;
    expect(w).toEqual({ label: "last week", runs: 4, bestTimed: 19, timed: 2, scored: 3 });
    expect(homeSelf(tFr, "fr", season({ runs }), titleOf).week!.label).toBe("la semaine dernière");
  });
  test("previous week without runs: zero runs, no best key", () => {
    expect(homeSelf(tEn, "en", season({ runs: [run(3, 10, true)] }), titleOf).week).toEqual({ label: "last week", runs: 0, bestTimed: null, timed: 0, scored: 0 });
  });
});

describe("homeSelf · pillars, strengths, costs", () => {
  test("pillars from the 4-week window, else the season, in pillar order", () => {
    const h = homeSelf(tEn, "en", season(), titleOf);
    expect(h.pillars.map((p) => [p.key, p.label, p.score])).toEqual([
      ["damage", "Damage", 64], ["survival", "Survival", 66], ["avoidable", "Avoidable damage", 76], ["interrupts", "Interrupts", 68], ["control", "Control", 55],
    ]);
    const s = homeSelf(tEn, "en", season({ recent: null, season: { runs: 40, pillars: [pillar("damage", 50)], overall: 50 } }), titleOf);
    expect(s.pillars.map((p) => p.score)).toEqual([50, null, null, null, null]);
    expect(homeSelf(tEn, "en", season({ recent: null }), titleOf).pillars.every((p) => p.score === null)).toBe(true);
  });
  test("strengths: pillars ≥ 70 first, then dungeons by overall, at most 3", () => {
    const h = homeSelf(tEn, "en", season(), titleOf);
    expect(h.strengths.map((p) => [p.kind, p.label, p.detail, p.score])).toEqual([
      ["pillar", "Avoidable damage", "", 76], ["dungeon", "Den of Nalorakk", "overall", 75], ["dungeon", "Murder Row", "overall", 73],
    ]);
    const many = homeSelf(tEn, "en", season({ recent: { runs: 9, pillars: [pillar("damage", 90), pillar("survival", 80), pillar("avoidable", 85), pillar("interrupts", 71)], overall: 80 } }), titleOf);
    expect(many.strengths.map((p) => p.score)).toEqual([90, 85, 80]);
  });
  test("costs: pillars < 60 first, then each dungeon's lowest pillar < 45, lowest first, at most 3", () => {
    const h = homeSelf(tEn, "en", season(), titleOf);
    expect(h.costs.map((p) => [p.kind, p.label, p.detail, p.score])).toEqual([
      ["pillar", "Control", "", 55], ["dungeon", "Voidscar Arena", "Control", 38], ["dungeon", "Kings' Rest", "Damage", 43],
    ]);
    expect(homeSelf(tFr, "fr", season(), titleOf).costs[2]!.detail).toBe("Dégâts");
  });
  test("a pillar's detail is its strongest evidence line", () => {
    const withEvidence = [{ ...pillar("control", 40), evidence: [{ label: "x", delta: -3, source: "nope.source", value: 1 }] }];
    const h = homeSelf(tEn, "en", season({ recent: { runs: 5, pillars: withEvidence, overall: 40 }, dungeons: [] }), titleOf);
    expect(h.costs).toEqual([{ kind: "pillar", label: "Control", detail: "x", score: 40 }]);
  });
  test("a pillar's detail is the evidence line in the UI language, not the server's English label", () => {
    const evidence = [{ label: "server English label", delta: 4, source: "survival.avoidableVsPeers", value: -8.2 }];
    const s = season({ recent: { runs: 5, pillars: [{ ...pillar("avoidable", 80), evidence }], overall: 80 }, dungeons: [] });
    expect(homeSelf(tEn, "en", s, titleOf).strengths[0]!.detail).toBe("avoidable −8% vs peers");
    expect(homeSelf(tFr, "fr", s, titleOf).strengths[0]!.detail).toBe("évitable −8\u202F% vs pairs");
  });
});

describe("homeSelf · bestPerWeek", () => {
  test("the last 4 game weeks oldest first, timed keys only, null without one", () => {
    const runs = [run(10, 19, true), run(10, 21, false), run(8, 18, true), run(8, 17, true), run(7, 22, false), run(6, 30, true)];
    expect(homeSelf(tEn, "en", season({ runs }), titleOf).bestPerWeek).toEqual([
      { week: 7, level: null }, { week: 8, level: 18 }, { week: 9, level: null }, { week: 10, level: 19 },
    ]);
  });
});

describe("progress line", () => {
  test("text", () => {
    expect(progressText(tEn, [{ week: 1, level: 18 }, { week: 2, level: null }, { week: 3, level: 19 }, { week: 4, level: 19 }]))
      .toBe("Best timed key: from +18 to +19 over the last 4 weeks.");
    expect(progressText(tEn, [{ week: 1, level: 18 }, { week: 2, level: 18 }])).toBe("Best timed key: +18 over the last 2 weeks.");
    expect(progressText(tEn, [{ week: 1, level: null }])).toBe("No timed key over the last 1 weeks.");
    expect(progressText(tFr, [{ week: 1, level: 18 }, { week: 2, level: 19 }]))
      .toBe("Meilleure clé timée : de +18 à +19 sur les 2 dernières semaines.");
  });
  test("points: evenly spread, scaled between the lowest and highest level, gaps skipped", () => {
    expect(progressPoints([{ week: 1, level: 18 }, { week: 2, level: null }, { week: 3, level: 19 }, { week: 4, level: 20 }]))
      .toEqual([{ x: 20, y: 44, level: 18 }, { x: 153, y: 31, level: 19 }, { x: 220, y: 18, level: 20 }]);
    expect(progressPoints([{ week: 1, level: 18 }, { week: 2, level: 18 }]).map((p) => p.y)).toEqual([31, 31]);
    expect(progressPoints([{ week: 1, level: null }])).toEqual([]);
  });
  test("score tone: 70 / 50", () => {
    expect([70, 69, 50, 49, null].map(scoreTone)).toEqual(["better", "neutral", "neutral", "worse", "neutral"]);
  });
});

describe("candidateRows", () => {
  const item = (o: Partial<HistoryItem>): HistoryItem => ({
    key: "eu|Vachaman-Ysondre|19", label: "Vachaman-Ysondre", charClass: 9, spec: "Elemental", targetLevel: 19, targetAutoDetected: false,
    verdict: "invite", score: 77.2, fetchedAt: 1, request: { character: "Vachaman-Ysondre" } as HistoryItem["request"], ...o,
  });
  test("two lines: name, spec · class · realm; key level; at most 6", () => {
    const rows = candidateRows([item({}), item({ key: "k2", label: "Obye-Argent Dawn", charClass: 12, spec: null, verdict: null, score: null })]);
    expect(rows.map((r) => [r.name, r.sub, r.level, r.verdict, r.score])).toEqual([
      ["Vachaman", "Elemental Shaman · Ysondre", "+19", "invite", "77"],
      ["Obye", "Demon Hunter · Argent Dawn", "+19", null, "—"],
    ]);
    expect(candidateRows(Array.from({ length: 9 }, (_, i) => item({ key: `k${i}` }))).length).toBe(6);
  });
});
