import { describe, expect, test } from "bun:test";
import type { EntryOrigin, LookupPayload, ProposalSummary, RunDefensives } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  actionLabels,
  analysisFor,
  costText,
  defensivesCell,
  originDot,
  originLabel,
  originSuffix,
  panelModel,
  patchText,
  proposalLines,
  tableUsedParts,
  tableUsedText,
  tableWarningText,
  unanalyzedRuns,
} from "./deepdive.ts";

const tFr = makeT(fr, "fr");

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
    expect(costText(tEn, 1)).toBe("~3 pts");
    expect(costText(tEn, 8)).toBe("~24 pts");
    expect(costText(tFr, 8)).toBe("~24 pts");
  });
});

describe("panelModel", () => {
  test("usage rows, deaths, audit and headline", () => {
    const m = panelModel(tEn, dd(), 1_000_000 + 2 * 3600_000);
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
    expect(m.tableParts.map((p) => p.text).join(" · ")).toBe("Table used: Holy Paladin · 3 entries · 1 from your override");
    expect(m.notice).toBeNull();
  });
  test("verdict tones and notices", () => {
    expect(panelModel(tEn, dd({ deaths: [{ ...dd().deaths[0]!, verdict: "defensive available" }] })).deaths[0]!.cls).toBe("tone-warn");
    expect(panelModel(tEn, dd({ deaths: [{ ...dd().deaths[0]!, verdict: "nothing available" }] })).deaths[0]!.cls).toBe("tone-good");
    expect(panelModel(tEn, dd({ deaths: [], countedDeaths: 0, avoidableDeaths: 0 })).deathsHeadline).toBe("No deaths");
    expect(panelModel(tEn, dd({ tableMissing: true, defensives: [], majorUsage: null })).notice).toBe("No defensives table for Holy Paladin yet — add entries from the audit below.");
    expect(panelModel(tEn, dd({ staleTable: true })).notice).toBe("The table changed since this run was analyzed — re-analyze to include the new entries.");
    expect(panelModel(tEn, dd({ truncated: true })).notice).toBe("Cast events were truncated (more than 5 pages) — counts may be low.");
    expect(panelModel(tEn, dd({ pointsSpent: null })).meta).toMatch(/analyzed .* ago$/);
  });
  test("an ignored override file outranks every other notice and names the file", () => {
    const warning = "bmpl: ignoring /home/me/.config/bmpl/defensives.json: Unexpected token";
    expect(panelModel(tEn, dd({ tableMissing: true, staleTable: true, truncated: true }), 0, warning).notice).toBe(`Your defensives.json is ignored: ${warning}`);
    expect(panelModel(tEn, dd(), 0, null).notice).toBeNull();
    expect(tableWarningText(tEn, warning)).toBe(`Your defensives.json is ignored: ${warning}`);
    expect(tableWarningText(tEn, null)).toBeNull();
    expect(tableWarningText(tEn, undefined)).toBeNull();
  });
  test("French: verdict words, notices and the table-used line", () => {
    const m = panelModel(tFr, dd(), 1_000_000 + 2 * 3600_000);
    expect(m.title).toBe("Defensives · Holy Paladin");
    expect(m.meta).toBe("analysé il y a 2 h · 3 pts");
    expect(m.deaths[0]!.verdict).toBe("immunité dispo");
    expect(m.deaths[1]!.verdict).toBe("couvert");
    expect(m.majorsText).toBe("majors utilisés à 87 % du possible");
    expect(m.deathsHeadline).toBe("1/1 morts avec un defensive dispo");
    expect(panelModel(tFr, dd({ deaths: [], countedDeaths: 0, avoidableDeaths: 0 })).deathsHeadline).toBe("Aucune mort");
    expect(panelModel(tFr, dd({ staleTable: true })).notice).toBe("La table a changé depuis l'analyse de ce run — ré-analyse pour inclure les nouvelles entrées.");
    expect(tableUsedText(tFr, dd().defensives, "Holy Paladin")).toBe("Table utilisée : Holy Paladin · 3 entrées · 1 de ton override");
  });
});

describe("defensivesCell", () => {
  test("usage and avoidable share; dash without analyses", () => {
    expect(defensivesCell(tEn, payload([dd()]))).toEqual({ text: "87% · 1/1 avoidable", value: 0.87 });
    expect(defensivesCell(tEn, payload([]))).toEqual({ text: "—", value: null });
    const noDeaths = payload([dd({ countedDeaths: 0, avoidableDeaths: 0 })]);
    noDeaths.deepdiveSummary = { tableWarning: null, analyzedRuns: 1, majorUsage: 0.5, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 };
    expect(defensivesCell(tEn, noDeaths)).toEqual({ text: "50% · no deaths", value: 0.5 });
  });
  test("French: the space before % and the translated fragments", () => {
    expect(defensivesCell(tFr, payload([dd()]))).toEqual({ text: "87 % · 1/1 évitables", value: 0.87 });
    const noDeaths = payload([dd({ countedDeaths: 0, avoidableDeaths: 0 })]);
    noDeaths.deepdiveSummary = { tableWarning: null, analyzedRuns: 1, majorUsage: 0.5, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 };
    expect(defensivesCell(tFr, noDeaths)).toEqual({ text: "50 % · aucune mort", value: 0.5 });
  });
});

describe("originLabel / tableUsedText", () => {
  test("labels every non-shipped origin", () => {
    expect(originLabel(tEn, "shipped")).toBeNull();
    expect(originLabel(tEn, "override")).toBe("override");
    expect(originLabel(tEn, "shared")).toBe("shared");
    expect(originLabel(tEn, "pending")).toBe("pending review");
  });
  test("the table line counts the local override or the hosted layers", () => {
    const o = (origin: EntryOrigin) => ({ origin });
    expect(tableUsedText(tEn, [o("shipped"), o("shipped")], "Holy Paladin")).toBe("Table used: Holy Paladin · 2 entries");
    expect(tableUsedText(tEn, [o("shipped"), o("override")], "Holy Paladin")).toBe("Table used: Holy Paladin · 2 entries · 1 from your override");
    expect(tableUsedText(tEn, [o("shared"), o("pending"), o("shipped")], "Holy Paladin")).toBe("Table used: Holy Paladin · 3 entries · 1 shared · 1 pending review");
    expect(tableUsedText(tEn, [o("shared")], "Holy Paladin")).toBe("Table used: Holy Paladin · 1 entries · 1 shared");
  });
});

describe("hosted panel: labels, dots, proposals", () => {
  test("actionLabels: members propose, local and admin edit", () => {
    const p = actionLabels(tEn, "propose");
    expect([p.add("major"), p.ignore, p.editCd, p.remove, p.addSubmit("minor"), p.save]).toEqual(["Propose + major", "Propose ignore", "Propose cd", "Propose removal", "Propose as minor", "Propose"]);
    for (const mode of ["local", "admin"] as const) {
      const l = actionLabels(tEn, mode);
      expect([l.add("major"), l.ignore, l.editCd, l.remove, l.addSubmit("minor"), l.save]).toEqual(["+ major", "Ignore", "Edit cd", "Remove for this spec", "Add as minor", "Save"]);
    }
  });
  test("French actionLabels", () => {
    const p = actionLabels(tFr, "propose");
    expect([p.add("major"), p.ignore, p.editCd, p.remove, p.addSubmit("minor"), p.save]).toEqual(["Proposer + major", "Proposer d'ignorer", "Proposer un cd", "Proposer la suppression", "Proposer en minor", "Proposer"]);
  });
  test("originDot marks shared and pending; originSuffix keeps the text only for a local override", () => {
    expect(originDot("shared")).toBe("dot-shared");
    expect(originDot("pending")).toBe("dot-pending");
    expect(originDot("override")).toBeNull();
    expect(originDot("shipped")).toBeNull();
    expect(originSuffix(tEn, "override")).toBe("override");
    expect(originSuffix(tEn, "shared")).toBeNull();
    expect(originSuffix(tEn, "pending")).toBeNull();
    expect(originSuffix(tEn, "shipped")).toBeNull();
  });
  test("tableUsedParts splits the line so shared / pending counts get their dot", () => {
    const o = (origin: EntryOrigin) => ({ origin });
    expect(tableUsedParts(tEn, [o("shipped"), o("override")], "Holy Paladin")).toEqual([{ text: "Table used: Holy Paladin · 2 entries", dot: null }, { text: "1 from your override", dot: null }]);
    expect(tableUsedParts(tEn, [o("shared"), o("shared"), o("pending"), o("shipped")], "Holy Paladin")).toEqual([
      { text: "Table used: Holy Paladin · 4 entries", dot: null }, { text: "2 shared", dot: "dot-shared" }, { text: "1 pending review", dot: "dot-pending" },
    ]);
    expect(tableUsedParts(tEn, [o("shipped"), o("override")], "Holy Paladin").map((p) => p.text).join(" · ")).toBe(tableUsedText(tEn, [o("shipped"), o("override")], "Holy Paladin"));
  });
  test("patchText describes a patch", () => {
    expect(patchText(tEn, { id: 1, ignore: true })).toBe("ignore");
    expect(patchText(tEn, { id: 1, cooldownS: 300 })).toBe("cd 300 s");
    expect(patchText(tEn, { id: 1, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 })).toBe("+ minor, cd 25 s, 6 s");
    expect(patchText(tEn, { id: 1 })).toBe("no change");
  });
  test("French patchText", () => {
    expect(patchText(tFr, { id: 1, ignore: true })).toBe("ignorer");
    expect(patchText(tFr, { id: 1, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 })).toBe("+ minor, cd 25 s, 6 s");
    expect(patchText(tFr, { id: 1 })).toBe("aucun changement");
  });
  test("proposalLines: name from the patch or the table, status with age and note", () => {
    const now = 1_000_000 + 2 * 3600_000;
    const proposals: ProposalSummary[] = [
      { id: 3, spellId: 642, status: "pending", patch: { id: 642, cooldownS: 300 }, note: null, createdAt: 1_000_000, decidedAt: null },
      { id: 2, spellId: 1044, status: "rejected", patch: { id: 1044, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 }, note: "It is a freedom, not a defensive.", createdAt: 1_000_000 - 3 * 86400_000, decidedAt: 1_000_000 - 2 * 86400_000 },
      { id: 1, spellId: 498, status: "approved", patch: { id: 498, cooldownS: 60 }, note: null, createdAt: 1_000_000 - 6 * 86400_000, decidedAt: 1_000_000 - 5 * 86400_000 },
      { id: 4, spellId: 9999, status: "pending", patch: { id: 9999, name: "Aura Mastery", ignore: true }, note: null, createdAt: now, decidedAt: null },
      { id: 5, spellId: 8888, status: "pending", patch: { id: 8888, ignore: true }, note: null, createdAt: now, decidedAt: null },
    ];
    expect(proposalLines(tEn, proposals, dd().defensives, now)).toEqual([
      { id: 3, dot: "dot-pending", what: "Divine Shield · cd 300 s", when: "pending · 2h ago" },
      { id: 2, dot: "dot-rejected", what: "Blessing of Freedom · + minor, cd 25 s, 6 s", when: "rejected 2d ago — \"It is a freedom, not a defensive.\"" },
      { id: 1, dot: "dot-approved", what: "Divine Protection · cd 60 s", when: "approved 5d ago" },
      { id: 4, dot: "dot-pending", what: "Aura Mastery · ignore", when: "pending · just now" },
      { id: 5, dot: "dot-pending", what: "spell 8888 · ignore", when: "pending · just now" },
    ]);
  });
  test("French proposalLines", () => {
    const now = 1_000_000 + 2 * 3600_000;
    const proposals: ProposalSummary[] = [
      { id: 3, spellId: 642, status: "pending", patch: { id: 642, cooldownS: 300 }, note: null, createdAt: 1_000_000, decidedAt: null },
      { id: 5, spellId: 8888, status: "pending", patch: { id: 8888, ignore: true }, note: null, createdAt: now, decidedAt: null },
    ];
    expect(proposalLines(tFr, proposals, dd().defensives, now)).toEqual([
      { id: 3, dot: "dot-pending", what: "Divine Shield · cd 300 s", when: "en attente · il y a 2 h" },
      { id: 5, dot: "dot-pending", what: "sort 8888 · ignorer", when: "en attente · à l'instant" },
    ]);
  });
  test("panelModel exposes specClass and tableParts", () => {
    const m = panelModel(tEn, dd(), 1_000_000);
    expect(m.specClass).toBe("Holy Paladin");
    expect(m.tableParts).toEqual([{ text: "Table used: Holy Paladin · 3 entries", dot: null }, { text: "1 from your override", dot: null }]);
  });
});
