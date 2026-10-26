// src/server/routes-wcl-link.ts
// Warcraft Logs account link, step 1 (spec docs/superpowers/specs/2026-10-26-wcl-account-link-design.md, decision 1):
// the admin-only measurement gate. /auth/wcl/start sends an admin to WCL's authorization page; the callback trades
// the code for a user token, runs the probe and answers its report as JSON. Nothing is stored; the code, the token
// and the client secret never reach a log line, an audit row or the response.
import { config } from "../config.ts";
import { OAUTH_COOKIE_MAX_AGE_S, WCL_COOKIE, clearCookie, parseCookies, serializeCookie } from "../hosted/cookie.ts";
import { newNonce } from "../hosted/oauth-state.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { exchangeWclCode, pkcePair, probeUserToken, userGql, wclAuthorizeUrl } from "../hosted/wcl-link.ts";
import { log } from "../log.ts";
import { gql } from "../wcl/client.ts";
import { jsonResponse } from "./http.ts";
import { redirect } from "./routes-auth.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";

const WCL_COOKIE_PATH = "/auth/wcl";
const bound = (userId: number, nonce: string): string => `${userId}:${nonce}`;

export function wclLinkRoutes(rt: HostedRuntime): Route[] {
  const redirectUri = `${rt.config.baseUrl}/auth/wcl/callback`;
  const cookieOpts = { maxAgeS: OAUTH_COOKIE_MAX_AGE_S, path: WCL_COOKIE_PATH, secure: rt.secure };

  return [
    route("GET", "/auth/wcl/start", (_req, _url, ctx) => {
      const nonce = newNonce();
      const { verifier, challenge } = pkcePair();
      const state = rt.wclStates.issue(bound(ctx.user!.id, nonce), Date.now());
      // The verifier rides in the HttpOnly nonce cookie (path /auth/wcl): it never leaves bmpl and the browser.
      return redirect(wclAuthorizeUrl({ clientId: config.clientId, redirectUri, state, challenge }), [
        serializeCookie(WCL_COOKIE, `${nonce}.${verifier}`, cookieOpts),
      ]);
    }, "admin"),

    // Public: WCL's redirect is a top-level navigation; the handler checks the session and the admin role itself.
    route("GET", "/auth/wcl/callback", async (req, url, ctx) => {
      const clear = clearCookie(WCL_COOKIE, { path: WCL_COOKIE_PATH, secure: rt.secure });
      const answer = (body: Record<string, unknown>, status = 200): Response => {
        const res = jsonResponse(body, status);
        res.headers.append("Set-Cookie", clear);
        return res;
      };
      const user = ctx.user;
      if (user?.role !== "admin") return answer({ ok: false, error: "admin only (the measurement step)" }, 403);
      const denied = url.searchParams.get("error");
      if (denied) return answer({ ok: false, error: `Warcraft Logs answered: ${denied.slice(0, 100)}` }, 400);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const [nonce, verifier] = (parseCookies(req.headers.get("cookie")).get(WCL_COOKIE) ?? "").split(".");
      if (!code || !state || !nonce || !verifier || !rt.wclStates.consume(state, bound(user.id, nonce), Date.now())) {
        return answer({ ok: false, error: "unknown or expired state: start again from /auth/wcl/start" }, 400);
      }
      const token = await exchangeWclCode(
        { clientId: config.clientId, clientSecret: config.clientSecret, code, redirectUri, verifier }, rt.fetchFn,
      );
      if (!token.ok) {
        log.warn("wcl_link_failed", { step: "token", error: token.error });
        return answer({ ok: false, error: token.error }, 502);
      }
      const report = await probeUserToken(token.facts, userGql(token.accessToken, rt.fetchFn), gql);
      log.info("wcl_link_probe", { verdict: report.verdict, expiresInS: report.token.expiresInS, refreshToken: report.token.refreshToken, publicQueries: report.publicQueries.ok });
      return answer({ ok: true, ...report });
    }),
  ];
}
