// Repositories over the hosted tables. Everything takes `now` explicitly so tests control time.
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { applyHostedSchema } from "./schema.ts";

export type Role = "member" | "admin";
export interface UserRow { id: number; discordId: string; username: string; globalName: string | null; avatarHash: string | null; role: Role; createdAt: number; lastSeenAt: number }
export interface SessionRow { id: string; userId: number; createdAt: number; expiresAt: number; ip: string | null; userAgent: string | null }
export interface InviteRow { discordId: string; invitedBy: string; createdAt: number; note: string | null }
export interface DiscordIdentity { discordId: string; username: string; globalName: string | null; avatarHash: string | null }

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
}

export const newSessionId = (): string => randomBytes(32).toString("base64url");

interface UserRaw { id: number; discord_id: string; username: string; global_name: string | null; avatar_hash: string | null; role: Role; created_at: number; last_seen_at: number }
interface SessionRaw { id: string; user_id: number; created_at: number; expires_at: number; ip: string | null; user_agent: string | null }
interface InviteRaw { discord_id: string; invited_by: string; created_at: number; note: string | null }

const user = (r: UserRaw): UserRow => ({ id: r.id, discordId: r.discord_id, username: r.username, globalName: r.global_name, avatarHash: r.avatar_hash, role: r.role, createdAt: r.created_at, lastSeenAt: r.last_seen_at });
const session = (r: SessionRaw): SessionRow => ({ id: r.id, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at, ip: r.ip, userAgent: r.user_agent });
const invite = (r: InviteRaw): InviteRow => ({ discordId: r.discord_id, invitedBy: r.invited_by, createdAt: r.created_at, note: r.note });

export function openHosted(db: Database): HostedDb {
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
  };
}
