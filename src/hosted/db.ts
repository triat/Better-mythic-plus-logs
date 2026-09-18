// Repositories over the hosted tables. Everything takes `now` explicitly so tests control time; the
// per-user history lives in history.ts.
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { applyHostedSchema } from "./schema.ts";
import { openUserHistory } from "./history.ts";
import type { UserHistoryRepo } from "./history.ts";
import { openDefensives } from "./defensives.ts";
import type { DefensivesRepo } from "./defensives.ts";

export type Role = "member" | "admin";
export interface UserRow { id: number; discordId: string; username: string; globalName: string | null; avatarHash: string | null; role: Role; createdAt: number; lastSeenAt: number }
export interface SessionRow { id: string; userId: number; createdAt: number; expiresAt: number; ip: string | null; userAgent: string | null }
export interface InviteRow { discordId: string; invitedBy: string; createdAt: number; note: string | null }
export interface DiscordIdentity { discordId: string; username: string; globalName: string | null; avatarHash: string | null }
export interface UserSettings { yourKey: number | null; legendOpen: boolean }
export const DEFAULT_USER_SETTINGS: UserSettings = { yourKey: null, legendOpen: true };

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
  };
  sessions: {
    create(userId: number, meta: { ip: string | null; userAgent: string | null; now: number }): SessionRow;
    get(id: string, now: number): SessionRow | null;
    delete(id: string): boolean;
    deleteForUser(userId: number): number;
    purgeExpired(now: number): number;
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
    /** Per-bucket totals from the bucket of `sinceAt` on, ascending. */
    totals(sinceAt: number): Array<{ hourStart: number; points: number }>;
  };
  history: UserHistoryRepo;
  defensives: DefensivesRepo;
}

export const newSessionId = (): string => randomBytes(32).toString("base64url");

interface UserRaw { id: number; discord_id: string; username: string; global_name: string | null; avatar_hash: string | null; role: Role; created_at: number; last_seen_at: number }
interface SessionRaw { id: string; user_id: number; created_at: number; expires_at: number; ip: string | null; user_agent: string | null }
interface InviteRaw { discord_id: string; invited_by: string; created_at: number; note: string | null }

const user = (r: UserRaw): UserRow => ({ id: r.id, discordId: r.discord_id, username: r.username, globalName: r.global_name, avatarHash: r.avatar_hash, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at });
const session = (r: SessionRaw): SessionRow => ({ id: r.id, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at, ip: r.ip, userAgent: r.user_agent });
const invite = (r: InviteRaw): InviteRow => ({ discordId: r.discord_id, invitedBy: r.invited_by, createdAt: r.created_at, note: r.note });

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

  const sessionGet = db.query<SessionRaw, [string]>("SELECT * FROM sessions WHERE id = ?");
  const sessionInsert = db.query("INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)");
  const sessionExtend = db.query("UPDATE sessions SET expires_at = ? WHERE id = ?");
  const sessionDelete = db.query("DELETE FROM sessions WHERE id = ?");
  const sessionDeleteUser = db.query("DELETE FROM sessions WHERE user_id = ?");
  const sessionPurge = db.query("DELETE FROM sessions WHERE expires_at <= ?");

  const inviteGet = db.query<InviteRaw, [string]>("SELECT * FROM invites WHERE discord_id = ?");
  const inviteAll = db.query<InviteRaw, []>("SELECT * FROM invites ORDER BY created_at");
  const inviteUpsert = db.query("INSERT INTO invites (discord_id, invited_by, created_at, note) VALUES (?, ?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET invited_by = excluded.invited_by, note = excluded.note");
  const inviteDelete = db.query("DELETE FROM invites WHERE discord_id = ?");

  const settingsGet = db.query<{ your_key: number | null; legend_open: number }, [number]>("SELECT your_key, legend_open FROM user_settings WHERE user_id = ?");
  const settingsUpsert = db.query("INSERT INTO user_settings (user_id, your_key, legend_open, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET your_key = excluded.your_key, legend_open = excluded.legend_open, updated_at = excluded.updated_at");
  const settings = (userId: number): UserSettings => {
    const r = settingsGet.get(userId);
    return r ? { yourKey: r.your_key, legendOpen: r.legend_open === 1 } : { ...DEFAULT_USER_SETTINGS };
  };

  const usageAdd = db.query("INSERT INTO usage_hourly (user_id, hour_start, points) VALUES (?, ?, ?) ON CONFLICT(user_id, hour_start) DO UPDATE SET points = points + excluded.points");
  const usageUsed = db.query<{ points: number } | null, [number, number]>("SELECT points FROM usage_hourly WHERE user_id = ? AND hour_start = ?");
  const usageByUser = db.query<{ user_id: number; points: number }, [number]>("SELECT user_id, points FROM usage_hourly WHERE hour_start = ? ORDER BY points DESC, user_id");
  const usageTotals = db.query<{ hour_start: number; points: number }, [number]>("SELECT hour_start, SUM(points) AS points FROM usage_hourly WHERE hour_start >= ? GROUP BY hour_start ORDER BY hour_start");

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
        settingsUpsert.run(userId, next.yourKey, next.legendOpen ? 1 : 0, now);
        return next;
      },
    },
    usage: {
      add(userId, at, points) { usageAdd.run(userId, hourStart(at), points); },
      used: (userId, at) => usageUsed.get(userId, hourStart(at))?.points ?? 0,
      byUser: (at) => usageByUser.all(hourStart(at)).map((r) => ({ userId: r.user_id, points: r.points })),
      totals: (sinceAt) => usageTotals.all(hourStart(sinceAt)).map((r) => ({ hourStart: r.hour_start, points: r.points })),
    },
    history: openUserHistory(db),
    defensives: openDefensives(db),
  };
}
