import { describe, expect, test } from "bun:test";
import type { AxisKey, AxisScore, LookupPayload, MPlusRun } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { bestIndices, compareFacts, compareNames, dungeonCompare, duelView, rankingView, targetWarning } from "./compare.ts";
import type { CompareEntry, DuelView, RankingView } from "./compare.ts";
import type { SynthesisDocs } from "./synthesis.ts";
import { synthesisView } from "./synthesis.ts";
import { sig } from "./vachaman.fixture.ts";

const tFr = makeT(fr, "fr");

describe("bestIndices", () => {
  test("higher / lower / ties / nulls / none", () => {
    expect(bestIndices([82, 100, 61], "higher")).toEqual([1]);
    expect(bestIndices([0.7, 0.2, null], "lower")).toEqual([1]);
    expect(bestIndices([5, 5, 5], "higher")).toEqual([]);
    expect(bestIndices([5, 5, null], "higher")).toEqual([0, 1]);
    expect(bestIndices([null, null], "higher")).toEqual([]);
    expect(bestIndices([1, 2], "none")).toEqual([]);
  });
});

const payload = (over: Record<string, unknown>): LookupPayload =>
  ({
    metric: "hps",
    character: { name: "A", classID: 7, spec: "Holy", scoreTop: null, realmSlug: "hyjal", region: "eu" },
    rio: null,
    runsIndexed: 12,
    targetLevel: 21, targetAutoDetected: true,
    seasonDungeons: [{ id: 1, name: "Voidscar Arena" }, { id: 2, name: "Den of Nalorakk" }, { id: 3, name: "Kings' Rest" }],
    perDungeon: { runs: [{ encounterID: 1, keyLevel: 21, parsePercent: 79.4, signals: undefined }], dungeonsCovered: 1, totalDungeonsInSeason: 2, dungeonsAtOrAboveTarget: 1, medianLevel: 21, medianAmount: 312_000, medianParse: 79.4 },
    prevLevelBest: null,
    summary: { runsWithSignals: 1, timedShown: 1, avgDeaths: 0.7, deathsInWipes: 0, dtpsDeltaPct: -12, kicksDeltaPts: null, avoidableDeltaPct: null, ilvl: 322, recentTimed: 9, recentTotal: 10, prevSeason: null },
    deepdive: [],
    deepdiveSummary: { tableWarning: null, analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
    evaluation: { role: "healer", targetLevel: 21, global: 78, verdict: "invite", runsUsed: 9, analyzedRuns: 0, configVersion: "x",
      axes: [{ key: "survival", score: 82, confidence: "high", evidence: [] }, { key: "utility", score: 61, confidence: "high", evidence: [] }, { key: "throughput", score: 88, confidence: "high", evidence: [] }, { key: "consistency", score: null, confidence: "low", evidence: [] }, { key: "preparation", score: 55, confidence: "medium", evidence: [] }, { key: "experience" as AxisKey, score: 74, confidence: "high", evidence: [] }] },
    ...over,
  }) as unknown as LookupPayload;

const a = payload({});
const b = payload({
  character: { name: "B", classID: 2, spec: "Guardian", scoreTop: null, realmSlug: "hyjal", region: "eu" }, metric: "dps", targetLevel: 18,
  perDungeon: { runs: [{ encounterID: 1, keyLevel: 18, parsePercent: 90, signals: undefined }, { encounterID: 2, keyLevel: 18, parsePercent: 50, signals: undefined }], dungeonsCovered: 2, totalDungeonsInSeason: 2, dungeonsAtOrAboveTarget: 0, medianLevel: 18, medianAmount: 1_200_000, medianParse: 70 },
  summary: { runsWithSignals: 2, timedShown: 2, avgDeaths: 0.2, deathsInWipes: 0, dtpsDeltaPct: null, kicksDeltaPts: 3, avoidableDeltaPct: 5, ilvl: 318, recentTimed: 4, recentTotal: 10, prevSeason: { slug: "s1", all: 2900, best: { role: "tank", score: 2900 } } },
  evaluation: { role: "tank", targetLevel: 18, global: 66, verdict: "maybe", runsUsed: 5, configVersion: "x",
    axes: [{ key: "survival", score: 100, confidence: "high", evidence: [] }, { key: "utility", score: 71, confidence: "high", evidence: [] }, { key: "throughput", score: 66, confidence: "high", evidence: [] }, { key: "consistency", score: 72, confidence: "medium", evidence: [] }, { key: "preparation", score: 38, confidence: "medium", evidence: [] }, { key: "experience" as AxisKey, score: 58, confidence: "high", evidence: [] }] },
});

const TITLES: Record<string, string> = {
  "survival.individualDeaths": "Individual deaths", "survival.avoidableVsPeers": "Avoidable vs peers", "survival.dtpsVsPeers": "DTPS vs peers",
  "survival.wipeDeaths": "Wipe deaths", "utility.kicksVsPeers": "Kicks vs peers", "utility.dispels": "Dispels",
  "throughput.medianParse": "Median parse", "preparation.potions": "Potions", "preparation.ilvlVsLevel": "Ilvl vs level",
  "preparation.healthstones": "Healthstones",
};
const weights = { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1 };
const docs: SynthesisDocs = {
  titleOf: (s) => TITLES[s] ?? s,
  axisWeights: { dps: weights, healer: weights, tank: weights },
  verdict: { invite: 70, maybe: 30, minRuns: 3 },
  confidence: { high: 10 },
  subSignals: {
    survival: ["survival.individualDeaths", "survival.avoidableVsPeers", "survival.dtpsVsPeers", "survival.wipeDeaths"],
    utility: ["utility.kicksVsPeers", "utility.dispels"],
    throughput: ["throughput.medianParse"],
    consistency: [],
    preparation: ["preparation.potions", "preparation.ilvlVsLevel", "preparation.healthstones"],
  },
};

describe("compareFacts", () => {
  const ranked = payload({ character: { name: "A", classID: 7, spec: "Holy", scoreTop: { points: 3000, regionRank: 591, serverRank: 3 }, realmSlug: "hyjal", region: "eu" } });
  test("the duel mockup's rows first, then the rest of the old summary", () => {
    expect(compareFacts(tEn, "en", [ranked, b]).map((f) => f.id)).toEqual([
      "rio", "prevSeason", "ilvl", "recentTimed", "deaths", "avoidable", "kicks", "output", "parse", "atTarget", "regionRank",
      "covered", "medianKey", "timedShown", "dtps", "defensives", "bestPrev",
    ]);
  });
  test("the region-rank row is dropped when nobody has one", () => {
    expect(compareFacts(tEn, "en", [a, b]).map((f) => f.id)).not.toContain("regionRank");
    const row = compareFacts(tEn, "en", [ranked, b]).find((f) => f.id === "regionRank")!;
    expect(row.cells.map((c) => [c.text, c.best])).toEqual([["#591", true], ["—", false]]);
  });
  test("bests: lower for deaths, avoidable and DTPS, higher elsewhere", () => {
    const f = (id: string) => compareFacts(tEn, "en", [a, b]).find((r) => r.id === id)!.cells.map((c) => [c.text, c.best]);
    expect(f("deaths")).toEqual([["0.7", false], ["0.2", true]]);
    expect(f("avoidable")).toEqual([["—", false], ["+5%", true]]);
    expect(f("dtps")).toEqual([["−12%", true], ["—", false]]);
    expect(f("ilvl")).toEqual([["322.0", true], ["318.0", false]]);
    expect(f("recentTimed")).toEqual([["9/10", true], ["4/10", false]]);
    expect(f("kicks")).toEqual([["—", false], ["+3 pts", true]]);
    expect(f("prevSeason")).toEqual([["— no data (reroll?)", false], ["2900 tank", true]]);
  });
  test("mixed metrics: \"Median output\" with the unit and no best; one metric keeps its label", () => {
    const mixed = compareFacts(tEn, "en", [a, b]).find((r) => r.id === "output")!;
    expect(mixed.label).toBe("Median output");
    expect(mixed.cells.map((c) => [c.text, c.best])).toEqual([["312.0k hps", false], ["1.20m dps", false]]);
    const same = compareFacts(tEn, "en", [a, payload({ perDungeon: { ...a.perDungeon, medianAmount: 200_000 } })]).find((r) => r.id === "output")!;
    expect(same.label).toBe("Median HPS");
    expect(same.cells.map((c) => c.best)).toEqual([true, false]);
  });
  test("the parse row carries its tier", () => {
    const parse = compareFacts(tEn, "en", [a, b]).find((r) => r.id === "parse")!;
    expect(parse.cells.map((c) => [c.text, c.tier, c.best])).toEqual([["79.4%", "magenta", true], ["70.0%", "blue", false]]);
  });
  test("French: labels and decimal commas", () => {
    const rows = compareFacts(tFr, "fr", [a, b]);
    const f = (id: string) => rows.find((r) => r.id === id)!;
    expect(f("ilvl").cells.map((c) => c.text)).toEqual(["322,0", "318,0"]);
    expect(f("deaths").cells.map((c) => c.text)).toEqual(["0,7", "0,2"]);
    expect(f("output").label).toBe("Output médian");
    expect(f("output").cells.map((c) => c.text)).toEqual(["312,0k hps", "1,20m dps"]);
    expect(f("parse").cells.map((c) => c.text)).toEqual(["79,4\u202f%", "70,0\u202f%"]);
    expect(f("prevSeason").cells.map((c) => c.text)).toEqual(["— pas de données (reroll ?)", "2900 tank"]);
    expect(f("atTarget").label).toBe("Donjons au niveau cible");
  });
});

/** A run with its signals: timed or depleted, deaths, DTPS against a 100k peer median. */
const run = (encounterID: number, keyLevel: number, parsePercent: number, timed: boolean | null, deaths = 0, dtps = 100_000): MPlusRun =>
  ({
    encounterID, keyLevel, parsePercent,
    signals: timed === null ? undefined : sig({
      keystone: { level: keyLevel, chests: timed ? 1 : 0, timed, timeMs: 1_800_000, affixes: [] },
      deaths: { count: deaths, groupTotal: deaths, events: [] },
      damageTaken: { total: 1, dtps, peer: { median: 100_000, count: 4 } },
    }),
  }) as unknown as MPlusRun;
const withRuns = (p: LookupPayload, runs: MPlusRun[]): LookupPayload => ({ ...p, perDungeon: { ...p.perDungeon, runs } });

describe("dungeonCompare", () => {
  const seasonDungeons = [{ id: 1, name: "Temple of Sethraliss" }, { id: 2, name: "Murder Row" }, { id: 3, name: "Kings' Rest" }, { id: 4, name: "The Blinding Vale" }];
  const x = withRuns(payload({ seasonDungeons }), [run(1, 21, 72.2, true, 1, 114_000), run(2, 18, 50, true), run(4, 17, 30, null)]);
  const y = withRuns(payload({ seasonDungeons }), [run(1, 22, 40, false), run(2, 18, 61.5, true)]);
  const rows = dungeonCompare(tEn, "en", [x, y]);
  test("a dungeon nobody ran is left out", () => {
    expect(rows.map((r) => [r.name, r.abbr])).toEqual([["Temple of Sethraliss", "TS"], ["Murder Row", "MR"], ["The Blinding Vale", "BV"]]);
  });
  test("top: the highest timed key only; a depleted higher key is not top; ties are all top", () => {
    expect(rows[0]!.cells.map((c) => [c!.level, c!.timed, c!.top])).toEqual([["+21", true, true], ["+22", false, false]]);
    expect(rows[1]!.cells.map((c) => c!.top)).toEqual([true, true]);
    expect(rows[2]!.cells[0]).toMatchObject({ level: "+17", timed: null, top: false, sub: "" });
    expect(rows[2]!.cells[1]).toBeNull();
  });
  test("the parse and the second line: deaths and DTPS vs peers", () => {
    expect(rows[0]!.cells[0]).toMatchObject({ parse: { text: "72.2%", tier: "blue" }, sub: "1 death · +14% DTPS" });
    expect(rows[0]!.cells[1]!.sub).toBe("0 deaths · +0% DTPS");
    expect(dungeonCompare(tFr, "fr", [x, y])[0]!.cells[0]).toMatchObject({ parse: { text: "72,2\u202f%" }, sub: "1 mort · +14\u202f% DTPS" });
  });
});

describe("targetWarning", () => {
  const at = (level: number) => payload({ evaluation: { ...a.evaluation, targetLevel: level } });
  test("null when every target is the same", () => {
    expect(targetWarning(tEn, [at(18), at(18), at(18)])).toBeNull();
  });
  test("the range otherwise", () => {
    expect(targetWarning(tFr, [at(18), at(11), at(14)])).toBe("Clés cibles différentes (+11 à +18) : chaque score est relatif à sa propre clé.");
    expect(targetWarning(tEn, [at(18), at(11)])).toBe("Different target keys (+11 to +18): each score is relative to its own key.");
  });
});

// The duel: the mockup's Vachâman (left) and Circe (right).
type Ev = [string, number, number];
const axis = (key: string, score: number | null, evidence: Ev[] = []): AxisScore =>
  ({ key, score, confidence: "high", evidence: evidence.map(([source, delta, value]) => ({ source, delta, value, label: source })) }) as AxisScore;
const player = (name: string, scores: [number, number, number, number, number], over: Record<string, unknown> = {}, evidence: Partial<Record<string, Ev[]>> = {}): LookupPayload => {
  const keys = ["survival", "utility", "throughput", "consistency", "preparation"];
  const p = payload({ character: { name, classID: 9, spec: "Elemental", scoreTop: null, realmSlug: "ysondre", region: "eu" }, ...over });
  return {
    ...p,
    evaluation: {
      ...p.evaluation, role: "dps", targetLevel: 18, global: 76, verdict: "invite", runsUsed: 9,
      axes: keys.map((k, i) => axis(k, scores[i]!, evidence[k] ?? [])),
      // The strengths and weaknesses read the drivers: one per evidence line, its delta as the badge points.
      drivers: Object.values(evidence).flatMap((ev) => (ev ?? []).map(([source, delta, value]) => ({ source, impact: Math.round(delta), value, reference: 0, label: "" })))
        .filter((d) => d.impact !== 0),
      ...(over.evaluation as object | undefined),
    },
  } as LookupPayload;
};
const summaryWith = (kicks: number | null, medianParse: number, ilvl = 320) => ({
  summary: { ...a.summary, kicksDeltaPts: kicks, avgDeaths: 0.7, ilvl },
  perDungeon: { ...a.perDungeon, medianParse },
});
const vach = (scores: [number, number, number, number, number] = [86, 72, 36, 59, 84], over: Record<string, unknown> = {}) =>
  player("Vachâman", scores, { ...summaryWith(3, 26), ...over }, {
    survival: [["survival.avoidableVsPeers", 8, -41], ["survival.individualDeaths", 3, 0.7]],
    utility: [["utility.kicksVsPeers", 5, 3]],
    throughput: [["throughput.medianParse", -9, 26]],
  });
const circe = (scores: [number, number, number, number, number] = [83, 60, 64, 40, 86], over: Record<string, unknown> = {}) =>
  player("Circe", scores, { ...summaryWith(-6, 54), ...over }, {
    utility: [["utility.kicksVsPeers", -4, -6]],
    throughput: [["throughput.medianParse", -2, 54]],
    survival: [["survival.individualDeaths", -1, 0.9]],
  });
const duel = (l: LookupPayload, r: LookupPayload, t = tEn, locale: "en" | "fr" = "en") =>
  duelView(t, locale, [{ key: "k1", payload: l }, { key: "k2", payload: r }], docs);

describe("duelView", () => {
  test("a winner on each side, a tie at Δ = 2, a win at Δ = 3", () => {
    const v = duel(vach(), circe());
    expect(v.axes.map((x) => [x.key, x.left.text, x.right.text, x.win.text, x.win.side])).toEqual([
      ["survival", "86", "83", "← Vachâman +3", "left"],
      ["utility", "72", "60", "← Vachâman +12", "left"],
      ["throughput", "36", "64", "Circe +28 →", "right"],
      ["consistency", "59", "40", "informational · weight 0", null],
      ["preparation", "84", "86", "tie", null],
    ]);
    expect(v.axes[0]!.left.wins).toBe(true);
    expect(v.axes[2]!.right).toMatchObject({ wins: true, band: "neutral" });
    expect(v.axes[2]!.left.band).toBe("worse");
  });
  test("the informational axis never wins and carries its text", () => {
    const row = duel(vach(), circe(), tFr, "fr").axes.find((x) => x.key === "consistency")!;
    expect(row).toMatchObject({ informational: true, win: { text: "informatif · poids 0", side: null } });
    expect([row.left.wins, row.right.wins]).toEqual([false, false]);
  });
  test("why: the axis's top evidence, first part", () => {
    const v = duel(vach(), circe());
    expect(v.axes[0]!.left.why).toBe("avoidable −41% vs peers");
  });
  test("lead: both win some (FR)", () => {
    const v = duel(vach(), circe(), tFr, "fr");
    expect(v.summary.title).toBe("En résumé · pour une +18");
    expect(v.summary.lead).toBe("Vachâman devant en survie et utilité ; Circe en throughput.");
  });
  test("lead: one wins, the rest are ties (FR)", () => {
    expect(duel(vach(), circe([85, 60, 37, 40, 86]), tFr, "fr").summary.lead).toBe("Vachâman devant en utilité, égalité ailleurs.");
  });
  test("lead: one wins every counted axis (FR)", () => {
    expect(duel(vach([90, 90, 90, 59, 90]), circe([60, 60, 60, 40, 60]), tFr, "fr").summary.lead).toBe("Vachâman devant sur tous les axes comptés.");
  });
  test("lead: nobody wins (FR)", () => {
    expect(duel(vach([80, 70, 60, 59, 50]), circe([81, 72, 58, 20, 50]), tFr, "fr").summary.lead).toBe("Aucun écart de plus de 2 points sur les axes comptés.");
  });
  test("detail: the verdicts, then the two largest gaps through their headline facts", () => {
    expect(duel(vach(), circe()).summary.detail).toBe("Both are INVITE. Real gaps: the median parse (26% vs 54%) and kicks vs peers (+3 pts vs −6 pts).");
    expect(duel(vach(), circe(), tFr, "fr").summary.detail)
      .toBe("Les deux sont INVITE. Écarts réels : le parse médian (26\u202f% contre 54\u202f%) et les kicks vs pairs (+3 pts contre −6 pts).");
  });
  test("detail: a missing headline fact falls back to the axis scores; different verdicts", () => {
    const r = circe(undefined, { ...summaryWith(null, 54), evaluation: { global: 60, verdict: "maybe" } });
    expect(duel(vach(), r, tFr, "fr").summary.detail)
      .toBe("Vachâman est INVITE, Circe MAYBE. Écarts réels : le parse médian (26\u202f% contre 54\u202f%) et utilité (72 contre 60).");
  });
  test("detail: one real gap, singular", () => {
    expect(duel(vach(), circe([85, 72, 64, 40, 84]), tEn).summary.detail).toBe("Both are INVITE. Real gap: the median parse (26% vs 54%).");
  });
  test("different targets: plain title and the warning", () => {
    const v = duel(vach(), circe(undefined, { evaluation: { targetLevel: 11 } }));
    expect(v.summary.title).toBe("In short");
    expect(v.warning).toBe("Different target keys (+11 to +18): each score is relative to its own key.");
  });
  test("heads: identity, verdict, runs, links", () => {
    const h = duel(vach(undefined, { rio: { seasons: [{ slug: "s2", all: 3650 }] } }), circe()).heads;
    expect(h[0]).toMatchObject({
      key: "k1", href: "/candidate?open=k1", name: "Vachâman", classId: 9, initials: "Sh",
      sub: "Elemental Shaman · Ysondre EU · RIO 3650",
      verdict: { cls: "badge-invite", label: "INVITE", score: "76" },
      runs: "+18 auto · 9 runs scored",
    });
    expect(h[1].sub).toBe("Elemental Shaman · Ysondre EU");
  });
  test("notes: two pros then one con, filled from the other list when one is short", () => {
    const h = duel(vach(), circe()).heads;
    const pros = synthesisView(tEn, "en", vach().evaluation, docs, 12);
    expect(h[0].notes).toEqual([
      { sign: "+", tone: "better", text: pros.pros[0]!.detail, hint: `${pros.pros[0]!.name}: ${pros.pros[0]!.hint}` },
      { sign: "+", tone: "better", text: pros.pros[1]!.detail, hint: `${pros.pros[1]!.name}: ${pros.pros[1]!.hint}` },
      { sign: "−", tone: "worse", text: pros.cons[0]!.detail, hint: `${pros.cons[0]!.name}: ${pros.cons[0]!.hint}` },
    ]);
    // Circe has no pros: three cons.
    expect(h[1].notes.map((n) => n.sign)).toEqual(["−", "−", "−"]);
    // Three pros and no con: three pros.
    const onlyPros = player("P", [80, 80, 80, 50, 80], {}, {
      survival: [["survival.avoidableVsPeers", 8, -41]], utility: [["utility.kicksVsPeers", 5, 3]], throughput: [["throughput.medianParse", 4, 60]],
    });
    expect(duel(onlyPros, circe()).heads[0].notes.map((n) => n.sign)).toEqual(["+", "+", "+"]);
  });
  test("one side insufficient: no score, never wins, the lead says why", () => {
    const r = circe(undefined, { evaluation: { global: null, verdict: "insufficient", runsUsed: 1 } });
    const v = duel(vach(), r, tFr, "fr");
    expect(v.heads[1].verdict).toEqual({ cls: "badge-insufficient", label: "PAS ASSEZ DE DONNÉES", score: null });
    expect(v.axes.every((x) => x.right.score === null && x.right.text === "—" && !x.left.wins && !x.right.wins)).toBe(true);
    expect(v.summary.lead).toBe("Circe n'a pas assez de runs notés pour comparer les axes.");
  });
});

describe("rankingView", () => {
  const glob = (name: string, global: number | null, scores: [number, number, number, number, number]) =>
    player(name, scores, {}, {
      survival: [["survival.avoidableVsPeers", 8, -41]], throughput: [["throughput.medianParse", -9, 26]],
    }) as LookupPayload & { evaluation: { global: number | null } };
  const withGlobal = (p: LookupPayload, global: number | null): LookupPayload =>
    ({ ...p, evaluation: { ...p.evaluation, global, verdict: global === null ? "insufficient" : global >= 70 ? "invite" : "maybe" } }) as LookupPayload;
  const entries: CompareEntry[] = [
    { key: "e1", payload: withGlobal(glob("Loutrasse", 66, [54, 51, 48, 42, 74]), 66) },
    { key: "e2", payload: withGlobal(glob("Obye", null, [50, 50, 50, 50, 50]), null) },
    { key: "e3", payload: withGlobal(glob("Circe", 78, [78, 60, 64, 59, 85]), 78) },
    { key: "e4", payload: withGlobal(glob("Lights", 66, [80, 64, 69, 99, 71]), 66) },
    { key: "e5", payload: withGlobal(glob("Biwaasham", 80, [80, 80, 61, 51, 80]), 80) },
  ];
  const v: RankingView = rankingView(tEn, "en", entries, docs);
  test("rank order: global descending, ties in selection order sharing their rank, insufficient last", () => {
    expect(v.cards.map((c) => [c.rank, c.name, c.series, c.top])).toEqual([
      [1, "Biwaasham", 5, true], [2, "Circe", 3, false], [3, "Loutrasse", 1, false], [3, "Lights", 4, false], [5, "Obye", 2, false],
    ]);
    expect(v.columns.map((c) => [c.name, c.series])).toEqual([["Biwaasham", 5], ["Circe", 3], ["Loutrasse", 1], ["Lights", 4], ["Obye", 2]]);
  });
  test("tied at the top: both rank 1 with the top style; an insufficient card is never top", () => {
    const tied = rankingView(tEn, "en", [entries[1]!, entries[4]!, { key: "e6", payload: withGlobal(glob("Kael", 80, [70, 70, 70, 70, 70]), 80) }], docs);
    expect(tied.cards.map((c) => [c.rank, c.name, c.top])).toEqual([[1, "Biwaasham", true], [1, "Kael", true], [3, "Obye", false]]);
    const none = rankingView(tEn, "en", [entries[1]!, { key: "e7", payload: withGlobal(glob("Zed", null, [50, 50, 50, 50, 50]), null) }, entries[1]!], docs);
    expect(none.cards.map((c) => [c.rank, c.top])).toEqual([[1, false], [1, false], [1, false]]);
  });
  test("the target keeps the auto marker", () => {
    expect(v.cards[0]!.target).toBe("+18 auto");
    const typed = rankingView(tEn, "en", [{ key: "x", payload: { ...entries[0]!.payload, targetAutoDetected: false } as LookupPayload }, ...entries.slice(1, 3)], docs);
    expect(typed.cards.find((c) => c.key === "x")!.target).toBe("+18");
  });
  test("the cards: target, score, verdict, bars, aria", () => {
    const c = v.cards[0]!;
    expect(c).toMatchObject({ href: "/candidate?open=e5", score: "80", verdict: { cls: "badge-invite", label: "INVITE" }, spec: "Elemental Shaman · Ysondre" });
    expect(c.bars.map((x) => [x.short, x.value, x.band, x.informational])).toEqual([
      ["SUR", 80, "better", false], ["UTI", 80, "better", false], ["THR", 61, "neutral", false], ["CON", 51, "neutral", true], ["PRE", 80, "better", false],
    ]);
    expect(c.aria).toBe("Survival 80, Utility 80, Throughput 61, Consistency 51, Preparation 80");
    expect(v.cards[4]!.score).toBeNull();
    expect(v.cards[4]!.bars.every((x) => x.value === null)).toBe(true);
  });
  test("each axis row's best; none on the informational row", () => {
    const row = (k: string) => v.axes.find((x) => x.key === k)!;
    expect(row("survival").cells.map((c) => [c.text, c.best])).toEqual([["80", true], ["78", false], ["54", false], ["80", true], ["—", false]]);
    expect(row("consistency").cells.some((c) => c.best)).toBe(false);
    expect(row("consistency")).toMatchObject({ informational: true, sub: "informational · weight 0" });
    expect(row("survival").sub).toBe("individual deaths, avoidable vs peers, dtps vs peers");
    expect(row("throughput").sub).toBe("median parse");
  });
  test("main and more", () => {
    expect(v.main.map((f) => f.id)).toEqual(["rio", "parse", "recentTimed"]);
    expect(v.more.map((f) => f.id)).toEqual(["prevSeason", "ilvl", "deaths", "avoidable", "kicks", "output", "atTarget", "covered", "medianKey", "timedShown", "dtps", "defensives", "bestPrev"]);
    expect(v.main.every((f) => f.cells.length === 5)).toBe(true);
  });
  test("the cards' line: pro and con, either alone, the verdict summary without either", () => {
    const pro = synthesisView(tEn, "en", entries[4]!.payload.evaluation, docs, 12);
    expect(v.cards[0]!.line).toBe(`+ ${pro.pros[0]!.detail} · − ${pro.cons[0]!.detail}`);
    const one = (ev: Partial<Record<string, Ev[]>>) =>
      rankingView(tEn, "en", [{ key: "x", payload: player("X", [70, 70, 70, 70, 70], {}, ev) }, ...entries.slice(0, 2)], docs).cards.find((c) => c.key === "x")!.line;
    expect(one({ survival: [["survival.avoidableVsPeers", 8, -41]] })).toBe("+ avoidable −41% vs peers");
    expect(one({ throughput: [["throughput.medianParse", -9, 26]] })).toMatch(/^− /);
    expect(one({})).toBe(synthesisView(tEn, "en", player("X", [70, 70, 70, 70, 70]).evaluation, docs, 12).verdict.summary);
  });
  test("French short labels", () => {
    expect(rankingView(tFr, "fr", entries, docs).cards[0]!.bars.map((x) => x.short)).toEqual(["SUR", "UTI", "THR", "RÉG", "PRÉ"]);
  });
});

describe("two picks with the same name", () => {
  const on = (realmSlug: string, region = "eu") => (p: LookupPayload) =>
    ({ ...p, character: { ...p.character, realmSlug, region } }) as LookupPayload;
  test("compareNames: the realm, then the region too when the realm is the same; a unique name stays bare", () => {
    expect(compareNames(tEn, "en", [on("hyjal")(vach()), on("ysondre")(vach()), circe()])).toEqual(["Vachâman (Hyjal)", "Vachâman (Ysondre)", "Circe"]);
    expect(compareNames(tEn, "en", [vach(), on("ysondre", "us")(vach())])).toEqual(["Vachâman (Ysondre EU)", "Vachâman (Ysondre US)"]);
  });
  test("the duel's mirror labels and win texts, the ranking's columns", () => {
    const v = duel(on("hyjal")(vach()), vach([50, 50, 50, 50, 50]));
    expect(v.names).toEqual(["Vachâman (Hyjal)", "Vachâman (Ysondre)"]);
    expect(v.axes[0]!.win.text).toBe("← Vachâman (Hyjal) +36");
    expect(v.heads.map((h) => h.name)).toEqual(["Vachâman", "Vachâman"]);
    const r = rankingView(tEn, "en", [{ key: "a", payload: on("hyjal")(vach()) }, { key: "b", payload: vach() }, { key: "c", payload: circe() }], docs);
    expect(r.columns.map((c) => c.name).sort()).toEqual(["Circe", "Vachâman (Hyjal)", "Vachâman (Ysondre)"]);
  });
});

// Nothing lost: every cell the old compare table showed is still somewhere in the new views.
const DASH = "—";
/** Deliberate format changes, old text → new text (English). */
const FORMAT_CHANGES: Record<string, string> = {
  "n/a": DASH, // an axis without a score
  "322": "322.0", "318": "318.0", // ilvl: one decimal, as the mockup
  "79%": "79.4%", "90%": "90.0%", "50%": "50.0%", // a dungeon's parse: one decimal
  "1d": "1 death", "0d": "0 deaths", // a dungeon's deaths: words
  "+14%": "+14% DTPS", "+0%": "+0% DTPS", // a dungeon's DTPS delta: named
};
// Values the pre-redesign compare table (`compareSections`, removed in phase 4) showed for the same payloads: its
// Evaluation, Summary and Per-dungeon sections in order, a dungeon cell split on " · " with its ✓ / ✗ left out (now
// `timed`).
const OLD_TWO: string[] = [
  "78", "66", "82", "100", "61", "71", "88", "66", "n/a", "72", "55", "38", "+21 auto", "+18 auto", "1/2", "2/2",
  "1/2", "0/2", "+21", "+18", "312.0k hps", "1.20m dps", "79.4%", "70.0%", "0.7", "0.2", "−12%", "—", "1/1", "2/2",
  "—", "+5%", "—", "+3 pts", "—", "—", "322", "318", "9/10", "4/10", "— no data (reroll?)", "2900 tank", "—", "—",
  "+21", "79%", "1d", "+14%", "+18", "90%", "0d", "+0%", "—", "+18", "50%", "0d", "+0%",
];
const OLD_FIVE: string[] = [
  "78", "66", "78", "66", "78", "82", "100", "82", "100", "82", "61", "71", "61", "71", "61", "88", "66", "88", "66",
  "88", "n/a", "72", "n/a", "72", "n/a", "55", "38", "55", "38", "55", "+21 auto", "+18 auto", "+21 auto",
  "+18 auto", "+21 auto", "1/2", "2/2", "1/2", "2/2", "1/2", "1/2", "0/2", "1/2", "0/2", "1/2", "+21", "+18", "+21",
  "+18", "+21", "312.0k hps", "1.20m dps", "312.0k hps", "1.20m dps", "312.0k hps", "79.4%", "70.0%", "79.4%",
  "70.0%", "79.4%", "0.7", "0.2", "0.7", "0.2", "0.7", "−12%", "—", "−12%", "—", "−12%", "1/1", "2/2", "1/1", "2/2",
  "1/1", "—", "+5%", "—", "+5%", "—", "—", "+3 pts", "—", "+3 pts", "—", "—", "—", "—", "—", "—", "322", "318",
  "322", "318", "322", "9/10", "4/10", "9/10", "4/10", "9/10", "— no data (reroll?)", "2900 tank",
  "— no data (reroll?)", "2900 tank", "3100 dps", "—", "—", "—", "—", "—", "+21", "79%", "1d", "+14%", "+18", "90%",
  "0d", "+0%", "+21", "79%", "—", "+21", "79%", "—", "+18", "50%", "0d", "+0%", "—", "—", "—",
];
const duelTexts = (v: DuelView): string[] => [
  ...v.facts.flatMap((f) => f.cells.map((c) => c.text)),
  ...v.axes.flatMap((x) => [x.left.text, x.right.text]),
  ...v.heads.flatMap((h) => [...h.runs.split(" · "), h.verdict.score ?? DASH]),
  ...v.dungeons.flatMap((d) => d.cells.flatMap((c) => (c ? [c.level, c.parse.text, ...c.sub.split(" · ")] : [DASH]))),
];
const rankingTexts = (v: RankingView): string[] => [
  ...v.cards.flatMap((c) => [c.target, c.score ?? DASH]),
  ...v.axes.flatMap((x) => x.cells.map((c) => c.text)),
  ...[...v.main, ...v.more].flatMap((f) => f.cells.map((c) => c.text)),
  ...v.dungeons.flatMap((d) => d.cells.flatMap((c) => (c ? [c.level, c.parse.text, ...c.sub.split(" · ")] : [DASH]))),
];
const missing = (old: string[], now: string[]): string[] => old.map((x) => FORMAT_CHANGES[x] ?? x).filter((x) => !now.includes(x));

describe("nothing lost from the old compare table", () => {
  const sa = withRuns(a, [run(1, 21, 79.4, true, 1, 114_000)]);
  const sb = withRuns(b, [run(1, 18, 90, true), run(2, 18, 50, false)]);
  test("two profiles: every old cell is in the duel", () => {
    expect(missing(OLD_TWO, duelTexts(duel(sa, sb)))).toEqual([]);
  });
  test("five profiles: every old cell is in the ranking", () => {
    const five = [sa, sb, payload({ character: { ...a.character, name: "C" } }), withRuns(b, []), payload({ summary: { ...a.summary, prevSeason: { slug: "s1", all: 3100, best: { role: "dps", score: 3100 } } } })];
    const view = rankingView(tEn, "en", five.map((p, i) => ({ key: `k${i}`, payload: p })), docs);
    expect(missing(OLD_FIVE, rankingTexts(view))).toEqual([]);
  });
});
