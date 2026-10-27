import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import type { Evaluation, LookupPayload } from "../types.ts";
import { compactReliability, crossedThreshold, isLowReliability, reliabilityLine, reliabilityView, spreadOf, unprovenOf } from "./reliability.ts";

const tFr = makeT(fr, "fr");
const th = { invite: 70, maybe: 30, minRuns: 3 };

const ev = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 19, axes: [], global: 66, verdict: "maybe", runsUsed: 8, analyzedRuns: 0, configVersion: "10",
  level: { floor: 17, best: 16, atTarget: 0, proven: false },
  range: {
    low: 58, high: 74,
    without: [58, 63, 65, 66, 67, 67, 68, 74].map((score, i) => ({ reportCode: `R${i}`, fightID: 1, score })),
  },
  ...over,
});

const run = (i: number, encounterName: string, keyLevel: number) =>
  ({ reportCode: `R${i}`, fightID: 1, encounterName, keyLevel }) as LookupPayload["perDungeon"]["runs"][number];
const payload = {
  perDungeon: { runs: [run(0, "Ara-Kara", 15), run(7, "Priory of the Sacred Flame", 16)] },
  prevLevelBest: null,
} as unknown as Pick<LookupPayload, "perDungeon" | "prevLevelBest">;

describe("reliability", () => {
  test("spread and unproven, as the server's history summary computes them", () => {
    expect(spreadOf(ev())).toBe(8);
    expect(spreadOf(ev({ range: null }))).toBeNull();
    expect(unprovenOf(ev())).toBe(true);
    expect(unprovenOf(ev({ level: undefined }))).toBeNull();
  });

  test("the range straddles INVITE first, then MAYBE; a range inside one verdict crosses nothing", () => {
    expect(crossedThreshold(ev(), th)).toBe("invite");
    expect(crossedThreshold(ev({ range: { low: 25, high: 40, without: [] } }), th)).toBe("maybe");
    expect(crossedThreshold(ev({ range: { low: 79, high: 85, without: [] } }), th)).toBeNull();
  });

  test("low reliability: an unproven level or a range that decides the verdict; never for NOT ENOUGH DATA", () => {
    expect(isLowReliability(ev(), th)).toBe(true);
    const proven = { floor: 17, best: 20, atTarget: 5, proven: true };
    expect(isLowReliability(ev({ level: proven }), th)).toBe(true);
    expect(isLowReliability(ev({ level: proven, range: { low: 60, high: 68, without: [] } }), th)).toBe(false);
    expect(isLowReliability(ev({ verdict: "insufficient" }), th)).toBe(false);
  });

  test("the Fiabilité block: level, stability, one dot per run, the run that moves the score most", () => {
    const v = reliabilityView(tEn, ev(), payload, th)!;
    expect(v.level).toEqual({ label: "Level", ok: false, strong: "Not proven at +19", detail: "best run +16, none at +17 or above" });
    expect(v.stability).toEqual({ label: "Stability", strong: "58–74", detail: "crosses INVITE: one run decides" });
    expect(v.dots.map((d) => d.band)).toEqual(["maybe", "maybe", "maybe", "maybe", "maybe", "maybe", "maybe", "invite"]);
    expect(v.note).toBe("One dot = the score without one of the 8 runs. Without Priory of the Sacred Flame +16: 74.");
    expect(reliabilityView(tEn, ev({ verdict: "insufficient" }), payload, th)).toBeNull();
  });

  test("proven and stable, or too few runs for a range", () => {
    const v = reliabilityView(tEn, ev({ level: { floor: 17, best: 21, atTarget: 5, proven: true }, range: { low: 64, high: 68, without: [] } }), payload, th)!;
    expect(v.level).toMatchObject({ ok: true, strong: "Proven at +19", detail: "5 runs at +19 or above" });
    expect(v.stability.detail).toBe("stable");
    const few = reliabilityView(tEn, ev({ range: null }), payload, th)!;
    expect(few.stability).toEqual({ label: "Stability", strong: null, detail: "not measured: 4 runs or more needed" });
    expect(few.dots).toEqual([]);
    expect(few.note).toBeNull();
  });

  test("compact marks for Récents and Live, the Compare line", () => {
    expect(compactReliability(tEn, { spread: 8, unproven: true })).toEqual({ spread: "±8", unproven: "Not proven at your key" });
    expect(compactReliability(tEn, {})).toEqual({ spread: null, unproven: null });
    expect(reliabilityLine(tEn, ev())).toBe("Level ✗ best +16 · Stability 58–74");
    expect(reliabilityLine(tEn, ev({ level: { floor: 17, best: 21, atTarget: 5, proven: true }, range: null }))).toBe("Level ✓ · Stability not measured");
  });

  test("in French", () => {
    const v = reliabilityView(tFr, ev(), payload, th)!;
    expect(v.level.strong).toBe("Non prouvé en +19");
    expect(v.stability.detail).toBe("traverse INVITE : un run décide");
    expect(v.note).toBe("Un point = le score sans un des 8 runs. Sans Priory of the Sacred Flame +16 : 74.");
    expect(reliabilityLine(tFr, ev())).toBe("Niveau ✗ max +16 · Stabilité 58–74");
  });
});
