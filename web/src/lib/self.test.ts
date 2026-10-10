import { describe, expect, test } from "bun:test";
import type { DungeonRow, Evaluation, LookupPayload, MyCharacter, RunControl, SeasonRunView, SeasonView } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  controlView, dungeonPanel, isMe, meChip, pillarCards, resultView, runDetail, scoreBand, seasonHeader, syncCard, toggleMe, trendView, workOnRows,
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
  state: { runs: 142, analysed: 24, pending: 118, controlOnly: 0, failed: 0, estimate: 1200 },
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
    expect(c[4]!.trend.text).toBe("no dispel, no crowd control measured yet");
    expect(c[4]!.sentence).toBe("No dispel for this spec and no crowd control measured yet: n/a, not 0.");
  });
  test("from the 4-week window when there is one", () => {
    const s = season({ recent: { runs: 38, overall: 60, pillars: [{ key: "damage", score: 70, evidence: [] }] } });
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
      recent: { runs: 38, overall: 60, pillars: [] },
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
      control: [{ id: 91800, name: "Gnaw", category: "stun", uses: 41, enemies: 44 }, { id: 49576, name: "Death Grip", category: "knock", uses: 33, enemies: 0 }], controlRuns: 9,
    },
  };
  test("shares, counts and the runs link", () => {
    const p = dungeonPanel(tEn, "en", row);
    expect(p.sub).toBe("21 runs · best +18 depleted");
    expect(p.avoidable.map((a) => [a.name, a.pct, a.width])).toEqual([["Shadow Pool", "38%", 38], ["Void Slash", "24%", 24]]);
    expect(p.other).toEqual({ pct: "38%", width: 38 });
    expect(p.killers).toEqual([{ ability: "Void Slash", deaths: "4 deaths" }]);
    expect(p.control).toEqual([{ id: 91800, name: "Gnaw", uses: "41 uses", enemies: "44 enemies" }, { id: 49576, name: "Death Grip", uses: "33 uses", enemies: "" }]);
    expect(p.controlNote).toBe("over 9 runs with crowd control · 9 analysed runs not measured yet");
    expect(dungeonPanel(tEn, "en", { ...row, details: { ...row.details, control: [], controlRuns: 0 } }).controlNote).toBe("No crowd control measured in this dungeon yet.");
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

describe("controlView (canvas control, run detail B)", () => {
  const control = (over: Partial<RunControl> = {}): RunControl => ({
    uses: 14, enemies: 13, perTenMin: 4.66, reference: 3.86, vsReference: 20.7, stale: false,
    spells: [
      { id: 91800, name: "Gnaw", category: "stun", uses: 8, enemies: 8, pet: true },
      { id: 49576, name: "Death Grip", category: "knock", uses: 5, enemies: 0 },
      { id: 207167, name: "Blinding Sleet", category: "disorient", uses: 1, enemies: 5 },
    ],
    ...over,
  });
  test("the rate against the spec's median first, then the spells by category", () => {
    const v = controlView(tEn, "en", control());
    expect(v.rate).toBe("4.7");
    expect(v.line).toEqual({ text: "per 10 min · median of the spec 3.9 ·", delta: "+21%", cls: "tone-good" });
    expect(v.groups).toEqual([
      { label: "stun", rows: [{ id: 91800, name: "Gnaw", pet: "(pet)", uses: "8 uses", enemies: "8 enemies" }] },
      { label: "disorient", rows: [{ id: 207167, name: "Blinding Sleet", pet: "", uses: "1 use", enemies: "5 enemies" }] },
      { label: "knock", rows: [{ id: 49576, name: "Death Grip", pet: "", uses: "5 uses", enemies: "" }] },
    ]);
    expect(v.note).toBeNull();
    const fr = controlView(tFr, "fr", control());
    expect(fr.rate).toBe("4,7");
    expect(fr.line.text).toBe("par 10 min · médiane de la spé 3,9 ·");
    expect(fr.groups[0]!.rows[0]).toMatchObject({ pet: "(pet)", uses: "8 utilisations", enemies: "8 ennemis" });
  });
  test("no reference yet, an older list, nothing landed, not measured", () => {
    expect(controlView(tEn, "en", control({ reference: null, vsReference: null })).line).toEqual({ text: "per 10 min · no spec median yet", delta: "", cls: "" });
    expect(controlView(tEn, "en", control({ vsReference: -6 })).line).toMatchObject({ delta: "−6%", cls: "tone-bad" });
    expect(controlView(tEn, "en", control({ stale: true })).note).toBe("Measured with an older list: the next sync updates it.");
    expect(controlView(tEn, "en", control({ uses: 0, enemies: 0, perTenMin: 0, spells: [] })).note).toBe("No crowd control landed in this run.");
    expect(controlView(tEn, "en", undefined)).toEqual({ rate: null, line: { text: "", delta: "", cls: "" }, groups: [], note: "Crowd control not measured for this run: sync the season to measure it." });
  });
});

describe("syncCard", () => {
  const own = { clientId: "abcd…wxyz", verifiedAt: 1, updatedAt: 1, usable: true, snapshot: null };
  test("hosted without a usable own client: the guide", () => {
    expect(syncCard(tEn, season(), true, null).kind).toBe("noClient");
    expect(syncCard(tEn, season(), true, { ...own, usable: false }).kind).toBe("noClient");
  });
  test("runs synced before crowd control existed: only crowd control to fetch", () => {
    const only = season({ state: { runs: 5, analysed: 5, pending: 5, controlOnly: 5, failed: 0, estimate: 35 } });
    expect(syncCard(tEn, only, true, own)).toEqual({
      kind: "ready", found: "5 ranked runs found · 5 need crowd control", cost: "~35 pts on your own WCL client · the shared budget is not used",
      start: "Measure crowd control on 5 runs",
    });
    expect(syncCard(tFr, only, true, own)).toMatchObject({ found: "5 runs classés trouvés · 5 à mesurer pour le contrôle", start: "Mesurer le contrôle sur 5 runs" });
    const mixed = season({ state: { runs: 7, analysed: 4, pending: 5, controlOnly: 2, failed: 0, estimate: 65 } });
    expect(syncCard(tEn, mixed, false, null)).toMatchObject({ found: "7 ranked runs found · 3 not analysed yet · 2 only need crowd control", start: "Sync 5 runs" });
    expect(syncCard(tFr, mixed, false, null)).toMatchObject({ found: "7 runs classés trouvés · 3 pas encore analysés · 2 n'ont besoin que du contrôle" });
  });
  test("estimate before spending, done when nothing is pending", () => {
    const v = syncCard(tEn, season(), true, own);
    expect(v).toEqual({ kind: "ready", found: "142 ranked runs found · 118 not analysed yet", cost: "~1\u202f200 pts on your own WCL client · the shared budget is not used", start: "Sync 118 runs" });
    expect(syncCard(tEn, season(), false, null)).toMatchObject({ kind: "ready", cost: "~1\u202f200 pts on your WCL client" });
    expect(syncCard(tEn, season({ state: { runs: 142, analysed: 140, pending: 0, controlOnly: 0, failed: 2, estimate: 0 } }), false, null))
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
  test("your own characters open the self-review tabs, anyone else the vetting view (phase-2 spec, decision 6)", () => {
    expect(resultView([c("muleyoxo")], p)).toBe("owner");
    expect(resultView([c("Other")], p)).toBe("vetting");
    expect(resultView([], p)).toBe("vetting");
  });
});

describe("seasonHeader", () => {
  test("short trend text in the grid's narrow cells; overall on the pillars' scale", () => {
    const s = season({ season: { runs: 40, overall: 62, pillars: [{ key: "survival", score: 41, evidence: [] }] },
      trends: [{ key: "damage", delta: null, direction: null, recentRuns: 2, weekly: [] }, { key: "survival", delta: -9, direction: "down", recentRuns: 6, weekly: [] }] });
    const h = seasonHeader(tEn, s);
    expect(h.cells[0]!.trend).toBe("too few runs");
    expect(h.cells[1]!.trend).toBe("↘ −9");
    expect(h.overall).toEqual({ text: "62", band: "mid" });
    expect(seasonHeader(tFr, s).cells[0]!.trend).toBe("trop peu de runs");
  });
});

