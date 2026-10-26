import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { WCL_TOKEN_URL, WCL_USER_GRAPHQL, exchangeWclCode, pkcePair, probeUserToken, userGql, wclAuthorizeUrl } from "../../src/hosted/wcl-link.ts";
import type { Gql } from "../../src/hosted/wcl-link.ts";

const facts = { tokenType: "Bearer", expiresInS: 3600, refreshToken: false, scope: null };
/** A fake endpoint whose counter rises by `cost` on every query that is not rateLimitData. */
function fakeEndpoint(cost: number): Gql & { spent: number } {
  const state = { spent: 0 };
  const q = (async (query: string) => {
    if (query.includes("rateLimitData")) return { rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: state.spent, pointsResetIn: 900 } };
    state.spent += cost;
    if (query.includes("currentUser")) return { userData: { currentUser: { id: 42, name: "tom" } } };
    if (query.includes("zones")) return { worldData: { zones: [{ name: "Mythic+ Season 3", frozen: false, encounters: [{ id: 7 }] }] } };
    return { worldData: { encounter: { characterRankings: {} } } };
  }) as unknown as Gql & { spent: number };
  Object.defineProperty(q, "spent", { get: () => state.spent });
  return q;
}

describe("WCL account link: the measurement gate", () => {
  test("PKCE: S256 of the verifier; the authorize URL carries the client, redirect, state and challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const url = new URL(wclAuthorizeUrl({ clientId: "cid", redirectUri: "https://bmpl.example.com/auth/wcl/callback", state: "st", challenge }));
    expect(`${url.origin}${url.pathname}`).toBe("https://www.warcraftlogs.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid", redirect_uri: "https://bmpl.example.com/auth/wcl/callback", response_type: "code", state: "st",
      code_challenge: challenge, code_challenge_method: "S256",
    });
  });

  test("the code exchange sends basic auth and the verifier; the facts never hold the token values", async () => {
    let seen: { url: string; auth: string | null; body: string } | null = null;
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      seen = { url: String(input), auth: new Headers(init?.headers).get("authorization"), body: String(init?.body) };
      return Response.json({ access_token: "AT-secret", token_type: "Bearer", expires_in: 31536000, refresh_token: "RT-secret" });
    }) as unknown as typeof fetch;
    const r = await exchangeWclCode({ clientId: "cid", clientSecret: "sec", code: "c0de", redirectUri: "https://x/cb", verifier: "v" }, fetchFn);
    expect(seen!.url).toBe(WCL_TOKEN_URL);
    expect(seen!.auth).toBe(`Basic ${btoa("cid:sec")}`);
    expect(Object.fromEntries(new URLSearchParams(seen!.body))).toEqual({ grant_type: "authorization_code", code: "c0de", redirect_uri: "https://x/cb", code_verifier: "v" });
    expect(r).toEqual({ ok: true, accessToken: "AT-secret", facts: { tokenType: "Bearer", expiresInS: 31536000, refreshToken: true, scope: null } });
    expect(JSON.stringify(r.ok ? r.facts : null)).not.toContain("secret");
    const refused = await exchangeWclCode({ clientId: "cid", clientSecret: "sec", code: "c", redirectUri: "x", verifier: "v" }, (async () => new Response("no", { status: 400 })) as unknown as typeof fetch);
    expect(refused).toEqual({ ok: false, error: "token endpoint answered HTTP 400" });
  });

  test("userGql posts to the user endpoint with the bearer token and surfaces GraphQL errors", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const ok = userGql("tok", (async (input: unknown, init?: RequestInit) => {
      seen = { url: String(input), auth: new Headers(init?.headers).get("authorization") };
      return Response.json({ data: { x: 1 } });
    }) as unknown as typeof fetch);
    expect(await ok<{ x: number }>("{ x }")).toEqual({ x: 1 });
    expect(seen as unknown).toEqual({ url: WCL_USER_GRAPHQL, auth: "Bearer tok" });
    const bad = userGql("tok", (async () => Response.json({ errors: [{ message: "unauthorized scope" }] })) as unknown as typeof fetch);
    await expect(bad("{ x }")).rejects.toThrow("GraphQL: unauthorized scope");
  });

  test("the verdict: the user's own counter, the instance's, both, or neither", async () => {
    const userOnly = await probeUserToken(facts, fakeEndpoint(1), fakeEndpoint(0));
    expect(userOnly.verdict).toBe("user budget");
    expect(userOnly.currentUser).toEqual({ id: 42, name: "tom" });
    expect(userOnly.publicQueries).toEqual({ ok: true, pages: 3 });
    // The same budget behind both tokens: modelled as the instance's counter moving and the user's not.
    expect((await probeUserToken(facts, fakeEndpoint(0), fakeEndpoint(0))).verdict).toBe("nothing moved");
    const shared = fakeEndpoint(1);
    expect((await probeUserToken(facts, shared, shared)).verdict).toBe("both moved");
    const broken = (async () => { throw new Error("user endpoint answered HTTP 401"); }) as unknown as Gql;
    const r = await probeUserToken(facts, broken, fakeEndpoint(0));
    expect(r.verdict).toBe("unreadable");
    expect(r.publicQueries).toEqual({ ok: false, error: "user endpoint answered HTTP 401" });
  });
});
