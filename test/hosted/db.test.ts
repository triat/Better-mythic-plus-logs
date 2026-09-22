import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { SESSION_REFRESH_MS, SESSION_TTL_MS, newSessionId, openHosted } from "../../src/hosted/db.ts";
import type { HostedDb } from "../../src/hosted/db.ts";

const ID = { discordId: "123456789012345678", username: "tom", globalName: "Tom", avatarHash: "abc" };
let db: HostedDb;
beforeEach(() => { db = openHosted(new Database(":memory:")); });

describe("users", () => {
  test("upsert creates a member by default and returns the row", () => {
    const u = db.users.upsertFromDiscord(ID, null, 1000);
    expect(u).toMatchObject({ discordId: ID.discordId, username: "tom", globalName: "Tom", avatarHash: "abc", role: "member", createdAt: 1000, lastSeenAt: 1000 });
    expect(db.users.byId(u.id)).toEqual(u);
    expect(db.users.byDiscordId(ID.discordId)).toEqual(u);
  });
  test("upsert updates names and last_seen, keeps id and created_at, keeps role when null, forces role when given", () => {
    const a = db.users.upsertFromDiscord(ID, null, 1000);
    const b = db.users.upsertFromDiscord({ ...ID, username: "tom2", avatarHash: null }, null, 2000);
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ username: "tom2", avatarHash: null, role: "member", createdAt: 1000, lastSeenAt: 2000 });
    const c = db.users.upsertFromDiscord(ID, "admin", 3000);
    expect(c.role).toBe("admin");
    const d = db.users.upsertFromDiscord(ID, null, 4000);
    expect(d.role).toBe("admin");
  });
  test("setRole and list", () => {
    const u = db.users.upsertFromDiscord(ID, null, 1);
    expect(db.users.setRole(u.id, "admin")).toBe(true);
    expect(db.users.setRole(999, "admin")).toBe(false);
    expect(db.users.list().map((x) => x.role)).toEqual(["admin"]);
  });
});

describe("sessions", () => {
  test("ids are 43-char base64url strings and unique", () => {
    const a = newSessionId(), b = newSessionId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  test("create/get/delete and expiry", () => {
    const u = db.users.upsertFromDiscord(ID, null, 0);
    const s = db.sessions.create(u.id, { ip: "1.2.3.4", userAgent: "ua", now: 1000 });
    expect(s).toMatchObject({ userId: u.id, createdAt: 1000, expiresAt: 1000 + SESSION_TTL_MS, ip: "1.2.3.4", userAgent: "ua" });
    expect(db.sessions.get(s.id, 2000)?.id).toBe(s.id);
    expect(db.sessions.get(s.id, 1000 + SESSION_TTL_MS)).toBeNull();
    expect(db.sessions.get("nope", 2000)).toBeNull();
    expect(db.sessions.delete(s.id)).toBe(true);
    expect(db.sessions.delete(s.id)).toBe(false);
  });
  test("sliding expiry: refreshed only when within the refresh window, and touches the user", () => {
    const u = db.users.upsertFromDiscord(ID, null, 0);
    const s = db.sessions.create(u.id, { ip: null, userAgent: null, now: 1000 });
    const early = db.sessions.get(s.id, 1000 + SESSION_REFRESH_MS - 1)!;
    expect(early.expiresAt).toBe(1000 + SESSION_TTL_MS); // untouched
    expect(db.users.byId(u.id)!.lastSeenAt).toBe(0);
    const later = db.sessions.get(s.id, 1000 + SESSION_REFRESH_MS + 1)!;
    expect(later.expiresAt).toBe(1000 + SESSION_REFRESH_MS + 1 + SESSION_TTL_MS);
    expect(db.users.byId(u.id)!.lastSeenAt).toBe(1000 + SESSION_REFRESH_MS + 1);
  });
  test("purgeExpired and deleteForUser", () => {
    const u = db.users.upsertFromDiscord(ID, null, 0);
    const a = db.sessions.create(u.id, { ip: null, userAgent: null, now: 0 });
    const b = db.sessions.create(u.id, { ip: null, userAgent: null, now: SESSION_TTL_MS });
    expect(db.sessions.purgeExpired(SESSION_TTL_MS + 1)).toBe(1);
    expect(db.sessions.get(a.id, SESSION_TTL_MS + 1)).toBeNull();
    expect(db.sessions.get(b.id, SESSION_TTL_MS + 1)).not.toBeNull();
    expect(db.sessions.deleteForUser(u.id)).toBe(1);
  });
  test("deleting a user cascades to delete their sessions", () => {
    const raw = new Database(":memory:");
    const hdb = openHosted(raw);
    const u = hdb.users.upsertFromDiscord(ID, null, 0);
    const s = hdb.sessions.create(u.id, { ip: null, userAgent: null, now: 1000 });
    raw.run("DELETE FROM users WHERE id = ?", [u.id]);
    expect(hdb.sessions.get(s.id, 2000)).toBeNull();
  });
});

describe("invites", () => {
  test("add/has/list/remove", () => {
    const i = db.invites.add(ID.discordId, "cli", "guild mate", 5);
    expect(i).toEqual({ discordId: ID.discordId, invitedBy: "cli", createdAt: 5, note: "guild mate" });
    expect(db.invites.has(ID.discordId)).toBe(true);
    expect(db.invites.has("999999999999999999")).toBe(false);
    expect(db.invites.list()).toEqual([i]);
    // re-adding replaces the note, keeps one row
    db.invites.add(ID.discordId, "admin:1", null, 6);
    expect(db.invites.list()).toHaveLength(1);
    expect(db.invites.remove(ID.discordId)).toBe(true);
    expect(db.invites.remove(ID.discordId)).toBe(false);
  });
});

describe("audit", () => {
  test("add/list/counts/purgeBefore round trip with two users; username join survives a deleted user as null", () => {
    const raw = new Database(":memory:");
    const hdb = openHosted(raw);
    const tom = hdb.users.upsertFromDiscord(ID, null, 0);
    const bob = hdb.users.upsertFromDiscord({ ...ID, discordId: "222222222222222222", username: "bob" }, "admin", 0);
    const a = hdb.audit.add({ at: 1_000, userId: tom.id, action: "login", target: "discord 1", detail: JSON.stringify({ userAgent: "ua" }), ip: "1.1.1.1" });
    const b = hdb.audit.add({ at: 2_000, userId: bob.id, action: "invite_add", target: "333", detail: null, ip: null });
    const c = hdb.audit.add({ at: 3_000, userId: null, action: "origin_rejected", target: "POST /api/lookup", detail: "not json", ip: "2.2.2.2" });
    expect([a, b, c]).toEqual([1, 2, 3]);
    const rows = hdb.audit.list({ actions: null, before: null, limit: 10 });
    expect(rows.map((r) => [r.id, r.action, r.username])).toEqual([[3, "origin_rejected", null], [2, "invite_add", "bob"], [1, "login", "tom"]]);
    expect(rows[2]).toEqual({ id: 1, at: 1_000, userId: tom.id, username: "tom", action: "login", target: "discord 1", detail: { userAgent: "ua" }, ip: "1.1.1.1" });
    expect(rows[0]!.detail).toBeNull(); // unparsable detail → null, never a throw
    expect(hdb.audit.list({ actions: ["login", "invite_add"], before: 3, limit: 1 }).map((r) => r.id)).toEqual([2]);
    expect(hdb.audit.list({ actions: ["login", "invite_add"], before: 2, limit: 5 }).map((r) => r.id)).toEqual([1]);
    expect(hdb.audit.counts(null)).toEqual({ all: 3, login: 1, admin: 1, quota: 0, security: 1, error: 0 });
    expect(hdb.audit.counts(2_000)).toEqual({ all: 2, login: 0, admin: 1, quota: 0, security: 1, error: 0 });
    raw.run("DELETE FROM users WHERE id = ?", [tom.id]);
    const after = hdb.audit.list({ actions: ["login"], before: null, limit: 1 })[0]!;
    expect(after.userId).toBeNull();
    expect(after.username).toBeNull();
    expect(hdb.audit.purgeBefore(2_000)).toBe(1);
    expect(hdb.audit.purgeBefore(10_000)).toBe(2);
    expect(hdb.audit.counts(null).all).toBe(0);
  });
});

test("openHosted is idempotent on the same database", () => {
  const raw = new Database(":memory:");
  openHosted(raw);
  openHosted(raw);
  expect(raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','invites')").all()).toHaveLength(3);
});

test("user_settings is migrated in place: region and locale appear on a pre-region database", () => {
  const raw = new Database(":memory:");
  raw.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL, global_name TEXT, avatar_hash TEXT, role TEXT NOT NULL CHECK (role IN ('member', 'admin')), created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, banned_at INTEGER, banned_by INTEGER)");
  raw.exec("CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, your_key INTEGER, legend_open INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)");
  const db = openHosted(raw);
  const columns = raw.query<{ name: string }, []>("PRAGMA table_info(user_settings)").all().map((r) => r.name);
  expect(columns).toContain("region");
  expect(columns).toContain("locale");
  expect(columns).toContain("live_sort");
  expect(columns).toContain("live_roles");
  expect(columns).toContain("live_classes");
  const u = db.users.upsertFromDiscord({ discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null }, null, 1000);
  expect(db.settings.get(u.id)).toEqual({ yourKey: null, legendOpen: true, region: null, locale: null, liveSort: "arrival", liveRoles: ["tank", "healer", "dps"], liveClasses: [] });
  expect(db.settings.update(u.id, { region: "tw" }, 2000)).toMatchObject({ yourKey: null, legendOpen: true, region: "tw", locale: null });
  expect(db.settings.update(u.id, { locale: "fr" }, 3000)).toMatchObject({ yourKey: null, legendOpen: true, region: "tw", locale: "fr" });
});

describe("phase 2: bans, deletion, wcl clients", () => {
  test("the users table is migrated in place: banned_at/banned_by appear on a pre-phase-2 database", () => {
    const raw = new Database(":memory:");
    raw.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL, global_name TEXT, avatar_hash TEXT, role TEXT NOT NULL CHECK (role IN ('member', 'admin')), created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)");
    const db = openHosted(raw);
    const u = db.users.upsertFromDiscord({ discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null }, null, 1000);
    expect(u.bannedAt).toBeNull();
    expect(db.users.ban(u.id, 99, 2000)).toBe(true);
    expect(db.users.byId(u.id)).toMatchObject({ bannedAt: 2000, bannedBy: 99 });
    expect(db.users.unban(u.id)).toBe(true);
    expect(db.users.byId(u.id)!.bannedAt).toBeNull();
    expect(db.users.ban(9999, 1, 1)).toBe(false);
  });
  test("delete cascades sessions, history, settings, usage and the wcl client; approved shared rows and audit rows keep NULL", () => {
    const raw = new Database(":memory:");
    const db = openHosted(raw);
    const u = db.users.upsertFromDiscord({ discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null }, null, 1000);
    db.sessions.create(u.id, { ip: null, userAgent: null, now: 1000 });
    expect(db.sessions.countActive(1000)).toBe(1);
    db.settings.update(u.id, { yourKey: 12 }, 1000);
    db.usage.add(u.id, 1000, 5);
    db.wclClients.put({ userId: u.id, clientId: "abc", secretEnc: "v1.x.y", verifiedAt: null, now: 1000 });
    const auditId = db.audit.add({ at: 1000, userId: u.id, action: "login", target: null, detail: null, ip: null });
    db.defensives.upsertShared("Paladin:Holy", { id: 498, cooldownS: 90 }, u.id, 1000);
    expect(db.users.count()).toBe(1);
    expect(db.users.delete(u.id)).toBe(true);
    expect(db.users.count()).toBe(0);
    expect(db.sessions.countActive(1000)).toBe(0);
    expect(db.wclClients.get(u.id)).toBeNull();
    expect(db.usage.used(u.id, 1000)).toBe(0);
    expect(db.audit.list({ actions: null, before: null, limit: 10 }).find((r) => r.id === auditId)).toMatchObject({ userId: null, username: null });
    expect(db.users.delete(u.id)).toBe(false);
    expect(raw.query<{ approved_by: number | null }, []>("SELECT approved_by FROM defensives_shared").get()).toEqual({ approved_by: null });
  });
  test("wclClients: put upserts, setVerified, remove, count", () => {
    const db = openHosted(new Database(":memory:"));
    const u = db.users.upsertFromDiscord({ discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null }, null, 1000);
    expect(db.wclClients.get(u.id)).toBeNull();
    expect(db.wclClients.put({ userId: u.id, clientId: "abc", secretEnc: "v1.a.b", verifiedAt: 1500, now: 1000 })).toEqual({ userId: u.id, clientId: "abc", secretEnc: "v1.a.b", verifiedAt: 1500, updatedAt: 1000 });
    expect(db.wclClients.put({ userId: u.id, clientId: "def", secretEnc: "v1.c.d", verifiedAt: null, now: 2000 })).toMatchObject({ clientId: "def", verifiedAt: null, updatedAt: 2000 });
    expect(db.wclClients.setVerified(u.id, 2500)).toBe(true);
    expect(db.wclClients.get(u.id)!.verifiedAt).toBe(2500);
    expect(db.wclClients.count()).toBe(1);
    expect(db.wclClients.remove(u.id)).toBe(true);
    expect(db.wclClients.remove(u.id)).toBe(false);
  });
});
