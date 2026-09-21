import { describe, expect, test } from "bun:test";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { initialsOf, menuModel, pendingText, quotaLine } from "./session.ts";
import { fmtPts } from "./format.ts";

const tFr = makeT(fr, "fr");
const member = { id: 2, discordId: "22", username: "muleyoxo", globalName: "Muleyoxo", avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png", role: "member" as const };
const admin = { ...member, id: 1, role: "admin" as const, globalName: null };

describe("quotaLine", () => {
  test("left of limit, reset in minutes, percentage left, tone by what is left", () => {
    expect(quotaLine(tEn, { used: 88, limit: 300, resetInS: 2280 }, false)).toEqual({ text: "212 of 300 pts left this hour", sub: "resets in 38 min", pct: 71, tone: "" });
    expect(quotaLine(tEn, { used: 280, limit: 300, resetInS: 60 }, false).tone).toBe("tone-warn");
    expect(quotaLine(tEn, { used: 300, limit: 300, resetInS: 5 }, false)).toEqual({ text: "0 of 300 pts left this hour", sub: "resets in 1 min", pct: 0, tone: "tone-bad" });
  });
  test("no limit: admins are unlimited, otherwise no quota", () => {
    expect(quotaLine(tEn, { used: 5, limit: null, resetInS: 1 }, true)).toEqual({ text: "unlimited · admin", sub: null, pct: null, tone: "" });
    expect(quotaLine(tEn, null, false)).toEqual({ text: "no quota", sub: null, pct: null, tone: "" });
  });
  test("in French", () => {
    expect(quotaLine(tFr, { used: 88, limit: 300, resetInS: 2280 }, false).text).toBe("212 pts sur 300 restants cette heure");
  });
});

describe("menuModel", () => {
  test("display name, handle with role, initials, admin flag, quota line", () => {
    const m = menuModel(tEn, member, { used: 88, limit: 300, resetInS: 2280 });
    expect(m.name).toBe("Muleyoxo");
    expect(m.handle).toBe("@muleyoxo");
    expect(m.initials).toBe("M");
    expect(m.isAdmin).toBe(false);
    expect(m.avatarUrl).toBe(member.avatarUrl);
    expect(m.quota.text).toBe("212 of 300 pts left this hour");
    expect(m.exhausted).toBeNull();
    expect(m.ownClient).toBe(false);
    expect(m.guideLink).toEqual({ label: "Use your own Warcraft Logs client →", href: "/help#wcl-client" });
  });
  test("admin: username as name, ' · admin' in the handle", () => {
    const m = menuModel(tEn, admin, null);
    expect(m.name).toBe("muleyoxo");
    expect(m.handle).toBe("@muleyoxo · admin");
    expect(m.isAdmin).toBe(true);
    expect(m.quota.text).toBe("unlimited · admin");
    expect(m.guideLink).toBeNull();
  });
  test("exhausted: the header label only once nothing is left", () => {
    expect(menuModel(tEn, member, { used: 299, limit: 300, resetInS: 90 }).exhausted).toBeNull();
    expect(menuModel(tEn, member, { used: 300, limit: 300, resetInS: 90 }).exhausted).toBe("quota reached · resets in 2 min");
  });
});

describe("initialsOf / pendingText", () => {
  test("first letter upper-cased, '?' for an empty name", () => {
    expect(initialsOf("muleyoxo")).toBe("M");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("😀tom")).toBe("😀");
  });
  test("pending proposals count, singular/plural, null for none", () => {
    expect(pendingText(tEn, 0)).toBeNull();
    expect(pendingText(tEn, 1)).toBe("1 pending proposal");
    expect(pendingText(tEn, 2)).toBe("2 pending proposals");
  });
  test("pendingText in French", () => {
    expect(pendingText(tFr, 2)).toBe("2 propositions en attente");
  });
});

describe("menuModel with an own client", () => {
  const own = { clientId: "a3f1…9c2e", verifiedAt: 1, updatedAt: 1, usable: true, snapshot: { pointsSpentThisHour: 1412, limitPerHour: 3600, pointsResetIn: 2280, observedAt: 1 } };
  test("the quota line is the client's counter and the header never says exhausted", () => {
    const m = menuModel(tEn, member, { used: 300, limit: 300, resetInS: 60 }, own);
    expect(m.quota).toEqual({ text: "Your WCL client · 1 412 / 3 600 pts", sub: "resets in 38 min", pct: 61, tone: "" });
    expect(m.exhausted).toBeNull();
    expect(m.ownClient).toBe(true);
    expect(m.guideLink).toBeNull();
    expect(menuModel(tEn, member, null, { ...own, snapshot: null }).quota).toEqual({ text: "Your WCL client · no request yet", sub: null, pct: null, tone: "" });
    expect(menuModel(tEn, member, null, { ...own, snapshot: { ...own.snapshot, pointsSpentThisHour: 3550 } }).quota.tone).toBe("tone-warn");
    expect(menuModel(tEn, member, null, { ...own, snapshot: { ...own.snapshot, pointsSpentThisHour: 3600 } }).quota).toMatchObject({ pct: 0, tone: "tone-bad" });
  });
  test("an undecryptable client (instance key rotated) warns and falls back to the shared quota", () => {
    const m = menuModel(tEn, member, { used: 300, limit: 300, resetInS: 60 }, { ...own, usable: false });
    expect(m.quota).toEqual({ text: "Your WCL client needs re-saving · using the shared budget", sub: "Settings → save the client again", pct: null, tone: "tone-warn" });
    expect(m.exhausted).not.toBeNull();
    expect(m.ownClient).toBe(false);
    expect(m.guideLink).not.toBeNull();
  });
  test("fmtPts: thousands separated by a narrow no-break space", () => {
    expect(fmtPts(1412)).toBe("1 412");
    expect(fmtPts(3600.7)).toBe("3 600");
    expect(fmtPts(37)).toBe("37");
    expect(fmtPts(1_234_567)).toBe("1 234 567");
  });
});
