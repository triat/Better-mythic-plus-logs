import { describe, expect, test } from "bun:test";
import type { AxisScore, Evaluation, LookupPayload } from "../types.ts";
import { axisInfo, axisRows, axisWeightLabel, heroStats, radarPoints } from "./axes.ts";

const axis = (key: AxisScore["key"], score: number | null, evidence: AxisScore["evidence"] = [], confidence: AxisScore["confidence"] = "high"): AxisScore =>
  ({ key, score, confidence, evidence } as AxisScore);

const ev: Evaluation = {
  role: "healer", targetLevel: 21, global: 78, verdict: "invite", runsUsed: 9, analyzedRuns: 0, configVersion: "x",
  axes: [
    axis("throughput", 88, [
      { label: "median parse 86%", delta: 27.4, source: "throughput.medianParse" },
      { label: "parse 79% at target level", delta: 10.6, source: "throughput.atTarget" },
    ]),
    axis("survival", 82, [
      { label: "0.2 individual deaths/run", delta: 18, source: "survival.deaths" },
      { label: "avoidable +12% vs peers", delta: -6.2, source: "survival.avoidable" },
      { label: "DTPS −3% vs peers", delta: 1, source: "survival.dtps" },
    ]),
    axis("consistency", null, [], "low"),
    axis("utility", 61), axis("preparation", 55), axis("experience", 74),
  ],
};

describe("axes view model", () => {
  test("rows follow AXIS_ORDER and carry top-2 evidence by |delta|", () => {
    const rows = axisRows(ev);
    expect(rows.map((r) => r.key)).toEqual(["survival", "utility", "throughput", "consistency", "preparation", "experience"]);
    expect(rows[0]!.top).toEqual([
      { label: "0.2 individual deaths/run", delta: "+18", tone: "good", source: "survival.deaths" },
      { label: "avoidable +12% vs peers", delta: "−6", tone: "bad", source: "survival.avoidable" },
    ]);
    expect(rows[0]!.all).toHaveLength(3);
    expect(rows[0]!.all[0]!.source).toBe("survival.deaths");
    expect(rows[2]!.top[0]).toEqual({ label: "median parse 86%", delta: "+27", tone: "good", source: "throughput.medianParse" });
  });
  test("null axis: no confidence, hollow note", () => {
    const c = axisRows(ev)[3]!;
    expect(c.score).toBeNull();
    expect(c.confidence).toBeNull();
    expect(c.note).toBe("not enough data for this axis");
    expect(c.top).toEqual([]);
  });
  test("axis with score but no evidence notes it", () => {
    expect(axisRows(ev)[1]!.note).toBe("no evidence");
  });
  test("radarPoints in AXIS_ORDER", () => {
    expect(radarPoints(ev)).toEqual([82, 61, 88, null, 55, 74]);
  });
  test("survival carries an analyzed-runs badge when deep-dive evidence exists", () => {
    const rows = axisRows({ ...ev, analyzedRuns: 3 });
    expect(rows.find((r) => r.key === "survival")!.badge).toBe("3 runs analyzed");
    expect(rows.find((r) => r.key === "utility")!.badge).toBeNull();
    expect(axisRows({ ...ev, analyzedRuns: 1 }).find((r) => r.key === "survival")!.badge).toBe("1 run analyzed");
    expect(axisRows(ev).find((r) => r.key === "survival")!.badge).toBeNull();
  });
  test("heroStats", () => {
    const payload = {
      metric: "hps",
      character: { scoreTop: { points: 3942.4, regionRank: 412, serverRank: 7, spec: "Holy", rankPercent: 99 } },
      summary: { ilvl: 322, prevSeason: { slug: "s1", all: 4153.2, best: { role: "dps", score: 4153.2 } } },
    } as unknown as LookupPayload;
    expect(heroStats(payload)).toEqual([
      { label: "HPS score", value: "3942" },
      { label: "ilvl", value: "322" },
      { label: "region", value: "#412" },
      { label: "server", value: "#7" },
      { label: "prev season", value: "4153", sub: "dps" },
    ]);
    const bare = { metric: "dps", character: { scoreTop: null }, summary: { ilvl: null, prevSeason: null } } as unknown as LookupPayload;
    expect(heroStats(bare)).toEqual([]);
  });
  test("axisWeightLabel reproduces the callout phrasing from the live axisWeights", () => {
    const w = {
      dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 },
      healer: { survival: 3, utility: 2.5, throughput: 2, consistency: 0, preparation: 1, experience: 2 },
      tank: { survival: 3, utility: 2, throughput: 2, consistency: 0, preparation: 1, experience: 2.5 },
    };
    expect(axisWeightLabel(w, "survival")).toBe("weight 3 for every role");
    expect(axisWeightLabel(w, "utility")).toBe("weight 2 (healer 2.5)");
    expect(axisWeightLabel(w, "throughput")).toBe("weight 3 for dps, 2 for healer and tank");
    expect(axisWeightLabel(w, "consistency")).toBe("weight 0 · informational");
    expect(axisWeightLabel(w, "experience")).toBe("weight 2 (tank 2.5)");
    expect(axisWeightLabel({ ...w, healer: { ...w.healer, preparation: 2 }, tank: { ...w.tank, preparation: 3 } }, "preparation")).toBe("dps 1 · healer 2 · tank 3");
  });
  test("axisInfo pairs the registry summary with the weight label; rows fall back to placeholders without it", () => {
    const docs = {
      docs: { axes: { survival: { summary: "Deaths and damage taken." }, utility: { summary: "Kicks." }, throughput: { summary: "P." }, consistency: { summary: "C." }, preparation: { summary: "Pr." }, experience: { summary: "E." } } },
      config: { axisWeights: { dps: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 }, healer: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 }, tank: { survival: 3, utility: 2, throughput: 3, consistency: 0, preparation: 1, experience: 2 } } },
    } as never;
    const info = axisInfo(docs);
    expect(info.survival).toEqual({ description: "Deaths and damage taken.", weight: "weight 3 for every role" });
    expect(axisRows(ev, info)[0]).toMatchObject({ description: "Deaths and damage taken.", weight: "weight 3 for every role" });
    expect(axisRows(ev)[0]).toMatchObject({ description: "", weight: "…" });
  });
});
