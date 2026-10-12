import { describe, expect, test } from "bun:test";
import type { LookupPayload } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { candidateHref, pageOf } from "./hostedMode.ts";
import { CAND_TABS, candHref, candState, candSwitchHref, classInitials, classToken, profileHeader } from "./profile.ts";

const tFr = makeT(fr, "fr");

describe("candidate URL state", () => {
  const key = `eu|Élise-Kel'Thas "x"|12`;
  test("round trip on every tab, with a run and the sheet", () => {
    for (const tab of CAND_TABS) {
      const s = { tab, run: "aBc123XyZ:7", sheet: true };
      const href = candHref(key, s);
      const url = new URL(href, "http://x");
      expect(pageOf(url.pathname)).toBe("candidate");
      expect(url.searchParams.get("open")).toBe(key);
      expect(candState(url.search)).toEqual(s);
    }
  });
  test("defaults are left out", () => {
    expect(candHref("k", {})).toBe("/candidate?open=k");
    expect(candHref("k", { tab: "synthesis", run: null, sheet: false })).toBe("/candidate?open=k");
    expect(candHref("k", { tab: "runs" })).toBe("/candidate?open=k&tab=runs");
    expect(candHref("k", { sheet: true })).toBe("/candidate?open=k");
    expect(candidateHref(key)).toBe(candHref(key, {}));
  });
  test("unknown tab, malformed run, sheet without a run", () => {
    expect(candState("")).toEqual({ tab: "synthesis", run: null, sheet: false });
    expect(candState("?tab=experience")).toEqual({ tab: "synthesis", run: null, sheet: false });
    expect(candState("?tab=runs&run=nofight&sheet=1")).toEqual({ tab: "runs", run: null, sheet: false });
    expect(candState("?tab=runs&sheet=1")).toEqual({ tab: "runs", run: null, sheet: false });
    expect(candState("?run=abc:12&sheet=0")).toEqual({ tab: "synthesis", run: "abc:12", sheet: false });
  });
  test("switching profile keeps the tab and drops the run and the sheet", () => {
    expect(candSwitchHref("other", "?open=k&tab=dungeons&run=abc:3&sheet=1")).toBe("/candidate?open=other&tab=dungeons");
    expect(candSwitchHref("other", "")).toBe("/candidate?open=other");
  });
});

const payload = (over: Partial<LookupPayload> = {}): LookupPayload => ({
  character: { id: 1, name: "Obye", classID: 12, spec: "Devourer", realmSlug: "hyjal", region: "eu",
    scoreTop: { spec: "Devourer", rankPercent: 90, points: 412.6, regionRank: 1234, serverRank: 56 } },
  zone: { id: 45, name: "Mythic+ Season 2", partition: 1 },
  metric: "dps", metricAutoSelected: false, alternateMetricHasData: false, specFilter: null,
  runsIndexed: 15, targetLevel: 11, targetAutoDetected: false,
  perDungeon: { runs: new Array(8).fill({}) },
  rio: { profileUrl: "https://raider.io/characters/eu/hyjal/Obye", seasons: [{ slug: "s2", all: 2923.4, dps: 2923.4, healer: 0, tank: 0 }],
    derived: { recentTimed: 4, recentTotal: 6, runsLast7d: 5, lastRunAt: 0 } },
  summary: { ilvl: 319.2, prevSeason: { slug: "s1", all: 3101.8, best: { role: "dps", score: 3101.8 } } },
  evaluation: { role: "dps", targetLevel: 11, axes: [], global: 59, verdict: "maybe", runsUsed: 8, analyzedRuns: 0, configVersion: "x" },
  ...over,
} as unknown as LookupPayload);

describe("profileHeader", () => {
  test("French: line, verdict, facts, links", () => {
    const h = profileHeader(tFr, "fr", payload());
    expect(h.name).toBe("Obye");
    expect(h.classColor).toBe("#A330C9");
    expect(h.iconUrl).toBe("https://wow.zamimg.com/images/wow/icons/medium/classicon_demonhunter.jpg");
    expect(h.initials).toBe("DH");
    expect(h.line).toBe("Devourer Demon Hunter · DPS · Hyjal (EU)");
    expect(h.verdict).toEqual({ cls: "badge-maybe", label: "MAYBE", score: "59", target: "pour une +11" });
    expect(h.facts.map((f) => [f.label, f.value])).toEqual([
      ["RIO", "2923"], ["ilvl", "319"], ["région", "#1234"], ["serveur", "#56"], [tFr("verdict.stats.prevSeason"), "3102"], ["runs · 7 jours", "5"],
    ]);
    expect(h.links).toEqual({ rio: "https://raider.io/characters/eu/hyjal/Obye", wcl: "https://www.warcraftlogs.com/character/eu/hyjal/obye" });
    expect(h.meta).toBe("Mythic+ Season 2 · 15 runs indexés");
    expect(h.runCount).toBe(8);
  });
  test("English meta with the metric note and the spec filter; healer role", () => {
    const h = profileHeader(tEn, "en", payload({
      metric: "hps", metricAutoSelected: true, alternateMetricHasData: true, specFilter: "Holy", runsIndexed: 1,
      evaluation: { role: "healer", targetLevel: 14, axes: [], global: null, verdict: "insufficient", runsUsed: 1, analyzedRuns: 0, configVersion: "x" },
    }));
    expect(h.meta).toBe("Mythic+ Season 2 · 1 run indexed · metric auto-selected; dps data exists too · filter: Holy");
    expect(h.line).toBe("Devourer Demon Hunter · Healer · Hyjal (EU)");
    expect(h.verdict).toEqual({ cls: "badge-insufficient", label: "NOT ENOUGH DATA", score: null, target: "for a +14" });
  });
  test("Death Knight icon token, an accented name in the WCL link", () => {
    expect(classToken(1)).toBe("deathknight");
    expect(classInitials(1)).toBe("DK");
    expect(classInitials(3)).toBe("Hu");
    expect(classToken(99)).toBeNull();
    const h = profileHeader(tEn, "en", payload({ character: { id: 2, name: "Vachâman", classID: 1, spec: null, realmSlug: "kel'thuzad", region: "us", scoreTop: null } as unknown as LookupPayload["character"] }));
    expect(h.iconUrl).toBe("https://wow.zamimg.com/images/wow/icons/medium/classicon_deathknight.jpg");
    expect(h.line).toBe("Death Knight · DPS · Kel'Thuzad (US)");
    expect(h.links.wcl).toBe("https://www.warcraftlogs.com/character/us/kel'thuzad/vach%C3%A2man");
  });
  test("no Raider.IO profile: no RIO link, no RIO or activity fact", () => {
    const h = profileHeader(tEn, "en", payload({ rio: null }));
    expect(h.links.rio).toBeNull();
    expect(h.facts.map((f) => f.label)).toEqual(["ilvl", "region", "server", "prev season"]);
  });
});
