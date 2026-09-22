import { describe, expect, test } from "bun:test";
import { tEn } from "../../i18n/t.ts";
import { parseRoster } from "./roster.ts";
import type { CachedVerdict } from "./roster.ts";
import { autoQueue, classMenu, panelView, sortMenu } from "./panel.ts";

const roster = {
  seq: 1,
  at: 0,
  players: parseRoster(
    "a|Biwaadrood-Nerzhul|Druid|Restoration|H|3412\n" +
    "a|Tankadin-Hyjal|Paladin|Protection|T|2890\n" +
    "a|Sombrelame-Dalaran|DemonHunter|Havoc|D|3105\n" +
    "p|Muleyoxo-Hyjal|Monk|Windwalker|D|3240\n",
  ),
};
const verdicts = new Map<string, CachedVerdict>([
  ["Biwaadrood-Nerzhul", { verdict: "invite", score: 78, targetLevel: 18, fetchedAt: 0 }],
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
        "a|Applicant-Realm|Druid|Restoration|H|100\n" +
        "p|Mate-Realm|Paladin|Protection|T|200\n" +
        "s|Me-Realm|Warrior|Fury|D|300\n",
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
