import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { ACTION_KIND, AUDIT_KINDS, AuditLog, actionsOf, clip, kindOf } from "../../src/hosted/audit.ts";
import type { AuditAction } from "../../src/hosted/audit.ts";
import { openHosted } from "../../src/hosted/db.ts";
import type { HostedDb, UserRow } from "../../src/hosted/db.ts";

const ALL_ACTIONS = Object.keys(ACTION_KIND) as AuditAction[];

let db: HostedDb;
let user: UserRow;
beforeEach(() => {
  db = openHosted(new Database(":memory:"));
  user = db.users.upsertFromDiscord({ discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null }, null, 0);
});

describe("AuditLog", () => {
  test("record fills user/ip/target from the scope; explicit null wins; detail round-trips", async () => {
    const log = new AuditLog(db.audit);
    await log.scope({ userId: user.id, ip: "203.0.113.9", target: "POST /api/lookup" }, async () => {
      log.setTarget("lookup Biwa-Nerzhul");
      expect(log.current()).toEqual({ userId: user.id, ip: "203.0.113.9", target: "lookup Biwa-Nerzhul" });
      log.record("wcl_error", { detail: { kind: "http", status: 502, message: "WCL HTTP 502" }, at: 1_000 });
      log.record("login_denied", { userId: null, target: "discord 5", at: 2_000 });
    });
    expect(log.current()).toBeUndefined();
    log.record("logout", { at: 3_000 }); // outside any scope
    const rows = db.audit.list({ actions: null, before: null, limit: 10 });
    expect(rows.map((r) => [r.action, r.userId, r.ip, r.target])).toEqual([
      ["logout", null, null, null],
      ["login_denied", null, "203.0.113.9", "discord 5"],
      ["wcl_error", user.id, "203.0.113.9", "lookup Biwa-Nerzhul"],
    ]);
    expect(rows.map((r) => r.at)).toEqual([3_000, 2_000, 1_000]);
    expect(rows[2]!.detail).toEqual({ kind: "http", status: 502, message: "WCL HTTP 502" });
    expect(rows[2]!.username).toBe(user.username);
    expect(rows[0]!.detail).toBeNull();
  });

  test("at defaults to now; a failing insert never throws", () => {
    const before = Date.now();
    const log = new AuditLog(db.audit);
    log.record("logout");
    const [row] = db.audit.list({ actions: null, before: null, limit: 1 });
    expect(row!.at).toBeGreaterThanOrEqual(before);
    const broken = new AuditLog({ ...db.audit, add: () => { throw new Error("disk full"); } });
    const err = console.error;
    const calls: unknown[][] = [];
    console.error = (...a: unknown[]) => { calls.push(a); };
    try {
      expect(() => broken.record("logout")).not.toThrow();
    } finally {
      console.error = err;
    }
    expect(calls).toHaveLength(1);
  });

  test("record bounds target (300) and ip (64), whether explicit or from the scope", async () => {
    const log = new AuditLog(db.audit);
    log.record("origin_rejected", { target: "POST /" + "x".repeat(500), ip: "9".repeat(100), at: 10_000 });
    await log.scope({ userId: null, ip: "1".repeat(100), target: "t".repeat(400) }, async () => { log.record("rate_limited", { at: 11_000 }); });
    const [scoped, explicit] = db.audit.list({ actions: ["origin_rejected", "rate_limited"], before: null, limit: 2 });
    expect(explicit!.target).toHaveLength(300);
    expect(explicit!.target!.endsWith("…")).toBe(true);
    expect(explicit!.ip).toHaveLength(64);
    expect(scoped!.target).toHaveLength(300);
    expect(scoped!.ip).toHaveLength(64);
  });

  test("list filters by actions and pages by id; counts per kind; purge", () => {
    const log = new AuditLog(db.audit);
    log.record("login", { userId: user.id, at: 1_000 });
    log.record("rate_limited", { at: 2_000 });
    log.record("invite_add", { userId: user.id, target: "5", at: 3_000 });
    log.record("origin_rejected", { at: 4_000 });
    log.record("wcl_error", { at: 5_000 });
    const all = db.audit.list({ actions: null, before: null, limit: 10 });
    expect(all.map((r) => r.action)).toEqual(["wcl_error", "origin_rejected", "invite_add", "rate_limited", "login"]);
    expect(db.audit.list({ actions: actionsOf("security"), before: null, limit: 10 }).map((r) => r.action)).toEqual(["origin_rejected", "rate_limited"]);
    const older = db.audit.list({ actions: null, before: all[1]!.id, limit: 2 });
    expect(older.map((r) => r.action)).toEqual(["invite_add", "rate_limited"]);
    expect(db.audit.list({ actions: [], before: null, limit: 10 })).toEqual([]);
    expect(db.audit.counts(null)).toEqual({ all: 5, login: 1, admin: 1, quota: 0, security: 2, error: 1 });
    expect(db.audit.counts(3_000)).toEqual({ all: 3, login: 0, admin: 1, quota: 0, security: 1, error: 1 });
    expect(db.audit.purgeBefore(3_000)).toBe(2);
    expect(db.audit.counts(null).all).toBe(3);
    expect(db.audit.purgeBefore(3_000)).toBe(0);
  });

  test("kindOf covers every action", () => {
    for (const a of ALL_ACTIONS) expect(AUDIT_KINDS).toContain(kindOf(a));
    expect(AUDIT_KINDS.flatMap(actionsOf).sort()).toEqual([...ALL_ACTIONS].sort());
  });

  test("clip keeps short strings and truncates long ones with an ellipsis", () => {
    expect(clip("abc")).toBe("abc");
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("a".repeat(300))).toHaveLength(300);
    expect(clip("a".repeat(301))).toHaveLength(300);
  });
});
