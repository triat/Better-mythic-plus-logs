import { describe, expect, test } from "bun:test";
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser, AuditRow } from "../types.ts";
import { fr } from "../i18n/fr.ts";
import { makeT, tEn } from "../i18n/t.ts";
import { AUDIT_KIND_OF, auditChips, auditDetail, auditRow, auditShowing, decidedLine, diffRows, fmtBytes, fmtUptime, gaugeModel, hourBars, instanceModel, inviteRow, proposalCard, topConsumers, userRow } from "./admin.ts";
import { fmtPts } from "./format.ts";

const tFr = makeT(fr, "fr");

const NOW = 1_800_000_000_000;
const H = 3600_000;
const usage: AdminUsage = {
  hourStart: NOW - (NOW % H), resetInS: 2280, limitPerUser: 300,
  instance: { limitPerHour: 3600, pointsSpentThisHour: 1412, pointsResetIn: 2280, observedAt: NOW - 120_000, windowEnd: NOW + 2280_000 },
  users: [{ userId: 2, discordId: "22", username: "tom", role: "member", points: 252 }, { userId: 1, discordId: "11", username: "muleyoxo", role: "admin", points: 181 }],
  hours: [{ hourStart: NOW - (NOW % H) - 2 * H, points: 3170 }, { hourStart: NOW - (NOW % H), points: 1412 }],
};
const users: AdminUser[] = [
  { id: 1, discordId: "11", username: "muleyoxo", globalName: "Muleyoxo", avatarUrl: "a", role: "admin", createdAt: 0, lastSeenAt: NOW - 10_000, pointsHour: 181, points24h: 2340, sessions: 2, configAdmin: true, bannedAt: null, ownClient: false },
  { id: 2, discordId: "22", username: "tom", globalName: null, avatarUrl: "b", role: "member", createdAt: 0, lastSeenAt: NOW - 2 * H, pointsHour: 252, points24h: 1118, sessions: 1, configAdmin: false, bannedAt: null, ownClient: false },
];

describe("gauge", () => {
  test("instance points vs limit, reset, floor note, snapshot age", () => {
    const g = gaugeModel(tEn, usage, NOW);
    expect(g).toEqual({ used: "1 412", limit: "3 600", pct: 39, tone: "", sub: "resets in 38 min · floor 100 pts · last rateLimitData 2 min ago" });
  });
  test("tones: yellow above 75 %, red above 90 %; no snapshot yet", () => {
    expect(gaugeModel(tEn, { ...usage, instance: { ...usage.instance!, pointsSpentThisHour: 2800 } }, NOW).tone).toBe("tone-warn");
    expect(gaugeModel(tEn, { ...usage, instance: { ...usage.instance!, pointsSpentThisHour: 3400 } }, NOW).tone).toBe("tone-bad");
    expect(gaugeModel(tEn, { ...usage, instance: null }, NOW)).toEqual({ used: "—", limit: "3 600", pct: 0, tone: "", sub: "no WCL call observed since the server started" });
    expect(gaugeModel(tEn, null, NOW).used).toBe("—");
  });
  test("top consumers: largest first, bar vs the member limit, admins unlimited", () => {
    expect(topConsumers(tEn, usage, users)).toEqual([
      { userId: 2, name: "tom", initials: "T", avatarUrl: "b", isAdmin: false, pct: 84, text: "252 / 300", tone: "tone-warn" },
      { userId: 1, name: "Muleyoxo", initials: "M", avatarUrl: "a", isAdmin: true, pct: 60, text: "181 · no limit", tone: "" },
    ]);
  });
  test("French gauge: no call yet, sub line, admin without limit", () => {
    expect(gaugeModel(tFr, usage, NOW).sub).toBe("reset dans 38 min · plancher 100 pts · dernier rateLimitData il y a 2 min");
    expect(gaugeModel(tFr, null, NOW).sub).toBe("aucun appel WCL observé depuis le démarrage du serveur");
    expect(topConsumers(tFr, usage, users)[1]!.text).toBe("181 · sans limite");
  });
  test("top consumers: a spender the user list no longer knows is named by id", () => {
    const gone = { ...usage, users: [{ userId: 9, discordId: "99", username: null, role: "member" as const, points: 10 }] };
    expect(topConsumers(tEn, gone, users)[0]!.name).toBe("user #9");
    expect(topConsumers(tFr, gone, users)[0]!.name).toBe("membre #9");
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
    expect(diffRows(tEn, proposal())).toEqual([{ field: "cooldown", from: "300 s", to: "240 s" }]);
    expect(diffRows(tEn, proposal({ patch: { id: 1044, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 }, current: null, spellId: 1044 }))).toEqual([
      { field: "kind", from: "— (not in table)", to: "minor" }, { field: "cooldown", from: "—", to: "25 s" }, { field: "duration", from: "—", to: "6 s" },
    ]);
    expect(diffRows(tEn, proposal({ patch: { id: 642, ignore: true } }))).toEqual([{ field: "ignore", from: "listed (immunity, cd 300 s)", to: "ignored for this spec" }]);
    expect(diffRows(tEn, proposal({ patch: { id: 642, ignore: true }, current: null, ignored: true }))).toEqual([{ field: "ignore", from: "already ignored", to: "ignored for this spec" }]);
    expect(diffRows(tEn, proposal({ patch: { id: 642, cooldownS: 300 } }))).toEqual([{ field: "cooldown", from: "300 s", to: "300 s (no change)" }]);
    expect(diffRows(tEn, proposal({ patch: { id: 642, name: "Divine Shield (renamed)", cooldownS: 240 } }))).toEqual([
      { field: "name", from: "Divine Shield", to: "Divine Shield (renamed)" }, { field: "cooldown", from: "300 s", to: "240 s" },
    ]);
  });
  test("card: name from current or patch, key, author, age", () => {
    const c = proposalCard(tEn, proposal(), NOW);
    expect(c).toEqual({ id: 7, spellId: 642, name: "Divine Shield", key: "Paladin:Holy", author: "bob", when: "2h ago", rows: [{ field: "cooldown", from: "300 s", to: "240 s" }] });
    expect(proposalCard(tEn, proposal({ current: null, patch: { id: 9, name: "New", kind: "minor", cooldownS: 1, durationS: 1 }, username: null }), NOW).name).toBe("New");
    expect(proposalCard(tEn, proposal({ current: null, patch: { id: 9, cooldownS: 1 }, username: null }), NOW)).toMatchObject({ name: "spell 9", author: "unknown user" });
  });
  test("French diff rows and cards", () => {
    expect(diffRows(tFr, proposal({ patch: { id: 642, ignore: true } }))).toEqual([{ field: "ignorer", from: "listé (immunity, cd 300 s)", to: "ignoré pour cette spec" }]);
    expect(diffRows(tFr, proposal({ patch: { id: 1044, kind: "minor", cooldownS: 25 }, current: null, spellId: 1044 }))).toEqual([
      { field: "type", from: "— (pas dans la table)", to: "minor" }, { field: "cooldown", from: "—", to: "25 s" },
    ]);
    expect(diffRows(tFr, proposal({ patch: { id: 642, cooldownS: 300 } }))).toEqual([{ field: "cooldown", from: "300 s", to: "300 s (aucun changement)" }]);
    expect(proposalCard(tFr, proposal({ current: null, patch: { id: 8888, cooldownS: 1 }, username: null }), NOW)).toMatchObject({ name: "sort 8888", author: "utilisateur inconnu", when: "il y a 2 h" });
    expect(decidedLine(tFr, proposal({ status: "approved", decidedAt: NOW - 5 * 24 * H }), NOW)).toMatchObject({ what: "Divine Shield · Paladin:Holy · cd 240 s", when: "il y a 5 j" });
  });
  test("decided line: dot by status, what, who, when, note", () => {
    const l = decidedLine(tEn, proposal({ status: "approved", decidedAt: NOW - 5 * 24 * H, note: "Fine as a minor.", patch: { id: 498, cooldownS: 60 }, spellId: 498, current: { id: 498, name: "Divine Protection", cooldownS: 60, durationS: 8, kind: "major" } }), NOW);
    expect(l).toEqual({ id: 7, dot: "dot-approved", what: "Divine Protection · Paladin:Holy · cd 60 s", author: "bob", status: "approved", when: "5d ago", note: "Fine as a minor." });
    expect(decidedLine(tEn, proposal({ status: "rejected", decidedAt: NOW - H }), NOW).dot).toBe("dot-rejected");
  });
});

describe("users, invites, instance", () => {
  test("user row: display name, handle, role chip, toggle label, last seen, points, revoke text, self/config guards", () => {
    expect(userRow(tEn, users[0]!, NOW, 1)).toEqual({
      id: 1, name: "Muleyoxo", handle: "@muleyoxo", initials: "M", avatarUrl: "a", role: "admin", roleNote: "env", toggle: null,
      lastSeen: "just now", pointsHour: "181", pointsHourTone: "", points24h: "2 340", discordId: "11", sessions: 2, canRevoke: false,
      banned: false, ban: null, pointsCell: "181",
    });
    const tom = userRow(tEn, users[1]!, NOW, 1);
    expect(tom).toMatchObject({ role: "member", roleNote: null, toggle: "make admin", lastSeen: "2h ago", pointsHour: "252", pointsHourTone: "tone-warn", points24h: "1 118", canRevoke: true });
    expect(userRow(tEn, { ...users[1]!, role: "admin" }, NOW, 1).toggle).toBe("make member");
    expect(userRow(tEn, { ...users[1]!, pointsHour: 300 }, NOW, 1).pointsHourTone).toBe("tone-bad");
  });
  test("banned rows and own-client cells", () => {
    const base = { id: 3, discordId: "333333333333333333", username: "bob", globalName: null, avatarUrl: "", role: "member" as const, createdAt: 0, lastSeenAt: NOW, pointsHour: 12, points24h: 40, sessions: 1, configAdmin: false, bannedAt: null, ownClient: true };
    const r = userRow(tEn, base, NOW, 1, 300);
    expect(r.pointsCell).toBe("own client");
    expect(r.ban).toBe("ban");
    expect(r.banned).toBe(false);
    const b = userRow(tEn, { ...base, ownClient: false, bannedAt: NOW - 1000 }, NOW, 1, 300);
    expect(b.pointsCell).toBe("12");
    expect(b.ban).toBe("unban");
    expect(b.banned).toBe(true);
    expect(b.canRevoke).toBe(false);
    expect(r.canRevoke).toBe(true);
    expect(userRow(tEn, { ...base, id: 1 }, NOW, 1, 300).ban).toBeNull();
    expect(userRow(tEn, { ...base, configAdmin: true }, NOW, 1, 300).ban).toBeNull();
  });
  test("French user row: own client, last seen", () => {
    const base = { id: 3, discordId: "333333333333333333", username: "bob", globalName: null, avatarUrl: "", role: "member" as const, createdAt: 0, lastSeenAt: NOW - 3 * H, pointsHour: 12, points24h: 40, sessions: 1, configAdmin: false, bannedAt: null, ownClient: true };
    expect(userRow(tFr, base, NOW, 1, 300)).toMatchObject({ pointsCell: "client perso", lastSeen: "il y a 3 h", toggle: "make admin" });
  });
  test("invite row: note or dash, added by admin id or CLI, status chip", () => {
    const base: AdminInvite = { discordId: "22", invitedBy: "admin:1", createdAt: NOW - 6 * 24 * H, note: "guild mate", user: { id: 2, username: "tom" } };
    expect(inviteRow(tEn, base, NOW)).toEqual({ discordId: "22", note: "guild mate", added: "6d ago · admin #1", status: "signed in as tom", signedIn: true });
    expect(inviteRow(tEn, { ...base, note: null, invitedBy: "cli", user: null }, NOW)).toEqual({ discordId: "22", note: "—", added: "6d ago · cli", status: "not signed in yet", signedIn: false });
    expect(inviteRow(tFr, base, NOW)).toMatchObject({ added: "il y a 6 j · admin #1", status: "connecté en tant que tom" });
    expect(inviteRow(tFr, { ...base, user: null }, NOW).status).toBe("pas encore connecté");
  });
  test("instance: version, uptime, db, backup age or never, env rows as given", () => {
    const i: AdminInstance = { version: "0.1.0", uptimeS: 3 * 86400 + 4 * 3600 + 5, dbPath: "/opt/bmpl/bmpl.db", dbBytes: 43_200_000, lastBackupAt: NOW - 12 * 60_000, env: [{ key: "BMPL_BASE_URL", value: "https://x", secret: false }] };
    expect(instanceModel(tEn, i, NOW)).toEqual({ version: "0.1.0", uptime: "3 d 4 h", db: "bmpl.db · 41.2 MB", dbPath: "/opt/bmpl/bmpl.db", backup: "12 min ago", env: i.env });
    expect(instanceModel(tEn, { ...i, lastBackupAt: null, uptimeS: 90 }, NOW)).toMatchObject({ backup: "never (no last-backup file yet)", uptime: "1 min" });
    expect(instanceModel(tFr, i, NOW)).toMatchObject({ uptime: "3 j 4 h", db: "bmpl.db · 41.2 MB", backup: "il y a 12 min" });
    expect(instanceModel(tFr, { ...i, lastBackupAt: null, uptimeS: 30 }, NOW)).toMatchObject({ backup: "jamais (pas encore de fichier last-backup)", uptime: "moins d'une minute" });
  });
  test("formatters", () => {
    expect(fmtPts(1412.4)).toBe("1 412");
    expect(fmtPts(37)).toBe("37");
    expect(fmtBytes(43_200_000)).toBe("41.2 MB");
    expect(fmtBytes(800)).toBe("800 B");
    expect(fmtBytes(20_480)).toBe("20.0 KB");
    expect(fmtUptime(tEn, 59)).toBe("less than a minute");
    expect(fmtUptime(tEn, 3600 * 5 + 60 * 7)).toBe("5 h 7 min");
    expect(fmtUptime(tFr, 3600 * 5 + 60 * 7)).toBe("5 h 7 min");
  });
});

describe("audit rows", () => {
  const NOW = new Date(2026, 8, 18, 14, 30).getTime(); // local time
  const row = (over: Partial<AuditRow>): AuditRow => ({ id: 1, at: NOW - 28 * 60_000, userId: 2, username: "tom", action: "wcl_error", target: "lookup Biwaadrood-Nerzhul", detail: { kind: "http", status: 502, message: "WCL HTTP 502" }, ip: "1.2.3.4", ...over });
  test("time: today HH:MM, yesterday, older via fmtAge", () => {
    expect(auditRow(tEn, row({}), NOW).time).toBe("14:02");
    expect(auditRow(tEn, row({ at: NOW - 24 * 3600_000 }), NOW).time).toBe("yesterday 14:30");
    expect(auditRow(tEn, row({ at: NOW - 5 * 24 * 3600_000 }), NOW).time).toBe("5d ago");
    expect(auditRow(tFr, row({ at: NOW - 24 * 3600_000 }), NOW).time).toBe("hier 14:30");
    expect(auditRow(tFr, row({ at: NOW - 5 * 24 * 3600_000 }), NOW).time).toBe("il y a 5 j");
  });
  test("who, dot, action, target, detail per action", () => {
    expect(auditRow(tEn, row({}), NOW)).toMatchObject({ who: "tom", whoFaint: false, dot: "dot-error", action: "wcl_error", target: "lookup Biwaadrood-Nerzhul", detail: "WCL HTTP 502" });
    expect(auditRow(tEn, row({ userId: null, username: null, action: "login_denied", target: "discord 5", detail: { reason: "not invited" } }), NOW)).toMatchObject({ who: "—", whoFaint: true, dot: "dot-login", detail: "not invited" });
    expect(auditDetail(tEn, "quota_refused", { error: "quota", used: 287, limit: 300, resetInS: 1300 })).toBe("quota · 287/300 pts used, resets in 22 min");
    expect(auditDetail(tEn, "rate_limited", { limit: 10, windowS: 60, retryAfterS: 41 })).toBe("10 per 60 s · retry in 41 s");
    expect(auditDetail(tEn, "origin_rejected", { origin: "https://evil.example", fetchSite: "cross-site", why: "origin" })).toBe("Origin https://evil.example · Sec-Fetch-Site cross-site");
    expect(auditDetail(tEn, "invite_add", { note: "alt of tom" })).toBe("note: “alt of tom”");
    expect(auditDetail(tEn, "invite_add", { note: null })).toBe("");
    expect(auditDetail(tEn, "proposal_approve", { proposalId: 7, patch: { id: 642, cooldownS: 240 }, note: "Matches the tooltip." })).toBe("cd 240 s · note: “Matches the tooltip.”");
    expect(auditDetail(tEn, "sessions_revoke", { userId: 2, sessionsEnded: 2 })).toBe("2 session(s) ended");
    expect(auditDetail(tEn, "role_change", { userId: 2, role: "admin" })).toBe("");
    expect(auditDetail(tEn, "account_delete", { username: "tom" })).toBe("tom");
    expect(auditDetail(tEn, "account_delete", null)).toBe("");
    expect(auditDetail(tEn, "logout", null)).toBe("");
  });
  test("French: the glue is translated, the recorded values are not", () => {
    expect(auditRow(tFr, row({}), NOW).detail).toBe("WCL HTTP 502");
    expect(auditDetail(tFr, "login_denied", { reason: "not invited" })).toBe("not invited");
    expect(auditDetail(tFr, "quota_refused", { error: "budget", used: 3500, limit: 3600, resetInS: 1300 })).toBe("budget de l'instance · 3\u202f500/3\u202f600 pts utilisés, reset dans 22 min");
    expect(auditDetail(tFr, "rate_limited", { limit: 10, windowS: 60, retryAfterS: 41 })).toBe("10 par 60 s · réessai dans 41 s");
    expect(auditDetail(tFr, "proposal_approve", { proposalId: 7, patch: { id: 642, cooldownS: 240 }, note: "Matches the tooltip." })).toBe("cd 240 s · note : « Matches the tooltip. »");
    expect(auditDetail(tFr, "user_ban", { sessionsEnded: 2 })).toBe("2 session(s) terminée(s)");
  });
  test("every action has a kind and chips cover every kind", () => {
    const kinds = new Set(Object.values(AUDIT_KIND_OF));
    for (const c of auditChips(tEn)) if (c.kind !== "all") expect(kinds.has(c.kind)).toBe(true);
    expect(auditChips(tEn).map((c) => c.label)).toEqual(["All", "Logins", "Admin", "Quota", "Security", "Errors"]);
    expect(auditChips(tFr).map((c) => c.label)).toEqual(["Tout", "Connexions", "Admin", "Quota", "Sécurité", "Erreurs"]);
    expect(auditShowing(tEn, 10, 1280)).toBe("showing 10 of 1 280 · newest first");
    expect(auditShowing(tFr, 10, 1280)).toBe("10 affichées sur 1 280 · plus récentes d'abord");
  });
});
