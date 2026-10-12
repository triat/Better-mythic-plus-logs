import { describe, expect, test } from "bun:test";
import type { LookupPayload } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { candidateHref, pageOf } from "./hostedMode.ts";
import {
  CAND_TABS, CAND_TAB_EVENT, OWNER_TABS, candHref, candInitial, candState, candSwitchHref, classInitials, classToken, compareHref, ownerHref,
  ownerState, ownerTabAfter, profileHeader, runKeyOf, tabAfter, vettingHref, viewSwitchHref,
} from "./profile.ts";

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
  test("landing on the same profile (Refresh, a lookup cache hit) keeps the run and the sheet", () => {
    expect(candSwitchHref("k", "?open=k&tab=runs&run=abc:3&sheet=1")).toBe("/candidate?open=k&tab=runs&run=abc%3A3&sheet=1");
  });
  test("a re-evaluation of the same character carries the run and the sheet to the new key", () => {
    const href = candSwitchHref("k2", "?open=k&tab=runs&run=abc:3&sheet=1", true);
    expect(candState(new URL(href, "http://x").search)).toEqual({ tab: "runs", run: "abc:3", sheet: true });
    expect(new URL(href, "http://x").searchParams.get("open")).toBe("k2");
  });
});

describe("owner URL state", () => {
  const key = `eu|Biwaasham-Hyjal "x"|19`;
  const search = (href: string) => new URL(href, "http://x").search;
  test("round trip on every tab, with a run and with the vetting view", () => {
    for (const tab of OWNER_TABS) {
      for (const vetting of [false, true]) {
        const s = { tab, run: "aBc123XyZ:7", vetting };
        const href = ownerHref(key, s);
        const url = new URL(href, "http://x");
        expect(pageOf(url.pathname)).toBe("candidate");
        expect(url.searchParams.get("open")).toBe(key);
        // With the vetting view, "form" is left out: it reads back as the owner default all the same.
        expect(ownerState(url.search, key, ["aBc123XyZ:7"])).toEqual(s);
      }
    }
  });
  test("defaults are left out", () => {
    expect(ownerHref("k", {})).toBe("/candidate?open=k");
    expect(ownerHref("k", { tab: "form", run: null, vetting: false })).toBe("/candidate?open=k");
    expect(ownerHref("k", { tab: "dungeons" })).toBe("/candidate?open=k&tab=dungeons");
    expect(ownerHref("k", { vetting: true })).toBe("/candidate?open=k&as=vetting");
    expect(ownerHref("k", { tab: "runs", run: "abc:3" })).toBe("/candidate?open=k&tab=runs&run=abc%3A3");
  });
  test("unknown and candidate-only tabs read as the form; runs and dungeons keep their meaning", () => {
    expect(ownerState("", "k", [])).toEqual({ tab: "form", run: null, vetting: false });
    expect(ownerState("?open=k&tab=synthesis", "k", [])).toEqual({ tab: "form", run: null, vetting: false });
    expect(ownerState("?open=k&tab=method", "k", [])).toEqual({ tab: "form", run: null, vetting: false });
    expect(ownerState("?open=k&tab=nope", "k", [])).toEqual({ tab: "form", run: null, vetting: false });
    expect(ownerState("?open=k&tab=runs", "k", []).tab).toBe("runs");
    expect(ownerState("?open=k&tab=dungeons", "k", []).tab).toBe("dungeons");
    expect(ownerState("?open=k&as=other", "k", []).vetting).toBe(false);
    // The other way round: the owner's "form" on the vetting profile is its Synthèse.
    expect(candState("?open=k&tab=form&as=vetting").tab).toBe("synthesis");
  });
  test("a run is kept only when the URL names this profile and the season holds it", () => {
    expect(ownerState("?open=k&tab=runs&run=abc:3", "k", ["abc:3"]).run).toBe("abc:3");
    expect(ownerState("?open=k&tab=runs&run=abc:3", "k", ["abc:4"]).run).toBeNull();
    expect(ownerState("?open=old&tab=runs&run=abc:3", "k", ["abc:3"])).toEqual({ tab: "runs", run: null, vetting: false });
    expect(ownerState("?tab=runs&run=abc:3", "k", ["abc:3"]).run).toBeNull();
    expect(ownerState("?open=k&run=nofight", "k", ["nofight"]).run).toBeNull();
  });
  test("switching views keeps the tab the target view has, else its default; run and sheet go", () => {
    expect(viewSwitchHref("k", "?open=k&tab=runs&run=abc:3", true)).toBe("/candidate?open=k&tab=runs&as=vetting");
    expect(viewSwitchHref("k", "?open=k&tab=dungeons", true)).toBe("/candidate?open=k&tab=dungeons&as=vetting");
    expect(viewSwitchHref("k", "?open=k&tab=form", true)).toBe("/candidate?open=k&as=vetting");
    expect(viewSwitchHref("k", "?open=k&tab=method&as=vetting", false)).toBe("/candidate?open=k");
    expect(viewSwitchHref("k", "?open=k&tab=synthesis&as=vetting", false)).toBe("/candidate?open=k");
    expect(viewSwitchHref("k", "?open=k&tab=runs&run=abc:3&sheet=1&as=vetting", false)).toBe("/candidate?open=k&tab=runs");
    expect(viewSwitchHref("k", "?open=k&tab=dungeons&as=vetting", false)).toBe("/candidate?open=k&tab=dungeons");
  });
  test("the vetting profile writes its own state with as=vetting; Refresh of the same profile keeps it", () => {
    const href = vettingHref(key, { tab: "method" });
    expect(candState(search(href))).toEqual({ tab: "method", run: null, sheet: false });
    expect(ownerState(search(href), key, []).vetting).toBe(true);
    expect(vettingHref("k", { tab: "runs", run: "abc:3", sheet: true })).toBe("/candidate?open=k&tab=runs&run=abc%3A3&sheet=1&as=vetting");
    expect(candSwitchHref("k", "?open=k&tab=method&as=vetting")).toBe("/candidate?open=k&tab=method&as=vetting");
    // Another profile, or a re-evaluation under a new key, opens that profile's own default view.
    expect(candSwitchHref("other", "?open=k&tab=method&as=vetting")).toBe("/candidate?open=other&tab=method");
    expect(candSwitchHref("k2", "?open=k&tab=runs&as=vetting", true)).toBe("/candidate?open=k2&tab=runs");
    // An owner page's state survives Refresh: "form" is the default, "runs" with its run is kept.
    expect(candSwitchHref("k", "?open=k&tab=form")).toBe("/candidate?open=k");
    expect(ownerState(search(candSwitchHref("k", "?open=k&tab=runs&run=abc:3")), "k", ["abc:3"])).toEqual({ tab: "runs", run: "abc:3", vetting: false });
  });
  test("owner tab keyboard wraps around and jumps", () => {
    expect(ownerTabAfter("form", "ArrowRight")).toBe("dungeons");
    expect(ownerTabAfter("runs", "ArrowRight")).toBe("form");
    expect(ownerTabAfter("form", "ArrowLeft")).toBe("runs");
    expect(ownerTabAfter("runs", "Home")).toBe("form");
    expect(ownerTabAfter("form", "End")).toBe("runs");
    expect(ownerTabAfter("form", "a")).toBeNull();
  });
});

describe("profile state helpers", () => {
  test("a run the payload does not hold is dropped with its sheet; the tab stays", () => {
    expect(candInitial("?open=k&tab=runs&run=abc:3&sheet=1", "k", ["abc:3"])).toEqual({ tab: "runs", run: "abc:3", sheet: true });
    expect(candInitial("?open=k&tab=runs&run=abc:3&sheet=1", "k", ["abc:4"])).toEqual({ tab: "runs", run: null, sheet: false });
    expect(candInitial("?tab=method", "k", [])).toEqual({ tab: "method", run: null, sheet: false });
    expect(runKeyOf({ reportCode: "aBc", fightID: 7 })).toBe("aBc:7");
  });
  test("a run is kept only when the URL names the profile that mounts (no previous profile's run)", () => {
    // The URL still names the previous profile: even a run this payload holds is not this profile's state.
    expect(candInitial("?open=old&tab=runs&run=abc:3&sheet=1", "new", ["abc:3"])).toEqual({ tab: "runs", run: null, sheet: false });
    expect(candInitial("?tab=runs&run=abc:3", "new", ["abc:3"])).toEqual({ tab: "runs", run: null, sheet: false });
    // Written first by the lookup (candSwitchHref), the URL names the new profile: its state is kept.
    expect(candInitial(new URL(candSwitchHref("new", "?open=old&tab=runs&run=abc:3&sheet=1", true), "http://x").search, "new", ["abc:3"]))
      .toEqual({ tab: "runs", run: "abc:3", sheet: true });
  });
  test("tab keyboard wraps around and jumps", () => {
    expect(tabAfter("synthesis", "ArrowRight")).toBe("runs");
    expect(tabAfter("method", "ArrowRight")).toBe("synthesis");
    expect(tabAfter("synthesis", "ArrowLeft")).toBe("method");
    expect(tabAfter("dungeons", "Home")).toBe("synthesis");
    expect(tabAfter("runs", "End")).toBe("method");
    expect(tabAfter("runs", "Enter")).toBeNull();
  });
  test("one usage event per tab; the compare link names the key", () => {
    expect(CAND_TABS.map((k) => CAND_TAB_EVENT[k])).toEqual(["cand_tab_synthesis", "cand_tab_runs", "cand_tab_dungeons", "cand_tab_method"]);
    const href = compareHref(`eu|Élise-Kel'Thas "x"|12`);
    expect(new URL(href, "http://x").searchParams.get("pick")).toBe(`eu|Élise-Kel'Thas "x"|12`);
    expect(href.startsWith("/compare?pick=")).toBe(true);
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
      ["RIO", "2923"], ["ilvl", "319"], [tFr("verdict.stats.score", { metric: "DPS" }), "413"], ["région", "#1234"], ["serveur", "#56"],
      [tFr("verdict.stats.prevSeason"), "3102"], ["runs · 7 jours", "5"],
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
    const h = profileHeader(tEn, "en", payload({ character: { id: 2, name: "Vachâman", classID: 1, spec: null, realmSlug: "kelthuzad", region: "us", scoreTop: null } as unknown as LookupPayload["character"] }));
    expect(h.iconUrl).toBe("https://wow.zamimg.com/images/wow/icons/medium/classicon_deathknight.jpg");
    expect(h.line).toBe("Death Knight · DPS · Kelthuzad (US)");
    // No WCL score: neither the score nor the ranks it would hold.
    expect(h.facts.map((f) => f.label)).toEqual(["RIO", "ilvl", "prev season", "runs · 7 days"]);
    expect(h.links.wcl).toBe("https://www.warcraftlogs.com/character/us/kelthuzad/vach%C3%A2man");
  });
  test("no Raider.IO profile: no RIO link, no RIO or activity fact", () => {
    const h = profileHeader(tEn, "en", payload({ rio: null }));
    expect(h.links.rio).toBeNull();
    expect(h.facts.map((f) => f.label)).toEqual(["ilvl", "DPS score", "region", "server", "prev season"]);
  });
});
