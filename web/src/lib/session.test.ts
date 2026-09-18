import { describe, expect, test } from "bun:test";
import { initialsOf, menuModel, pendingText, quotaLine } from "./session.ts";

const member = { id: 2, discordId: "22", username: "muleyoxo", globalName: "Muleyoxo", avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png", role: "member" as const };
const admin = { ...member, id: 1, role: "admin" as const, globalName: null };

describe("quotaLine", () => {
  test("left of limit, reset in minutes, percentage left, tone by what is left", () => {
    expect(quotaLine({ used: 88, limit: 300, resetInS: 2280 }, false)).toEqual({ text: "212 of 300 pts left this hour", sub: "resets in 38 min", pct: 71, tone: "" });
    expect(quotaLine({ used: 280, limit: 300, resetInS: 60 }, false).tone).toBe("tone-warn");
    expect(quotaLine({ used: 300, limit: 300, resetInS: 5 }, false)).toEqual({ text: "0 of 300 pts left this hour", sub: "resets in 1 min", pct: 0, tone: "tone-bad" });
  });
  test("no limit: admins are unlimited, otherwise no quota", () => {
    expect(quotaLine({ used: 5, limit: null, resetInS: 1 }, true)).toEqual({ text: "unlimited · admin", sub: null, pct: null, tone: "" });
    expect(quotaLine(null, false)).toEqual({ text: "no quota", sub: null, pct: null, tone: "" });
  });
});

describe("menuModel", () => {
  test("display name, handle with role, initials, admin flag, quota line", () => {
    const m = menuModel(member, { used: 88, limit: 300, resetInS: 2280 });
    expect(m.name).toBe("Muleyoxo");
    expect(m.handle).toBe("@muleyoxo");
    expect(m.initials).toBe("M");
    expect(m.isAdmin).toBe(false);
    expect(m.avatarUrl).toBe(member.avatarUrl);
    expect(m.quota.text).toBe("212 of 300 pts left this hour");
    expect(m.exhausted).toBeNull();
  });
  test("admin: username as name, ' · admin' in the handle", () => {
    const m = menuModel(admin, null);
    expect(m.name).toBe("muleyoxo");
    expect(m.handle).toBe("@muleyoxo · admin");
    expect(m.isAdmin).toBe(true);
    expect(m.quota.text).toBe("unlimited · admin");
  });
  test("exhausted: the header label only once nothing is left", () => {
    expect(menuModel(member, { used: 299, limit: 300, resetInS: 90 }).exhausted).toBeNull();
    expect(menuModel(member, { used: 300, limit: 300, resetInS: 90 }).exhausted).toBe("quota reached · resets in 2 min");
  });
});

describe("initialsOf / pendingText", () => {
  test("first letter upper-cased, '?' for an empty name", () => {
    expect(initialsOf("muleyoxo")).toBe("M");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("😀tom")).toBe("😀");
  });
  test("pending proposals count, singular/plural, null for none", () => {
    expect(pendingText(0)).toBeNull();
    expect(pendingText(1)).toBe("1 pending proposal");
    expect(pendingText(2)).toBe("2 pending proposals");
  });
});
