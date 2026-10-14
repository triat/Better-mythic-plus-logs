import { describe, expect, test } from "bun:test";
import { signalSummary } from "../../../src/signals/summary.ts";
import type { RioProfile } from "../../../src/signals/types.ts";
import type { LookupPayload, MPlusRun } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { dungeonGrid, heatOfDeaths, heatOfDelta } from "./dungeonGrid.ts";
import { profileHeader } from "./profile.ts";
import { payload, runs, sig } from "./vachaman.fixture.ts";

const tFr = makeT(fr, "fr");
const NB = "\u202f";

const rio = {
  profileUrl: "https://raider.io/characters/eu/ysondre/Vachâman", itemLevel: 328.4,
  seasons: [{ slug: "s2", all: 3852, dps: 3852, healer: 0, tank: 0 }, { slug: "s1", all: 3101.8, dps: 3101.8, healer: 0, tank: 0 }],
  derived: { recentTimed: 18, recentTotal: 20, runsLast7d: 9, lastRunAt: 0 },
} as unknown as RioProfile;

/** The fixture with what the tiles and the header read: the server's own summary, Raider.IO, the evaluation. */
const full = (over: Partial<LookupPayload> = {}): LookupPayload => {
  const base = payload(over);
  return {
    ...base,
    zone: { id: 45, name: "Mythic+ Season 2", partition: 1 },
    metricAutoSelected: false, alternateMetricHasData: false, specFilter: null, runsIndexed: 9, targetAutoDetected: false,
    rio,
    summary: signalSummary(base.perDungeon.runs as never, rio),
    evaluation: { role: "dps", targetLevel: 19, axes: [], global: 77, verdict: "invite", runsUsed: 8, analyzedRuns: 1, configVersion: "x" },
    ...over,
  } as LookupPayload;
};

describe("heat tints", () => {
  test("vs peers, lower is better, at the edges", () => {
    expect([-50, -20, -19.9, -5, -4.9, 0, 19.9, 20, 49.9, 50, 120].map(heatOfDelta))
      .toEqual(["heat-5", "heat-5", "heat-4", "heat-4", "heat-3", "heat-3", "heat-3", "heat-2", "heat-2", "heat-1", "heat-1"]);
  });
  test("deaths: group ≥ 8, group ≥ 5 or own > 0, else neutral", () => {
    expect(heatOfDeaths(0, 8)).toBe("heat-1");
    expect(heatOfDeaths(0, 5)).toBe("heat-2");
    expect(heatOfDeaths(1, 1)).toBe("heat-2");
    expect(heatOfDeaths(0, 4)).toBe("heat-3");
    expect(heatOfDeaths(0, 7)).toBe("heat-2");
  });
});

describe("dungeonGrid", () => {
  test("DPS rows (French): key level first, two-line cells, kicks against the best dungeon", () => {
    const v = dungeonGrid(tFr, "fr", full());
    expect(v.utilLabel).toBe("Kicks");
    expect(v.rows.map((r) => r.level)).toEqual(["+20", "+20", "+20", "+20", "+20", "+19", "+19", "+19"]);
    const ts = v.rows[0]!;
    expect(ts).toMatchObject({
      key: "TS:1", name: "Temple of Sethraliss", level: "+20", upgrade: { text: "✓ +1", timed: true }, time: "30:31",
      deaths: { text: "3 / 5", cls: "heat-2" },
      util: { text: "37", barPct: Math.round((37 / 85) * 100) },
      avoidable: { text: `−100${NB}%`, cls: "heat-5" },
      dtps: { text: `+14${NB}%`, cls: "heat-3" },
      parse: { text: `72,2${NB}%`, tier: "blue", amount: "400.0k" },
      analysed: true, hasSignals: true,
    });
    expect(ts.sub).toBe(new Intl.DateTimeFormat("fr", { day: "numeric", month: "short" }).format(new Date(runs[0]!.startTime)));
    expect(ts.facts).toEqual([
      { label: "Morts (lui / groupe)", value: "3 / 5" },
      { label: "Kicks", value: "37/146" },
      { label: "Évitable vs pairs", value: `−100${NB}%` },
      { label: "DTPS vs pairs", value: `+14${NB}%` },
      { label: "DPS · parse", value: `400.0k · 72,2${NB}%` },
    ]);
    expect(ts.note).not.toBe(tFr("cand.dungeons.notAnalysed"));
    const mr = v.rows.find((r) => r.name === "Murder Row")!;
    expect(mr.util).toEqual({ text: "85", barPct: 100 });
    expect(mr.note).toBe("Run non analysé : l'analyse ajoute les morts détaillées et l'usage des défensifs.");
    expect(mr.deaths).toEqual({ text: "0 / 2", cls: "heat-3" });
    expect(v.rows.find((r) => r.name === "Altar of Fangs")!.avoidable).toEqual({ text: `−26${NB}%`, cls: "heat-5" });
    expect(v.rows.find((r) => r.name === "Den of Nalorakk")!.avoidable).toEqual({ text: `+11${NB}%`, cls: "heat-3" });
    expect(v.missing).toEqual(["Eco-Dome Al'dani"]);
    expect(v.legend).toBe("Pairs = les autres joueurs des mêmes logs. La barre des kicks compare les donjons entre eux.");
  });

  test("the analysed note is panelModel's headline", () => {
    const ts = dungeonGrid(tEn, "en", full()).rows[0]!;
    expect(ts.note).toBe("majors used 60% of possible · 1/3 deaths with something at hand");
  });

  test("a run in another spec says so under the dungeon's name", () => {
    const other: MPlusRun = { ...runs[1]!, spec: "Restoration" };
    const v = dungeonGrid(tEn, "en", full({ perDungeon: { ...payload().perDungeon, runs: [runs[0]!, other] } }));
    expect(v.rows[1]!.sub.endsWith(" · Restoration")).toBe(true);
    expect(v.rows[0]!.sub.includes("·")).toBe(false);
  });

  test("healer columns: dispels, and the parse read last", () => {
    const healerRuns = runs.map((r, i) => ({ ...r, signals: sig({ ...r.signals!, role: "healer", dispels: { count: 10 + i * 5, available: true } }) }));
    const v = dungeonGrid(tFr, "fr", full({
      perDungeon: { ...payload().perDungeon, runs: healerRuns },
      evaluation: { role: "healer", targetLevel: 19, axes: [], global: 82, verdict: "invite", runsUsed: 8, analyzedRuns: 0, configVersion: "x" },
    } as Partial<LookupPayload>));
    expect(v.utilLabel).toBe("Dispels");
    const ts = v.rows.find((r) => r.name === "Temple of Sethraliss")!;
    expect(ts.util).toEqual({ text: "10", barPct: Math.round((10 / 45) * 100) });
    expect(ts.facts[1]).toEqual({ label: "Dispels", value: "10" });
    expect(v.notes[1]!.label).toBe("Dispels");
    expect(v.notes[1]!.value).toBe("27,5 / run");
    expect(v.notes[1]!.sub.startsWith("pic à 45 (Murder Row)")).toBe(true);
    expect(v.notes[3]!.sub.endsWith("à lire en dernier pour un soigneur")).toBe(true);
  });

  test("a dungeon without signals: level, time and parse only", () => {
    const bare: MPlusRun = { ...runs[2]!, signals: undefined };
    const row = dungeonGrid(tEn, "en", full({ perDungeon: { ...payload().perDungeon, runs: [bare] } })).rows[0]!;
    expect(row).toMatchObject({
      level: "+20", upgrade: { text: "✓", timed: true }, time: "31:33", hasSignals: false,
      deaths: { text: "—", cls: "" }, util: null, avoidable: null, dtps: null,
      parse: { text: "64.4%", tier: "blue", amount: "400.0k" },
    });
    expect(row.facts).toEqual([{ label: "DPS · parse", value: "400.0k · 64.4%" }]);
  });

  test("notes strip (English)", () => {
    const v = dungeonGrid(tEn, "en", full());
    expect(dungeonGrid(tFr, "fr", full()).notes[2]!.sub).toBe(`évitable −33${NB}% vs pairs · DTPS −1${NB}% vs pairs`);
    expect(v.notes.map((n) => [n.label, n.value])).toEqual([
      ["Group deaths", "2.6 / run"],
      ["Kicks", "47.9 / run"],
      ["Own deaths", "0.6 / run"],
      ["Median DPS parse", "58.0%"],
    ]);
    expect(v.notes[0]!.sub).toBe("most in Temple of Sethraliss +20: 5 · timed 8/8 · Raider.IO recent runs 18/20 timed");
    expect(v.notes[0]!.tone).toBe("neutral");
    expect(v.notes[1]).toMatchObject({ sub: "peak 85 (Murder Row) · kicks +1 pts vs peers", tone: "better" });
    expect(v.notes[2]).toMatchObject({ sub: "avoidable −33% vs peers · DTPS −1% vs peers", tone: "better" });
    expect(v.notes[3]).toMatchObject({ sub: "median DPS 400.0k", tone: "tier-blue" });
  });

  test("the avoidable note names the one dungeon well above peers", () => {
    const spiked = runs.map((r) => r.encounterName !== "Altar of Fangs" ? r
      : { ...r, signals: { ...r.signals!, avoidableDamage: { ...r.signals!.avoidableDamage!, perMinute: 50_000 * 1.92 } } });
    const v = dungeonGrid(tFr, "fr", full({ perDungeon: { ...payload().perDungeon, runs: spiked } }));
    expect(v.notes[2]!.sub.startsWith(`évitable −25${NB}% vs pairs, sauf Altar of Fangs +92${NB}%`)).toBe(true);
    expect(v.rows.find((r) => r.name === "Altar of Fangs")!.avoidable).toEqual({ text: `+92${NB}%`, cls: "heat-1" });
  });

  test("every value the signal tiles show is in the notes strip or a row's facts (the header keeps ilvl and last season)", () => {
    const p = full();
    const v = dungeonGrid(tEn, "en", p);
    const fields = [
      ...v.notes.flatMap((n) => [n.value, n.sub]),
      ...v.rows.flatMap((r) => r.facts.map((f) => f.value)),
    ];
    const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A whole field, or a run of words inside one: never a fragment of a longer number or word.
    const inField = (value: string) => {
      const re = new RegExp(`(^|[\\s(])${escape(value)}($|[\\s)·,])`);
      return fields.some((f) => f === value || re.test(f));
    };
    const header = profileHeader(tEn, "en", p).facts.map((f) => f.value);
    // Values the pre-redesign tiles (`lib/tiles.ts`, removed in phase 4) showed for this fixture: [label, value].
    const ts: [string, string][] = [
      ["Median DPS", "400.0k"], ["Median parse", "58.0%"], ["Timed (shown)", "8/8"], ["Avg deaths", "0.6"],
      ["Δ DTPS vs peers", "−1%"], ["Avoidable vs peers", "−33%"], ["Kicks vs peers", "+1 pts"], ["ilvl", "328"],
      ["RIO recent timed", "18/20"], ["Prev season", "3102"],
    ];
    for (const [label, value] of ts) {
      const inHeader = label === "ilvl" || label === "Prev season";
      if (inHeader) expect(header).toContain(value);
      else expect({ tile: label, found: inField(value) }).toEqual({ tile: label, found: true });
    }
  });
});
