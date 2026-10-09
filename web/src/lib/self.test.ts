import { describe, expect, test } from "bun:test";
import type { DungeonRow, Evaluation, LookupPayload, MyCharacter, SeasonRunView, SeasonView } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  dungeonPanel, isMe, meChip, pillarCards, runDetail, scoreBand, syncCard, toggleMe, trendView, workOnRows,
} from "./self.ts";

const tFr = makeT(fr, "fr");
const titleOf = (s: string) => s;

const ev = (over: Partial<Evaluation> = {}): Evaluation => ({
  role: "dps", targetLevel: 18, axes: [], global: 55, verdict: "maybe", runsUsed: 8, analyzedRuns: 0, configVersion: "x",
  drivers: [{ source: "survival.individualDeaths", impact: -9, value: 1.4, reference: 0.7, label: "1.4 individual deaths/run" }],
  nextVerdict: null,
  pillars: [
    { key: "damage", score: 68, evidence: [{ label: "median parse 61%", delta: 4, source: "throughput.medianParse", value: 61, weight: 3, score: 61 }] },
    { key: "survival", score: 41, evidence: [{ label: "1.4 individual deaths/run", delta: -6, source: "survival.individualDeaths", value: 1.4, weight: 3, score: 40 }] },
    { key: "avoidable", score: 57, evidence: [] },
    { key: "interrupts", score: 82, evidence: [] },
    { key: "control", score: null, evidence: [] },
  ],
  ...over,
});

const season = (over: Partial<SeasonView> = {}): SeasonView => ({
  character: { name: "Muleyoxo", realm: "silvermoon", region: "eu" }, zoneID: 55, targetLevel: 18, currentWeek: 0, checkedAt: 0,
  state: { runs: 142, analysed: 24, pending: 118, failed: 0, estimate: 1200 },
  runs: [], recent: null, season: null,
  trends: [{ key: "survival", delta: -9, direction: "down", recentRuns: 6, weekly: [null, null, null, null, null, null, 45, 40] }],
  workOn: [], dungeons: [], ...over,
});

describe("scoreBand (spec: 75 / 55 / 45)", () => {
  test("bands", () => {
    expect([80, 75, 74, 55, 54, 45, 44, null].map(scoreBand)).toEqual(["good", "good", "mid", "mid", "warn", "warn", "bad", "na"]);
  });
});

describe("trendView", () => {
  test("arrows, same, not enough", () => {
    expect(trendView(tEn, { key: "damage", delta: 6, direction: "up", recentRuns: 5, weekly: [] })).toEqual({ text: "↗ +6", cls: "tone-good" });
    expect(trendView(tEn, { key: "damage", delta: -9, direction: "down", recentRuns: 5, weekly: [] })).toEqual({ text: "↘ −9", cls: "tone-bad" });
    expect(trendView(tEn, { key: "damage", delta: 2, direction: "same", recentRuns: 5, weekly: [] }).text).toBe("→ same");
    expect(trendView(tEn, undefined).text).toBe("not enough runs for a trend (0 recently)");
    expect(trendView(tFr, { key: "damage", delta: null, direction: null, recentRuns: 2, weekly: [] }).text).toBe("pas assez de runs pour une tendance (2 récemment)");
  });
});

describe("pillarCards", () => {
  test("from the lookup's evaluation when the season has no window", () => {
    const c = pillarCards(tEn, "en", ev(), season());
    expect(c.map((x) => [x.key, x.score, x.band])).toEqual([
      ["damage", "68", "mid"], ["survival", "41", "bad"], ["avoidable", "57", "mid"], ["interrupts", "82", "good"], ["control", "n/a", "na"],
    ]);
    expect(c[1]!.trend.text).toBe("↘ −9");
    expect(c[1]!.bars.map((b) => [b.px, b.last, b.empty])).toEqual([[2, false, true], [2, false, true], [2, false, true], [2, false, true], [2, false, true], [2, false, true], [13, false, false], [11, true, false]]);
    expect(c[4]!.trend.text).toBe("dispels only until phase 2");
    expect(c[4]!.sentence).toBe("No dispel or purge for this spec: n/a, not 0.");
  });
  test("from the 4-week window when there is one", () => {
    const s = season({ recent: { runs: 38, global: 60, pillars: [{ key: "damage", score: 70, evidence: [] }] } });
    expect(pillarCards(tEn, "en", ev(), s)[0]!.score).toBe("70");
  });
});

describe("workOnRows", () => {
  test("the lookup's costs when the season has no window; no past", () => {
    const r = workOnRows(tEn, "en", ev(), season(), titleOf);
    expect(r).toEqual([{ n: 1, title: "survival.individualDeaths", pillar: "Survival", impact: "−9 pts of score", past: { text: "no past yet", cls: "muted" }, detail: expect.any(String) }]);
  });
  test("the window's rows with the own-past column", () => {
    const s = season({
      recent: { runs: 38, global: 60, pillars: [] },
      workOn: [{ source: "survival.individualDeaths", pillar: "survival", impact: -9, value: 1.4, reference: 0.7, label: "", past: { value: 0.2, change: "worse" } }],
    });
    expect(workOnRows(tEn, "en", ev(), s, titleOf)[0]!.past).toEqual({ text: "worse (0.2 before)", cls: "tone-bad" });
    expect(workOnRows(tFr, "fr", ev(), s, titleOf)[0]!.past.text).toBe("moins bien (0,2 avant)");
  });
});

describe("dungeonPanel", () => {
  const row: DungeonRow = {
    encounterID: 12923, name: "Voidscar Arena", runs: 21, analysed: 18,
    pillars: { damage: 62, survival: 28, avoidable: 41, interrupts: 80, control: null }, overall: 53, best: { level: 18, timed: false },
    details: {
      avoidable: [{ id: 1, name: "Shadow Pool", total: 380 }, { id: 2, name: "Void Slash", total: 240 }], avoidableOther: 380, avoidableTotal: 1000,
      killers: [{ ability: "Void Slash", deaths: 4 }],
      casts: [{ id: 3, name: "Lava Bolt", attempts: 40, completed: 11, interrupted: 27, mine: 9 }],
    },
  };
  test("shares, counts and the runs link", () => {
    const p = dungeonPanel(tEn, "en", row);
    expect(p.sub).toBe("21 runs · best +18 depleted");
    expect(p.avoidable.map((a) => [a.name, a.pct, a.width])).toEqual([["Shadow Pool", "38%", 38], ["Void Slash", "24%", 24]]);
    expect(p.other).toEqual({ pct: "38%", width: 38 });
    expect(p.killers).toEqual([{ ability: "Void Slash", deaths: "4 deaths" }]);
    expect(p.casts).toEqual([{ id: 3, name: "Lava Bolt", ofText: "11 of 40", mine: "you kicked 9" }]);
    expect(p.runsLink).toBe("21 runs in Voidscar Arena ›");
    expect(dungeonPanel(tFr, "fr", row).avoidable[0]!.pct).toBe("38\u00a0%"); // Intl: no-break space
  });
});

describe("runDetail", () => {
  test("killing hits as shares, avoidable amounts, casts and the kick line", () => {
    const v = {
      signals: {
        deaths: { count: 1, groupTotal: 1, events: [{ atMs: 842_000, cause: null, source: null, overkill: 0, inWipe: false, killingHits: [
          { ability: "Void Slash", abilityId: 5, amount: 71, overkill: 10, friendly: false, instakill: false },
          { ability: "Shadow Pool", abilityId: 6, amount: 29, overkill: 0, friendly: true, instakill: false },
        ] }] },
        avoidableDamage: { total: 3_500_000, perMinute: 1, peer: null, spellCount: 3, abilities: [{ id: 6, name: "Shadow Pool", total: 2_100_000 }], other: 1_400_000 },
        interrupts: { count: 4, kickCooldownS: 15, capacity: 10, usage: 0.4, peer: null, enemyCasts: [{ id: 7, name: "Lava Bolt", attempts: 12, completed: 3, interrupted: 9, mine: 4 }] },
      },
    } as unknown as SeasonRunView;
    const d = runDetail(tEn, "en", v)!;
    expect(d.deaths).toEqual([{ title: "Death at 14:02", hits: [{ ability: "Void Slash", share: "71% of the hits" }, { ability: "Shadow Pool (self)", share: "29% of the hits" }] }]);
    expect(d.avoidable.map((a) => a.name)).toEqual(["Shadow Pool", "other avoidable damage"]);
    expect(d.casts).toEqual([{ id: 7, name: "Lava Bolt", ofText: "3 of 12" }]);
    expect(d.kicked).toBe("You kicked 4 of the 9 interrupted.");
  });
});

describe("syncCard", () => {
  const own = { clientId: "abcd…wxyz", verifiedAt: 1, updatedAt: 1, usable: true, snapshot: null };
  test("hosted without a usable own client: the guide", () => {
    expect(syncCard(tEn, season(), true, null).kind).toBe("noClient");
    expect(syncCard(tEn, season(), true, { ...own, usable: false }).kind).toBe("noClient");
  });
  test("estimate before spending, done when nothing is pending", () => {
    const v = syncCard(tEn, season(), true, own);
    expect(v).toEqual({ kind: "ready", found: "142 ranked runs found · 118 not analysed yet", cost: "~1\u202f200 pts on your own WCL client · the shared budget is not used", start: "Sync 118 runs" });
    expect(syncCard(tEn, season(), false, null)).toMatchObject({ kind: "ready", cost: "~1\u202f200 pts on your WCL client" });
    expect(syncCard(tEn, season({ state: { runs: 142, analysed: 140, pending: 0, failed: 2, estimate: 0 } }), false, null))
      .toEqual({ kind: "done", text: "Season synced · 140 of 142 runs analysed", failed: "2 logs are not available on Warcraft Logs" });
    expect(syncCard(tEn, null, false, null).kind).toBe("nothing");
  });
});

describe("me", () => {
  const p = { character: { name: "Muleyoxo", realmSlug: "silvermoon", region: "eu" } } as unknown as LookupPayload;
  const c = (name: string): MyCharacter => ({ name, realm: "silvermoon", region: "eu", source: "manual" });
  test("toggle, case-insensitive, at most 5", () => {
    expect(isMe([c("muleyoxo")], p)).toBe(true);
    expect(toggleMe([], p)).toEqual([c("Muleyoxo")]);
    expect(toggleMe([c("Muleyoxo"), c("Other")], p)).toEqual([c("Other")]);
    const full = ["Aa", "Bb", "Cc", "Dd", "Ee"].map(c);
    expect(toggleMe(full, p)).toBeNull();
    expect(meChip(tEn, full, p)).toEqual({ label: "This is me", on: false, disabled: true, title: "Up to 5 characters: remove one from your list first" });
    expect(meChip(tEn, [c("Muleyoxo")], p)).toEqual({ label: "This is me ✓", on: true, disabled: false });
  });
});
