import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { anchorOf, axisIsInformational, hashAnchor, axisNote, budgetPill, curvePath, curveTable, faqEntries, fmtThresholds, linkSegments, roleWeights, toc } from "./help.ts";

const tFr = makeT(fr, "fr");

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

describe("hashAnchor", () => {
  test("the id a hash points at, decoded; null when there is none or it is malformed", () => {
    expect(hashAnchor("#drivers")).toBe("drivers");
    expect(hashAnchor("#survival.individualDeaths")).toBe("survival.individualDeaths");
    expect(hashAnchor("#live%2Daddon")).toBe("live-addon");
    expect(hashAnchor("")).toBeNull();
    expect(hashAnchor("#")).toBeNull();
    expect(hashAnchor("#%E0%A4%A")).toBeNull();
  });
});

describe("toc", () => {
  test("order and the six axis sub-entries", () => {
    const t = toc(tEn, docs, false);
    expect(t.map((e) => e.anchor)).toEqual([
      "what", "verdict", "axes", "axis-survival", "axis-utility", "axis-throughput", "axis-consistency", "axis-preparation", "axis-experience",
      "level-scale", "expected-ilvl", "runs", "peers", "deep-dive", "live-addon", "reading", "faq",
    ]);
    expect(t.filter((e) => e.sub).map((e) => e.label)).toEqual(["Survival", "Utility", "Throughput", "Consistency", "Preparation", "Experience"]);
    expect(t.filter((e) => !e.sub).map((e) => e.label)).toEqual([
      "What bmpl looks at", "The verdict", "The six axes", "Key-level scaling", "Expected item level", "Per-run signals", "Peers", "Deep-dive",
      "The in-game addon", "Reading the page", "FAQ",
    ]);
  });
  test("live-addon is not hosted-gated: present, in the same spot, whether hosted or not", () => {
    expect(toc(tEn, docs, false).map((e) => e.anchor)).toContain("live-addon");
    expect(toc(tEn, docs, true).map((e) => e.anchor)).toContain("live-addon");
    expect(toc(tEn, docs, false).find((e) => e.anchor === "live-addon")!.label).toBe("The in-game addon");
  });
  test("hosted: the own-client guide sits between deep-dive and live-addon, before reading", () => {
    const anchors = toc(tEn, docs, true).map((e) => e.anchor);
    expect(anchors.slice(anchors.indexOf("deep-dive"), anchors.indexOf("reading") + 1)).toEqual(["deep-dive", "wcl-client", "live-addon", "reading"]);
    expect(toc(tEn, docs, true).find((e) => e.anchor === "wcl-client")!.label).toBe("Your own WCL client");
  });
  test("French: the section labels follow the dictionary, the axis labels follow the registry served", () => {
    const t = toc(tFr, docs, true);
    expect(t.map((e) => e.anchor)).toEqual(toc(tEn, docs, true).map((e) => e.anchor));
    expect(t.filter((e) => !e.sub).map((e) => e.label)).toEqual([
      "Ce que bmpl regarde", "Le verdict", "Les six axes", "Pondération par niveau de key", "Item level attendu", "Signaux par run", "Pairs", "Deep-dive",
      "Ton propre client WCL", "L'addon en jeu", "Lire la page", "FAQ",
    ]);
    // The registry is fetched in the UI language (api.docs(locale)); the toc prints whatever titles it carries.
    expect(t.filter((e) => e.sub).map((e) => e.label)).toEqual(["Survival", "Utility", "Throughput", "Consistency", "Preparation", "Experience"]);
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
    expect(budgetPill(tEn, 100)).toEqual({ pts: "100 pts / h", lookups: "about 10 uncached lookups" });
    expect(budgetPill(tEn, 3600)).toEqual({ pts: "3 600 pts / h", lookups: "about 360 uncached lookups" });
    expect(budgetPill(tEn, 5)).toEqual({ pts: "5 pts / h", lookups: "about 1 uncached lookup" });
    expect(budgetPill(tEn, null)).toBeNull();
  });
  test("budgetPill in French: same pts line, the lookup count pluralised the French way", () => {
    expect(budgetPill(tFr, 3600)).toEqual({ pts: "3 600 pts / h", lookups: "environ 360 recherches non cachées" });
    expect(budgetPill(tFr, 5)).toEqual({ pts: "5 pts / h", lookups: "environ 1 recherche non cachée" });
    expect(budgetPill(tFr, null)).toBeNull();
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
  expect(fmtThresholds(tEn, { invite: 70, maybe: 45, minRuns: 3 }, { high: 6, medium: 3 })).toEqual({ invite: "70", maybe: "45", minRuns: "3 enriched runs", high: "6 runs", medium: "3 runs" });
  expect(fmtThresholds(tEn, { invite: 70, maybe: 45, minRuns: 1 }, { high: 1, medium: 1 })).toEqual({ invite: "70", maybe: "45", minRuns: "1 enriched run", high: "1 run", medium: "1 run" });
  expect(fmtThresholds(tFr, { invite: 70, maybe: 45, minRuns: 3 }, { high: 6, medium: 1 })).toEqual({ invite: "70", maybe: "45", minRuns: "3 runs enrichis", high: "6 runs", medium: "1 run" });
  expect(faqEntries(docs, false).map((f) => f.q)).toEqual(["a"]);
  expect(faqEntries(docs, true).map((f) => f.q)).toEqual(["a", "c"]);
});

test("axisNote: the minimum-runs line of Survival and Consistency, from the config", () => {
  const c = { high: 6, medium: 3, consistencyMinRuns: 5, deepdiveMinRuns: 2 };
  expect(axisNote(tEn, "survival", c)).toBe("The two deep-dive sub-signals appear once at least 2 shown runs have been analyzed.");
  expect(axisNote(tEn, "consistency", c)).toBe("Every sub-signal needs at least 5 runs; below that the axis is n/a.");
  expect(axisNote(tEn, "survival", { ...c, deepdiveMinRuns: 1 })).toBe("The two deep-dive sub-signals appear once at least 1 shown run has been analyzed.");
  expect(axisNote(tEn, "consistency", { ...c, consistencyMinRuns: 1 })).toBe("Every sub-signal needs at least 1 run; below that the axis is n/a.");
  expect(axisNote(tEn, "utility", c)).toBeNull();
  expect(axisNote(tFr, "survival", c)).toBe("Les deux sous-signaux deep-dive apparaissent une fois qu'au moins 2 runs affichés ont été analysés.");
  expect(axisNote(tFr, "survival", { ...c, deepdiveMinRuns: 1 })).toBe("Les deux sous-signaux deep-dive apparaissent une fois qu'au moins 1 run affiché a été analysé.");
  expect(axisNote(tFr, "consistency", c)).toBe("Chaque sous-signal demande au moins 5 runs ; en dessous l'axe est n/a.");
  expect(axisNote(tFr, "utility", c)).toBeNull();
});
