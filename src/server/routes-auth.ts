// src/server/routes-auth.ts
// Discord login, logout and /api/me. Only registered in hosted mode.
import { clip } from "../hosted/audit.ts";
import type { HostedConfig } from "../hosted/config.ts";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE_S, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_S, clearCookie, parseCookies, serializeCookie, signSessionId } from "../hosted/cookie.ts";
import type { HostedDb, Role } from "../hosted/db.ts";
import { authorizeUrl, avatarUrl, exchangeCode, fetchDiscordGuilds, fetchDiscordUser } from "../hosted/discord.ts";
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

/**
 * Whether a Discord account may sign in: banned first (regardless of everything else), then a
 * config admin, an invited account, or (open signup) anyone. The Discord guild gate is checked
 * separately by the callback — it needs the access token, which this function does not have.
 */
export function admission(rt: { config: HostedConfig; db: HostedDb }, discordId: string): { admitted: true; role: Role | null } | { admitted: false; reason: "banned" | "not invited" } {
  if (rt.db.users.byDiscordId(discordId)?.bannedAt != null) return { admitted: false, reason: "banned" };
  if (rt.config.adminDiscordIds.includes(discordId)) return { admitted: true, role: "admin" };
  if (rt.db.invites.has(discordId) || rt.config.openSignup) return { admitted: true, role: null };
  return { admitted: false, reason: "not invited" };
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
      const clearOauth = clearCookie(OAUTH_COOKIE, { path: "/auth", secure: rt.secure });

      // The user cancelled at Discord (or Discord sent some other `error`): back to the
      // sign-in page, no need to touch the pending state (it just expires on its own TTL).
      if (url.searchParams.get("error")) return redirect("/", [clearOauth]);

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const nonce = parseCookies(req.headers.get("cookie")).get(OAUTH_COOKIE);
      if (!code || !state || !nonce || !rt.states.consume(state, nonce, Date.now())) return invalidState();

      // This is a top-level navigation (the browser followed Discord's redirect here), so a
      // Discord-side failure sends the user back to the sign-in page instead of a bare JSON
      // 502 the browser would render as a blank page.
      const discordFailure = (error: string): Response => {
        console.error(`discord login: ${error}`);
        return redirect("/?login=failed", [clearOauth]);
      };

      const token = await exchangeCode(rt.config, code, rt.fetchFn);
      if (!token.ok) return discordFailure(token.error);
      const me = await fetchDiscordUser(token.accessToken, rt.fetchFn);
      if (!me.ok) return discordFailure(me.error);

      const deny = (reason: "banned" | "guild" | "not invited" | "rate", location: string): Response => {
        rt.audit.record("login_denied", { userId: null, target: `discord ${me.identity.discordId}`, detail: { reason } });
        return redirect(location, [clearOauth]);
      };

      const verdict = admission(rt, me.identity.discordId);
      if (!verdict.admitted) return deny(verdict.reason, verdict.reason === "banned" ? "/?denied=banned" : `/?denied=${encodeURIComponent(me.identity.discordId)}`);

      // The guild gate needs the access token, so it cannot live in `admission`; a config admin
      // is not exempt from it.
      if (rt.config.discordGuildId) {
        const g = await fetchDiscordGuilds(token.accessToken, rt.fetchFn);
        if (!g.ok) return discordFailure(g.error);
        if (!g.guildIds.includes(rt.config.discordGuildId)) return deny("guild", "/?denied=guild");
      }

      // A brand new account under open signup counts against the per-IP signup limit; an
      // existing account (invited, admin, or already created earlier) never does.
      if (!rt.db.users.byDiscordId(me.identity.discordId)) {
        const v = rt.limits.signup.hit(`ip:${ctx.ip}`, Date.now());
        if (!v.ok) {
          if (v.first) rt.audit.record("rate_limited", { userId: null, detail: { limit: rt.limits.signup.rule.limit, windowS: Math.round(rt.limits.signup.rule.windowMs / 1000), retryAfterS: v.retryAfterS, what: "signup" } });
          return redirect("/?denied=rate", [clearOauth]);
        }
      }

      // Re-login rotates the session: an old cookie replayed after a fresh login must not
      // keep working.
      if (ctx.sessionId) rt.db.sessions.delete(ctx.sessionId);

      const now = Date.now();
      const user = rt.db.users.upsertFromDiscord(me.identity, verdict.role, now);
      const session = rt.db.sessions.create(user.id, { ip: ctx.ip || null, userAgent: req.headers.get("user-agent"), now });
      rt.audit.record("login", { userId: user.id, target: `discord ${me.identity.discordId}`, detail: { userAgent: clip(req.headers.get("user-agent") ?? "", 120) } });
      return redirect("/", [serializeCookie(SESSION_COOKIE, signSessionId(session.id, rt.config.sessionSecret), sessionCookieOpts), clearOauth]);
    }, "public"),

    route("POST", "/auth/logout", (_req, _url, ctx) => {
      if (ctx.sessionId) rt.db.sessions.delete(ctx.sessionId);
      if (ctx.user) rt.audit.record("logout");
      const res = jsonResponse({ ok: true });
      res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, { path: "/", secure: rt.secure }));
      return res;
    }, "public"),

    route("GET", "/api/me", (_req, _url, ctx) => {
      const res = jsonResponse({ ok: true, user: meUser(ctx.user!), quota: rt.quota.status({ id: ctx.user!.id, role: ctx.user!.role }) });
      // Slide the cookie's Max-Age along with the server-side expiry (sessions.get already
      // extends expires_at); otherwise the browser drops the cookie 30 days after login
      // even though the session itself is still valid.
      res.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, signSessionId(ctx.sessionId!, rt.config.sessionSecret), sessionCookieOpts));
      return res;
    }),

    route("DELETE", "/api/me", (_req, _url, ctx) => {
      const u = ctx.user!;
      rt.audit.record("account_delete", { userId: null, target: `discord ${u.discordId}`, detail: { username: u.username } });
      rt.wclClients.forget(u.id);
      rt.db.users.delete(u.id);
      const res = jsonResponse({ ok: true });
      res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, { path: "/", secure: rt.secure }));
      return res;
    }),
  ];
}
