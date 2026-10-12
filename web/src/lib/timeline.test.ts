import { describe, expect, test } from "bun:test";
import type { DefensiveUse, RunDefensives } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { DEFAULT_LAYERS, timelineView } from "./timeline.ts";
import type { LayerKey } from "./timeline.ts";
import { sig, temple, templeAnalysis } from "./vachaman.fixture.ts";

const tFr = makeT(fr, "fr");
const NB = " ";
const ALL: Record<LayerKey, boolean> = { deaths: true, dispo: true, cd: true, casts: true, control: true };

describe("timelineView", () => {
  test("the mockup's Temple of Sethraliss run (French)", () => {
    const v = timelineView(tFr, "fr", temple, templeAnalysis, false, DEFAULT_LAYERS, "d1")!;
    expect(v.durationMs).toBe(1_831_000);
    expect(v.ticks).toEqual([
      { leftPct: 0, label: "0:00" }, { leftPct: 16.38, label: "5:00" }, { leftPct: 32.77, label: "10:00" },
      { leftPct: 49.15, label: "15:00" }, { leftPct: 65.54, label: "20:00" }, { leftPct: 81.92, label: "25:00" },
      { leftPct: 98.31, label: "30:00" },
    ]);
    expect(v.chips.map((c) => [c.key, c.label, c.count, c.on, c.disabled, c.analyse])).toEqual([
      ["deaths", "Morts", "3", true, null, false],
      ["dispo", "Défensif dispo à la mort", "1/3", true, null, false],
      ["cd", "Recharges majeures à la mort", "3", true, null, false],
      ["casts", "Casts de défensifs", "13", false, null, false],
      ["control", "Contrôle", "—", false, "Non récupéré pour un candidat", false],
    ]);
    expect(v.lanes.map((l) => l.key)).toEqual(["deaths", "dispo", "cd"]);
    const [deaths, dispo, cd] = v.lanes;
    expect(deaths!.markers).toEqual([
      { id: "d0", leftPct: 6.17, kind: "death", title: "1:53 · Ground Pound" },
      { id: "d1", leftPct: 45.06, kind: "death-bad", title: "13:45 · Storm Strikes" },
      { id: "d2", leftPct: 58.44, kind: "death", title: "17:50 · Spark Step" },
    ]);
    expect(dispo!.markers.map((m) => [m.id, m.kind, m.title])).toEqual([
      ["d0", "none", "Aucun défensif majeur disponible"],
      ["d1", "dispo", "Astral Shift disponible"],
      ["d2", "none", "Aucun défensif majeur disponible"],
    ]);
    expect(cd!.bars).toEqual([
      { leftPct: 6.17, widthPct: 2.24, title: "Astral Shift en recharge 41 s après 1:53" },
      { leftPct: 45.06, widthPct: 5.13, title: "Earth Elemental en recharge 94 s après 13:45" },
      { leftPct: 58.44, widthPct: 1.75, title: "Astral Shift en recharge 32 s après 17:50" },
    ]);
    expect(v.events).toEqual(["d0", "d1", "d2"]);
    expect(v.callout).toEqual({
      id: "d1", time: "13:45", title: "Mort évitable · Storm Strikes", hits: `Storm Strikes 100${NB}%`,
      state: "Astral Shift disponible et non utilisé · Earth Elemental en recharge (encore 94 s) · dispo : Silvermoon Health Potion",
      bad: true,
    });
    expect(v.moments).toEqual([
      { id: "d0", time: "1:53", text: "Mort · Ground Pound — aucun défensif majeur disponible", bad: false },
      { id: "d1", time: "13:45", text: "Mort évitable · Storm Strikes — Astral Shift était disponible", bad: true },
      { id: "d2", time: "17:50", text: "Mort · Spark Step — aucun défensif majeur disponible", bad: false },
      { id: null, time: "run", text: "Aucune potion de soin", bad: false },
    ]);
    expect(v.summary).toBe("3 morts, dont une évitable : à 13:45, Astral Shift était prêt et n'a pas servi.");
  });

  test("callout of a plain death, English", () => {
    const v = timelineView(tEn, "en", temple, templeAnalysis, false, DEFAULT_LAYERS, "d0")!;
    expect(v.callout).toEqual({
      id: "d0", time: "1:53", title: "Death · Ground Pound", hits: "Ground Pound 71% · Slither Strike 29%",
      state: "Astral Shift on cooldown (41 s left) · available: Silvermoon Health Potion", bad: false,
    });
    expect(v.summary).toBe("3 deaths, one avoidable: at 13:45, Astral Shift was ready and went unused.");
    expect(timelineView(tEn, "en", temple, templeAnalysis, false, DEFAULT_LAYERS, "nope")!.callout).toBeNull();
    expect(timelineView(tEn, "en", temple, templeAnalysis, false, DEFAULT_LAYERS, null)!.callout).toBeNull();
  });

  test("casts lane, in time order", () => {
    const v = timelineView(tFr, "fr", temple, templeAnalysis, false, ALL, null)!;
    expect(v.lanes.map((l) => l.key)).toEqual(["deaths", "dispo", "cd", "casts"]);
    const casts = v.lanes[3]!.markers;
    expect(casts).toHaveLength(13);
    expect(casts[0]).toEqual({ id: "c0", leftPct: 1.75, kind: "cast", title: "0:32 · Astral Shift" });
    expect(casts[6]!.title).toBe("12:11 · Earth Elemental");
  });

  test("no analysis: the defensive layers are disabled and offer the analysis", () => {
    const v = timelineView(tFr, "fr", temple, null, false, ALL, "d1")!;
    for (const k of ["dispo", "cd", "casts"] as const) {
      expect(v.chips.find((c) => c.key === k)).toMatchObject({ on: false, count: "—", analyse: true, disabled: "Analyse le run pour voir les défensifs à la mort" });
    }
    expect(v.lanes.map((l) => l.key)).toEqual(["deaths"]);
    expect(v.lanes[0]!.markers.map((m) => m.kind)).toEqual(["death", "death", "death"]);
    expect(v.callout).toMatchObject({ title: "Mort · Storm Strikes", hits: "Storm Strikes", state: "Analyse le run pour voir les défensifs", bad: false });
    expect(v.moments[1]).toEqual({ id: "d1", time: "13:45", text: "Mort · Storm Strikes", bad: false });
    expect(v.summary).toBe("3 morts");
  });

  test("an analysis saved before castsAtMs: casts disabled, neutral wording", () => {
    const old = {
      ...templeAnalysis,
      defensives: templeAnalysis.defensives.map(({ castsAtMs: _drop, ...d }) => d as DefensiveUse),
    } as RunDefensives;
    const v = timelineView(tFr, "fr", temple, old, false, ALL, null)!;
    expect(v.chips.find((c) => c.key === "casts")).toEqual({
      key: "casts", label: "Casts de défensifs", count: "—", on: false, analyse: false,
      disabled: "Données absentes de cette analyse — réanalyse pour les voir",
    });
    expect(v.lanes.map((l) => l.key)).toEqual(["deaths", "dispo", "cd"]);
  });

  test("control is always disabled, worded for the owner", () => {
    const v = timelineView(tFr, "fr", temple, templeAnalysis, true, ALL, null)!;
    expect(v.chips.find((c) => c.key === "control")).toMatchObject({ on: false, disabled: "Horodatage du contrôle : pas encore récupéré", count: "—" });
  });

  test("no signals or no duration → null; no deaths → no summary", () => {
    expect(timelineView(tEn, "en", { ...temple, signals: undefined }, null, false, DEFAULT_LAYERS, null)).toBeNull();
    expect(timelineView(tEn, "en", { ...temple, signals: sig({ fightDurationMs: 0 }) }, null, false, DEFAULT_LAYERS, null)).toBeNull();
    const clean = timelineView(tEn, "en", { ...temple, signals: sig() }, null, false, DEFAULT_LAYERS, null)!;
    expect(clean.summary).toBeNull();
    expect(clean.events).toEqual([]);
    expect(clean.moments).toEqual([]);
  });

  test("a cooldown bar never runs past the end of the track", () => {
    const late = {
      ...templeAnalysis,
      deaths: [{ ...templeAnalysis.deaths[2]!, onCooldown: [{ name: "Earth Elemental", readyInS: 900 }] }],
    };
    const run = { ...temple, signals: sig({ deaths: { count: 1, groupTotal: 1, events: [temple.signals!.deaths.events[2]!] } }) };
    const bar = timelineView(tEn, "en", run, late, false, DEFAULT_LAYERS, null)!.lanes.find((l) => l.key === "cd")!.bars[0]!;
    expect(bar.leftPct + bar.widthPct).toBeLessThanOrEqual(100);
  });
});
