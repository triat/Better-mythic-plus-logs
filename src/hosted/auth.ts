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
