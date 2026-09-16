import { describe, expect, test } from "bun:test";
import type { Evaluation } from "../types.ts";
import { AXIS_LABELS, AXIS_ORDER, confidenceColor, verdictView } from "./verdict.ts";

const ev = (over: Partial<Evaluation>): Evaluation => ({
  role: "healer", targetLevel: 21, axes: [], global: 78, verdict: "invite", runsUsed: 9, configVersion: "deadbeef", ...over,
});

describe("verdict", () => {
  test("axis order and labels", () => {
    expect(AXIS_ORDER).toEqual(["survival", "utility", "throughput", "consistency", "preparation", "experience"]);
    expect(AXIS_LABELS.throughput).toBe("Throughput");
  });
  test("invite/maybe/pass views", () => {
    expect(verdictView(ev({}))).toEqual({
      label: "INVITE", score: "78", cls: "badge-invite", sub: "for a +21 · 9 runs scored · confidence per axis",
    });
    expect(verdictView(ev({ verdict: "maybe", global: 52.4, runsUsed: 1 })).label).toBe("MAYBE");
    expect(verdictView(ev({ verdict: "maybe", global: 52.4, runsUsed: 1 })).score).toBe("52");
    expect(verdictView(ev({ verdict: "maybe", global: 52.4, runsUsed: 1 })).sub).toBe("for a +21 · 1 run scored · confidence per axis");
    expect(verdictView(ev({ verdict: "pass", global: 31 })).cls).toBe("badge-pass");
    expect(verdictView(ev({}), true).sub).toBe("for a +21 (auto) · 9 runs scored · confidence per axis");
  });
  test("insufficient view has no score and no threshold", () => {
    expect(verdictView(ev({ verdict: "insufficient", global: null, runsUsed: 2 }))).toEqual({
      label: "NOT ENOUGH DATA", score: null, cls: "badge-insufficient", sub: "only 2 runs scored",
    });
    expect(verdictView(ev({ verdict: "insufficient", global: 40, runsUsed: 1 })).sub).toBe("only 1 run scored");
  });
  test("confidence colors", () => {
    expect(confidenceColor("high")).toBe("#56d364");
    expect(confidenceColor("medium")).toBe("#e3b341");
    expect(confidenceColor("low")).toBe("#f85149");
    expect(confidenceColor(null)).toBe("#6e7681");
  });
});
