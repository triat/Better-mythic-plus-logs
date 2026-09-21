// Repositories over the hosted tables. Everything takes `now` explicitly so tests control time; the
// per-user history lives in history.ts.
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import type { Region } from "../wow/regions.ts";
import { isRegion } from "../wow/regions.ts";
import { applyHostedSchema } from "./schema.ts";
import { config } from "../config.ts";
import { HISTORY_MAX_PER_USER, USER_HISTORY_TABLES, openUserHistory } from "./history.ts";
import type { UserHistoryRepo } from "./history.ts";
import { openDefensives } from "./defensives.ts";
import type { DefensivesRepo } from "./defensives.ts";
import { AUDIT_KINDS, actionsOf } from "./audit.ts";
import type { AuditAction, AuditKind, AuditRow } from "./audit.ts";

export type Role = "member" | "admin";
export interface UserRow { id: number; discordId: string; username: string; globalName: string | null; avatarHash: string | null; role: Role; createdAt: number; lastSeenAt: number; bannedAt: number | null; bannedBy: number | null }
export interface WclClientRow { userId: number; clientId: string; secretEnc: string; verifiedAt: number | null; updatedAt: number }
export interface SessionRow { id: string; userId: number; createdAt: number; expiresAt: number; ip: string | null; userAgent: string | null }
export interface InviteRow { discordId: string; invitedBy: string; createdAt: number; note: string | null }
export interface DiscordIdentity { discordId: string; username: string; globalName: string | null; avatarHash: string | null }
export interface UserSettings { yourKey: number | null; legendOpen: boolean; region: Region | null }
export const DEFAULT_USER_SETTINGS: UserSettings = { yourKey: null, legendOpen: true, region: null };

/** WCL usage buckets are calendar hours (epoch ms). */
export const HOUR_MS = 3_600_000;
export const hourStart = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A session is only re-stamped when it has consumed at least this much of its TTL (avoids a write per request). */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;

export interface HostedDb {
  users: {
    upsertFromDiscord(identity: DiscordIdentity, role: Role | null, now: number): UserRow;
    byId(id: number): UserRow | null;
    byDiscordId(discordId: string): UserRow | null;
    list(): UserRow[];
    setRole(id: number, role: Role): boolean;
    touch(id: number, now: number): void;
    ban(id: number, by: number, now: number): boolean;
    unban(id: number): boolean;
    delete(id: number): boolean;
    count(): number;
  };
  sessions: {
    create(userId: number, meta: { ip: string | null; userAgent: string | null; now: number }): SessionRow;
    get(id: string, now: number): SessionRow | null;
    delete(id: string): boolean;
    deleteForUser(userId: number): number;
    purgeExpired(now: number): number;
    countForUser(userId: number, now: number): number;
    countActive(now: number): number;
  };
  invites: {
    add(discordId: string, invitedBy: string, note: string | null, now: number): InviteRow;
    remove(discordId: string): boolean;
    has(discordId: string): boolean;
    list(): InviteRow[];
  };
  settings: {
    get(userId: number): UserSettings;
    /** Merges `patch` over the stored (or default) row and returns the result. */
    update(userId: number, patch: Partial<UserSettings>, now: number): UserSettings;
  };
  usage: {
    /** Adds `points` to the user's bucket of `at`. */
    add(userId: number, at: number, points: number): void;
    used(userId: number, at: number): number;
    /** Every user's points in the bucket of `at`, largest first. */
    byUser(at: number): Array<{ userId: number; points: number }>;
    /** Every user's points from the bucket of `sinceAt` on, largest first. */
    byUserSince(sinceAt: number): Array<{ userId: number; points: number }>;
    /** Per-bucket totals from the bucket of `sinceAt` on, ascending. */
    totals(sinceAt: number): Array<{ hourStart: number; points: number }>;
  };
  history: UserHistoryRepo;
  defensives: DefensivesRepo;
  wclClients: {
    get(userId: number): WclClientRow | null;
    /** Upserts the row; a re-put resets `verifiedAt` to what is passed. */
    put(row: { userId: number; clientId: string; secretEnc: string; verifiedAt: number | null; now: number }): WclClientRow;
    setVerified(userId: number, at: number): boolean;
    remove(userId: number): boolean;
    count(): number;
  };
  audit: {
    /** Inserts one row (`detail` already serialised) and returns its id. */
    add(row: { at: number; userId: number | null; action: AuditAction; target: string | null; detail: string | null; ip: string | null }): number;
    /** Newest first (`id DESC`), joined with users for `username`; `actions: null` = every action, `before` = rows with a smaller id only. */
    list(o: { actions: AuditAction[] | null; before: number | null; limit: number }): AuditRow[];
    /** Row counts per kind (plus `all`) since `sinceAt` (null = ever). */
    counts(sinceAt: number | null): Record<AuditKind | "all", number>;
    /** Deletes rows older than `at`; returns how many. */
    purgeBefore(at: number): number;
  };
}

export const newSessionId = (): string => randomBytes(32).toString("base64url");

interface UserRaw { id: number; discord_id: string; username: string; global_name: string | null; avatar_hash: string | null; role: Role; created_at: number; last_seen_at: number; banned_at: number | null; banned_by: number | null }
interface SessionRaw { id: string; user_id: number; created_at: number; expires_at: number; ip: string | null; user_agent: string | null }
interface InviteRaw { discord_id: string; invited_by: string; created_at: number; note: string | null }
interface AuditRaw { id: number; at: number; user_id: number | null; username: string | null; action: AuditAction; target: string | null; detail: string | null; ip: string | null }
interface WclClientRaw { user_id: number; client_id: string; secret_enc: string; verified_at: number | null; updated_at: number }

const user = (r: UserRaw): UserRow => ({ id: r.id, discordId: r.discord_id, username: r.username, globalName: r.global_name, avatarHash: r.avatar_hash, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at, bannedAt: r.banned_at, bannedBy: r.banned_by });
const wclClient = (r: WclClientRaw): WclClientRow => ({ userId: r.user_id, clientId: r.client_id, secretEnc: r.secret_enc, verifiedAt: r.verified_at, updatedAt: r.updated_at });
const session = (r: SessionRaw): SessionRow => ({ id: r.id, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at, ip: r.ip, userAgent: r.user_agent });
const invite = (r: InviteRaw): InviteRow => ({ discordId: r.discord_id, invitedBy: r.invited_by, createdAt: r.created_at, note: r.note });
const parseDetail = (raw: string | null): Record<string, unknown> | null => {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const auditRow = (r: AuditRaw): AuditRow => ({ id: r.id, at: r.at, userId: r.user_id, username: r.username, action: r.action, target: r.target, detail: parseDetail(r.detail), ip: r.ip });

export function openHosted(db: Database): HostedDb {
  db.exec("PRAGMA foreign_keys = ON");
  applyHostedSchema(db);

  const userById = db.query<UserRaw, [number]>("SELECT * FROM users WHERE id = ?");
  const userByDiscord = db.query<UserRaw, [string]>("SELECT * FROM users WHERE discord_id = ?");
  const usersAll = db.query<UserRaw, []>("SELECT * FROM users ORDER BY id");
  const userInsert = db.query("INSERT INTO users (discord_id, username, global_name, avatar_hash, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const userUpdate = db.query("UPDATE users SET username = ?, global_name = ?, avatar_hash = ?, role = ?, last_seen_at = ? WHERE id = ?");
  const userSetRole = db.query("UPDATE users SET role = ? WHERE id = ?");
  const userTouch = db.query("UPDATE users SET last_seen_at = ? WHERE id = ?");
  const userBan = db.query("UPDATE users SET banned_at = ?, banned_by = ? WHERE id = ?");
  const userUnban = db.query("UPDATE users SET banned_at = NULL, banned_by = NULL WHERE id = ?");
  const userDelete = db.query("DELETE FROM users WHERE id = ?");
  const userCount = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM users");

  const sessionGet = db.query<SessionRaw, [string]>("SELECT * FROM sessions WHERE id = ?");
  const sessionInsert = db.query("INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)");
  const sessionExtend = db.query("UPDATE sessions SET expires_at = ? WHERE id = ?");
  const sessionDelete = db.query("DELETE FROM sessions WHERE id = ?");
  const sessionDeleteUser = db.query("DELETE FROM sessions WHERE user_id = ?");
  const sessionPurge = db.query("DELETE FROM sessions WHERE expires_at <= ?");
  const sessionCount = db.query<{ n: number }, [number, number]>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?");
  const sessionCountActive = db.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?");

  const inviteGet = db.query<InviteRaw, [string]>("SELECT * FROM invites WHERE discord_id = ?");
  const inviteAll = db.query<InviteRaw, []>("SELECT * FROM invites ORDER BY created_at");
  const inviteUpsert = db.query("INSERT INTO invites (discord_id, invited_by, created_at, note) VALUES (?, ?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET invited_by = excluded.invited_by, note = excluded.note");
  const inviteDelete = db.query("DELETE FROM invites WHERE discord_id = ?");

  const settingsGet = db.query<{ your_key: number | null; legend_open: number; region: string | null }, [number]>("SELECT your_key, legend_open, region FROM user_settings WHERE user_id = ?");
  const settingsUpsert = db.query("INSERT INTO user_settings (user_id, your_key, legend_open, region, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET your_key = excluded.your_key, legend_open = excluded.legend_open, region = excluded.region, updated_at = excluded.updated_at");
  const settings = (userId: number): UserSettings => {
    const r = settingsGet.get(userId);
    return r ? { yourKey: r.your_key, legendOpen: r.legend_open === 1, region: isRegion(r.region) ? r.region : null } : { ...DEFAULT_USER_SETTINGS };
  };

  const usageAdd = db.query("INSERT INTO usage_hourly (user_id, hour_start, points) VALUES (?, ?, ?) ON CONFLICT(user_id, hour_start) DO UPDATE SET points = points + excluded.points");
  const usageUsed = db.query<{ points: number } | null, [number, number]>("SELECT points FROM usage_hourly WHERE user_id = ? AND hour_start = ?");
  const usageByUser = db.query<{ user_id: number; points: number }, [number]>("SELECT user_id, points FROM usage_hourly WHERE hour_start = ? ORDER BY points DESC, user_id");
  const usageByUserSince = db.query<{ user_id: number; points: number }, [number]>("SELECT user_id, SUM(points) AS points FROM usage_hourly WHERE hour_start >= ? GROUP BY user_id ORDER BY points DESC, user_id");
  const usageTotals = db.query<{ hour_start: number; points: number }, [number]>("SELECT hour_start, SUM(points) AS points FROM usage_hourly WHERE hour_start >= ? GROUP BY hour_start ORDER BY hour_start");

  const auditInsert = db.query<{ id: number }, [number, number | null, string, string | null, string | null, string | null]>("INSERT INTO audit_log (at, user_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?) RETURNING id");
  const AUDIT_SELECT = "SELECT a.id, a.at, a.user_id, u.username, a.action, a.target, a.detail, a.ip FROM audit_log a LEFT JOIN users u ON u.id = a.user_id";
  const auditCounts = db.query<{ action: AuditAction; n: number }, [number]>("SELECT action, COUNT(*) AS n FROM audit_log WHERE at >= ? GROUP BY action");
  const auditPurge = db.query("DELETE FROM audit_log WHERE at < ?");

  const wclClientGet = db.query<WclClientRaw, [number]>("SELECT * FROM user_wcl_clients WHERE user_id = ?");
  const wclClientPut = db.query(
    "INSERT INTO user_wcl_clients (user_id, client_id, secret_enc, verified_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET client_id = excluded.client_id, secret_enc = excluded.secret_enc, verified_at = excluded.verified_at, updated_at = excluded.updated_at",
  );
  const wclClientSetVerified = db.query("UPDATE user_wcl_clients SET verified_at = ? WHERE user_id = ?");
  const wclClientRemove = db.query("DELETE FROM user_wcl_clients WHERE user_id = ?");
  const wclClientCount = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM user_wcl_clients");

  const changes = (): number => Number(db.query<{ n: number }, []>("SELECT changes() AS n").get()!.n);

  return {
    users: {
      upsertFromDiscord(identity, role, now) {
        const existing = userByDiscord.get(identity.discordId);
        if (existing) {
          userUpdate.run(identity.username, identity.globalName, identity.avatarHash, role ?? existing.role, now, existing.id);
          return user(userById.get(existing.id)!);
        }
        userInsert.run(identity.discordId, identity.username, identity.globalName, identity.avatarHash, role ?? "member", now, now);
        return user(userByDiscord.get(identity.discordId)!);
      },
      byId: (id) => { const r = userById.get(id); return r ? user(r) : null; },
      byDiscordId: (d) => { const r = userByDiscord.get(d); return r ? user(r) : null; },
      list: () => usersAll.all().map(user),
      setRole(id, role) { userSetRole.run(role, id); return changes() === 1; },
      touch(id, now) { userTouch.run(now, id); },
      ban(id, by, now) { userBan.run(now, by, id); return changes() === 1; },
      unban(id) { userUnban.run(id); return changes() === 1; },
      delete(id) { userDelete.run(id); return changes() === 1; },
      count: () => userCount.get()!.n,
    },
    sessions: {
      create(userId, meta) {
        const id = newSessionId();
        sessionInsert.run(id, userId, meta.now, meta.now + SESSION_TTL_MS, meta.ip, meta.userAgent);
        return session(sessionGet.get(id)!);
      },
      get(id, now) {
        const r = sessionGet.get(id);
        if (!r || r.expires_at <= now) return null;
        if (r.expires_at - now < SESSION_TTL_MS - SESSION_REFRESH_MS) {
          sessionExtend.run(now + SESSION_TTL_MS, id);
          userTouch.run(now, r.user_id);
          return session(sessionGet.get(id)!);
        }
        return session(r);
      },
      delete(id) { sessionDelete.run(id); return changes() === 1; },
      deleteForUser(userId) { sessionDeleteUser.run(userId); return changes(); },
      purgeExpired(now) { sessionPurge.run(now); return changes(); },
      countForUser: (userId, now) => sessionCount.get(userId, now)!.n,
      countActive: (now) => sessionCountActive.get(now)!.n,
    },
    invites: {
      add(discordId, invitedBy, note, now) {
        inviteUpsert.run(discordId, invitedBy, now, note);
        return invite(inviteGet.get(discordId)!);
      },
      remove(discordId) { inviteDelete.run(discordId); return changes() === 1; },
      has: (discordId) => inviteGet.get(discordId) !== null,
      list: () => inviteAll.all().map(invite),
    },
    settings: {
      get: settings,
      update(userId, patch, now) {
        const next = { ...settings(userId), ...patch };
        settingsUpsert.run(userId, next.yourKey, next.legendOpen ? 1 : 0, next.region, now);
        return next;
      },
    },
    usage: {
      add(userId, at, points) { usageAdd.run(userId, hourStart(at), points); },
      used: (userId, at) => usageUsed.get(userId, hourStart(at))?.points ?? 0,
      byUser: (at) => usageByUser.all(hourStart(at)).map((r) => ({ userId: r.user_id, points: r.points })),
      byUserSince: (sinceAt) => usageByUserSince.all(hourStart(sinceAt)).map((r) => ({ userId: r.user_id, points: r.points })),
      totals: (sinceAt) => usageTotals.all(hourStart(sinceAt)).map((r) => ({ hourStart: r.hour_start, points: r.points })),
    },
    history: openUserHistory(db, HISTORY_MAX_PER_USER, USER_HISTORY_TABLES, config.region),
    defensives: openDefensives(db),
    wclClients: {
      get: (userId) => { const r = wclClientGet.get(userId); return r ? wclClient(r) : null; },
      put(row) {
        wclClientPut.run(row.userId, row.clientId, row.secretEnc, row.verifiedAt, row.now);
        return wclClient(wclClientGet.get(row.userId)!);
      },
      setVerified(userId, at) { wclClientSetVerified.run(at, userId); return changes() === 1; },
      remove(userId) { wclClientRemove.run(userId); return changes() === 1; },
      count: () => wclClientCount.get()!.n,
    },
    audit: {
      add: (r) => auditInsert.get(r.at, r.userId, r.action, r.target, r.detail, r.ip)!.id,
      list(o) {
        if (o.actions !== null && o.actions.length === 0) return [];
        // Built per call: the IN list needs one placeholder per action.
        const where: string[] = [];
        const params: Array<string | number> = [];
        if (o.actions !== null) { where.push(`a.action IN (${o.actions.map(() => "?").join(", ")})`); params.push(...o.actions); }
        if (o.before !== null) { where.push("a.id < ?"); params.push(o.before); }
        params.push(o.limit);
        const sql = `${AUDIT_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY a.id DESC LIMIT ?`;
        return db.query<AuditRaw, Array<string | number>>(sql).all(...params).map(auditRow);
      },
      counts(sinceAt) {
        const byAction = new Map(auditCounts.all(sinceAt ?? 0).map((r) => [r.action, Number(r.n)]));
        const out = { all: 0 } as Record<AuditKind | "all", number>;
        for (const kind of AUDIT_KINDS) {
          const n = actionsOf(kind).reduce((sum, a) => sum + (byAction.get(a) ?? 0), 0);
          out[kind] = n;
          out.all += n;
        }
        return out;
      },
      purgeBefore(at) { auditPurge.run(at); return changes(); },
    },
  };
}
