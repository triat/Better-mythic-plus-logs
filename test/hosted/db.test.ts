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

test("openHosted is idempotent on the same database", () => {
  const raw = new Database(":memory:");
  openHosted(raw);
  openHosted(raw);
  expect(raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','invites')").all()).toHaveLength(3);
});
