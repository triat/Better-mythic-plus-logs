import { describe, expect, test } from "bun:test";
import { fr } from "../../i18n/fr.ts";
import { makeT, tEn } from "../../i18n/t.ts";
import { parseRoster } from "./roster.ts";
import type { CachedVerdict } from "./roster.ts";
import { autoQueue, classMenu, liveView, panelView, rolesFor, sortMenu, verdictScope } from "./panel.ts";

const roster = {
  seq: 1,
  at: 0,
  players: parseRoster(
    "a|Biwaadrood-Nerzhul|2|H|3412\n" +
    "a|Tankadin-Hyjal|6|T|2890\n" +
    "a|Sombrelame-Dalaran|12|D|3105\n" +
    "p|Muleyoxo-Hyjal|5|D|3240\n",
  ),
};
const verdicts = new Map<string, CachedVerdict>([
  ["Biwaadrood-Nerzhul", { verdict: "invite", score: 78, targetLevel: 18, fetchedAt: 0, spec: null, ilvl: null }],
]);
const settings = { liveSort: "arrival" as const, liveRoles: ["tank", "healer", "dps"] as const, liveClasses: [] as string[] };

describe("panelView", () => {
  test("applicants newest first, party untouched, verdict and age attached", () => {
    const v = panelView(tEn, { roster, verdicts, settings, now: 12 * 60_000 });
    expect(v.applicants.map((r) => r.player.name)).toEqual(["Sombrelame", "Tankadin", "Biwaadrood"]);
    expect(v.party.map((r) => r.player.name)).toEqual(["Muleyoxo"]);
    expect(v.applicants[2]!.verdict!.verdict).toBe("invite");
    expect(v.applicants[2]!.ageLabel).toBe("vetted 12 min ago");
    expect(v.applicants[0]!.ageLabel).toBeNull();
    expect(v.countLine).toBe("showing 3 of 3");
  });
  test("a filter narrows the applicants and the count says so; the party is never filtered", () => {
    const v = panelView(tEn, { roster, verdicts, settings: { ...settings, liveRoles: ["tank"] }, now: 0 });
    expect(v.applicants.map((r) => r.player.name)).toEqual(["Tankadin"]);
    expect(v.party.length).toBe(1);
    expect(v.countLine).toBe("showing 1 of 3");
    expect(v.hiddenCount).toBe(2);
  });
  // Review round 1, finding 5: the player's own "self" row is grouped with "party", not with the applicants.
  test("the 'self' kind is grouped into party, not into applicants", () => {
    const withSelf = {
      seq: 1,
      at: 0,
      players: parseRoster(
        "a|Applicant-Realm|2|H|100\n" +
        "p|Mate-Realm|6|T|200\n" +
        "s|Me-Realm|11|D|300\n",
      ),
    };
    const v = panelView(tEn, { roster: withSelf, verdicts: new Map(), settings, now: 0 });
    expect(v.applicants.map((r) => r.player.name)).toEqual(["Applicant"]);
    expect(v.party.map((r) => r.player.name)).toEqual(["Mate", "Me"]);
    expect(v.countLine).toBe("showing 1 of 1"); // "self" and "party" never count toward the applicant total
  });
});

describe("autoQueue", () => {
  test("queues uncached applicants oldest first, skips the cached and the in-flight ones", () => {
    const applicants = roster.players.filter((p) => p.kind === "applicant");
    expect(autoQueue(applicants, verdicts, new Set(["Sombrelame-Dalaran"]))).toEqual(["Tankadin-Hyjal"]);
    expect(autoQueue(applicants, verdicts, new Set())).toEqual(["Tankadin-Hyjal", "Sombrelame-Dalaran"]);
  });
  test("never queues a party member", () => {
    expect(autoQueue(roster.players, new Map(), new Set()).includes("Muleyoxo-Hyjal")).toBe(false);
  });
});

describe("sortMenu / classMenu", () => {
  test("sortMenu marks the current sort and covers every LIVE_SORTS value", () => {
    const items = sortMenu(tEn, "verdict");
    expect(items.map((i) => i.value)).toEqual(["arrival", "verdict", "score", "role", "class"]);
    expect(items.map((i) => i.label)).toEqual(["arrival", "verdict", "Raider.IO score", "role", "class"]);
    expect(items.find((i) => i.value === "verdict")!.on).toBe(true);
    expect(items.filter((i) => i.on).length).toBe(1);
  });
  test("classMenu lists 'all' plus every class present among the applicants, sorted, never the party's", () => {
    const applicants = roster.players.filter((p) => p.kind === "applicant");
    const items = classMenu(tEn, (name) => name.toUpperCase(), applicants, []);
    expect(items).toEqual([
      { value: "", label: "all", hint: null, on: true },
      { value: "DemonHunter", label: "DEMONHUNTER", hint: null, on: false },
      { value: "Druid", label: "DRUID", hint: null, on: false },
      { value: "Paladin", label: "PALADIN", hint: null, on: false },
    ]);
    expect(items.some((i) => i.label === "MONK")).toBe(false); // Muleyoxo is party, not an applicant
  });
  test("classMenu marks the selected class, not 'all'", () => {
    const applicants = roster.players.filter((p) => p.kind === "applicant");
    const items = classMenu(tEn, (name) => name, applicants, ["Druid"]);
    expect(items.find((i) => i.value === "")!.on).toBe(false);
    expect(items.find((i) => i.value === "Druid")!.on).toBe(true);
  });
});

// I5: verdicts cached for the previous key level must not survive a change — they would badge a row
// with a verdict computed against a different key, and `autoQueue` would skip that row for good.
describe("verdictScope", () => {
  test("a key-level change, a region change and auto/explicit are each a different scope", () => {
    expect(verdictScope(18, "eu")).toBe(verdictScope(18, "eu")); // stable: the map is not cleared for nothing
    expect(verdictScope(18, "eu")).not.toBe(verdictScope(22, "eu"));
    expect(verdictScope(18, "eu")).not.toBe(verdictScope(18, "us"));
    expect(verdictScope(null, "eu")).not.toBe(verdictScope(18, "eu"));
    expect(verdictScope(null, "eu")).toBe(verdictScope(null, "eu"));
  });

  test("a row kept across a key change would be skipped by autoQueue — which is why the map is emptied", () => {
    const applicants = roster.players.filter((p) => p.kind === "applicant");
    const stale = new Map<string, CachedVerdict>([["Biwaadrood-Nerzhul", { verdict: "invite", score: 78, targetLevel: 18, fetchedAt: 0, spec: null, ilvl: null }]]);
    expect(autoQueue(applicants, stale, new Set())).not.toContain("Biwaadrood-Nerzhul");
    expect(autoQueue(applicants, new Map(), new Set())).toContain("Biwaadrood-Nerzhul");
  });
});

// --- liveView (redesign phase 4): mockup F-Live's seven applicants and the player's own row. ---

const tFr = makeT(fr, "fr");
const DAY = 24 * 3_600_000;
const NOW = 10 * DAY;
const mockRoster = {
  seq: 2,
  at: NOW - 2_000,
  players: parseRoster(
    "a|Danilaskuf-Silvermoon|1|T|2977\n" +
    "a|Moadmoad-Kazzak|7|H|3273\n" +
    "a|Vachâman-Ysondre|9|D|3852\n" +
    "a|Circe-Sylvanas|4|D|3729\n" +
    "a|Obye-Hyjal|12|D|2923\n" +
    "a|Loutrasse-Khaz Modan|3|D|3022\n" +
    "a|Lights-Malfurion|3|D|3034\n" +
    "s|Biwaasham-Hyjal|9|D|3410\n",
  ),
};
const cv = (verdict: CachedVerdict["verdict"], score: number | null, fetchedAt: number, spec: string | null, ilvl: number | null): CachedVerdict =>
  ({ verdict, score, targetLevel: 19, fetchedAt, spec, ilvl });
const mockVerdicts = new Map<string, CachedVerdict>([
  ["Danilaskuf-Silvermoon", cv("invite", 76.2, NOW - 2 * DAY, "Blood", 325)],
  ["Moadmoad-Kazzak", cv("invite", 82, NOW - 3 * DAY, "Holy", 313)],
  ["Vachâman-Ysondre", cv("invite", 77, NOW - 2 * 60_000, "Elemental", 328.4)],
  ["Circe-Sylvanas", cv("invite", 76, NOW - 3 * DAY, "Arcane", 326)],
  ["Obye-Hyjal", cv("maybe", 59, NOW - 3 * DAY, "Havoc", 319)],
  ["Loutrasse-Khaz Modan", cv("maybe", 59, NOW - 3 * DAY, "BeastMastery", 321)],
  // The player's own row never shows a verdict, even when they once looked themselves up.
  ["Biwaasham-Hyjal", cv("pass", 30, NOW, "Elemental", 330)],
]);
const all = { liveSort: "arrival" as const, liveRoles: ["tank", "healer", "dps"] as const, liveClasses: [] as string[] };
const view = (o: Partial<Parameters<typeof liveView>[2]> = {}, t = tEn, locale: "en" | "fr" = "en") =>
  liveView(t, locale, { roster: mockRoster, verdicts: mockVerdicts, settings: all, now: NOW, queued: new Set(), yourKey: 19, ...o });

describe("liveView", () => {
  test("applicants grouped tank, heal, DPS with their counts; rows keep the sort's order", () => {
    const v = view();
    expect(v.groups.map((g) => [g.role, g.label, g.count])).toEqual([["tank", "Tank", 1], ["healer", "Heal", 1], ["dps", "DPS", 5]]);
    // arrival: newest first inside each group
    expect(v.groups[2]!.rows.map((r) => r.name)).toEqual(["Lights", "Loutrasse", "Obye", "Circe", "Vachâman"]);
    const byScore = view({ settings: { ...all, liveSort: "score" } });
    expect(byScore.groups[2]!.rows.map((r) => r.name)).toEqual(["Vachâman", "Circe", "Lights", "Loutrasse", "Obye"]);
    expect(v.groups.flatMap((g) => g.rows).every((r) => r.id.startsWith("applicant:"))).toBe(true);
  });

  test("an empty group is left out", () => {
    const v = view({ settings: { ...all, liveClasses: ["Hunter"] } });
    expect(v.groups.map((g) => g.role)).toEqual(["dps"]);
  });

  test("role chips: counts after the class filter, before the role filter; on states for all, none and one", () => {
    const v = view();
    expect(v.roleChips.map((c) => [c.value, c.label, c.on])).toEqual([
      ["all", "All · 7", true], ["tank", "Tank · 1", false], ["healer", "Heal · 1", false], ["dps", "DPS · 5", false],
    ]);
    expect(view({ settings: { ...all, liveRoles: [] } }).roleChips[0]!.on).toBe(true);
    const one = view({ settings: { ...all, liveRoles: ["dps"] } });
    expect(one.roleChips.filter((c) => c.on).map((c) => c.value)).toEqual(["dps"]);
    expect(one.roleChips.map((c) => c.label)).toEqual(["All · 7", "Tank · 1", "Heal · 1", "DPS · 5"]);
    const two = view({ settings: { ...all, liveRoles: ["tank", "dps"] } });
    expect(two.roleChips.some((c) => c.on)).toBe(false);
    const hunters = view({ settings: { ...all, liveRoles: ["tank"], liveClasses: ["Hunter"] } });
    expect(hunters.roleChips.map((c) => c.label)).toEqual(["All · 2", "Tank · 0", "Heal · 0", "DPS · 2"]);
    expect(view({}, tFr, "fr").roleChips[0]!.label).toBe("Tous · 7");
  });

  test("rolesFor maps the chips onto the stored liveRoles", () => {
    expect(rolesFor("all")).toEqual(["tank", "healer", "dps"]);
    expect(rolesFor("healer")).toEqual(["healer"]);
  });

  test("row states and actions: vetted, queued, unvetted", () => {
    const v = view({ queued: new Set(["Lights-Malfurion"]) });
    const dps = v.groups[2]!.rows;
    const vach = dps.find((r) => r.name === "Vachâman")!;
    expect(vach).toMatchObject({
      character: "Vachâman-Ysondre", realm: "Ysondre", initials: "Sh", classColor: "#0070DD",
      spec: "Elemental", ilvl: "328", rio: "3852", state: "vetted", age: "2 min ago",
      verdict: { cls: "badge-invite", label: "INVITE", score: "77" }, action: { kind: "open", label: "Open profile" }, you: null,
    });
    expect(dps.find((r) => r.name === "Loutrasse")!.spec).toBe("Beast Mastery");
    expect(dps.find((r) => r.name === "Lights")).toMatchObject({ state: "queued", action: null, verdict: null, age: null });
    const unvetted = view().groups[2]!.rows.find((r) => r.name === "Lights")!;
    expect(unvetted).toMatchObject({ state: "unvetted", action: { kind: "evaluate", label: "Evaluate · ~10 pts" } });
    expect(view({}, tFr, "fr").groups[2]!.rows.find((r) => r.name === "Lights")!.action!.label).toBe("Évaluer · ~10 pts");
  });

  test("spec and ilvl read — without a cached verdict, and a verdict without them", () => {
    const lights = view().groups[2]!.rows.find((r) => r.name === "Lights")!;
    expect([lights.spec, lights.ilvl, lights.rio]).toEqual(["—", "—", "3034"]);
    const bare = new Map(mockVerdicts).set("Lights-Malfurion", cv("pass", 31, NOW, null, null));
    const r = view({ verdicts: bare }).groups[2]!.rows.find((x) => x.name === "Lights")!;
    expect([r.spec, r.ilvl, r.state]).toEqual(["—", "—", "vetted"]);
  });

  test("status: title, key line, counts", () => {
    const v = view();
    expect(v.status.title).toBe("Game connected · Group Finder open");
    expect(v.status.key).toBe("Your key: +19 · updated just now");
    expect(v.status.counts).toEqual([
      { label: "applicants", value: "7", tone: null },
      { label: "evaluated", value: "6", tone: null },
      { label: "INVITE", value: "4", tone: "invite" },
    ]);
    expect(view({ yourKey: null }).status.key).toBe("Your key: auto");
    const fv = view({ now: NOW + 2 * 60_000 }, tFr, "fr");
    expect(fv.status.key).toBe("Ta clé : +19 · mis à jour il y a 2 min");
    expect(fv.status.counts.map((c) => c.label)).toEqual(["candidats", "évalués", "INVITE"]);
    expect(v.columns.verdict).toBe("Verdict at +19");
    expect(view({ yourKey: null }, tFr, "fr").columns.verdict).toBe("Verdict");
  });

  test("party: the self row says 'you · DPS', never a verdict or an action; the line counts missing roles", () => {
    const v = view();
    expect(v.party.members.map((m) => [m.name, m.state, m.verdict, m.action, m.you])).toEqual([["Biwaasham", "self", null, null, "you · DPS"]]);
    expect(v.party.missing).toEqual(["tank", "healer", "dps", "dps"]);
    expect(v.party.line).toBe("1 / 5 · missing 1 tank, 1 healer, and 2 DPS");
    expect(view({}, tFr, "fr").party.line).toBe("1 / 5 · il manque 1 tank, 1 heal et 2 DPS");
    expect(view({}, tFr, "fr").party.members[0]!.you).toBe("toi · DPS");
  });

  test("party: a full group, two DPS missing, and a party member keeps the applicant treatment", () => {
    const full = { ...mockRoster, players: parseRoster(
      "p|Tanky-Hyjal|6|T|1\np|Heals-Hyjal|7|H|1\np|Dps1-Hyjal|4|D|1\np|Dps2-Hyjal|3|D|1\ns|Me-Hyjal|9|D|1\n",
    ) };
    const fv = view({ roster: full }, tFr, "fr");
    expect(fv.party.line).toBe("5 / 5 · groupe complet");
    expect(fv.party.missing).toEqual([]);
    expect(fv.groups).toEqual([]);
    const three = { ...mockRoster, players: parseRoster("p|Tanky-Hyjal|6|T|1\np|Heals-Hyjal|7|H|1\ns|Me-Hyjal|9|D|1\n") };
    const tv = view({ roster: three }, tFr, "fr");
    expect(tv.party.line).toBe("3 / 5 · il manque 2 DPS");
    expect(tv.party.missing).toEqual(["dps", "dps"]);
    expect(view({ roster: three }).party.line).toBe("3 / 5 · missing 2 DPS");
    const tanky = tv.party.members[0]!;
    expect(tanky).toMatchObject({ id: "party:0", state: "unvetted", action: { kind: "evaluate" }, you: null });
    const oneTank = { ...mockRoster, players: parseRoster("p|Tanky-Hyjal|6|T|1\np|Tank2-Hyjal|1|T|1\ns|Me-Hyjal|9|D|1\n") };
    expect(view({ roster: oneTank }, tFr, "fr").party.line).toBe("3 / 5 · il manque 1 heal et 2 DPS");
  });

  test("hidden counts the applicants the filters leave out", () => {
    expect(view().hidden).toBe(0);
    expect(view({ settings: { ...all, liveRoles: ["dps"] } }).hidden).toBe(2);
    expect(view({ settings: { ...all, liveClasses: ["Hunter"] } }).hidden).toBe(5);
  });

  test("the note says where spec and ilvl come from", () => {
    expect(view({}, tFr, "fr").note).toBe("Le jeu ne donne que le nom, la classe, le rôle et le score Raider.IO. La spé et l'ilvl viennent de l'évaluation bmpl.");
  });
});
