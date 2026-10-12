import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { SHEET_TABS, isEditingField, sheetKey, sheetLayout, sheetRuns, sheetTabAfter, trapFocus } from "./runSheet.ts";
import { runListView } from "./runList.ts";
import { NOW, payload, runs } from "./vachaman.fixture.ts";

const tFr = makeT(fr, "fr");
const NB = "\u202f";

describe("sheetRuns", () => {
  test("the mockup's left list: best per dungeon, best parse first, the shown run marked (French)", () => {
    const rows = sheetRuns(tFr, "fr", payload(), "TS:1", NOW);
    expect(rows.length).toBe(runs.length);
    expect(rows[0]).toEqual({
      key: "TS:1", abbr: "TS", name: "Temple of Sethraliss", level: "+20",
      deaths: { text: "3 morts", tone: "pass" }, parse: { text: `72,2${NB}%`, tier: "blue" }, on: true,
    });
    expect(rows.filter((r) => r.on).map((r) => r.key)).toEqual(["TS:1"]);
    const parses = rows.map((r) => Number(r.parse.text.replace(",", ".").replace(/[^\d.]/g, "")));
    expect(parses).toEqual([...parses].sort((a, b) => b - a));
  });

  test("death tones: two and more pass, one neutral, none dim; no signals: a dash", () => {
    const p = payload();
    const noSignals = { ...p.perDungeon.runs[1]!, signals: undefined };
    const q = payload({ perDungeon: { ...p.perDungeon, runs: [p.perDungeon.runs[0]!, noSignals, ...p.perDungeon.runs.slice(2)] } });
    const rows = sheetRuns(tEn, "en", q, null, NOW);
    expect(rows.some((r) => r.on)).toBe(false);
    const byDeaths = (n: number) => runs.filter((r) => r !== runs[1] && r.signals!.deaths.count === n).map((r) => `${r.reportCode}:1`);
    for (const k of byDeaths(1)) expect(rows.find((r) => r.key === k)!.deaths).toEqual({ text: "1 death", tone: "neutral" });
    for (const k of byDeaths(0)) expect(rows.find((r) => r.key === k)!.deaths).toEqual({ text: "0 deaths", tone: "dim" });
    expect(rows.find((r) => r.key === `${runs[1]!.reportCode}:1`)!.deaths).toEqual({ text: "—", tone: "dim" });
  });
});

describe("sheetRuns — every run of the profile", () => {
  test("a run the Runs tab's \"with deaths\" filter hides is still listed and marked", () => {
    const p = payload();
    const deathless = p.perDungeon.runs.find((r) => r.signals!.deaths.count === 0)!;
    const key = `${deathless.reportCode}:${deathless.fightID}`;
    expect(runListView(tEn, "en", p, "deaths", "parse", NOW).rows.some((r) => r.key === key)).toBe(false);
    const rows = sheetRuns(tEn, "en", p, key, NOW);
    expect(rows.length).toBe(p.perDungeon.runs.length);
    expect(rows.filter((r) => r.on).map((r) => r.key)).toEqual([key]);
  });
});

describe("sheetKey", () => {
  test("Escape closes from inside or from the body, but only leaves a field being edited", () => {
    expect(sheetKey("Escape", "inside", false)).toBe("close");
    expect(sheetKey("Escape", "none", false)).toBe("close");
    expect(sheetKey("Escape", "inside", true)).toBe("leave-field");
    expect(sheetKey("Escape", "none", true)).toBe("close");
  });
  test("Tab is trapped from inside and from the body; another dialog over the sheet keeps its keys", () => {
    expect(sheetKey("Tab", "inside", false)).toBe("trap");
    expect(sheetKey("Tab", "none", false)).toBe("trap");
    expect(sheetKey("Escape", "outside", false)).toBeNull();
    expect(sheetKey("Tab", "outside", false)).toBeNull();
    expect(sheetKey("Enter", "inside", false)).toBeNull();
  });
  test("a field being edited: text inputs, text areas, list boxes; not a checkbox or a button", () => {
    expect(isEditingField("INPUT", null)).toBe(true);
    expect(isEditingField("input", "number")).toBe(true);
    expect(isEditingField("TEXTAREA", null)).toBe(true);
    expect(isEditingField("SELECT", null)).toBe(true);
    expect(isEditingField("INPUT", "checkbox")).toBe(false);
    expect(isEditingField("BUTTON", null)).toBe(false);
    expect(isEditingField("SECTION", null)).toBe(false);
  });
});

describe("sheetLayout", () => {
  test("min(100vw, max(960px, 72vw)); the run list only with 240 px left; full width under 960 px", () => {
    expect(sheetLayout(1440)).toEqual({ panel: 1037, list: true, full: false });
    expect(sheetLayout(1200)).toEqual({ panel: 960, list: true, full: false });
    expect(sheetLayout(1199)).toEqual({ panel: 960, list: false, full: false });
    expect(sheetLayout(1024)).toEqual({ panel: 960, list: false, full: false });
    expect(sheetLayout(960)).toEqual({ panel: 960, list: false, full: true });
    expect(sheetLayout(390)).toEqual({ panel: 390, list: false, full: true });
  });
});

describe("trapFocus", () => {
  test("wraps at both ends, pulls focus back from outside, leaves the middle to the browser", () => {
    expect(trapFocus(4, 5, false)).toBe(0);
    expect(trapFocus(0, 5, true)).toBe(4);
    expect(trapFocus(2, 5, false)).toBeNull();
    expect(trapFocus(2, 5, true)).toBeNull();
    expect(trapFocus(-1, 5, false)).toBe(0);
    expect(trapFocus(-1, 5, true)).toBe(4);
    expect(trapFocus(0, 1, false)).toBe(0);
    expect(trapFocus(-1, 0, false)).toBeNull();
  });
});

describe("sheetTabAfter", () => {
  test("arrows wrap, Home / End, other keys ignored", () => {
    expect(SHEET_TABS).toEqual(["spells", "avoidable"]);
    expect(sheetTabAfter("spells", "ArrowRight")).toBe("avoidable");
    expect(sheetTabAfter("avoidable", "ArrowRight")).toBe("spells");
    expect(sheetTabAfter("spells", "ArrowLeft")).toBe("avoidable");
    expect(sheetTabAfter("avoidable", "Home")).toBe("spells");
    expect(sheetTabAfter("spells", "End")).toBe("avoidable");
    expect(sheetTabAfter("spells", "Enter")).toBeNull();
  });
});
