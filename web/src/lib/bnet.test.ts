import { describe, expect, test } from "bun:test";
import type { BnetCallbackCode, BnetCandidate, MyCharacter } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import {
  BNET_CODES, bnetCodeOf, bnetNotice, linkedLine, makeMainPick, pickCount, pickFailureNotice, pickHeader, pickKey, pickerRows,
  picksBody, picksFromList, removedNotice, saveLabel, togglePick, unlinkConfirm,
} from "./bnet.ts";
import { MAX_ME } from "./self.ts";

const tFr = makeT(fr, "fr");
const cand = (bnetId: number, name: string, over: Partial<BnetCandidate> = {}): BnetCandidate =>
  ({ bnetId, name, realm: "silvermoon", realmName: "Silvermoon", region: "eu", level: 90, classID: 5, ...over });
const candidates = [
  cand(1, "Muleyoxo"),
  cand(2, "Biwaasham", { realm: "hyjal", realmName: "Hyjal", classID: 7 }),
  cand(3, "Muleyus", { realm: "area-52", realmName: "Area 52", region: "us", classID: 6 }),
  cand(4, "Banktoon", { level: 12, classID: null }),
];

describe("?bnet= codes", () => {
  test("BNET_CODES is exactly the server's BnetCallbackCode union", () => {
    // A missing or extra member is a tsc error here; the runtime check pins the array to the same set.
    const all: Record<BnetCallbackCode, true> = { pick: true, cancelled: true, state: true, scope: true, taken: true, empty: true, down: true };
    expect([...BNET_CODES].sort() as string[]).toEqual(Object.keys(all).sort());
  });
  test("read from the query string, anything else is null", () => {
    expect(bnetCodeOf("?bnet=pick")).toBe("pick");
    expect(bnetCodeOf("?x=1&bnet=taken")).toBe("taken");
    expect(bnetCodeOf("?bnet=nope")).toBeNull();
    expect(bnetCodeOf("")).toBeNull();
  });
  test("each code's notice, in the spec's wording; pick has none", () => {
    expect(bnetNotice(tEn, "pick")).toBeNull();
    expect(bnetNotice(tEn, "cancelled")).toEqual({ text: "Battle.net linking cancelled.", tone: "muted" });
    expect(bnetNotice(tEn, "state")).toEqual({ text: "This Battle.net link expired: start again from My characters.", tone: "bad" });
    expect(bnetNotice(tEn, "scope")?.text).toBe("Battle.net did not share your characters: allow World of Warcraft profile access and link again.");
    expect(bnetNotice(tEn, "taken")?.text).toBe("This Battle.net account is linked to another bmpl account.");
    expect(bnetNotice(tEn, "empty")?.text).toBe(
      "Battle.net returned no characters. Check that third-party access is allowed in your Blizzard privacy settings (account.blizzard.com/privacy), then link again.",
    );
    expect(bnetNotice(tEn, "down")).toEqual({ text: "Battle.net did not answer: try again in a moment.", tone: "bad" });
    expect(bnetNotice(tEn, "expired")).toEqual({ text: "This import expired: link again.", tone: "bad" });
    expect(bnetNotice(tFr, "down")?.text).toBe("Battle.net n'a pas répondu : réessaie dans un instant.");
  });
  test("a pick refused with 410 bnet_import_expired reads as the expired notice; any other failure keeps its message", () => {
    expect(pickFailureNotice(tEn, { error: "This import expired: link Battle.net again.", code: "bnet_import_expired" }))
      .toEqual({ text: "This import expired: link again.", tone: "bad" });
    expect(pickFailureNotice(tEn, { error: "A picked character is not in this Battle.net import.", code: null }))
      .toEqual({ text: "A picked character is not in this Battle.net import.", tone: "bad" });
  });
});

describe("picker", () => {
  test("key, toggle up to the cap, make main", () => {
    expect(pickKey(candidates[2]!)).toBe("us|3");
    expect(togglePick([], "eu|1")).toEqual(["eu|1"]);
    expect(togglePick(["eu|1", "eu|2"], "eu|1")).toEqual(["eu|2"]);
    expect(togglePick(["eu|1"], "eu|2", 1)).toBeNull();
    const full = Array.from({ length: MAX_ME }, (_, i) => `eu|${100 + i}`);
    expect(togglePick(full, "eu|1")).toBeNull();
    expect(togglePick(full, "eu|100")).toHaveLength(MAX_ME - 1);
    expect(makeMainPick(["eu|1", "eu|2", "us|3"], "us|3")).toEqual(["us|3", "eu|1", "eu|2"]);
    expect(makeMainPick(["eu|1"], "eu|2")).toEqual(["eu|1"]);
  });
  test("rows keep the import's order; the main is the first ticked; unticked rows are disabled once full", () => {
    const rows = pickerRows(candidates, ["eu|2", "eu|1"]);
    expect(rows[0]).toEqual({
      key: "eu|1", name: "Muleyoxo", realm: "Silvermoon", region: "EU", level: 90, classID: 5, checked: true, main: false, disabled: false,
    });
    expect(rows.map((r) => [r.key, r.checked, r.main])).toEqual([["eu|1", true, false], ["eu|2", true, true], ["us|3", false, false], ["eu|4", false, false]]);
    expect(rows[2]!.realm).toBe("Area 52");
    expect(rows[3]!.classID).toBeNull();
    const full = Array.from({ length: MAX_ME }, (_, i) => `eu|${100 + i}`);
    expect(pickerRows(candidates, ["eu|1", ...full.slice(1)]).map((r) => r.disabled)).toEqual([false, true, true, true]);
  });
  test("header, count and save label", () => {
    expect(pickHeader(tEn, "Tomr#2147", candidates)).toBe("from Tomr#2147 · 4 characters in 2 regions · highest level first");
    expect(pickHeader(tEn, null, [candidates[0]!])).toBe("from your Battle.net account · 1 character in 1 region · highest level first");
    expect(pickHeader(tFr, "Tomr#2147", candidates)).toBe("de Tomr#2147 · 4 personnages dans 2 régions · niveau le plus haut d'abord");
    expect(pickCount(tEn, ["eu|1", "eu|2", "us|3"])).toBe("3 of 20 ticked · the main is the first you ticked");
    expect(pickCount(tFr, ["eu|1"])).toBe("1 coché sur 20 · le principal est le premier que tu as coché");
    expect(pickCount(tFr, ["eu|1", "eu|2"])).toBe("2 cochés sur 20 · le principal est le premier que tu as coché");
    expect(saveLabel(tEn, 3)).toBe("Save 3 characters");
    expect(saveLabel(tEn, 1)).toBe("Save 1 character");
  });
  test("the body follows the tick order and skips keys the import does not hold", () => {
    expect(picksBody(candidates, ["us|3", "eu|1", "eu|99"])).toEqual([{ region: "us", bnetId: 3 }, { region: "eu", bnetId: 1 }]);
  });
  test("Import again starts with the list's Battle.net characters ticked, in list order", () => {
    const chars: MyCharacter[] = [
      { name: "Muleyus", realm: "area-52", region: "us", source: "bnet", bnetId: 3, verifiedAt: 1 },
      { name: "Gone", realm: "silvermoon", region: "eu", source: "bnet", bnetId: 77, verifiedAt: 1 },
      { name: "Muleyoxo", realm: "silvermoon", region: "eu", source: "bnet", bnetId: 1, verifiedAt: 1 },
      { name: "Hand", realm: "silvermoon", region: "eu", source: "manual" },
    ];
    expect(picksFromList(candidates, chars)).toEqual(["us|3", "eu|1"]);
  });
});

describe("linked state and notices", () => {
  const at = Date.UTC(2026, 9, 11, 12);
  test("linked line with the BattleTag and the link date", () => {
    expect(linkedLine(tEn, "en", { battletag: "Tomr#2147", linkedAt: at }))
      .toEqual({ who: "Tomr#2147", text: "· linked 11 Oct · characters re-checked every 30 days" });
    expect(linkedLine(tEn, "en", { battletag: null, linkedAt: at }).who).toBe("your Battle.net account");
    expect(linkedLine(tFr, "fr", { battletag: "Tomr#2147", linkedAt: at }).text).toBe("· lié le 11 oct. · personnages revérifiés tous les 30 jours");
  });
  test("unlink confirmation counts the characters that leave", () => {
    expect(unlinkConfirm(tEn, 3)).toBe("Unlink Battle.net? Your 3 characters leave My characters; their cached runs stay. You can link again at any time.");
    expect(unlinkConfirm(tEn, 1)).toBe("Unlink Battle.net? Your character leaves My characters; its cached runs stay. You can link again at any time.");
    expect(unlinkConfirm(tEn, 0)).toBe("Unlink Battle.net? You can link again at any time.");
    expect(unlinkConfirm(tFr, 2)).toBe("Délier Battle.net ? Tes 2 personnages quittent Mes personnages ; leurs runs en cache restent. Tu peux le lier à nouveau à tout moment.");
  });
  test("removal notice from the check round's Name-realm labels", () => {
    expect(removedNotice(tEn, [])).toBeNull();
    expect(removedNotice(tEn, ["Biwaadrood-nerzhul"])).toEqual({
      text: "Biwaadrood (Nerzhul) left your list: it is no longer on your Battle.net account, or it could not be checked for 30 days.",
      tone: "warn",
    });
    expect(removedNotice(tEn, ["Biwaadrood-nerzhul", "Muleyus-area-52"])?.text)
      .toBe("Biwaadrood (Nerzhul), Muleyus (Area 52) left your list: they are no longer on your Battle.net account, or they could not be checked for 30 days.");
    expect(removedNotice(tFr, ["Biwaadrood-nerzhul"])?.text)
      .toBe("Biwaadrood (Nerzhul) a quitté ta liste : il n'est plus sur ton compte Battle.net, ou il n'a pas pu être vérifié pendant 30 jours.");
  });
});
