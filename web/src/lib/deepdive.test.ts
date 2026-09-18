import { describe, expect, test } from "bun:test";
import type { EntryOrigin } from "@shared/deepdive/types.ts";
import type { LookupPayload, RunDefensives } from "../types.ts";
import { analysisFor, costText, defensivesCell, originLabel, panelModel, tableUsedText, tableWarningText, unanalyzedRuns } from "./deepdive.ts";

const dd = (over: Partial<RunDefensives> = {}): RunDefensives => ({
  reportCode: "ABC", fightID: 3, character: "Muleyoxo", className: "Paladin", spec: "Holy", tableMissing: false, tableVersion: "t",
  defensives: [
    { id: 498, name: "Divine Protection", cooldownS: 60, durationS: 8, kind: "major", origin: "shipped", casts: 27, capacity: 30, usage: 0.9, observedMinIntervalS: 38, cdMismatch: true },
    { id: 642, name: "Divine Shield", cooldownS: 300, durationS: 8, kind: "immunity", origin: "override", casts: 5, capacity: 6, usage: 5 / 6, observedMinIntervalS: 310, cdMismatch: false },
    { id: 1022, name: "Blessing of Protection", cooldownS: 300, durationS: 10, kind: "minor", origin: "shipped", casts: 3, capacity: 6, usage: 0.5, observedMinIntervalS: null, cdMismatch: false },
  ],
  deaths: [
    { atMs: 1_764_223, inWipe: false, killingHits: [{ id: 1300372, name: "Cosmic Crash", amount: 559197, share: 0.55 }, { id: 1264188, name: "Unstable Singularity", amount: 458887, share: 0.45 }], killingBlow: "Unstable Singularity", available: ["Divine Shield"], active: [], onCooldown: [{ name: "Divine Protection", readyInS: 12 }], verdict: "immunity available" },
    { atMs: 100_000, inWipe: true, killingHits: [], killingBlow: null, available: [], active: ["Divine Protection"], onCooldown: [], verdict: "covered" },
  ],
  majorUsage: 0.87, avoidableDeaths: 1, countedDeaths: 1,
  unlisted: [{ id: 31821, name: "Aura Mastery", casts: 2, uptimeS: 16 }],
  staleTable: false, truncated: false, fetchedAt: 1_000_000, pointsSpent: 3,
  ...over,
});

const payload = (deepdive: RunDefensives[], runs = [{ reportCode: "ABC", fightID: 3 }, { reportCode: "DEF", fightID: 1 }]): LookupPayload =>
  ({
    character: { name: "Muleyoxo" },
    perDungeon: { runs: runs.map((r) => ({ ...r, signals: {} })) },
    prevLevelBest: null,
    deepdive,
    deepdiveSummary: { tableWarning: null, analyzedRuns: deepdive.length, majorUsage: deepdive[0]?.majorUsage ?? null, avoidableDeathShare: deepdive.length ? 1 : null, avoidableDeaths: deepdive.length, countedDeaths: deepdive.length },
  }) as unknown as LookupPayload;

describe("analysisFor / unanalyzedRuns / costText", () => {
  test("finds the analysis of a run and lists runs still to analyze (only runs with signals)", () => {
    const p = payload([dd()]);
    expect(analysisFor(p, { reportCode: "ABC", fightID: 3 })?.spec).toBe("Holy");
    expect(analysisFor(p, { reportCode: "DEF", fightID: 1 })).toBeNull();
    expect(unanalyzedRuns(p).map((r) => r.reportCode)).toEqual(["DEF"]);
    const noSig = payload([], [{ reportCode: "X", fightID: 1 }]);
    (noSig.perDungeon.runs[0] as { signals?: unknown }).signals = undefined;
    expect(unanalyzedRuns(noSig)).toEqual([]);
  });
  test("cost text", () => {
    expect(costText(1)).toBe("~3 pts");
    expect(costText(8)).toBe("~24 pts");
  });
});

describe("panelModel", () => {
  test("usage rows, deaths, audit and headline", () => {
    const m = panelModel(dd(), 1_000_000 + 2 * 3600_000);
    expect(m.title).toBe("Defensives · Holy Paladin");
    expect(m.meta).toBe("analyzed 2h ago · 3 pts");
    expect(m.usage[0]).toEqual({ id: 498, name: "Divine Protection", kind: "major", counts: "27 / 30", pct: 90, pctText: "90%", cls: "tone-good", cd: "cd 60 s · seen 38 s", mismatch: true, origin: "shipped", countsUsage: true });
    expect(m.usage[2]!.countsUsage).toBe(false);
    expect(m.usage[2]!.pctText).toBe("—");
    expect(m.majorsText).toBe("majors used 87% of possible");
    expect(m.deathsHeadline).toBe("1/1 deaths with a defensive available");
    expect(m.deaths[0]).toEqual({
      time: "29:24", verdict: "immunity available", cls: "tone-bad", wipe: false,
      hits: [{ id: 1300372, name: "Cosmic Crash", text: "55%" }, { id: 1264188, name: "Unstable Singularity", text: "45%" }], blow: "killing blow: Unstable Singularity",
      states: [{ id: 642, name: "Divine Shield", text: "available", cls: "tone-bad" }, { id: 498, name: "Divine Protection", text: "on cd · 12 s left", cls: "faint" }],
    });
    expect(m.deaths[1]!.wipe).toBe(true);
    expect(m.deaths[1]!.cls).toBe("tone-good");
    expect(m.deaths[1]!.states).toEqual([{ id: 498, name: "Divine Protection", text: "active", cls: "tone-good" }]);
    expect(m.unlisted).toEqual([{ id: 31821, name: "Aura Mastery", text: " · 2× · 16 s up" }]);
    expect(m.tableUsed).toBe("Table used: Holy Paladin · 3 entries · 1 from your override");
    expect(m.notice).toBeNull();
  });
  test("verdict tones and notices", () => {
    expect(panelModel(dd({ deaths: [{ ...dd().deaths[0]!, verdict: "defensive available" }] })).deaths[0]!.cls).toBe("tone-warn");
    expect(panelModel(dd({ deaths: [{ ...dd().deaths[0]!, verdict: "nothing available" }] })).deaths[0]!.cls).toBe("tone-good");
    expect(panelModel(dd({ deaths: [], countedDeaths: 0, avoidableDeaths: 0 })).deathsHeadline).toBe("No deaths");
    expect(panelModel(dd({ tableMissing: true, defensives: [], majorUsage: null })).notice).toBe("No defensives table for Holy Paladin yet — add entries from the audit below.");
    expect(panelModel(dd({ staleTable: true })).notice).toBe("The table changed since this run was analyzed — re-analyze to include the new entries.");
    expect(panelModel(dd({ truncated: true })).notice).toBe("Cast events were truncated (more than 5 pages) — counts may be low.");
    expect(panelModel(dd({ pointsSpent: null })).meta).toMatch(/analyzed .* ago$/);
  });
  test("an ignored override file outranks every other notice and names the file", () => {
    const warning = "bmpl: ignoring /home/me/.config/bmpl/defensives.json: Unexpected token";
    expect(panelModel(dd({ tableMissing: true, staleTable: true, truncated: true }), 0, warning).notice).toBe(`Your defensives.json is ignored: ${warning}`);
    expect(panelModel(dd(), 0, null).notice).toBeNull();
    expect(tableWarningText(warning)).toBe(`Your defensives.json is ignored: ${warning}`);
    expect(tableWarningText(null)).toBeNull();
    expect(tableWarningText(undefined)).toBeNull();
  });
});

describe("defensivesCell", () => {
  test("usage and avoidable share; dash without analyses", () => {
    expect(defensivesCell(payload([dd()]))).toEqual({ text: "87% · 1/1 avoidable", value: 0.87 });
    expect(defensivesCell(payload([]))).toEqual({ text: "—", value: null });
    const noDeaths = payload([dd({ countedDeaths: 0, avoidableDeaths: 0 })]);
    noDeaths.deepdiveSummary = { tableWarning: null, analyzedRuns: 1, majorUsage: 0.5, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 };
    expect(defensivesCell(noDeaths)).toEqual({ text: "50% · no deaths", value: 0.5 });
  });
});

describe("originLabel / tableUsedText", () => {
  test("labels every non-shipped origin", () => {
    expect(originLabel("shipped")).toBeNull();
    expect(originLabel("override")).toBe("override");
    expect(originLabel("shared")).toBe("shared");
    expect(originLabel("pending")).toBe("pending review");
  });
  test("the table line counts the local override or the hosted layers", () => {
    const o = (origin: EntryOrigin) => ({ origin });
    expect(tableUsedText([o("shipped"), o("shipped")], "Holy Paladin")).toBe("Table used: Holy Paladin · 2 entries");
    expect(tableUsedText([o("shipped"), o("override")], "Holy Paladin")).toBe("Table used: Holy Paladin · 2 entries · 1 from your override");
    expect(tableUsedText([o("shared"), o("pending"), o("shipped")], "Holy Paladin")).toBe("Table used: Holy Paladin · 3 entries · 1 shared · 1 pending review");
    expect(tableUsedText([o("shared")], "Holy Paladin")).toBe("Table used: Holy Paladin · 1 entries · 1 shared");
  });
});
