import { describe, expect, test } from "bun:test";
import { anchorOf, axisIsInformational, axisNote, budgetPill, curvePath, curveTable, faqEntries, fmtThresholds, linkSegments, roleWeights, toc } from "./help.ts";

const docs = {
  axes: {
    survival: { title: "Survival", summary: "", why: "", subSignals: {} },
    utility: { title: "Utility", summary: "", why: "", subSignals: {} },
    throughput: { title: "Throughput", summary: "", why: "", subSignals: {} },
    consistency: { title: "Consistency", summary: "", why: "", subSignals: {} },
    preparation: { title: "Preparation", summary: "", why: "", subSignals: {} },
    experience: { title: "Experience", summary: "", why: "", subSignals: {} },
  },
  faq: [{ q: "a", a: "b" }, { q: "c", a: "d", hostedOnly: true }],
} as never;

describe("anchorOf", () => {
  test("sub-signal sources, axis keys, extras", () => {
    expect(anchorOf("survival.individualDeaths")).toBe("survival.individualDeaths");
    expect(anchorOf("survival")).toBe("axis-survival");
    expect(anchorOf("experience.prevSeasonBonus")).toBe("experience.prevSeasonBonus");
  });
});

describe("toc", () => {
  test("order and the six axis sub-entries", () => {
    const t = toc(docs, false);
    expect(t.map((e) => e.anchor)).toEqual([
      "what", "verdict", "axes", "axis-survival", "axis-utility", "axis-throughput", "axis-consistency", "axis-preparation", "axis-experience",
      "level-scale", "expected-ilvl", "runs", "peers", "deep-dive", "reading", "faq",
    ]);
    expect(t.filter((e) => e.sub).map((e) => e.label)).toEqual(["Survival", "Utility", "Throughput", "Consistency", "Preparation", "Experience"]);
  });
  test("hosted: the own-client guide sits between deep-dive and reading", () => {
    const anchors = toc(docs, true).map((e) => e.anchor);
    expect(anchors.slice(anchors.indexOf("deep-dive"), anchors.indexOf("reading") + 1)).toEqual(["deep-dive", "wcl-client", "reading"]);
    expect(toc(docs, true).find((e) => e.anchor === "wcl-client")!.label).toBe("Your own WCL client");
  });
});

describe("own-client guide", () => {
  test("linkSegments splits [label](href) links and keeps plain text whole", () => {
    expect(linkSegments("plain")).toEqual([{ text: "plain" }]);
    expect(linkSegments("Open [Settings](/settings#wcl-client), paste both.")).toEqual([
      { text: "Open " }, { text: "Settings", href: "/settings#wcl-client" }, { text: ", paste both." },
    ]);
    expect(linkSegments("[a](https://x.y/) and [b](/z)")).toEqual([{ text: "a", href: "https://x.y/" }, { text: " and " }, { text: "b", href: "/z" }]);
    expect(linkSegments("")).toEqual([{ text: "" }]);
    expect(linkSegments("set it to `http://localhost`, then")).toEqual([{ text: "set it to " }, { text: "http://localhost", code: true }, { text: ", then" }]);
  });
  test("budgetPill: pts per hour and a rough lookup count; null without a quota", () => {
    expect(budgetPill(100)).toEqual({ pts: "100 pts / h", lookups: "about 10 uncached lookups" });
    expect(budgetPill(3600)).toEqual({ pts: "3 600 pts / h", lookups: "about 360 uncached lookups" });
    expect(budgetPill(5)).toEqual({ pts: "5 pts / h", lookups: "about 1 uncached lookup" });
    expect(budgetPill(null)).toBeNull();
  });
});

describe("curves", () => {
  test("table formats x by unit", () => {
    expect(curveTable([[0, 100], [0.5, 85], [3, 10]], "deaths per run")).toEqual([{ x: "0", y: 100 }, { x: "0.5", y: 85 }, { x: "3", y: 10 }]);
    expect(curveTable([[-40, 100], [0, 65], [50, 10]], "% vs peers")).toEqual([{ x: "−40%", y: 100 }, { x: "0%", y: 65 }, { x: "+50%", y: 10 }]);
    expect(curveTable([[8, 1.6], [25, 0.65]], "key level")).toEqual([{ x: "+8", y: 1.6 }, { x: "+25", y: 0.65 }]);
  });
  test("path spans the box, y from 0 to yMax", () => {
    const p = curvePath([[0, 100], [2, 0]], 200, 52);
    expect(p.dots).toEqual([{ cx: 4, cy: 4 }, { cx: 196, cy: 48 }]);
    expect(p.path).toBe("M4,4 L196,48");
    expect(p.midY).toBe(26);
    expect(curvePath([[8, 1.6], [25, 0.65]], 200, 52, 2).dots[0]).toEqual({ cx: 4, cy: 12.8 });
  });
});

test("roleWeights, informational axis, thresholds text, faq filter", () => {
  expect(roleWeights({ dps: 3, healer: 1, tank: 0 })).toEqual([{ role: "dps", weight: 3 }, { role: "healer", weight: 1 }, { role: "tank", weight: 0 }]);
  const aw = { dps: { consistency: 0, survival: 3 }, healer: { consistency: 0, survival: 3 }, tank: { consistency: 0, survival: 3 } } as never;
  expect(axisIsInformational(aw, "consistency")).toBe(true);
  expect(axisIsInformational(aw, "survival")).toBe(false);
  expect(fmtThresholds({ invite: 70, maybe: 45, minRuns: 3 }, { high: 6, medium: 3 })).toEqual({ invite: "70", maybe: "45", minRuns: "3 enriched runs", high: "6 runs", medium: "3 runs" });
  expect(faqEntries(docs, false).map((f) => f.q)).toEqual(["a"]);
  expect(faqEntries(docs, true).map((f) => f.q)).toEqual(["a", "c"]);
});

test("axisNote: the minimum-runs line of Survival and Consistency, from the config", () => {
  const c = { high: 6, medium: 3, consistencyMinRuns: 5, deepdiveMinRuns: 2 };
  expect(axisNote("survival", c)).toBe("The two deep-dive sub-signals appear once at least 2 shown runs have been analyzed.");
  expect(axisNote("consistency", c)).toBe("Every sub-signal needs at least 5 runs; below that the axis is n/a.");
  expect(axisNote("utility", c)).toBeNull();
});
