import { describe, expect, test } from "bun:test";
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser } from "../types.ts";
import { decidedLine, diffRows, fmtBytes, fmtPts, fmtUptime, gaugeModel, hourBars, instanceModel, inviteRow, proposalCard, topConsumers, userRow } from "./admin.ts";

const NOW = 1_800_000_000_000;
const H = 3600_000;
const usage: AdminUsage = {
  hourStart: NOW - (NOW % H), resetInS: 2280, limitPerUser: 300,
  instance: { limitPerHour: 3600, pointsSpentThisHour: 1412, pointsResetIn: 2280, observedAt: NOW - 120_000, windowEnd: NOW + 2280_000 },
  users: [{ userId: 2, discordId: "22", username: "tom", role: "member", points: 252 }, { userId: 1, discordId: "11", username: "muleyoxo", role: "admin", points: 181 }],
  hours: [{ hourStart: NOW - (NOW % H) - 2 * H, points: 3170 }, { hourStart: NOW - (NOW % H), points: 1412 }],
};
const users: AdminUser[] = [
  { id: 1, discordId: "11", username: "muleyoxo", globalName: "Muleyoxo", avatarUrl: "a", role: "admin", createdAt: 0, lastSeenAt: NOW - 10_000, pointsHour: 181, points24h: 2340, sessions: 2, configAdmin: true },
  { id: 2, discordId: "22", username: "tom", globalName: null, avatarUrl: "b", role: "member", createdAt: 0, lastSeenAt: NOW - 2 * H, pointsHour: 252, points24h: 1118, sessions: 1, configAdmin: false },
];

describe("gauge", () => {
  test("instance points vs limit, reset, floor note, snapshot age", () => {
    const g = gaugeModel(usage, NOW);
    expect(g).toEqual({ used: "1 412", limit: "3 600", pct: 39, tone: "", sub: "resets in 38 min · floor 100 pts · last rateLimitData 2 min ago" });
  });
  test("tones: yellow above 75 %, red above 90 %; no snapshot yet", () => {
    expect(gaugeModel({ ...usage, instance: { ...usage.instance!, pointsSpentThisHour: 2800 } }, NOW).tone).toBe("tone-warn");
    expect(gaugeModel({ ...usage, instance: { ...usage.instance!, pointsSpentThisHour: 3400 } }, NOW).tone).toBe("tone-bad");
    expect(gaugeModel({ ...usage, instance: null }, NOW)).toEqual({ used: "—", limit: "3 600", pct: 0, tone: "", sub: "no WCL call observed since the server started" });
    expect(gaugeModel(null, NOW).used).toBe("—");
  });
  test("top consumers: largest first, bar vs the member limit, admins unlimited", () => {
    expect(topConsumers(usage, users)).toEqual([
      { userId: 2, name: "tom", initials: "T", avatarUrl: "b", isAdmin: false, pct: 84, text: "252 / 300", tone: "tone-warn" },
      { userId: 1, name: "Muleyoxo", initials: "M", avatarUrl: "a", isAdmin: true, pct: 60, text: "181 · no limit", tone: "" },
    ]);
  });
  test("hour bars: 24 slots ending now, missing hours at 0, heights relative to the peak, current hour marked", () => {
    const bars = hourBars(usage, NOW);
    expect(bars).toHaveLength(24);
    expect(bars[23]).toEqual({ hourStart: NOW - (NOW % H), points: 1412, pct: 45, current: true });
    expect(bars[21]).toEqual({ hourStart: NOW - (NOW % H) - 2 * H, points: 3170, pct: 100, current: false });
    expect(bars[0]!.points).toBe(0);
    expect(hourBars({ ...usage, hours: [] }, NOW).every((b) => b.pct === 0)).toBe(true);
  });
});

const proposal = (over: Partial<AdminProposal> = {}): AdminProposal => ({
  id: 7, spellId: 642, status: "pending", patch: { id: 642, cooldownS: 240 }, note: null, createdAt: NOW - 2 * H, decidedAt: null,
  key: "Paladin:Holy", proposedBy: 2, username: "bob", current: { id: 642, name: "Divine Shield", cooldownS: 300, durationS: 8, kind: "immunity" }, ignored: false, ...over,
});

describe("proposal cards", () => {
  test("diff rows: changed fields only, current → proposed", () => {
    expect(diffRows(proposal())).toEqual([{ field: "cooldown", from: "300 s", to: "240 s" }]);
    expect(diffRows(proposal({ patch: { id: 1044, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 }, current: null, spellId: 1044 }))).toEqual([
      { field: "kind", from: "— (not in table)", to: "minor" }, { field: "cooldown", from: "—", to: "25 s" }, { field: "duration", from: "—", to: "6 s" },
    ]);
    expect(diffRows(proposal({ patch: { id: 642, ignore: true } }))).toEqual([{ field: "ignore", from: "listed (immunity, cd 300 s)", to: "ignored for this spec" }]);
    expect(diffRows(proposal({ patch: { id: 642, ignore: true }, current: null, ignored: true }))).toEqual([{ field: "ignore", from: "already ignored", to: "ignored for this spec" }]);
    expect(diffRows(proposal({ patch: { id: 642, cooldownS: 300 } }))).toEqual([{ field: "cooldown", from: "300 s", to: "300 s (no change)" }]);
  });
  test("card: name from current or patch, key, author, age", () => {
    const c = proposalCard(proposal(), NOW);
    expect(c).toEqual({ id: 7, spellId: 642, name: "Divine Shield", key: "Paladin:Holy", author: "bob", when: "2h ago", rows: [{ field: "cooldown", from: "300 s", to: "240 s" }] });
    expect(proposalCard(proposal({ current: null, patch: { id: 9, name: "New", kind: "minor", cooldownS: 1, durationS: 1 }, username: null }), NOW).name).toBe("New");
    expect(proposalCard(proposal({ current: null, patch: { id: 9, cooldownS: 1 }, username: null }), NOW)).toMatchObject({ name: "spell 9", author: "unknown user" });
  });
  test("decided line: dot by status, what, who, when, note", () => {
    const l = decidedLine(proposal({ status: "approved", decidedAt: NOW - 5 * 24 * H, note: "Fine as a minor.", patch: { id: 498, cooldownS: 60 }, spellId: 498, current: { id: 498, name: "Divine Protection", cooldownS: 60, durationS: 8, kind: "major" } }), NOW);
    expect(l).toEqual({ id: 7, dot: "dot-approved", what: "Divine Protection · Paladin:Holy · cd 60 s", author: "bob", status: "approved", when: "5d ago", note: "Fine as a minor." });
    expect(decidedLine(proposal({ status: "rejected", decidedAt: NOW - H }), NOW).dot).toBe("dot-rejected");
  });
});

describe("users, invites, instance", () => {
  test("user row: display name, handle, role chip, toggle label, last seen, points, revoke text, self/config guards", () => {
    expect(userRow(users[0]!, NOW, 1)).toEqual({
      id: 1, name: "Muleyoxo", handle: "@muleyoxo", initials: "M", avatarUrl: "a", role: "admin", roleNote: "env", toggle: null,
      lastSeen: "just now", pointsHour: "181", pointsHourTone: "", points24h: "2 340", discordId: "11", sessions: 2, canRevoke: false,
    });
    const tom = userRow(users[1]!, NOW, 1);
    expect(tom).toMatchObject({ role: "member", roleNote: null, toggle: "make admin", lastSeen: "2h ago", pointsHour: "252", pointsHourTone: "tone-warn", points24h: "1 118", canRevoke: true });
    expect(userRow({ ...users[1]!, role: "admin" }, NOW, 1).toggle).toBe("make member");
    expect(userRow({ ...users[1]!, pointsHour: 300 }, NOW, 1).pointsHourTone).toBe("tone-bad");
  });
  test("invite row: note or dash, added by admin id or CLI, status chip", () => {
    const base: AdminInvite = { discordId: "22", invitedBy: "admin:1", createdAt: NOW - 6 * 24 * H, note: "guild mate", user: { id: 2, username: "tom" } };
    expect(inviteRow(base, NOW)).toEqual({ discordId: "22", note: "guild mate", added: "6d ago · admin #1", status: "signed in as tom", signedIn: true });
    expect(inviteRow({ ...base, note: null, invitedBy: "cli", user: null }, NOW)).toEqual({ discordId: "22", note: "—", added: "6d ago · cli", status: "not signed in yet", signedIn: false });
  });
  test("instance: version, uptime, db, backup age or never, env rows as given", () => {
    const i: AdminInstance = { version: "0.1.0", uptimeS: 3 * 86400 + 4 * 3600 + 5, dbPath: "/opt/bmpl/bmpl.db", dbBytes: 43_200_000, lastBackupAt: NOW - 12 * 60_000, env: [{ key: "BMPL_BASE_URL", value: "https://x", secret: false }] };
    expect(instanceModel(i, NOW)).toEqual({ version: "0.1.0", uptime: "3 d 4 h", db: "bmpl.db · 41.2 MB", dbPath: "/opt/bmpl/bmpl.db", backup: "12 min ago", env: i.env });
    expect(instanceModel({ ...i, lastBackupAt: null, uptimeS: 90 }, NOW)).toMatchObject({ backup: "never (no last-backup file yet)", uptime: "1 min" });
  });
  test("formatters", () => {
    expect(fmtPts(1412.4)).toBe("1 412");
    expect(fmtPts(37)).toBe("37");
    expect(fmtBytes(43_200_000)).toBe("41.2 MB");
    expect(fmtBytes(800)).toBe("800 B");
    expect(fmtBytes(20_480)).toBe("20.0 KB");
    expect(fmtUptime(59)).toBe("less than a minute");
    expect(fmtUptime(3600 * 5 + 60 * 7)).toBe("5 h 7 min");
  });
});
