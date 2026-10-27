import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import type { HistoryItem } from "../types.ts";
import { LOCAL_STATUS, type StatusInfo } from "./hostedMode.ts";
import { menuModel } from "./session.ts";
import { accountLinks, accountView, navItems, recentList, recentRows } from "./shell.ts";

const tFr = makeT(fr, "fr");
const hosted: StatusInfo = { ...LOCAL_STATUS, hosted: true };

const item = (n: number, o: Partial<HistoryItem> = {}): HistoryItem => ({
  key: `eu|Name${n}-Realm|12`,
  label: `Name${n}-Realm`,
  charClass: 7,
  spec: null,
  targetLevel: 12,
  targetAutoDetected: false,
  verdict: "invite",
  score: 70.4,
  fetchedAt: 1000 - n,
  request: { character: `Name${n}-Realm` } as HistoryItem["request"],
  ...o,
});

describe("navItems", () => {
  test("six items in order, labels, hrefs, icons", () => {
    const items = navItems(tEn, "home", { candidates: 0, liveOn: false });
    expect(items.map((i) => i.key)).toEqual(["home", "candidate", "me", "compare", "live", "help"]);
    expect(items.map((i) => i.href)).toEqual(["/", "/candidate", "/me", "/compare", "/live", "/help"]);
    expect(items.map((i) => i.label)).toEqual(["Home", "Candidates", "My characters", "Compare", "Live", "Help"]);
    expect(items.map((i) => i.icon)).toEqual(["home", "users", "user", "compare", "live", "help"]);
  });
  test("active follows the page; none for a page outside the nav", () => {
    expect(navItems(tEn, "compare", { candidates: 0, liveOn: false }).filter((i) => i.active).map((i) => i.key)).toEqual(["compare"]);
    expect(navItems(tEn, "settings", { candidates: 0, liveOn: false }).some((i) => i.active)).toBe(false);
  });
  test("the candidate count only when > 0", () => {
    expect(navItems(tEn, "home", { candidates: 0, liveOn: false })[1]!.count).toBeUndefined();
    expect(navItems(tEn, "home", { candidates: 6, liveOn: false })[1]!.count).toBe(6);
    expect(navItems(tEn, "home", { candidates: 6, liveOn: false })[0]!.count).toBeUndefined();
  });
  test("the Live dot on / off, on Live only", () => {
    expect(navItems(tEn, "home", { candidates: 0, liveOn: true })[4]!.dot).toBe("on");
    expect(navItems(tEn, "home", { candidates: 0, liveOn: false })[4]!.dot).toBe("off");
    expect(navItems(tEn, "home", { candidates: 0, liveOn: true }).filter((i) => i.dot).length).toBe(1);
  });
  test("in French", () => {
    expect(navItems(tFr, "home", { candidates: 0, liveOn: false }).map((i) => i.label)).toEqual(["Accueil", "Candidats", "Mes persos", "Comparer", "Live", "Aide"]);
  });
});

describe("recentRows", () => {
  test("trims to 8 and keeps order", () => {
    const rows = recentRows(Array.from({ length: 12 }, (_, i) => item(i)), null);
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.name)).toEqual(["Name0", "Name1", "Name2", "Name3", "Name4", "Name5", "Name6", "Name7"]);
    expect(recentRows(Array.from({ length: 12 }, (_, i) => item(i)), null, 3)).toHaveLength(3);
  });
  test("rounds the score, an em dash for none, verdict and class carried", () => {
    const [a, b] = recentRows([item(1, { score: 76.6 }), item(2, { score: null, verdict: null })], null);
    expect(a!.score).toBe("77");
    expect(a!.verdict).toBe("invite");
    expect(a!.classId).toBe(7);
    expect(b!.score).toBe("—");
    expect(b!.verdict).toBeNull();
  });
  test("splits Name-Realm, links to the candidate page, marks the active key", () => {
    const rows = recentRows([item(1, { label: "Vachâman-Ysondre" }), item(2)], "eu|Name2-Realm|12");
    expect(rows[0]!.name).toBe("Vachâman");
    expect(rows[0]!.href).toBe(`/candidate?${new URLSearchParams({ open: "eu|Name1-Realm|12" })}`);
    expect(rows.map((r) => r.active)).toEqual([false, true]);
  });
});

describe("recentList", () => {
  const many = Array.from({ length: 12 }, (_, i) => item(i));
  test("collapsed: 8 rows, the rest counted, the toggle shown", () => {
    const l = recentList(many, null, false);
    expect(l.rows.map((r) => r.name)).toEqual(["Name0", "Name1", "Name2", "Name3", "Name4", "Name5", "Name6", "Name7"]);
    expect(l.hidden).toBe(4);
    expect(l.toggle).toBe(true);
  });
  test("an active entry beyond the 8th is added as an extra row", () => {
    const l = recentList(many, "eu|Name10-Realm|12", false);
    expect(l.rows).toHaveLength(9);
    expect(l.rows[8]!.name).toBe("Name10");
    expect(l.rows[8]!.active).toBe(true);
    expect(l.hidden).toBe(3);
  });
  test("an active entry within the 8 adds nothing", () => {
    const l = recentList(many, "eu|Name3-Realm|12", false);
    expect(l.rows).toHaveLength(8);
    expect(l.rows.filter((r) => r.active).map((r) => r.name)).toEqual(["Name3"]);
  });
  test("expanded: every entry, none hidden", () => {
    const l = recentList(many, "eu|Name10-Realm|12", true);
    expect(l.rows).toHaveLength(12);
    expect(l.hidden).toBe(0);
    expect(l.toggle).toBe(true);
  });
  test("8 or fewer: no toggle", () => {
    const l = recentList(many.slice(0, 8), null, false);
    expect(l).toMatchObject({ hidden: 0, toggle: false });
    expect(l.rows).toHaveLength(8);
  });
});

describe("accountView", () => {
  const member = { id: 2, discordId: "22", username: "biwaa", globalName: "Biwaa", avatarUrl: "", role: "member" as const };
  test("local: the local-mode title, no lines", () => {
    expect(accountView(tEn, LOCAL_STATUS, null)).toEqual({ title: "Local mode", lines: [], local: true, links: { side: [], menu: [] } });
  });
  test("hosted: the menu's name and quota line", () => {
    const menu = menuModel(tEn, member, { used: 88, limit: 300, resetInS: 2280 });
    expect(accountView(tEn, hosted, menu)).toEqual({ title: "Biwaa", lines: ["212 of 300 pts left this hour"], local: false, links: { side: [], menu: [] } });
    expect(accountView(tEn, hosted, null)).toEqual({ title: "", lines: [], local: false, links: { side: [], menu: [] } });
  });
  test("in French", () => {
    expect(accountView(tFr, LOCAL_STATUS, null).title).toBe("Mode local");
  });
});

describe("accountLinks", () => {
  const discord = "https://discord.com/users/111111111111111111";
  const coffee = "https://buymeacoffee.com/bmpl";
  test("none when the instance sets no URL", () => {
    expect(accountLinks(tEn, hosted)).toEqual({ side: [], menu: [] });
  });
  test("contact and support, short in the sidebar, named in the menu", () => {
    const links = accountLinks(tEn, { ...hosted, operator: "Muleyoxo", contactUrl: discord, supportUrl: coffee });
    expect(links.side).toEqual([
      { key: "contact", href: discord, label: "Discord" },
      { key: "support", href: coffee, label: "Support bmpl" },
    ]);
    expect(links.menu.map((l) => l.label)).toEqual(["Message Muleyoxo on Discord ↗", "Support bmpl ↗"]);
  });
  test("each link on its own", () => {
    expect(accountLinks(tEn, { ...hosted, supportUrl: coffee }).side.map((l) => l.key)).toEqual(["support"]);
    expect(accountLinks(tEn, { ...hosted, contactUrl: discord }).menu.map((l) => l.key)).toEqual(["contact"]);
  });
  test("in French", () => {
    const links = accountLinks(tFr, { ...hosted, operator: "Muleyoxo", contactUrl: discord, supportUrl: coffee });
    expect(links.side.map((l) => l.label)).toEqual(["Discord", "Soutenir bmpl"]);
    expect(links.menu.map((l) => l.label)).toEqual(["Écrire à Muleyoxo sur Discord ↗", "Soutenir bmpl ↗"]);
  });
});
