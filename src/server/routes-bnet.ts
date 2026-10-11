// src/server/routes-bnet.ts
// Battle.net linking (spec docs/superpowers/specs/2026-10-11-battlenet-linking-design.md, decisions 3–5 and 8): the
// OAuth round trip that imports the account's characters, the import's read, the pick and the unlink. Hosted only.
// The Blizzard token lives for the callback only; the code, the token and the client secret never reach an audit
// row, the error ring or a console line (bnet.ts's failure messages name the endpoint and status only).
import type { BnetFailure } from "../hosted/bnet.ts";
import { BNET_REGIONS, bnetAuthorizeUrl, exchangeBnetCode, fetchAccountCharacters, fetchBnetUser, mergeCandidates } from "../hosted/bnet.ts";
import type { BnetCandidate } from "../hosted/bnet-db.ts";
import { BNET_COOKIE, OAUTH_COOKIE_MAX_AGE_S, clearCookie, parseCookies, serializeCookie } from "../hosted/cookie.ts";
import { newNonce } from "../hosted/oauth-state.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { parseCharacters } from "../self/characters.ts";
import { jsonResponse } from "./http.ts";
import { redirect } from "./routes-auth.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { BNET_PICK_BODY, parseBody } from "./validate.ts";

const BNET_COOKIE_PATH = "/auth/bnet";

/** What `/me?bnet=` tells the member after the callback (the front's `BNET_CODES`). */
export type BnetCallbackCode = "pick" | "cancelled" | "state" | "scope" | "taken" | "empty" | "down";

export function bnetRoutes(rt: HostedRuntime): Route[] {
  const nonceCookieOpts = { maxAgeS: OAUTH_COOKIE_MAX_AGE_S, path: BNET_COOKIE_PATH, secure: rt.secure };

  return [
    route("GET", "/auth/bnet/start", () => {
      const nonce = newNonce();
      const state = rt.bnetStates.issue(nonce, Date.now());
      return redirect(bnetAuthorizeUrl(rt.config, state), [serializeCookie(BNET_COOKIE, nonce, nonceCookieOpts)]);
    }),

    // Public: Blizzard's redirect lands here as a top-level navigation, so every outcome is a 302 to /me with a
    // code the page explains, never a JSON error; the session is checked by the handler itself.
    route("GET", "/auth/bnet/callback", async (req, url, ctx) => {
      const clearNonce = clearCookie(BNET_COOKIE, { path: BNET_COOKIE_PATH, secure: rt.secure });
      const done = (code: BnetCallbackCode): Response => redirect(`/me?bnet=${code}`, [clearNonce]);
      const blizzardFailure = (f: BnetFailure): Response => {
        const code = f.kind === "scope" ? "scope" : "down";
        console.error(`bnet link: ${code}`);
        rt.errors.push(new Error(`bnet link: ${code} (${f.kind}): ${f.error}`), "bnet callback");
        return done(code);
      };

      const user = ctx.user;
      if (!user) return done("state");
      // The member said no at Battle.net (or Blizzard sent another `error`): the pending state just expires.
      if (url.searchParams.get("error")) return done("cancelled");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const nonce = parseCookies(req.headers.get("cookie")).get(BNET_COOKIE);
      if (!code || !state || !nonce || !rt.bnetStates.consume(state, nonce, Date.now())) return done("state");

      const token = await exchangeBnetCode(rt.config, code, rt.fetchFn);
      if (!token.ok) return blizzardFailure(token);
      const account = await fetchBnetUser(token.accessToken, rt.fetchFn);
      if (!account.ok) return blizzardFailure(account);

      // One Battle.net account per member (decision 5): nothing is imported for a second one.
      const owner = rt.db.bnet.link.byAccount(account.accountId);
      if (owner !== null && owner !== user.id) {
        rt.audit.record("login_denied", { target: `user ${owner}`, detail: { reason: "bnet_taken" } });
        return done("taken");
      }

      // The four regions in turn; one failure stops the import before anything is stored.
      const lists: BnetCandidate[][] = [];
      for (const region of BNET_REGIONS) {
        const r = await fetchAccountCharacters(token.accessToken, region, rt.fetchFn);
        if (!r.ok) return blizzardFailure(r);
        lists.push(r.candidates);
      }

      const now = Date.now();
      rt.db.bnet.link.put(user.id, account.accountId, account.battletag, now);
      rt.audit.record("bnet_link", { detail: { battletag: account.battletag } });
      const candidates = mergeCandidates(lists);
      if (candidates.length === 0) {
        // The link stands, with no candidates: an older import must not resurface in the picker.
        rt.db.bnet.imports.delete(user.id);
        return done("empty");
      }
      rt.db.bnet.imports.put(user.id, candidates, now);
      return done("pick");
    }, "public"),

    route("GET", "/api/bnet", (_req, _url, ctx) => {
      const id = ctx.user!.id;
      const link = rt.db.bnet.link.get(id);
      return jsonResponse({
        ok: true,
        link: link ? { battletag: link.battletag, linkedAt: link.linkedAt } : null,
        removed: link?.removed ?? [],
        import: rt.db.bnet.imports.get(id, ctx.now),
      });
    }),

    // Decision 4: only candidates of the member's own import, in the order sent, become My characters.
    route("PUT", "/api/bnet/characters", async (req, _url, ctx) => {
      const b = await parseBody(req, BNET_PICK_BODY);
      if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
      const id = ctx.user!.id;
      const imported = rt.db.bnet.imports.get(id, ctx.now);
      if (!imported) return jsonResponse({ ok: false, error: "bnet_import_expired", message: "This import expired: link Battle.net again." }, 410);
      const byKey = new Map(imported.candidates.map((c) => [`${c.region}|${c.bnetId}`, c]));
      const picked: BnetCandidate[] = [];
      for (const p of b.value.picks) {
        const c = byKey.get(`${p.region}|${p.bnetId}`);
        if (!c) return jsonResponse({ ok: false, error: "bnet_unknown_character", message: "A picked character is not in this Battle.net import." }, 400);
        picked.push(c);
      }
      // Same cleaning as a read (duplicates dropped, first kept), so the answer is what GET /api/settings returns.
      const characters = parseCharacters(JSON.stringify(picked.map((c) =>
        ({ name: c.name, realm: c.realm, region: c.region, source: "bnet", bnetId: c.bnetId, verifiedAt: ctx.now }))));
      const settings = rt.db.settings.update(id, { characters }, ctx.now);
      rt.db.bnet.imports.delete(id);
      rt.db.bnet.removed.clear(id);
      return jsonResponse({ ok: true, settings });
    }),

    // Decision 8: the link, any import and every `bnet` character go; nothing else from Blizzard is stored.
    route("DELETE", "/api/bnet", (_req, _url, ctx) => {
      rt.db.bnet.unlink(ctx.user!.id, ctx.now);
      rt.audit.record("bnet_unlink");
      return jsonResponse({ ok: true });
    }),
  ];
}
