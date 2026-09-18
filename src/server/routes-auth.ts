// src/server/routes-auth.ts
// Discord login, logout and /api/me. Only registered in hosted mode.
import type { HostedConfig } from "../hosted/config.ts";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE_S, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S, clearCookie, parseCookies, serializeCookie, signSessionId } from "../hosted/cookie.ts";
import type { HostedDb, Role } from "../hosted/db.ts";
import { authorizeUrl, avatarUrl, exchangeCode, fetchDiscordUser } from "../hosted/discord.ts";
import { newNonce } from "../hosted/oauth-state.ts";
import type { SessionUser } from "../hosted/auth.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
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

      const discordFailure = (error: string): Response => {
        console.error(`discord login: ${error}`);
        const res = jsonResponse({ ok: false, error: "Discord login failed" }, 502);
        res.headers.append("Set-Cookie", clearOauth);
        return res;
      };

      const token = await exchangeCode(rt.config, code, rt.fetchFn);
      if (!token.ok) return discordFailure(token.error);
      const me = await fetchDiscordUser(token.accessToken, rt.fetchFn);
      if (!me.ok) return discordFailure(me.error);

      const verdict = admission(rt, me.identity.discordId);
      if (!verdict.admitted) return redirect(`/?denied=${encodeURIComponent(me.identity.discordId)}`, [clearOauth]);

      // Re-login rotates the session: an old cookie replayed after a fresh login must not
      // keep working.
      if (ctx.sessionId) rt.db.sessions.delete(ctx.sessionId);

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

    route("GET", "/api/me", (_req, _url, ctx) => {
      const res = jsonResponse({ ok: true, user: meUser(ctx.user!) });
      // Slide the cookie's Max-Age along with the server-side expiry (sessions.get already
      // extends expires_at); otherwise the browser drops the cookie 30 days after login
      // even though the session itself is still valid.
      res.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, signSessionId(ctx.sessionId!, rt.config.sessionSecret), sessionCookieOpts));
      return res;
    }),
  ];
}
