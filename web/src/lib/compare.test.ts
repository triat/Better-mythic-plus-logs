import { describe, expect, test } from "bun:test";
import type { LookupPayload } from "../types.ts";
import { bestIndices, compareSections } from "./compare.ts";

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
    character: { name: "A", classID: 7, spec: "Holy", scoreTop: null },
    targetLevel: 21, targetAutoDetected: true,
    seasonDungeons: [{ id: 1, name: "Voidscar Arena" }, { id: 2, name: "Den of Nalorakk" }, { id: 3, name: "Kings' Rest" }],
    perDungeon: { runs: [{ encounterID: 1, keyLevel: 21, parsePercent: 79.4, signals: undefined }], dungeonsCovered: 1, totalDungeonsInSeason: 2, dungeonsAtOrAboveTarget: 1, medianLevel: 21, medianAmount: 312_000, medianParse: 79.4 },
    prevLevelBest: null,
    summary: { runsWithSignals: 1, timedShown: 1, avgDeaths: 0.7, deathsInWipes: 0, dtpsDeltaPct: -12, kicksDeltaPts: null, avoidableDeltaPct: null, ilvl: 322, recentTimed: 9, recentTotal: 10, prevSeason: null },
    deepdive: [],
    deepdiveSummary: { tableWarning: null, analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
    evaluation: { role: "healer", targetLevel: 21, global: 78, verdict: "invite", runsUsed: 9, analyzedRuns: 0, configVersion: "x",
      axes: [{ key: "survival", score: 82, confidence: "high", evidence: [] }, { key: "utility", score: 61, confidence: "high", evidence: [] }, { key: "throughput", score: 88, confidence: "high", evidence: [] }, { key: "consistency", score: null, confidence: "low", evidence: [] }, { key: "preparation", score: 55, confidence: "medium", evidence: [] }, { key: "experience", score: 74, confidence: "high", evidence: [] }] },
    ...over,
  }) as unknown as LookupPayload;

describe("compareSections", () => {
  const a = payload({});
  const b = payload({
    character: { name: "B", classID: 2, spec: "Guardian", scoreTop: null }, metric: "dps", targetLevel: 18,
    perDungeon: { runs: [{ encounterID: 1, keyLevel: 18, parsePercent: 90, signals: undefined }, { encounterID: 2, keyLevel: 18, parsePercent: 50, signals: undefined }], dungeonsCovered: 2, totalDungeonsInSeason: 2, dungeonsAtOrAboveTarget: 0, medianLevel: 18, medianAmount: 1_200_000, medianParse: 70 },
    summary: { runsWithSignals: 2, timedShown: 2, avgDeaths: 0.2, deathsInWipes: 0, dtpsDeltaPct: null, kicksDeltaPts: 3, avoidableDeltaPct: 5, ilvl: 318, recentTimed: 4, recentTotal: 10, prevSeason: { slug: "s1", all: 2900, best: { role: "tank", score: 2900 } } },
    evaluation: { role: "tank", targetLevel: 18, global: 66, verdict: "maybe", runsUsed: 5, configVersion: "x",
      axes: [{ key: "survival", score: 100, confidence: "high", evidence: [] }, { key: "utility", score: 71, confidence: "high", evidence: [] }, { key: "throughput", score: 66, confidence: "high", evidence: [] }, { key: "consistency", score: 72, confidence: "medium", evidence: [] }, { key: "preparation", score: 38, confidence: "medium", evidence: [] }, { key: "experience", score: 58, confidence: "high", evidence: [] }] },
  });
  const sections = compareSections([a, b]);
  const row = (title: string, label: string) => sections.find((s) => s.title === title)!.rows.find((r) => r.label === label)!;

  test("score + axes", () => {
    expect(row("Evaluation", "Score").cells.map((c) => [c.text, c.best])).toEqual([["78", true], ["66", false]]);
    expect(row("Evaluation", "Survival").cells.map((c) => [c.text, c.best])).toEqual([["82", false], ["100", true]]);
    expect(row("Evaluation", "Consistency").cells.map((c) => [c.text, c.best])).toEqual([["n/a", false], ["72", true]]);
  });
  test("summary rows", () => {
    expect(row("Summary", "Target level").cells.map((c) => c.text)).toEqual(["+21 auto", "+18 auto"]);
    expect(row("Summary", "Median output").cells.map((c) => c.text)).toEqual(["312.0k hps", "1.20m dps"]);
    expect(row("Summary", "Median output").cells.map((c) => c.best)).toEqual([false, false]);
    expect(row("Summary", "Avg deaths").cells.map((c) => [c.text, c.cls, c.best])).toEqual([["0.7", "tone-warn", false], ["0.2", "tone-good", true]]);
    expect(row("Summary", "Median Δ DTPS vs peers").cells.map((c) => c.text)).toEqual(["−12%", "—"]);
    expect(row("Summary", "Prev season").cells.map((c) => c.text)).toEqual(["— no data (reroll?)", "2900 tank"]);
    expect(row("Summary", "Best run prev-level").cells.map((c) => c.text)).toEqual(["—", "—"]);
  });
  test("per-dungeon rows only where someone has a run", () => {
    const d = sections.find((s) => s.title === "Per-dungeon (best run)")!;
    expect(d.rows.map((r) => r.label)).toEqual(["Voidscar Arena", "Den of Nalorakk"]);
    expect(d.rows.map((r) => r.label)).not.toContain("Kings' Rest");
    expect(d.rows[0]!.cells.map((c) => [c.text, c.best])).toEqual([["+21 · 79%", false], ["+18 · 90%", true]]);
    expect(d.rows[1]!.cells[0]!.text).toBe("—");
  });
  test("same metric keeps the metric label", () => {
    const s = compareSections([a, payload({ character: { name: "C", classID: 7, spec: null, scoreTop: null } })]);
    expect(s.find((x) => x.title === "Summary")!.rows.find((r) => r.label === "Median HPS")!.cells.map((c) => c.text)).toEqual(["312.0k", "312.0k"]);
  });
  test("Defensives row: higher usage wins, dash without analyses", () => {
    const a = payload({ deepdiveSummary: { tableWarning: null, analyzedRuns: 2, majorUsage: 0.8, avoidableDeathShare: 0.5, avoidableDeaths: 1, countedDeaths: 2 } });
    const b = payload({});
    const s = compareSections([a, b]);
    const row = s.find((x) => x.title === "Summary")!.rows.find((r) => r.label === "Defensives")!;
    expect(row.cells[0]).toEqual({ text: "80% · 1/2 avoidable", cls: "", best: true });
    expect(row.cells[1]).toEqual({ text: "—", cls: "faint", best: false });
  });
});
