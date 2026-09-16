import { describe, expect, test } from "bun:test";
import type { AxisScore, Evaluation, LookupPayload } from "../types.ts";
import { axisRows, heroStats, radarPoints } from "./axes.ts";

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
      { label: "0.2 individual deaths/run", delta: "+18", tone: "good" },
      { label: "avoidable +12% vs peers", delta: "−6", tone: "bad" },
    ]);
    expect(rows[0]!.all).toHaveLength(3);
    expect(rows[2]!.top[0]).toEqual({ label: "median parse 86%", delta: "+27", tone: "good" });
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
});
