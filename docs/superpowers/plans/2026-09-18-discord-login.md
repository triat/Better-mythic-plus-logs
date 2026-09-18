# Discord Login, Sessions, Invites and Admin Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In hosted mode, every `/api/*` request is authenticated by a Discord OAuth2 login (`identify` scope), sessions live in SQLite behind a signed cookie, access is invite-only (allowlist ∪ admins), admins get a role and management routes, and the front shows a minimal sign-in gate.

**Architecture:** New `src/hosted/*` modules, each pure or over an injected `Database`/`fetch`: `schema.ts` + `db.ts` (users/sessions/invites repositories), `cookie.ts` (HMAC-signed session cookie), `oauth-state.ts` (single-use `state` bound to a short-lived cookie), `discord.ts` (authorize URL, code exchange, `/users/@me`), `auth.ts` (request context + route gate). The route table from issue #2 gains `auth: "public" | "user" | "admin"` on each `Route` and a third `RequestContext` argument on handlers; `runServer` resolves the session once per request and applies the gate in hosted mode only. Two new route files: `routes-auth.ts` (`/auth/*`, `/api/me`) and `routes-admin.ts` (`/api/admin/*`). The CLI passes the parsed `HostedConfig` into `runServer` and gains `bmpl invite`. The front calls `/api/me` in hosted mode and renders a placeholder sign-in screen (design pass in issue #7).

**Tech Stack:** Bun 1.3 (`Bun.serve`, `bun:sqlite`, `bun:test`), `node:crypto` (HMAC, random bytes, timing-safe compare), TypeScript strict, Vite 8 + React 19 (types-only imports from `src/`).

**Spec:** GitHub issue #3 (`gh issue view 3`), parent #1 (`gh issue view 1`). Repo rules: `AGENTS.md`, `docs/agents/{architecture,web-front,testing,workflow}.md`. Builds on the #2 plan (`docs/superpowers/plans/2026-09-17-hosted-mode-skeleton.md`) — read its "Readiness" carry-overs: `planServe` must return the parsed `HostedConfig`; `Route` gains `auth` + per-request context; `history`/SSE singletons stay shared until issue #4.

## Global Constraints

- Local mode (`bmpl serve` without `--hosted`) is unchanged: no login, no gate, every existing test in `test/server.test.ts` and `test/server-deepdive.test.ts` untouched and green. Only `test/server-hosted.test.ts` changes (it now needs a session for gated routes).
- OAuth2 authorization-code flow with Discord, scope exactly `identify`; redirect URI is `${baseUrl}/auth/discord/callback`. Endpoints: authorize `https://discord.com/oauth2/authorize`, token `https://discord.com/api/oauth2/token` (form-encoded), me `https://discord.com/api/users/@me`. All Discord HTTP goes through an injected `fetchFn` (tests never reach the network).
- Schema (`src/hosted/schema.ts`, `CREATE TABLE IF NOT EXISTS`, timestamps are epoch milliseconds): `users(id INTEGER PRIMARY KEY, discord_id TEXT UNIQUE NOT NULL, username TEXT NOT NULL, global_name TEXT, avatar_hash TEXT, role TEXT NOT NULL CHECK(role IN ('member','admin')), created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`; `sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, user_agent TEXT)`; `invites(discord_id TEXT PRIMARY KEY, invited_by TEXT NOT NULL, created_at INTEGER NOT NULL, note TEXT)`.
- Admission after the callback: `discord_id ∈ invites` **or** `∈ config.adminDiscordIds`. Admin ids get `role = 'admin'` on every login (config wins over the stored role); anyone else keeps their stored role (default `member`). Not admitted → no user row, no session, redirect to `/?denied=<discord_id>`.
- Session cookie `bmpl_session`: value `<id>.<hmac>` where `id` = 32 random bytes base64url and `hmac` = HMAC-SHA256(`BMPL_SESSION_SECRET`, id) base64url; attributes `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` plus `Secure` iff `baseUrl` starts with `https:`. A cookie whose signature does not verify is rejected before any DB read. TTL 30 days sliding: on an authenticated request, if `expires_at − now < 30 d − 1 h`, set `expires_at = now + 30 d` and `users.last_seen_at = now`. Expired sessions purged hourly (`setInterval(...).unref()`).
- OAuth `state`: 32 random bytes base64url, single-use, expires after 10 minutes, bound to a `bmpl_oauth` cookie (32 random bytes base64url, `HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600`, `Secure` as above). The callback rejects a missing/unknown/expired/consumed state or a nonce mismatch with `400 { ok:false, error:"Invalid OAuth state" }`.
- Route gate in hosted mode only: `Route.auth` defaults to `"user"`; `"public"` routes: static assets, `/auth/*`, `/api/health`, `/api/status`. Unauthenticated → `401 { ok:false, error:"sign in" }`; `"admin"` route with a `member` → `403 { ok:false, error:"admin only" }`. Handlers receive `ctx: RequestContext { hosted, user: SessionUser | null, sessionId: string | null, ip: string }` — never `process.env`/globals for identity.
- `GET /api/me` → `200 { ok:true, user:{ id, discordId, username, globalName, avatarUrl, role } }` or 401. `avatarUrl` = `https://cdn.discordapp.com/avatars/<discord_id>/<avatar_hash>.png?size=64` when `avatar_hash` is set, else `https://cdn.discordapp.com/embed/avatars/<(discord_id >> 22) % 6>.png`.
- Admin routes (`auth: "admin"`): `GET /api/admin/invites`, `POST /api/admin/invites { discordId, note? }`, `DELETE /api/admin/invites/:discordId`, `GET /api/admin/users`, `POST /api/admin/users/:id/role { role }` (an admin cannot change their own role → 400).
- Client IP: `X-Forwarded-For` first entry when hosted (Caddy in front), else `server.requestIP(req)?.address ?? ""`.
- No new runtime dependencies (root or `web/`). `node:crypto` only. TypeScript strict; English; 2-space, double quotes, `.ts` extensions; `just check` and `bun test` green with `web/dist` absent.
- Front: types-only imports from `src/`; new logic in pure tested view models under `web/src/lib/`; only existing classes/tokens (`.home`, `.btn`, `.btn-primary`, `.muted`, `.mono`, `.card`) — the sign-in screen is a functional placeholder whose design pass is issue #7 (Claude Design canvas). All UI strings English.
- Commits on `main` in place; messages end (after a blank line) with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`. Stage paths explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`. Never rewrite history.

## File structure

| File | Responsibility |
|---|---|
| `src/hosted/schema.ts` (new) | `HOSTED_SCHEMA` SQL, `applyHostedSchema(db)` |
| `src/hosted/db.ts` (new) | `openHosted(db)` → `HostedDb { users, sessions, invites }` repositories (prepared statements) |
| `src/hosted/cookie.ts` (new) | `parseCookies`, `signSessionId`, `verifySessionCookie`, `serializeCookie`, cookie names/TTLs |
| `src/hosted/oauth-state.ts` (new) | `OAuthStates` — issue/consume single-use states bound to a nonce |
| `src/hosted/discord.ts` (new) | `authorizeUrl`, `exchangeCode`, `fetchDiscordUser`, `avatarUrl` — all over `fetchFn` |
| `src/hosted/auth.ts` (new) | `RequestContext`, `SessionUser`, `resolveRequest`, `authGate`, `clientIp` |
| `src/server/routes.ts` (modify) | `Route.auth`, `Handler(req, url, ctx)`, `findRoute` |
| `src/server/routes-shared.ts`, `routes-local.ts` (modify) | third handler arg; `/api/health` + `/api/status` → `auth: "public"` |
| `src/server/routes-auth.ts` (new) | `/auth/discord`, `/auth/discord/callback`, `POST /auth/logout`, `GET /api/me` |
| `src/server/routes-admin.ts` (new) | `/api/admin/*` |
| `src/server.ts` (modify) | `ServeOptions.hostedConfig`, `fetchFn`; per-request context; gate; purge timer |
| `src/cli.ts` (modify) | `planServe` returns `hostedConfig`; `bmpl invite` |
| `web/src/api.ts`, `web/src/lib/hostedMode.ts`, `web/src/App.tsx`, `web/src/components/{SignIn,Header}.tsx` | front gate |
| `test/hosted/{db,cookie,oauth-state,discord,auth}.test.ts`, `test/hosted/helpers.ts`, `test/server-auth.test.ts`, `test/server-admin.test.ts` (new); `test/server-hosted.test.ts`, `test/cli-serve.test.ts` (modify) | tests |
| `README.md`, `.env.hosted.example`, `docs/agents/architecture.md`, `AGENTS.md` | docs |

---

### Task 1: Hosted schema and repositories (`src/hosted/schema.ts`, `src/hosted/db.ts`)

**Files:**
- Create: `src/hosted/schema.ts`, `src/hosted/db.ts`
- Test: `test/hosted/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/hosted/schema.ts
  export const HOSTED_SCHEMA: string;
  export function applyHostedSchema(db: Database): void;
  // src/hosted/db.ts
  export type Role = "member" | "admin";
  export interface UserRow { id: number; discordId: string; username: string; globalName: string | null; avatarHash: string | null; role: Role; createdAt: number; lastSeenAt: number }
  export interface SessionRow { id: string; userId: number; createdAt: number; expiresAt: number; ip: string | null; userAgent: string | null }
  export interface InviteRow { discordId: string; invitedBy: string; createdAt: number; note: string | null }
  export interface DiscordIdentity { discordId: string; username: string; globalName: string | null; avatarHash: string | null }
  export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  export const SESSION_REFRESH_MS = 60 * 60 * 1000;
  export interface HostedDb {
    users: {
      upsertFromDiscord(identity: DiscordIdentity, role: Role | null, now: number): UserRow; // role null = keep stored role (member for a new user)
      byId(id: number): UserRow | null;
      byDiscordId(discordId: string): UserRow | null;
      list(): UserRow[];
      setRole(id: number, role: Role): boolean;
      touch(id: number, now: number): void;
    };
    sessions: {
      create(userId: number, meta: { ip: string | null; userAgent: string | null; now: number }): SessionRow;
      /** null when unknown or expired; slides expiry (and touches the user) when within SESSION_REFRESH_MS of needing it. */
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
  export function openHosted(db: Database): HostedDb;
  export function newSessionId(): string; // 32 random bytes, base64url
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosted/db.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/hosted/db.test.ts`
Expected: FAIL — cannot find `../../src/hosted/db.ts`.

- [ ] **Step 3: Implement `src/hosted/schema.ts`**

```ts
// src/hosted/schema.ts
// Hosted-mode tables (users, sessions, invites). Additive only: every statement is
// CREATE ... IF NOT EXISTS so it can run on every start next to the cache tables.
import type { Database } from "bun:sqlite";

export const HOSTED_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  discord_id   TEXT    NOT NULL UNIQUE,
  username     TEXT    NOT NULL,
  global_name  TEXT,
  avatar_hash  TEXT,
  role         TEXT    NOT NULL CHECK (role IN ('member', 'admin')),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS invites (
  discord_id TEXT    PRIMARY KEY,
  invited_by TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  note       TEXT
);
`;

export function applyHostedSchema(db: Database): void {
  db.exec(HOSTED_SCHEMA);
}
```

- [ ] **Step 4: Implement `src/hosted/db.ts`**

```ts
// src/hosted/db.ts
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
```

Note on `invites.add` re-adding: the upsert keeps the original `created_at` (only `invited_by` and `note` change) — the test only checks the row count and that is what the SQL does.

- [ ] **Step 5: Run the tests and typecheck**

Run: `bun test test/hosted/db.test.ts && just check`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/hosted/schema.ts src/hosted/db.ts test/hosted/db.test.ts
git commit -m "feat(hosted): users, sessions and invites tables with repositories"
```

---

### Task 2: Session cookie signing and OAuth state store

**Files:**
- Create: `src/hosted/cookie.ts`, `src/hosted/oauth-state.ts`
- Test: `test/hosted/cookie.test.ts`, `test/hosted/oauth-state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/hosted/cookie.ts
  export const SESSION_COOKIE = "bmpl_session";
  export const OAUTH_COOKIE = "bmpl_oauth";
  export const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
  export const OAUTH_COOKIE_MAX_AGE_S = 600;
  export function parseCookies(header: string | null): Map<string, string>;
  export function signSessionId(id: string, secret: string): string;            // "<id>.<hmac>"
  export function verifySessionCookie(value: string | undefined, secret: string): string | null; // id or null
  export function serializeCookie(name: string, value: string, opts: { maxAgeS: number; path: string; secure: boolean }): string;
  export function clearCookie(name: string, opts: { path: string; secure: boolean }): string;
  // src/hosted/oauth-state.ts
  export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
  export class OAuthStates {
    issue(nonce: string, now: number): string;                       // state token
    consume(state: string, nonce: string, now: number): boolean;     // true once, then false
    size(): number;
  }
  export const newNonce: () => string; // 32 random bytes base64url
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosted/cookie.test.ts
import { describe, expect, test } from "bun:test";
import { OAUTH_COOKIE, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S, clearCookie, parseCookies, serializeCookie, signSessionId, verifySessionCookie } from "../../src/hosted/cookie.ts";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("parseCookies", () => {
  test("parses name=value pairs, trims, ignores malformed", () => {
    const m = parseCookies("a=1; bmpl_session=abc.def ; bad; c=");
    expect(m.get("a")).toBe("1");
    expect(m.get("bmpl_session")).toBe("abc.def");
    expect(m.get("c")).toBe("");
    expect(m.has("bad")).toBe(false);
    expect(parseCookies(null).size).toBe(0);
  });
});

describe("session cookie signing", () => {
  test("round-trips and rejects tampering, wrong secret, malformed", () => {
    const v = signSessionId("session-id-1", SECRET);
    expect(v.startsWith("session-id-1.")).toBe(true);
    expect(verifySessionCookie(v, SECRET)).toBe("session-id-1");
    expect(verifySessionCookie(v.slice(0, -1) + (v.endsWith("A") ? "B" : "A"), SECRET)).toBeNull();
    expect(verifySessionCookie("session-id-2." + v.split(".")[1], SECRET)).toBeNull();
    expect(verifySessionCookie(v, "another-secret-another-secret-00")).toBeNull();
    expect(verifySessionCookie("nodot", SECRET)).toBeNull();
    expect(verifySessionCookie("", SECRET)).toBeNull();
    expect(verifySessionCookie(undefined, SECRET)).toBeNull();
  });
});

describe("serializeCookie / clearCookie", () => {
  test("session cookie attributes", () => {
    const s = serializeCookie(SESSION_COOKIE, "v", { maxAgeS: SESSION_COOKIE_MAX_AGE_S, path: "/", secure: true });
    expect(s).toBe("bmpl_session=v; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure");
    const o = serializeCookie(OAUTH_COOKIE, "n", { maxAgeS: 600, path: "/auth", secure: false });
    expect(o).toBe("bmpl_oauth=n; Max-Age=600; Path=/auth; HttpOnly; SameSite=Lax");
    expect(clearCookie(SESSION_COOKIE, { path: "/", secure: true })).toBe("bmpl_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure");
  });
});
```

```ts
// test/hosted/oauth-state.test.ts
import { describe, expect, test } from "bun:test";
import { OAUTH_STATE_TTL_MS, OAuthStates, newNonce } from "../../src/hosted/oauth-state.ts";

describe("OAuthStates", () => {
  test("issue/consume is single-use and bound to the nonce", () => {
    const s = new OAuthStates();
    const state = s.issue("nonce-a", 1000);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.consume(state, "nonce-b", 1001)).toBe(false); // wrong nonce does not consume
    expect(s.consume(state, "nonce-a", 1001)).toBe(true);
    expect(s.consume(state, "nonce-a", 1002)).toBe(false); // consumed
    expect(s.consume("unknown", "nonce-a", 1002)).toBe(false);
  });
  test("expires after the TTL and prunes on issue", () => {
    const s = new OAuthStates();
    const state = s.issue("n", 0);
    expect(s.consume(state, "n", OAUTH_STATE_TTL_MS)).toBe(false);
    s.issue("m", OAUTH_STATE_TTL_MS + 1);
    expect(s.size()).toBe(1);
  });
  test("nonces are random base64url", () => {
    expect(newNonce()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newNonce()).not.toBe(newNonce());
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test test/hosted/cookie.test.ts test/hosted/oauth-state.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/hosted/cookie.ts`**

```ts
// src/hosted/cookie.ts
// Cookie helpers for hosted mode. The session cookie carries "<id>.<hmac>" so a forged id is
// rejected by the signature before any database read.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "bmpl_session";
export const OAUTH_COOKIE = "bmpl_oauth";
export const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
export const OAUTH_COOKIE_MAX_AGE_S = 600;

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    out.set(name, part.slice(i + 1).trim());
  }
  return out;
}

const hmac = (id: string, secret: string): string => createHmac("sha256", secret).update(id).digest("base64url");

export const signSessionId = (id: string, secret: string): string => `${id}.${hmac(id, secret)}`;

export function verifySessionCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(hmac(id, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export function serializeCookie(name: string, value: string, opts: { maxAgeS: number; path: string; secure: boolean }): string {
  const parts = [`${name}=${value}`, `Max-Age=${opts.maxAgeS}`, `Path=${opts.path}`, "HttpOnly", "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export const clearCookie = (name: string, opts: { path: string; secure: boolean }): string =>
  serializeCookie(name, "", { maxAgeS: 0, path: opts.path, secure: opts.secure });
```

- [ ] **Step 4: Implement `src/hosted/oauth-state.ts`**

```ts
// src/hosted/oauth-state.ts
// Single-use OAuth `state` tokens, bound to a nonce that lives in the bmpl_oauth cookie:
// the callback must present both, so a link replayed from another browser is refused.
// In-memory on purpose — one bmpl process, ten-minute lifetime.
import { randomBytes } from "node:crypto";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const newNonce = (): string => randomBytes(32).toString("base64url");

export class OAuthStates {
  private readonly pending = new Map<string, { nonce: string; expiresAt: number }>();

  issue(nonce: string, now: number): string {
    for (const [k, v] of this.pending) if (v.expiresAt <= now) this.pending.delete(k);
    const state = randomBytes(32).toString("base64url");
    this.pending.set(state, { nonce, expiresAt: now + OAUTH_STATE_TTL_MS });
    return state;
  }

  consume(state: string, nonce: string, now: number): boolean {
    const entry = this.pending.get(state);
    if (!entry) return false;
    if (entry.expiresAt <= now) { this.pending.delete(state); return false; }
    if (entry.nonce !== nonce) return false;
    this.pending.delete(state);
    return true;
  }

  size(): number { return this.pending.size; }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `bun test test/hosted/cookie.test.ts test/hosted/oauth-state.test.ts && just check`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/hosted/cookie.ts src/hosted/oauth-state.ts test/hosted/cookie.test.ts test/hosted/oauth-state.test.ts
git commit -m "feat(hosted): signed session cookie helpers and single-use OAuth state store"
```

---

### Task 3: Discord OAuth client (`src/hosted/discord.ts`)

**Files:**
- Create: `src/hosted/discord.ts`
- Test: `test/hosted/discord.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
  export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
  export const DISCORD_ME_URL = "https://discord.com/api/users/@me";
  export const redirectUri: (baseUrl: string) => string;   // `${baseUrl}/auth/discord/callback`
  export function authorizeUrl(cfg: { discordClientId: string; baseUrl: string }, state: string): string;
  export type FetchFn = typeof fetch;
  export async function exchangeCode(cfg: { discordClientId: string; discordClientSecret: string; baseUrl: string }, code: string, fetchFn: FetchFn): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }>;
  export async function fetchDiscordUser(accessToken: string, fetchFn: FetchFn): Promise<{ ok: true; identity: DiscordIdentity } | { ok: false; error: string }>;
  export function avatarUrl(discordId: string, avatarHash: string | null): string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosted/discord.test.ts
import { describe, expect, test } from "bun:test";
import { DISCORD_ME_URL, DISCORD_TOKEN_URL, authorizeUrl, avatarUrl, exchangeCode, fetchDiscordUser, redirectUri } from "../../src/hosted/discord.ts";

const CFG = { discordClientId: "123456789012345678", discordClientSecret: "sekrit", baseUrl: "https://bmpl.example.com" };

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as unknown as typeof fetch;

describe("authorizeUrl", () => {
  test("has client_id, identify scope, redirect_uri and state", () => {
    const u = new URL(authorizeUrl(CFG, "st4te"));
    expect(u.origin + u.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(u.searchParams.get("client_id")).toBe(CFG.discordClientId);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("identify");
    expect(u.searchParams.get("redirect_uri")).toBe("https://bmpl.example.com/auth/discord/callback");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("prompt")).toBe("none");
    expect(redirectUri(CFG.baseUrl)).toBe("https://bmpl.example.com/auth/discord/callback");
  });
});

describe("exchangeCode", () => {
  test("posts a form body and returns the access token", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const f = fakeFetch((url, init) => { seen = { url, init }; return Response.json({ access_token: "tok", token_type: "Bearer" }); });
    const r = await exchangeCode(CFG, "c0de", f);
    expect(r).toEqual({ ok: true, accessToken: "tok" });
    expect(seen!.url).toBe(DISCORD_TOKEN_URL);
    expect(seen!.init?.method).toBe("POST");
    const body = new URLSearchParams(String(seen!.init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c0de");
    expect(body.get("client_id")).toBe(CFG.discordClientId);
    expect(body.get("client_secret")).toBe("sekrit");
    expect(body.get("redirect_uri")).toBe("https://bmpl.example.com/auth/discord/callback");
    expect(new Headers(seen!.init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
  });
  test("non-2xx, missing token and network errors are reported, never thrown", async () => {
    expect((await exchangeCode(CFG, "c", fakeFetch(() => new Response("nope", { status: 400 })))).ok).toBe(false);
    expect((await exchangeCode(CFG, "c", fakeFetch(() => Response.json({})))).ok).toBe(false);
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const r = await exchangeCode(CFG, "c", boom);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("offline");
  });
});

describe("fetchDiscordUser", () => {
  test("sends the bearer token and maps the identity", async () => {
    let auth = "";
    const f = fakeFetch((url, init) => { auth = new Headers(init?.headers).get("authorization") ?? ""; expect(url).toBe(DISCORD_ME_URL); return Response.json({ id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" }); });
    const r = await fetchDiscordUser("tok", f);
    expect(auth).toBe("Bearer tok");
    expect(r).toEqual({ ok: true, identity: { discordId: "123456789012345678", username: "tom", globalName: "Tom", avatarHash: "abc" } });
  });
  test("null global_name/avatar and bad payloads", async () => {
    const r = await fetchDiscordUser("tok", fakeFetch(() => Response.json({ id: "123456789012345678", username: "tom", global_name: null, avatar: null })));
    expect(r).toEqual({ ok: true, identity: { discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null } });
    expect((await fetchDiscordUser("tok", fakeFetch(() => Response.json({ username: "x" })))).ok).toBe(false);
    expect((await fetchDiscordUser("tok", fakeFetch(() => new Response("", { status: 401 })))).ok).toBe(false);
  });
});

describe("avatarUrl", () => {
  test("hash → cdn avatar, no hash → default embed avatar by (id >> 22) % 6", () => {
    expect(avatarUrl("123456789012345678", "abc")).toBe("https://cdn.discordapp.com/avatars/123456789012345678/abc.png?size=64");
    expect(avatarUrl("123456789012345678", null)).toBe(`https://cdn.discordapp.com/embed/avatars/${(123456789012345678n >> 22n) % 6n}.png`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/hosted/discord.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/hosted/discord.ts`**

```ts
// src/hosted/discord.ts
// Discord OAuth2 (authorization code, scope "identify"). Every HTTP call goes through the
// injected fetchFn so tests never touch the network. Errors are returned, never thrown.
import type { DiscordIdentity } from "./db.ts";

export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_ME_URL = "https://discord.com/api/users/@me";

export type FetchFn = typeof fetch;

export const redirectUri = (baseUrl: string): string => `${baseUrl}/auth/discord/callback`;

export function authorizeUrl(cfg: { discordClientId: string; baseUrl: string }, state: string): string {
  const u = new URL(DISCORD_AUTHORIZE_URL);
  u.searchParams.set("client_id", cfg.discordClientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "identify");
  u.searchParams.set("redirect_uri", redirectUri(cfg.baseUrl));
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "none"); // returning users are not re-asked to authorize
  return u.toString();
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function exchangeCode(
  cfg: { discordClientId: string; discordClientSecret: string; baseUrl: string },
  code: string,
  fetchFn: FetchFn,
): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const body = new URLSearchParams({
    client_id: cfg.discordClientId,
    client_secret: cfg.discordClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(cfg.baseUrl),
  });
  try {
    const res = await fetchFn(DISCORD_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!res.ok) return { ok: false, error: `Discord token endpoint answered ${res.status}` };
    const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!json || typeof json.access_token !== "string" || !json.access_token) return { ok: false, error: "Discord token response has no access_token" };
    return { ok: true, accessToken: json.access_token };
  } catch (e) {
    return { ok: false, error: `Discord token request failed: ${message(e)}` };
  }
}

export async function fetchDiscordUser(
  accessToken: string,
  fetchFn: FetchFn,
): Promise<{ ok: true; identity: DiscordIdentity } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(DISCORD_ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { ok: false, error: `Discord /users/@me answered ${res.status}` };
    const j = (await res.json().catch(() => null)) as { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown } | null;
    if (!j || typeof j.id !== "string" || typeof j.username !== "string") return { ok: false, error: "Discord /users/@me payload is missing id/username" };
    return {
      ok: true,
      identity: {
        discordId: j.id,
        username: j.username,
        globalName: typeof j.global_name === "string" ? j.global_name : null,
        avatarHash: typeof j.avatar === "string" ? j.avatar : null,
      },
    };
  } catch (e) {
    return { ok: false, error: `Discord /users/@me request failed: ${message(e)}` };
  }
}

/** Discord CDN avatar; users without a custom avatar get one of the six default embeds. */
export function avatarUrl(discordId: string, avatarHash: string | null): string {
  if (avatarHash) return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=64`;
  const index = (BigInt(discordId) >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun test test/hosted/discord.test.ts && just check`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hosted/discord.ts test/hosted/discord.test.ts
git commit -m "feat(hosted): Discord OAuth2 client over an injected fetch"
```

---

### Task 4: Request context and route gate (`src/hosted/auth.ts`, `Route.auth`, `runServer` wiring)

The seam every later task uses. After this task hosted mode refuses unauthenticated `/api/*` calls (except health/status); no login route exists yet, so tests create sessions directly in the DB through a helper.

**Files:**
- Create: `src/hosted/auth.ts`, `test/hosted/helpers.ts`, `test/hosted/auth.test.ts`
- Modify: `src/server/routes.ts`, `src/server/routes-shared.ts`, `src/server/routes-local.ts`, `src/server.ts`, `test/server-hosted.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/server/routes.ts
  export type RouteAuth = "public" | "user" | "admin";
  export type Handler = (req: Request, url: URL, ctx: RequestContext) => Response | Promise<Response>;
  export interface Route { method: "GET" | "POST" | "DELETE"; match: (path: string) => boolean; handle: Handler; auth: RouteAuth }
  export const route: (method, path, handle, auth?: RouteAuth /* default "user" */) => Route;
  export const prefixRoute: (method, prefix, handle, auth?: RouteAuth) => Route;
  export function findRoute(routes: Route[], req: Request, url: URL): Route | null;
  // src/hosted/auth.ts
  export interface SessionUser { id: number; discordId: string; username: string; globalName: string | null; avatarHash: string | null; role: Role }
  export interface RequestContext { hosted: boolean; user: SessionUser | null; sessionId: string | null; ip: string }
  export const LOCAL_CONTEXT: (ip: string) => RequestContext;          // { hosted:false, user:null, sessionId:null, ip }
  export function clientIp(req: Request, hosted: boolean, fallback: string | null): string;
  export function resolveRequest(req: Request, deps: { db: HostedDb; secret: string; now: number; ip: string }): RequestContext;
  export function authGate(route: { auth: RouteAuth }, ctx: RequestContext): Response | null; // 401/403 JSON or null
  // src/server.ts
  export interface ServeOptions { port; open; hosted?; hostedConfig?: HostedConfig; fetchFn?: typeof fetch; assets? }
  export interface HostedRuntime { config: HostedConfig; db: HostedDb; states: OAuthStates; fetchFn: typeof fetch; secure: boolean }
  // test/hosted/helpers.ts
  export const TEST_HOSTED_CONFIG: HostedConfig;   // baseUrl "http://localhost", secret 32 chars, client id/secret, adminDiscordIds ["111111111111111111"]
  export function loginAs(db: HostedDb, secret: string, who: { discordId: string; role: Role; username?: string }, now?: number): { cookie: string; user: UserRow; sessionId: string };
  ```
- `runServer` in hosted mode requires `hostedConfig` (throws `Error("hosted mode needs hostedConfig")` otherwise) and builds a `HostedRuntime` from `openHosted((await getStore())._db)`; `sharedRoutes(ctx)` keeps its construction-time context; `ServeOptions.fetchFn` defaults to global `fetch`.

- [ ] **Step 1: Write the failing unit tests for `auth.ts`**

```ts
// test/hosted/helpers.ts
import { signSessionId } from "../../src/hosted/cookie.ts";
import type { HostedConfig } from "../../src/hosted/config.ts";
import type { HostedDb, Role, UserRow } from "../../src/hosted/db.ts";

export const TEST_HOSTED_CONFIG: HostedConfig = {
  baseUrl: "http://localhost",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  discordClientId: "123456789012345678",
  discordClientSecret: "test-client-secret",
  adminDiscordIds: ["111111111111111111"],
};

/** Inserts a user + session straight into the DB and returns the Cookie header to send. */
export function loginAs(db: HostedDb, secret: string, who: { discordId: string; role: Role; username?: string }, now = Date.now()): { cookie: string; user: UserRow; sessionId: string } {
  const user = db.users.upsertFromDiscord({ discordId: who.discordId, username: who.username ?? "user" + who.discordId.slice(-4), globalName: null, avatarHash: null }, who.role, now);
  const s = db.sessions.create(user.id, { ip: "127.0.0.1", userAgent: "test", now });
  return { cookie: `bmpl_session=${signSessionId(s.id, secret)}`, user, sessionId: s.id };
}
```

```ts
// test/hosted/auth.test.ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LOCAL_CONTEXT, authGate, clientIp, resolveRequest } from "../../src/hosted/auth.ts";
import { signSessionId } from "../../src/hosted/cookie.ts";
import { openHosted } from "../../src/hosted/db.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./helpers.ts";

const SECRET = TEST_HOSTED_CONFIG.sessionSecret;
const req = (cookie?: string, extra: Record<string, string> = {}) =>
  new Request("http://x/api/history", { headers: { ...(cookie ? { cookie } : {}), ...extra } });

describe("clientIp", () => {
  test("hosted trusts the first X-Forwarded-For entry, local uses the fallback", () => {
    expect(clientIp(req(undefined, { "x-forwarded-for": " 9.9.9.9 , 10.0.0.1" }), true, "127.0.0.1")).toBe("9.9.9.9");
    expect(clientIp(req(undefined, { "x-forwarded-for": "9.9.9.9" }), false, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp(req(), true, null)).toBe("");
  });
});

describe("resolveRequest", () => {
  test("valid cookie → user; tampered/missing/expired/unknown → anonymous", () => {
    const db = openHosted(new Database(":memory:"));
    const { cookie, user, sessionId } = loginAs(db, SECRET, { discordId: "123456789012345678", role: "member" }, 1000);
    const ok = resolveRequest(req(cookie), { db, secret: SECRET, now: 2000, ip: "1.1.1.1" });
    expect(ok.user).toMatchObject({ id: user.id, discordId: "123456789012345678", role: "member" });
    expect(ok.sessionId).toBe(sessionId);
    expect(ok.hosted).toBe(true);
    expect(ok.ip).toBe("1.1.1.1");
    const tampered = resolveRequest(req(cookie.slice(0, -2) + "zz"), { db, secret: SECRET, now: 2000, ip: "" });
    expect(tampered.user).toBeNull();
    expect(resolveRequest(req(), { db, secret: SECRET, now: 2000, ip: "" }).user).toBeNull();
    const unknown = `bmpl_session=${signSessionId("not-a-session", SECRET)}`;
    expect(resolveRequest(req(unknown), { db, secret: SECRET, now: 2000, ip: "" }).user).toBeNull();
    db.sessions.delete(sessionId);
    expect(resolveRequest(req(cookie), { db, secret: SECRET, now: 2000, ip: "" }).user).toBeNull();
  });
});

describe("authGate", () => {
  const anon = { hosted: true, user: null, sessionId: null, ip: "" };
  const member = { ...anon, user: { id: 1, discordId: "1", username: "m", globalName: null, avatarHash: null, role: "member" as const }, sessionId: "s" };
  const admin = { ...member, user: { ...member.user, role: "admin" as const } };
  test("public passes everyone; user needs a session; admin needs the role", async () => {
    expect(authGate({ auth: "public" }, anon)).toBeNull();
    const r401 = authGate({ auth: "user" }, anon)!;
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ ok: false, error: "sign in" });
    expect(authGate({ auth: "user" }, member)).toBeNull();
    const r403 = authGate({ auth: "admin" }, member)!;
    expect(r403.status).toBe(403);
    expect(await r403.json()).toEqual({ ok: false, error: "admin only" });
    expect(authGate({ auth: "admin" }, admin)).toBeNull();
  });
  test("local context is never gated", () => {
    expect(authGate({ auth: "admin" }, LOCAL_CONTEXT("127.0.0.1"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/hosted/auth.test.ts`
Expected: FAIL — `src/hosted/auth.ts` not found.

- [ ] **Step 3: Extend `src/server/routes.ts`**

```ts
// src/server/routes.ts
// Minimal route table: first match wins, in registration order (prefix routes go after exact ones).
// `auth` is enforced by the server in hosted mode only (src/hosted/auth.ts authGate).
import type { RequestContext } from "../hosted/auth.ts";

export type RouteAuth = "public" | "user" | "admin";
export type Handler = (req: Request, url: URL, ctx: RequestContext) => Response | Promise<Response>;
export interface Route { method: "GET" | "POST" | "DELETE"; match: (path: string) => boolean; handle: Handler; auth: RouteAuth }

export const route = (method: Route["method"], path: string, handle: Handler, auth: RouteAuth = "user"): Route =>
  ({ method, match: (p) => p === path, handle, auth });

export const prefixRoute = (method: Route["method"], prefix: string, handle: Handler, auth: RouteAuth = "user"): Route =>
  ({ method, match: (p) => p.startsWith(prefix), handle, auth });

export function findRoute(routes: Route[], req: Request, url: URL): Route | null {
  for (const r of routes) if (r.method === req.method && r.match(url.pathname)) return r;
  return null;
}
```

Delete `dispatch` (its only caller is `runServer`, rewritten in Step 6).

- [ ] **Step 4: Create `src/hosted/auth.ts`**

```ts
// src/hosted/auth.ts
// Per-request identity for hosted mode: cookie → signature check → session row → user.
// Local mode gets LOCAL_CONTEXT and is never gated.
import { SESSION_COOKIE, parseCookies, verifySessionCookie } from "./cookie.ts";
import type { HostedDb, Role } from "./db.ts";
import { jsonResponse } from "../server/http.ts";
import type { RouteAuth } from "../server/routes.ts";

export interface SessionUser { id: number; discordId: string; username: string; globalName: string | null; avatarHash: string | null; role: Role }
export interface RequestContext { hosted: boolean; user: SessionUser | null; sessionId: string | null; ip: string }

export const LOCAL_CONTEXT = (ip: string): RequestContext => ({ hosted: false, user: null, sessionId: null, ip });

/** Behind Caddy the socket peer is the proxy; the first X-Forwarded-For entry is the client. */
export function clientIp(req: Request, hosted: boolean, fallback: string | null): string {
  if (hosted) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]!.trim();
      if (first) return first;
    }
  }
  return fallback ?? "";
}

export function resolveRequest(req: Request, deps: { db: HostedDb; secret: string; now: number; ip: string }): RequestContext {
  const anonymous: RequestContext = { hosted: true, user: null, sessionId: null, ip: deps.ip };
  const id = verifySessionCookie(parseCookies(req.headers.get("cookie")).get(SESSION_COOKIE), deps.secret);
  if (!id) return anonymous;
  const s = deps.db.sessions.get(id, deps.now);
  if (!s) return anonymous;
  const u = deps.db.users.byId(s.userId);
  if (!u) return anonymous;
  return {
    hosted: true,
    user: { id: u.id, discordId: u.discordId, username: u.username, globalName: u.globalName, avatarHash: u.avatarHash, role: u.role },
    sessionId: s.id,
    ip: deps.ip,
  };
}

/** null = allowed; otherwise the 401/403 response to send instead of the handler. */
export function authGate(route: { auth: RouteAuth }, ctx: RequestContext): Response | null {
  if (!ctx.hosted || route.auth === "public") return null;
  if (!ctx.user) return jsonResponse({ ok: false, error: "sign in" }, 401);
  if (route.auth === "admin" && ctx.user.role !== "admin") return jsonResponse({ ok: false, error: "admin only" }, 403);
  return null;
}
```

`src/server/http.ts` importing nothing from `hosted/` and `hosted/auth.ts` importing `http.ts` + the `RouteAuth` type keeps the graph acyclic (`routes.ts` imports only the `RequestContext` type).

- [ ] **Step 5: Thread the context through the route files**

`src/server/routes-shared.ts`: every handler closure gains the unused third parameter where needed (TypeScript accepts fewer parameters, so most closures stay as they are). Mark public routes:

```ts
    route("GET", "/api/health", () => handleHealth(), "public"),
    route("GET", "/api/status", () => …unchanged body…, "public"),
```

Everything else keeps the default `"user"`. `src/server/routes-local.ts` needs no change (local routes are never gated), but its handler signatures must still typecheck against the new `Handler` — they do (fewer params).

- [ ] **Step 6: Rewrite `runServer` in `src/server.ts`**

```ts
import type { Server } from "bun";
import { hasCredentials } from "./config.ts";
import { dim, heading, ok } from "./format.ts";
import { LOCAL_CONTEXT, authGate, clientIp, resolveRequest } from "./hosted/auth.ts";
import type { HostedConfig } from "./hosted/config.ts";
import { openHosted } from "./hosted/db.ts";
import type { HostedDb } from "./hosted/db.ts";
import { OAuthStates } from "./hosted/oauth-state.ts";
import { findRoute } from "./server/routes.ts";
import type { Route } from "./server/routes.ts";
import { sharedRoutes } from "./server/routes-shared.ts";
import { localRoutes } from "./server/routes-local.ts";
import { jsonResponse } from "./server/http.ts";
import { withSecurityHeaders } from "./server/security.ts";
import { closeStore, getStore } from "./signals/store.ts";
import { resolveEnvPath } from "./setup.ts";
import { createStaticHandler, defaultAssetLoader } from "./web-static.ts";
import type { AssetLoader } from "./web-static.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
  /** Multi-user deployment: local-only routes are not registered, security headers on, login required. Default false. */
  hosted?: boolean;
  /** Required when hosted: the validated BMPL_* environment. */
  hostedConfig?: HostedConfig;
  /** Test hook: fetch used for Discord calls. Default: global fetch. */
  fetchFn?: typeof fetch;
  /** Test hook: where the built front lives. Default: embedded web/dist. */
  assets?: AssetLoader;
}

/** Everything hosted-only routes need, built once per server. */
export interface HostedRuntime { config: HostedConfig; db: HostedDb; states: OAuthStates; fetchFn: typeof fetch; secure: boolean }

const SESSION_PURGE_INTERVAL_MS = 60 * 60 * 1000;

// openBrowser unchanged

export async function runServer(opts: ServeOptions): Promise<Server<undefined>> {
  if (process.listenerCount("SIGINT") === 0) {
    process.on("SIGINT", () => { closeStore(); process.exit(0); });
  }
  const hosted = opts.hosted ?? false;
  if (hosted && !opts.hostedConfig) throw new Error("hosted mode needs hostedConfig");
  const envPathHint = await resolveEnvPath();
  const serveStatic = createStaticHandler(opts.assets ?? defaultAssetLoader);

  let runtime: HostedRuntime | null = null;
  if (hosted) {
    const config = opts.hostedConfig!;
    runtime = { config, db: openHosted((await getStore())._db), states: new OAuthStates(), fetchFn: opts.fetchFn ?? fetch, secure: config.baseUrl.startsWith("https:") };
    setInterval(() => runtime!.db.sessions.purgeExpired(Date.now()), SESSION_PURGE_INTERVAL_MS).unref();
  }
  const routes: Route[] = [...sharedRoutes({ hosted, envPath: envPathHint }), ...(hosted ? [] : localRoutes())];

  const respond = async (req: Request, url: URL, peerIp: string | null): Promise<Response> => {
    try {
      if (req.method === "GET") {
        const staticRes = await serveStatic(url.pathname);
        if (staticRes) return staticRes;
      }
      const r = findRoute(routes, req, url);
      if (!r) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      const ip = clientIp(req, hosted, peerIp);
      const ctx = runtime ? resolveRequest(req, { db: runtime.db, secret: runtime.config.sessionSecret, now: Date.now(), ip }) : LOCAL_CONTEXT(ip);
      return authGate(r, ctx) ?? (await r.handle(req, url, ctx));
    } catch (e) {
      console.error(e);
      return jsonResponse({ ok: false, error: "Internal error" }, 500);
    }
  };

  const server = Bun.serve({
    port: opts.port,
    idleTimeout: 0, // long-lived SSE streams and slow enrichment lookups
    development: !hosted,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const res = await respond(req, url, srv.requestIP(req)?.address ?? null);
      return hosted ? withSecurityHeaders(res) : res;
    },
    error(e) { /* unchanged */ },
  });
  // banner + openBrowser unchanged
  return server;
}
```

`HostedRuntime` is exported now so Tasks 5–6 can build route files that take it; `routes` is a `const` array — Task 5 will push the auth routes into it via `authRoutes(runtime)` and Task 6 `adminRoutes(runtime)`. Prepare that: declare `const routes: Route[] = [...sharedRoutes(...), ...(hosted ? [] : localRoutes())];` exactly like that so later tasks can spread more arrays in.

- [ ] **Step 7: Update `test/server-hosted.test.ts` for the gate**

In `beforeAll`, build the hosted server with a config and open the same DB for the helper:

```ts
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";
import { getStore } from "../src/signals/store.ts";

let db: HostedDb;
let cookie: string;
// in beforeAll, after process.env.BMPL_DB_PATH = …:
hosted = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets });
db = openHosted((await getStore())._db);
cookie = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member" }).cookie;
```

Then:
- In "shared routes still answer" and "hosted /api/defensives never leaks…" and the two "malformed history keys" tests, add `{ headers: { cookie } }` to every hosted fetch (keep `method`/`body` where present).
- In "every hosted response carries them (static, api, 404, SSE)", pass the cookie on `/api/watch/status` (still 404) and on the SSE fetch; the `/`, `/api/status`, `/nope` fetches stay anonymous.
- Add a new describe:

```ts
describe("hosted auth gate", () => {
  test("gated routes answer 401 without a session, public ones do not", async () => {
    for (const [method, path] of [["GET", "/api/history"], ["POST", "/api/lookup"], ["POST", "/api/deepdive"], ["GET", "/api/defensives?class=Shaman&spec=Elemental"], ["GET", "/api/events"]] as const) {
      const res = await fetch(h(path), { method, body: method === "POST" ? "{}" : undefined });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: "sign in" });
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    }
    expect((await fetch(h("/api/health"))).status).toBe(200);
    expect((await fetch(h("/api/status"))).status).toBe(200);
    expect((await fetch(h("/"))).status).toBe(200);
  });
  test("a valid session passes; a tampered cookie is anonymous", async () => {
    expect((await fetch(h("/api/history"), { headers: { cookie } })).status).toBe(200);
    expect((await fetch(h("/api/history"), { headers: { cookie: cookie.slice(0, -3) + "xyz" } })).status).toBe(401);
  });
  test("local mode has no gate", async () => {
    expect((await fetch(l("/api/history"))).status).toBe(200);
  });
  test("runServer refuses hosted mode without a config", async () => {
    await expect(runServer({ port: 0, open: false, hosted: true })).rejects.toThrow("hostedConfig");
  });
});
```

- [ ] **Step 8: Run everything**

Run: `bun test test/hosted/auth.test.ts test/server-hosted.test.ts && bun test && just check`
Expected: all green (the SSE test's `AbortController` pattern is unchanged; `test/server.test.ts` and `test/server-deepdive.test.ts` untouched).

- [ ] **Step 9: Commit**

```bash
git add src/hosted/auth.ts src/server/routes.ts src/server/routes-shared.ts src/server.ts test/hosted/helpers.ts test/hosted/auth.test.ts test/server-hosted.test.ts
git commit -m "feat(server): per-request context and auth gate — hosted /api/* requires a session"
```

---

### Task 5: Auth routes — `/auth/discord`, callback, logout, `/api/me`

**Files:**
- Create: `src/server/routes-auth.ts`, `test/server-auth.test.ts`
- Modify: `src/server.ts` (spread `authRoutes(runtime)` into `routes` when hosted)

**Interfaces:**
- Consumes: `HostedRuntime` (Task 4), `authorizeUrl`/`exchangeCode`/`fetchDiscordUser`/`avatarUrl` (Task 3), cookie + state helpers (Task 2), `HostedDb` (Task 1).
- Produces:
  ```ts
  // src/server/routes-auth.ts
  export function authRoutes(rt: HostedRuntime): Route[];
  export function meUser(u: SessionUser): { id: number; discordId: string; username: string; globalName: string | null; avatarUrl: string; role: Role };
  export function admission(rt: { config: HostedConfig; db: HostedDb }, discordId: string): { admitted: false } | { admitted: true; role: Role | null }; // role "admin" for config admins, null (= keep stored) for invitees
  ```

- [ ] **Step 1: Write the failing round-trip test**

```ts
// test/server-auth.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG } from "./hosted/helpers.ts";

// Fake Discord: one token endpoint, one /users/@me; `who` selects the identity returned.
let who = { id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" as string | null };
let tokenStatus = 200;
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://discord.com/api/oauth2/token") {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("code") !== "good-code") return new Response("bad code", { status: 400 });
    return tokenStatus === 200 ? Response.json({ access_token: "tok-" + who.id }) : new Response("", { status: tokenStatus });
  }
  if (url === "https://discord.com/api/users/@me") {
    if (new Headers(init?.headers).get("authorization") !== "Bearer tok-" + who.id) return new Response("", { status: 401 });
    return Response.json(who);
  }
  throw new Error("unexpected fetch " + url);
}) as unknown as typeof fetch;

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const noRedirect = { redirect: "manual" as const };
const cookieOf = (res: Response, name: string): string | null => {
  for (const c of res.headers.getSetCookie()) if (c.startsWith(name + "=")) return c.split(";")[0]!;
  return null;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-auth-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, fetchFn: fakeFetch,
    assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }),
  });
  db = openHosted((await getStore())._db);
  db.invites.add("123456789012345678", "test", null, Date.now());
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

/** Runs /auth/discord then the callback with the state + nonce it issued; returns the callback response. */
async function login(overrides: { state?: string; oauthCookie?: string | null; code?: string } = {}): Promise<{ start: Response; cb: Response }> {
  const start = await fetch(u("/auth/discord"), noRedirect);
  const location = new URL(start.headers.get("location")!);
  const state = overrides.state ?? location.searchParams.get("state")!;
  const oauth = overrides.oauthCookie === undefined ? cookieOf(start, "bmpl_oauth") : overrides.oauthCookie;
  const cb = await fetch(u(`/auth/discord/callback?code=${overrides.code ?? "good-code"}&state=${encodeURIComponent(state)}`), { ...noRedirect, headers: oauth ? { cookie: oauth } : {} });
  return { start, cb };
}

describe("GET /auth/discord", () => {
  test("redirects to Discord with identify scope, sets the oauth cookie, no session needed", async () => {
    const res = await fetch(u("/auth/discord"), noRedirect);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(loc.searchParams.get("scope")).toBe("identify");
    expect(loc.searchParams.get("redirect_uri")).toBe("http://localhost/auth/discord/callback");
    expect(loc.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const oauth = res.headers.getSetCookie().find((c) => c.startsWith("bmpl_oauth="))!;
    expect(oauth).toContain("HttpOnly");
    expect(oauth).toContain("Path=/auth");
    expect(oauth).toContain("SameSite=Lax");
    expect(oauth).not.toContain("Secure"); // baseUrl is http in tests
    expect(oauth).toContain("Max-Age=600");
  });
});

describe("GET /auth/discord/callback", () => {
  test("full round-trip: session cookie set, redirect to /, user row created, /api/me works", async () => {
    const { cb } = await login();
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/");
    const session = cb.headers.getSetCookie().find((c) => c.startsWith("bmpl_session="))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    expect(session).toContain("Path=/");
    expect(session).toContain("Max-Age=2592000");
    expect(cb.headers.getSetCookie().find((c) => c.startsWith("bmpl_oauth=") && c.includes("Max-Age=0"))).toBeDefined();
    const cookie = session.split(";")[0]!;
    const me = await fetch(u("/api/me"), { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ ok: true, user: { id: expect.any(Number), discordId: "123456789012345678", username: "tom", globalName: "Tom", avatarUrl: "https://cdn.discordapp.com/avatars/123456789012345678/abc.png?size=64", role: "member" } });
    expect(db.users.byDiscordId("123456789012345678")?.role).toBe("member");
  });
  test("a config admin is admitted without an invite and gets role admin", async () => {
    who = { id: "111111111111111111", username: "boss", global_name: null, avatar: null };
    const { cb } = await login();
    expect(cb.status).toBe(302);
    const cookie = cookieOf(cb, "bmpl_session")!;
    const me = await (await fetch(u("/api/me"), { headers: { cookie } })).json();
    expect(me.user.role).toBe("admin");
    expect(me.user.avatarUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
    who = { id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" };
  });
  test("an uninvited user gets no session and is sent to /?denied=<id>", async () => {
    who = { id: "999999999999999999", username: "stranger", global_name: null, avatar: null };
    const { cb } = await login();
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/?denied=999999999999999999");
    expect(cookieOf(cb, "bmpl_session")).toBeNull();
    expect(db.users.byDiscordId("999999999999999999")).toBeNull();
    who = { id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" };
  });
  test("state is single-use, bound to the oauth cookie, and required", async () => {
    const first = await login();
    expect(first.cb.status).toBe(302);
    const state = new URL(first.start.headers.get("location")!).searchParams.get("state")!;
    const oauth = cookieOf(first.start, "bmpl_oauth");
    const replay = await fetch(u(`/auth/discord/callback?code=good-code&state=${state}`), { ...noRedirect, headers: { cookie: oauth! } });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ ok: false, error: "Invalid OAuth state" });
    expect((await login({ oauthCookie: null })).cb.status).toBe(400);
    expect((await login({ oauthCookie: "bmpl_oauth=someone-elses-nonce" })).cb.status).toBe(400);
    expect((await login({ state: "forged" })).cb.status).toBe(400);
    expect((await fetch(u("/auth/discord/callback"), noRedirect)).status).toBe(400);
  });
  test("Discord failures answer 502 without a session", async () => {
    const bad = await login({ code: "wrong-code" });
    expect(bad.cb.status).toBe(502);
    expect(cookieOf(bad.cb, "bmpl_session")).toBeNull();
    tokenStatus = 500;
    expect((await login()).cb.status).toBe(502);
    tokenStatus = 200;
  });
});

describe("POST /auth/logout and /api/me", () => {
  test("logout deletes the session and clears the cookie; /api/me is 401 after", async () => {
    const { cb } = await login();
    const cookie = cookieOf(cb, "bmpl_session")!;
    const out = await fetch(u("/auth/logout"), { method: "POST", headers: { cookie }, ...noRedirect });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect(out.headers.getSetCookie().find((c) => c.startsWith("bmpl_session=;") && c.includes("Max-Age=0"))).toBeDefined();
    expect((await fetch(u("/api/me"), { headers: { cookie } })).status).toBe(401);
    expect((await fetch(u("/auth/logout"), { method: "POST" })).status).toBe(200); // anonymous logout is a no-op
  });
  test("/api/me without a session is 401", async () => {
    const res = await fetch(u("/api/me"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "sign in" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/server-auth.test.ts`
Expected: FAIL — `/auth/discord` answers 404.

- [ ] **Step 3: Implement `src/server/routes-auth.ts`**

```ts
// src/server/routes-auth.ts
// Discord login, logout and /api/me. Only registered in hosted mode.
import type { HostedConfig } from "../hosted/config.ts";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE_S, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S, clearCookie, parseCookies, serializeCookie, signSessionId } from "../hosted/cookie.ts";
import type { HostedDb, Role } from "../hosted/db.ts";
import { authorizeUrl, avatarUrl, exchangeCode, fetchDiscordUser } from "../hosted/discord.ts";
import { newNonce } from "../hosted/oauth-state.ts";
import type { SessionUser } from "../hosted/auth.ts";
import type { HostedRuntime } from "../server.ts";
import { jsonResponse } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";

const redirect = (location: string, setCookies: string[] = []): Response => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
};

export const meUser = (u: SessionUser) =>
  ({ id: u.id, discordId: u.discordId, username: u.username, globalName: u.globalName, avatarUrl: avatarUrl(u.discordId, u.avatarHash), role: u.role });

/** Invite-only phase: config admins always get in (as admins); everyone else needs an invite row. */
export function admission(rt: { config: HostedConfig; db: HostedDb }, discordId: string): { admitted: false } | { admitted: true; role: Role | null } {
  if (rt.config.adminDiscordIds.includes(discordId)) return { admitted: true, role: "admin" };
  if (rt.db.invites.has(discordId)) return { admitted: true, role: null };
  return { admitted: false };
}

export function authRoutes(rt: HostedRuntime): Route[] {
  const oauthCookieOpts = { maxAgeS: OAUTH_COOKIE_MAX_AGE_S, path: "/auth", secure: rt.secure };
  const sessionCookieOpts = { maxAgeS: SESSION_COOKIE_MAX_AGE_S, path: "/", secure: rt.secure };
  const invalidState = () => jsonResponse({ ok: false, error: "Invalid OAuth state" }, 400);

  return [
    route("GET", "/auth/discord", () => {
      const nonce = newNonce();
      const state = rt.states.issue(nonce, Date.now());
      return redirect(authorizeUrl(rt.config, state), [serializeCookie(OAUTH_COOKIE, nonce, oauthCookieOpts)]);
    }, "public"),

    route("GET", "/auth/discord/callback", async (req, url, ctx) => {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const nonce = parseCookies(req.headers.get("cookie")).get(OAUTH_COOKIE);
      if (!code || !state || !nonce || !rt.states.consume(state, nonce, Date.now())) return invalidState();
      const clearOauth = clearCookie(OAUTH_COOKIE, { path: "/auth", secure: rt.secure });

      const token = await exchangeCode(rt.config, code, rt.fetchFn);
      if (!token.ok) { console.error(`discord login: ${token.error}`); return jsonResponse({ ok: false, error: "Discord login failed" }, 502); }
      const me = await fetchDiscordUser(token.accessToken, rt.fetchFn);
      if (!me.ok) { console.error(`discord login: ${me.error}`); return jsonResponse({ ok: false, error: "Discord login failed" }, 502); }

      const verdict = admission(rt, me.identity.discordId);
      if (!verdict.admitted) return redirect(`/?denied=${encodeURIComponent(me.identity.discordId)}`, [clearOauth]);

      const now = Date.now();
      const user = rt.db.users.upsertFromDiscord(me.identity, verdict.role, now);
      const session = rt.db.sessions.create(user.id, { ip: ctx.ip || null, userAgent: req.headers.get("user-agent"), now });
      return redirect("/", [serializeCookie(SESSION_COOKIE, signSessionId(session.id, rt.config.sessionSecret), sessionCookieOpts), clearOauth]);
    }, "public"),

    route("POST", "/auth/logout", (_req, _url, ctx) => {
      if (ctx.sessionId) rt.db.sessions.delete(ctx.sessionId);
      const res = jsonResponse({ ok: true });
      res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, { path: "/", secure: rt.secure }));
      return res;
    }, "public"),

    route("GET", "/api/me", (_req, _url, ctx) => jsonResponse({ ok: true, user: meUser(ctx.user!) })),
  ];
}
```

`/api/me` keeps the default `"user"` auth, so the gate produces the 401 and `ctx.user` is non-null inside. `/auth/logout` is `"public"` so an expired/anonymous browser can still clear its cookie.

- [ ] **Step 4: Register in `runServer`**

In `src/server.ts`: `import { authRoutes } from "./server/routes-auth.ts";` and

```ts
const routes: Route[] = [
  ...sharedRoutes({ hosted, envPath: envPathHint }),
  ...(runtime ? authRoutes(runtime) : localRoutes()),
];
```

(`routes-auth.ts` imports the `HostedRuntime` type from `../server.ts` and `server.ts` imports `authRoutes` — a type-only cycle, fine under `isolatedModules`; if tsc complains, move `HostedRuntime` to `src/hosted/runtime.ts` and import it from both.)

- [ ] **Step 5: Run the tests**

Run: `bun test test/server-auth.test.ts test/server-hosted.test.ts && bun test && just check`
Expected: PASS. If `res.headers.getSetCookie` is missing in the Bun version, use `res.headers.get("set-cookie")` splitting is unsafe (commas in dates) — `getSetCookie()` exists in Bun ≥ 1.0.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes-auth.ts src/server.ts test/server-auth.test.ts
git commit -m "feat(server): Discord login round-trip, session cookie, invite-only admission, logout, /api/me"
```

---

### Task 6: Admin routes (`src/server/routes-admin.ts`)

**Files:**
- Create: `src/server/routes-admin.ts`, `test/server-admin.test.ts`
- Modify: `src/server.ts` (spread `adminRoutes(runtime)`)

**Interfaces:**
- Produces: `export function adminRoutes(rt: HostedRuntime): Route[]` — all `auth: "admin"`:
  - `GET /api/admin/invites` → `{ ok, invites: InviteRow[] }`
  - `POST /api/admin/invites { discordId, note? }` → `{ ok, invite }`; 400 when `discordId` is not `/^\d{17,20}$/`
  - `DELETE /api/admin/invites/:discordId` → `{ ok: removed }`
  - `GET /api/admin/users` → `{ ok, users: Array<{ id, discordId, username, globalName, avatarUrl, role, createdAt, lastSeenAt }> }`
  - `POST /api/admin/users/:id/role { role }` → `{ ok, user }`; 400 for a bad role/id or when `id === ctx.user.id`; 404 unknown user

- [ ] **Step 1: Write the failing tests**

```ts
// test/server-admin.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let admin: ReturnType<typeof loginAs>;
let member: ReturnType<typeof loginAs>;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const json = (method: string, body?: unknown, cookie?: string): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-admin-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }) });
  db = openHosted((await getStore())._db);
  admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "111111111111111111", role: "admin", username: "boss" });
  member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

describe("admin gate", () => {
  test("member → 403, anonymous → 401", async () => {
    const r = await fetch(u("/api/admin/invites"), { headers: { cookie: member.cookie } });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: "admin only" });
    expect((await fetch(u("/api/admin/invites"))).status).toBe(401);
  });
});

describe("invites", () => {
  test("add, list, remove", async () => {
    const add = await fetch(u("/api/admin/invites"), json("POST", { discordId: "222222222222222222", note: "guild" }, admin.cookie));
    expect(add.status).toBe(200);
    const body = await add.json();
    expect(body.invite).toMatchObject({ discordId: "222222222222222222", invitedBy: "admin:" + admin.user.id, note: "guild" });
    const list = await (await fetch(u("/api/admin/invites"), { headers: { cookie: admin.cookie } })).json();
    expect(list.invites.map((i: { discordId: string }) => i.discordId)).toEqual(["222222222222222222"]);
    expect((await fetch(u("/api/admin/invites"), json("POST", { discordId: "abc" }, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/invites"), json("POST", {}, admin.cookie))).status).toBe(400);
    expect(await (await fetch(u("/api/admin/invites/222222222222222222"), { method: "DELETE", headers: { cookie: admin.cookie } })).json()).toEqual({ ok: true });
    expect(await (await fetch(u("/api/admin/invites/222222222222222222"), { method: "DELETE", headers: { cookie: admin.cookie } })).json()).toEqual({ ok: false });
  });
});

describe("users", () => {
  test("list shows both users with avatar urls", async () => {
    const r = await (await fetch(u("/api/admin/users"), { headers: { cookie: admin.cookie } })).json();
    expect(r.users.map((x: { username: string; role: string }) => [x.username, x.role]).sort()).toEqual([["boss", "admin"], ["tom", "member"]]);
    expect(r.users[0].avatarUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\//);
  });
  test("role change: promote, demote, cannot change self, unknown id, bad role", async () => {
    const promote = await fetch(u(`/api/admin/users/${member.user.id}/role`), json("POST", { role: "admin" }, admin.cookie));
    expect(promote.status).toBe(200);
    expect((await promote.json()).user.role).toBe("admin");
    expect(db.users.byId(member.user.id)!.role).toBe("admin");
    const demote = await fetch(u(`/api/admin/users/${member.user.id}/role`), json("POST", { role: "member" }, admin.cookie));
    expect((await demote.json()).user.role).toBe("member");
    expect((await fetch(u(`/api/admin/users/${admin.user.id}/role`), json("POST", { role: "member" }, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/users/9999/role"), json("POST", { role: "admin" }, admin.cookie))).status).toBe(404);
    expect((await fetch(u(`/api/admin/users/${member.user.id}/role`), json("POST", { role: "god" }, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/users/abc/role"), json("POST", { role: "admin" }, admin.cookie))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/server-admin.test.ts`
Expected: FAIL — 404 on `/api/admin/*`.

- [ ] **Step 3: Implement `src/server/routes-admin.ts`**

```ts
// src/server/routes-admin.ts
// Invite and user management. Every route is auth: "admin"; the admin page (issue #8) is the client.
import { avatarUrl } from "../hosted/discord.ts";
import type { UserRow } from "../hosted/db.ts";
import type { HostedRuntime } from "../server.ts";
import { jsonResponse, readJson } from "./http.ts";
import { prefixRoute, route } from "./routes.ts";
import type { Route } from "./routes.ts";

const DISCORD_ID = /^\d{17,20}$/;

const adminUser = (u: UserRow) => ({
  id: u.id, discordId: u.discordId, username: u.username, globalName: u.globalName,
  avatarUrl: avatarUrl(u.discordId, u.avatarHash), role: u.role, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
});

const tail = (url: URL, prefix: string): string => url.pathname.slice(prefix.length);

export function adminRoutes(rt: HostedRuntime): Route[] {
  return [
    route("GET", "/api/admin/invites", () => jsonResponse({ ok: true, invites: rt.db.invites.list() }), "admin"),
    route("POST", "/api/admin/invites", async (req, _url, ctx) => {
      const body = await readJson<{ discordId?: unknown; note?: unknown }>(req);
      const discordId = typeof body?.discordId === "string" ? body.discordId.trim() : "";
      if (!DISCORD_ID.test(discordId)) return jsonResponse({ ok: false, error: "`discordId` must be a 17–20 digit Discord user id" }, 400);
      const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;
      return jsonResponse({ ok: true, invite: rt.db.invites.add(discordId, `admin:${ctx.user!.id}`, note, Date.now()) });
    }, "admin"),
    prefixRoute("DELETE", "/api/admin/invites/", (_req, url) => {
      const id = tail(url, "/api/admin/invites/");
      if (!DISCORD_ID.test(id)) return jsonResponse({ ok: false, error: "Invalid Discord id" }, 400);
      return jsonResponse({ ok: rt.db.invites.remove(id) });
    }, "admin"),
    route("GET", "/api/admin/users", () => jsonResponse({ ok: true, users: rt.db.users.list().map(adminUser) }), "admin"),
    prefixRoute("POST", "/api/admin/users/", async (req, url, ctx) => {
      const m = /^(\d+)\/role$/.exec(tail(url, "/api/admin/users/"));
      if (!m) return jsonResponse({ ok: false, error: "Invalid user id" }, 400);
      const id = Number.parseInt(m[1]!, 10);
      const body = await readJson<{ role?: unknown }>(req);
      const role = body?.role;
      if (role !== "member" && role !== "admin") return jsonResponse({ ok: false, error: "`role` must be member or admin" }, 400);
      if (id === ctx.user!.id) return jsonResponse({ ok: false, error: "You cannot change your own role" }, 400);
      if (!rt.db.users.setRole(id, role)) return jsonResponse({ ok: false, error: "Unknown user" }, 404);
      return jsonResponse({ ok: true, user: adminUser(rt.db.users.byId(id)!) });
    }, "admin"),
  ];
}
```

- [ ] **Step 4: Register in `runServer`**

```ts
import { adminRoutes } from "./server/routes-admin.ts";
const routes: Route[] = [
  ...sharedRoutes({ hosted, envPath: envPathHint }),
  ...(runtime ? [...authRoutes(runtime), ...adminRoutes(runtime)] : localRoutes()),
];
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/server-admin.test.ts && bun test && just check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes-admin.ts src/server.ts test/server-admin.test.ts
git commit -m "feat(server): admin routes — invites CRUD, user list, role changes"
```

---

### Task 7: CLI — `planServe` passes the config, `bmpl invite`, docs

**Files:**
- Modify: `src/cli.ts`, `test/cli-serve.test.ts`, `README.md`, `.env.hosted.example`, `docs/agents/architecture.md`, `AGENTS.md`
- Create: `test/cli-invite.test.ts`

**Interfaces:**
- `planServe` returns `{ ok: true; port; open; hosted: false }` or `{ ok: true; port; open: false; hosted: true; hostedConfig: HostedConfig }`.
- `export function planInvite(args: string[]): { ok: true; action: "add"; discordId: string; note: string | null } | { ok: true; action: "list" } | { ok: true; action: "remove"; discordId: string } | { ok: false; error: string }` — pure; `cmdInvite` executes it against `openHosted((await getStore())._db)`.

- [ ] **Step 1: Write the failing tests**

Update `test/cli-serve.test.ts`: the two hosted expectations become

```ts
    expect(planServe(["--hosted"], FULL)).toEqual({ ok: true, port: 3000, open: false, hosted: true, hostedConfig: { baseUrl: "https://bmpl.example.com", sessionSecret: FULL.BMPL_SESSION_SECRET, discordClientId: FULL.BMPL_DISCORD_CLIENT_ID, discordClientSecret: "s", adminDiscordIds: ["111111111111111111"] } });
```

(and the same shape for the `BMPL_MODE: "hosted"` case).

```ts
// test/cli-invite.test.ts
import { describe, expect, test } from "bun:test";
import { planInvite } from "../src/cli.ts";

describe("planInvite", () => {
  test("add with optional note", () => {
    expect(planInvite(["123456789012345678"])).toEqual({ ok: true, action: "add", discordId: "123456789012345678", note: null });
    expect(planInvite(["123456789012345678", "--note", "guild mate"])).toEqual({ ok: true, action: "add", discordId: "123456789012345678", note: "guild mate" });
  });
  test("list and remove", () => {
    expect(planInvite(["--list"])).toEqual({ ok: true, action: "list" });
    expect(planInvite(["--remove", "123456789012345678"])).toEqual({ ok: true, action: "remove", discordId: "123456789012345678" });
  });
  test("errors: missing id, bad id", () => {
    expect(planInvite([]).ok).toBe(false);
    expect(planInvite(["42"]).ok).toBe(false);
    expect(planInvite(["--remove", "x"]).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test test/cli-serve.test.ts test/cli-invite.test.ts`
Expected: FAIL (`hostedConfig` missing; `planInvite` not exported).

- [ ] **Step 3: Implement in `src/cli.ts`**

`planServe`: change the hosted return to `return { ok: true, port, open: false, hosted: true, hostedConfig: v.config };` and its return type union accordingly. In `case "serve"`: `await runServer({ port: plan.port, open: plan.open, hosted: plan.hosted, hostedConfig: plan.hosted ? plan.hostedConfig : undefined });`.

Add:

```ts
import { openHosted } from "./hosted/db.ts";

const DISCORD_ID = /^\d{17,20}$/;

/** Pure `invite` argument parsing. */
export function planInvite(args: string[]):
  | { ok: true; action: "add"; discordId: string; note: string | null }
  | { ok: true; action: "list" }
  | { ok: true; action: "remove"; discordId: string }
  | { ok: false; error: string } {
  if (hasFlag(args, "--list")) return { ok: true, action: "list" };
  const usage = "Usage: bmpl invite <discord-id> [--note \"…\"] | --list | --remove <discord-id>";
  const remove = parseFlag(args, "--remove");
  if (args.includes("--remove")) {
    if (!remove || !DISCORD_ID.test(remove)) return { ok: false, error: `${usage}\nDiscord ids are 17–20 digit numbers (Discord → Settings → Advanced → Developer Mode, then right-click a user → Copy User ID).` };
    return { ok: true, action: "remove", discordId: remove };
  }
  const positional = stripFlags(args, ["--note"], []);
  const discordId = positional[0];
  if (!discordId || !DISCORD_ID.test(discordId)) return { ok: false, error: `${usage}\nDiscord ids are 17–20 digit numbers (Discord → Settings → Advanced → Developer Mode, then right-click a user → Copy User ID).` };
  return { ok: true, action: "add", discordId, note: parseFlag(args, "--note") ?? null };
}

async function cmdInvite(args: string[]): Promise<void> {
  const plan = planInvite(args);
  if (!plan.ok) { console.error(err(plan.error)); process.exit(2); }
  const db = openHosted((await getStore())._db);
  if (plan.action === "list") {
    const rows = db.invites.list();
    if (rows.length === 0) { console.log(dim("no invites")); return; }
    for (const r of rows) console.log(`${r.discordId}  ${dim(new Date(r.createdAt).toISOString().slice(0, 10))}  ${dim(r.invitedBy)}${r.note ? "  " + r.note : ""}`);
    return;
  }
  if (plan.action === "remove") { console.log(db.invites.remove(plan.discordId) ? ok(`removed ${plan.discordId}`) : err(`${plan.discordId} was not invited`)); return; }
  const row = db.invites.add(plan.discordId, "cli", plan.note, Date.now());
  console.log(ok(`invited ${row.discordId}${row.note ? ` (${row.note})` : ""}`));
}
```

`getStore`, `dim`, `ok`, `err` are already imported in `cli.ts` (check; add if not). Dispatcher: `case "invite": { await cmdInvite(rest); closeStore(); break; }` — check how other DB-using commands close the store (`closeStore` import) and mirror them. `stripFlags(args, ["--note"], [])` treats `--note` as a flag with a value; verify its signature in `cli.ts` (`stripFlags(args, flagsWithValues, booleanFlags)`).

USAGE block: add

```
  bmpl invite <discord-id> [--note "…"] | --list | --remove <discord-id>
                                     Hosted mode: allow a Discord user to sign in
                                     (writes the invites table in bmpl.db).
```

- [ ] **Step 4: Docs**

`.env.hosted.example`: after the Discord lines add `# OAuth2 redirect URL to register in the Discord application: <BMPL_BASE_URL>/auth/discord/callback`.

`README.md` "Hosted mode" section — replace the sentence "Login, quotas and the admin page come with the following issues." with:

```markdown
**Login.** Hosted mode signs people in with Discord (scope `identify` only —
no e-mail, no server list). Create an application at
https://discord.com/developers/applications → OAuth2: copy the *Client ID*
and *Client Secret* into `BMPL_DISCORD_CLIENT_ID` / `BMPL_DISCORD_CLIENT_SECRET`
and add the redirect `https://<your host>/auth/discord/callback`. Access is
invite-only: the Discord ids in `BMPL_ADMIN_DISCORD_IDS` are admins and can
always sign in; everyone else needs an invite — `bmpl invite <discord-id>
[--note "guild mate"]` on the server (`bmpl invite --list`, `--remove <id>`),
or the admin page once issue #8 lands. A user who is not invited sees their
Discord id on the sign-in page so they can send it to you. Sessions last 30
days (sliding) in an `HttpOnly` cookie; **Sign out** ends one.

Quotas and the admin page come with the following issues.
```

`docs/agents/architecture.md`: in the Server section, add after the module list: "`routes-auth.ts` (`/auth/discord`, callback, `POST /auth/logout`, `GET /api/me`) and `routes-admin.ts` (`/api/admin/*`, `auth: "admin"`) are registered only in hosted mode; every `Route` carries `auth: public | user | admin`, enforced by `authGate` in `src/hosted/auth.ts` after `resolveRequest` turns the `bmpl_session` cookie into a `RequestContext { hosted, user, sessionId, ip }` handed to every handler. Hosted tables (`users`, `sessions`, `invites`) live in the same SQLite file through `src/hosted/db.ts` (`openHosted(store._db)`); sessions are 30-day sliding, purged hourly; OAuth `state` is single-use and bound to the `bmpl_oauth` cookie (`src/hosted/oauth-state.ts`)." Add `users`, `sessions`, `invites` rows to the SQLite table list (lifetime: sessions 30 d sliding; others until removed). CLI section: add `invite`.

`AGENTS.md`: "Where things are" `src/hosted/` line → `src/hosted/  hosted-mode config, schema/repos (users, sessions, invites), cookie/state/Discord helpers, auth gate`; last paragraph → "#2 and #3 (hosted skeleton, Discord login) are shipped, next is #4 (per-user state)."

- [ ] **Step 5: Run everything and a manual check**

Run: `bun test && just check && bun src/cli.ts invite 42; echo "exit=$?"`
Expected: green; the last command prints the usage + id hint and `exit=2`. Then `BMPL_DB_PATH=/tmp/bmpl-invite-test.db bun src/cli.ts invite 123456789012345678 --note test && BMPL_DB_PATH=/tmp/bmpl-invite-test.db bun src/cli.ts invite --list && rm -f /tmp/bmpl-invite-test.db*` — prints the invite once each.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/cli-serve.test.ts test/cli-invite.test.ts README.md .env.hosted.example docs/agents/architecture.md AGENTS.md
git commit -m "feat(cli): serve passes the hosted config, bmpl invite; Discord setup docs"
```

---

### Task 8: Front — `/api/me`, sign-in gate, sign-out

**Files:**
- Create: `web/src/components/SignIn.tsx`
- Modify: `web/src/api.ts`, `web/src/lib/hostedMode.ts`, `web/src/lib/hostedMode.test.ts`, `web/src/App.tsx`, `web/src/components/Header.tsx`

**Interfaces:**
- Produces:
  ```ts
  // web/src/api.ts
  export interface MeUser { id: number; discordId: string; username: string; globalName: string | null; avatarUrl: string; role: "member" | "admin" }
  export type MeResult = { kind: "ok"; user: MeUser } | { kind: "unauthorized" } | { kind: "error"; error: string };
  api.me(): Promise<MeResult>; api.logout(): Promise<ApiResult<Record<never, never>>>;
  // web/src/lib/hostedMode.ts
  export interface UiControls { setup: boolean; quit: boolean; watch: boolean; envPath: boolean; signOut: boolean }
  export type BootScreen = "setup" | "main" | "signin";
  export function bootScreen(status: StatusInfo, me: MeResult | null, pathname: string): BootScreen; // hosted: me ok → main, else signin; local: initialScreen
  export function deniedDiscordId(search: string): string | null;   // "?denied=123…" → "123…", else null (must match /^\d{17,20}$/)
  ```

- [ ] **Step 1: Write the failing tests** (append to `web/src/lib/hostedMode.test.ts`)

```ts
import { bootScreen, deniedDiscordId } from "./hostedMode.ts";

describe("bootScreen", () => {
  const me = { kind: "ok" as const, user: { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const } };
  test("hosted: signed in → main, otherwise signin (never setup)", () => {
    expect(bootScreen(hosted, me, "/")).toBe("main");
    expect(bootScreen(hosted, { kind: "unauthorized" }, "/")).toBe("signin");
    expect(bootScreen(hosted, { kind: "error", error: "x" }, "/")).toBe("signin");
    expect(bootScreen(hosted, null, "/setup")).toBe("signin");
  });
  test("local: ignores me and follows initialScreen", () => {
    expect(bootScreen(local, null, "/setup")).toBe("setup");
    expect(bootScreen({ ...local, hasCredentials: false }, me, "/")).toBe("setup");
    expect(bootScreen(local, null, "/")).toBe("main");
  });
});

describe("deniedDiscordId", () => {
  test("parses a valid id only", () => {
    expect(deniedDiscordId("?denied=123456789012345678")).toBe("123456789012345678");
    expect(deniedDiscordId("?denied=abc")).toBeNull();
    expect(deniedDiscordId("")).toBeNull();
    expect(deniedDiscordId("?x=1")).toBeNull();
  });
});

test("uiControls: signOut only in hosted mode", () => {
  expect(uiControls(local).signOut).toBe(false);
  expect(uiControls(hosted).signOut).toBe(true);
});
```

Update the two existing `uiControls` expectations to include `signOut: false` (local) / `signOut: true` (hosted).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test web/src/lib/hostedMode.test.ts`
Expected: FAIL — `bootScreen`/`deniedDiscordId` not exported, `signOut` missing.

- [ ] **Step 3: Implement**

`web/src/lib/hostedMode.ts`:

```ts
import type { MeResult } from "../api.ts";

export interface UiControls { setup: boolean; quit: boolean; watch: boolean; envPath: boolean; signOut: boolean }
export type BootScreen = "setup" | "main" | "signin";

export function uiControls(status: StatusInfo): UiControls {
  const local = !status.hosted;
  return { setup: local, quit: local, watch: local, envPath: local, signOut: !local };
}

/** Hosted: the session decides; local: the credentials decide (initialScreen). */
export function bootScreen(status: StatusInfo, me: MeResult | null, pathname: string): BootScreen {
  if (status.hosted) return me?.kind === "ok" ? "main" : "signin";
  return initialScreen(status, pathname);
}

export function deniedDiscordId(search: string): string | null {
  const v = new URLSearchParams(search).get("denied");
  return v && /^\d{17,20}$/.test(v) ? v : null;
}
```

(`api.ts` imports nothing from `lib/`, so the type import is acyclic.)

`web/src/api.ts`:

```ts
export interface MeUser { id: number; discordId: string; username: string; globalName: string | null; avatarUrl: string; role: "member" | "admin" }
export type MeResult = { kind: "ok"; user: MeUser } | { kind: "unauthorized" } | { kind: "error"; error: string };

// inside `api`:
  me: async (): Promise<MeResult> => {
    let res: Response;
    try { res = await fetch("/api/me"); } catch { return { kind: "error", error: "Network error" }; }
    if (res.status === 401) return { kind: "unauthorized" };
    const data = (await res.json().catch(() => null)) as { ok?: boolean; user?: MeUser; error?: string } | null;
    if (!res.ok || !data?.ok || !data.user) return { kind: "error", error: data?.error ?? `HTTP ${res.status}` };
    return { kind: "ok", user: data.user };
  },
  logout: () => call<Record<never, never>>("/auth/logout", post()),
```

`web/src/components/SignIn.tsx` (placeholder — existing classes only; issue #7 restyles it):

```tsx
interface Props { deniedDiscordId: string | null }

/** Hosted-mode gate. Functional placeholder: the designed version is issue #7. */
export function SignIn({ deniedDiscordId }: Props) {
  return (
    <main className="home" style={{ paddingTop: 80 }}>
      <h1>bmpl</h1>
      <p className="muted">Vet a Mythic+ applicant from their Warcraft Logs and Raider.IO history.</p>
      <p><a className="btn btn-primary btn-lg" href="/auth/discord">Sign in with Discord</a></p>
      {deniedDiscordId && (
        <div className="card" style={{ display: "inline-block", marginTop: 24, textAlign: "left" }}>
          <p><strong>You need an invitation.</strong></p>
          <p className="muted">Send your Discord id to the person who runs this instance, then sign in again:</p>
          <p className="mono">{deniedDiscordId}</p>
        </div>
      )}
    </main>
  );
}
```

`web/src/App.tsx`:

```tsx
import { LOCAL_STATUS, bootScreen, deniedDiscordId, uiControls } from "./lib/hostedMode.ts";
import type { StatusInfo } from "./lib/hostedMode.ts";
import type { MeUser } from "./api.ts";
import { SignIn } from "./components/SignIn.tsx";

type Screen =
  | { kind: "loading" }
  | { kind: "setup"; status: StatusInfo }
  | { kind: "signin"; status: StatusInfo }
  | { kind: "main"; status: StatusInfo; me: MeUser | null };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  useEffect(() => {
    (async () => {
      const s = await api.status();
      const status: StatusInfo = s.ok ? { hosted: s.hosted, hasCredentials: s.hasCredentials, envPath: s.envPath ?? null } : LOCAL_STATUS;
      const me = status.hosted ? await api.me() : null;
      const kind = bootScreen(status, me, location.pathname);
      if (kind === "main") setScreen({ kind, status, me: me?.kind === "ok" ? me.user : null });
      else setScreen({ kind, status });
    })();
  }, []);
  if (screen.kind === "loading") return <div className="muted" style={{ padding: 24 }}><span className="spinner" /> loading…</div>;
  if (screen.kind === "signin") return <SignIn deniedDiscordId={deniedDiscordId(location.search)} />;
  if (screen.kind === "setup") {
    return <Setup envPath={screen.status.envPath ?? ""} hasCredentials={screen.status.hasCredentials} onDone={() => { history.replaceState({}, "", "/"); setScreen({ kind: "main", status: { ...screen.status, hasCredentials: true }, me: null }); }} />;
  }
  return <Main status={screen.status} me={screen.me} onSetup={() => { history.pushState({}, "", "/setup"); setScreen({ kind: "setup", status: { ...screen.status, hasCredentials: true } }); }} />;
}
```

`Main` gains `me: MeUser | null` and an `onSignOut`:

```tsx
const onSignOut = async () => {
  const r = await api.logout();
  if (!r.ok) { setToast(r.error); return; }
  location.assign("/");
};
```

passed to `<Header … onSignOut={onSignOut} me={me} />`. `Header.tsx` `Props` gains `me: MeUser | null; onSignOut: () => void;` (import `type MeUser` from `../api.ts`) and, next to the Quit button:

```tsx
{p.controls.signOut && (
  <>
    {p.me && <span className="muted" title={p.me.discordId}>{p.me.globalName ?? p.me.username}</span>}
    <button className="btn" onClick={p.onSignOut}>Sign out</button>
  </>
)}
```

The full user menu (avatar, quota, Admin link) is issue #7.

- [ ] **Step 4: Run the tests, typecheck, build, look at it**

Run: `bun test && just check && just build`
Expected: green. Then start a hosted server with a real-looking env (the `.env.hosted.example` variables; the Discord client id/secret can be dummy 18-digit/any values — the login itself cannot complete without a real app, but the gate can be seen): open `http://localhost:3000/` → the sign-in screen with the Discord button; `http://localhost:3000/?denied=123456789012345678` → the invitation notice with the id. Then `bmpl serve` (local): unchanged, no Sign out button. To see the signed-in header without a Discord app: run the server, insert a user + session with `bun -e` using `openHosted` + `signSessionId` (same as `test/hosted/helpers.ts`), set the cookie in the browser devtools, reload — the name and **Sign out** appear; clicking Sign out returns to the sign-in screen. Take one screenshot of each state for the report.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/lib/hostedMode.ts web/src/lib/hostedMode.test.ts web/src/App.tsx web/src/components/SignIn.tsx web/src/components/Header.tsx
git commit -m "feat(web): hosted sign-in gate via /api/me, invitation notice, sign out"
```

---

## Self-review

- **Spec coverage (issue #3):** OAuth2 flow with `identify` + signed state → Tasks 2, 3, 5. Schema (`users`, `sessions`, `invites`) → Task 1. Admission (invites ∪ admins, admins auto-role, uninvited → no session + front notice with the id) → Tasks 5, 8. Cookie (`bmpl_session`, HttpOnly/Secure/SameSite=Lax/Path=/, 30-day sliding, HMAC-signed, rejected before DB read) → Tasks 1, 2, 4, 5. Hourly purge → Task 4. Middleware (401 `sign in`, `requireAdmin` 403, handlers get `{ user }` in a context) → Task 4. `GET /api/me` → Task 5. Admin routes → Task 6. Acceptance tests (round-trip, tampered cookie, uninvited, admin auto-invite, logout, `/api/lookup` 401 hosted / unaffected local) → Tasks 4, 5. State single-use and bound → Task 2 + 5 (bound to the `bmpl_oauth` cookie rather than the IP — see ruling). README (Discord app setup, redirect URL, `bmpl invite`) → Task 7.
- **Rulings recorded here:** (1) `state` is bound to a short-lived `bmpl_oauth` cookie nonce, not the client IP — IPs change behind mobile carriers/proxies and Caddy needs `X-Forwarded-For` trust; the cookie binding is the standard defence and is testable. (2) The sign-in screen ships as a functional placeholder built from existing classes; the designed version (Claude Design canvas) is issue #7, per the issue split. (3) Config admins get `role = admin` re-applied on every login (env wins), members keep their stored role so an in-app promotion survives re-login. (4) `POST /auth/logout` is public so a stale browser can always clear its cookie; it is `SameSite=Lax`-protected and idempotent, so CSRF has no effect.
- **Placeholders:** none. Every code step carries the code; the two "unchanged" markers in Task 4's `runServer` refer to blocks already in the file (`openBrowser`, `error()`, banner).
- **Type consistency:** `SessionUser` (auth.ts) ⊂ `UserRow` (db.ts) fields; `meUser`/`adminUser` both derive `avatarUrl` via `discord.ts`; `HostedRuntime { config, db, states, fetchFn, secure }` is produced in Task 4 and consumed identically in Tasks 5–6; `loginAs` (helpers) returns `{ cookie, user, sessionId }` used by Tasks 4 and 6; `MeResult`/`MeUser` defined in `api.ts` and consumed by `hostedMode.ts`, `App.tsx`, `Header.tsx`; `planServe`'s hosted branch carries `hostedConfig: HostedConfig` matching `ServeOptions.hostedConfig`.
