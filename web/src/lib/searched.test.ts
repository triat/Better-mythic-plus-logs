import { describe, expect, test } from "bun:test";
import type { AdminCharacter } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { NO_FILTERS, ageText, classColorOf, cloud, overview, regionsOf, searchedTable, tabOf, tabStep, verdictCounts } from "./searched.ts";

const tFr = makeT(fr, "fr");
const NOW = 1_800_000_000_000;
const H = 3_600_000;
const D = 24 * H;
const TH = { invite: 70, maybe: 40 };

const ch = (name: string, o: Partial<AdminCharacter> = {}): AdminCharacter => ({
  region: "eu", realm: "ysondre", name: name.toLowerCase(), displayName: name, displayRealm: "Ysondre", classId: null, className: null,
  spec: "Elemental", role: "dps", verdict: "maybe", score: 50, targetLevel: 15, members: 1, lookedUpAt: NOW - H, rio: 3000,
  bestTimed: 15, bestDungeon: "Priory", runs: 10, ...o,
});

const list = [
  ch("Vacha", { verdict: "invite", score: 78, rio: 3400, members: 4, lookedUpAt: NOW - 3 * 60_000, classId: 9 }),
  ch("Kess", { role: "tank", spec: "Blood", verdict: "maybe", score: 54, rio: 3100, lookedUpAt: NOW - 2 * H, className: "Death Knight" }),
  ch("Lumiel", { role: "healer", spec: "Discipline", verdict: "invite", score: 81, rio: 3300, region: "us", lookedUpAt: NOW - 3 * D, members: 2 }),
  ch("Thrakk", { verdict: "pass", score: 31, rio: 3350, lookedUpAt: NOW - 10 * D, targetLevel: 16 }),
  ch("Ghost", { verdict: null, score: null, targetLevel: null, members: 0, rio: null, spec: null, role: null, lookedUpAt: NOW - 40 * D }),
];

describe("searched characters", () => {
  test("tabs: the table by default, ← → Home End", () => {
    expect([tabOf(""), tabOf("?tab=cloud"), tabOf("?tab=nope")]).toEqual(["table", "cloud", "table"]);
    expect([tabStep("table", "ArrowRight"), tabStep("table", "ArrowLeft"), tabStep("cloud", "Home"), tabStep("table", "End"), tabStep("table", "a")])
      .toEqual(["overview", "cloud", "table", "cloud", null]);
  });
  test("class colour from the WCL id, else Raider.IO's class name, else none", () => {
    expect(classColorOf(list[0]!)).toMatch(/^#/);
    expect(classColorOf(list[1]!)).toMatch(/^#/);
    expect(classColorOf(list[4]!)).toBeNull();
  });
  test("table: verdict counts under the other filters, search without accents, sort, paging", () => {
    expect(verdictCounts(list, { ...NO_FILTERS, role: "dps" })).toEqual({ all: 2, invite: 1, maybe: 0, pass: 1, none: 0 });
    expect(verdictCounts(list, NO_FILTERS)).toEqual({ all: 5, invite: 2, maybe: 1, pass: 1, none: 1 });
    expect(searchedTable(tEn, list, NO_FILTERS, "recent", 1).rows.map((c) => c.displayName)).toEqual(["Vacha", "Kess", "Lumiel", "Thrakk", "Ghost"]);
    expect(searchedTable(tEn, list, NO_FILTERS, "score", 1).rows.map((c) => c.displayName)).toEqual(["Lumiel", "Vacha", "Kess", "Thrakk", "Ghost"]);
    expect(searchedTable(tEn, list, { ...NO_FILTERS, verdict: "none" }, "recent", 1).rows.map((c) => c.displayName)).toEqual(["Ghost"]);
    expect(searchedTable(tEn, list, { ...NO_FILTERS, query: "DÉATH" }, "recent", 1).rows.map((c) => c.displayName)).toEqual(["Kess"]);
    expect(searchedTable(tEn, list, { ...NO_FILTERS, region: "us" }, "recent", 1).rows.map((c) => c.displayName)).toEqual(["Lumiel"]);
    expect(searchedTable(tEn, list, NO_FILTERS, "recent", 9, 2)).toMatchObject({ page: 3, pages: 3, total: 5, range: "5–5 of 5" });
    expect(regionsOf(list)).toEqual(["eu", "us"]);
  });
  test("ages", () => {
    expect([ageText(tEn, NOW - 3 * 60_000, NOW), ageText(tEn, NOW - 5 * H, NOW), ageText(tEn, NOW - 3 * D, NOW), ageText(tEn, null, NOW)])
      .toEqual(["3 min ago", "5 h ago", "3 d ago", "—"]);
    expect(ageText(tFr, NOW - 2 * H, NOW)).toBe("il y a 2 h");
  });
  test("overview: the period, medians by role, verdict shares summing to 100, the level, bins against the thresholds, specs", () => {
    const o = overview(list, 30, TH, NOW);
    expect(o.count).toBe(4);
    expect(o.thisWeek).toBe(3);
    expect(o.median).toBe(66);
    expect(o.medianByRole).toEqual({ tank: 54, healer: 81, dps: 55 });
    expect(o.verdicts).toEqual({ invite: 2, maybe: 1, pass: 1, none: 0 });
    expect(o.shares.invite + o.shares.maybe + o.shares.pass).toBe(100);
    expect([o.levelMode, o.levelMin, o.levelMax]).toEqual([15, 15, 16]);
    expect(o.bins.map((b) => b.verdict)).toEqual(["pass", "pass", "pass", "pass", "maybe", "maybe", "maybe", "invite", "invite", "invite"]);
    expect(o.bins[7]!.n + o.bins[8]!.n).toBe(2);
    expect(o.specs[0]).toMatchObject({ spec: "Elemental", n: 2, width: 100 });
    expect(overview(list, 0, TH, NOW).count).toBe(5);
    expect(overview(list, 7, TH, NOW).count).toBe(3);
  });
  test("cloud: both scores only, the Raider.IO axis rounded to hundreds, the bands, the widest gaps", () => {
    const c = cloud(list, "all", TH);
    expect(c.points).toHaveLength(4);
    expect(c.missing).toBe(1);
    expect([c.rioMin, c.rioMax, c.ticks]).toEqual([3100, 3400, [3100, 3200, 3300, 3400]]);
    expect(c.points.find((p) => p.character.displayName === "Vacha")).toMatchObject({ x: 78, y: 0 });
    expect([c.maybeAt, c.inviteAt]).toEqual([40, 70]);
    // Thrakk (lowest score, third Raider.IO) and Lumiel (highest score, second lowest Raider.IO) disagree most.
    expect(c.gaps.slice(0, 2).map((g) => g.displayName).sort()).toEqual(["Lumiel", "Thrakk"]);
    expect(cloud(list, "tank", TH).points.map((p) => p.character.displayName)).toEqual(["Kess"]);
  });
});
