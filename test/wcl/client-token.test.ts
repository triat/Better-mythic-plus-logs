// A token WCL stops accepting (GraphQL 401 "Unauthenticated.") must not stay cached until its
// expiry: production 2026-10-08, 12 lookups in a row failed with the same rejected token.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetAuthCache } from "../../src/wcl/auth.ts";
import { WclError, gql, runWithWclClient, setWclErrorObserver } from "../../src/wcl/client.ts";

const realFetch = globalThis.fetch;
const savedEnv = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
let minted = 0;
let rejected: Set<string>;
let graphqlCalls: string[];
beforeEach(() => {
  minted = 0;
  rejected = new Set();
  graphqlCalls = [];
  resetAuthCache();
  process.env.WCL_CLIENT_ID = "env-id";
  process.env.WCL_CLIENT_SECRET = "env-secret";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: `tok-${++minted}`, expires_in: 31_536_000, token_type: "bearer" });
    const auth = new Headers(init?.headers).get("authorization")!;
    graphqlCalls.push(auth);
    if (rejected.has(auth)) return new Response('{"error":"Unauthenticated."}', { status: 401 });
    return Response.json({ data: { ok: true } });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; setWclErrorObserver(null); resetAuthCache(); });
afterAll(() => {
  if (savedEnv.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedEnv.id;
  if (savedEnv.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedEnv.secret;
});

describe("gql and a rejected token", () => {
  test("a 401 drops the cached token and retries once with a fresh one", async () => {
    await gql("query { ok }");
    rejected.add("Bearer tok-1"); // WCL revokes the cached token
    const observed: WclError[] = [];
    setWclErrorObserver((e) => observed.push(e));
    expect(await gql<{ ok: boolean }>("query { ok }")).toEqual({ ok: true });
    expect(graphqlCalls).toEqual(["Bearer tok-1", "Bearer tok-1", "Bearer tok-2"]);
    expect(observed).toEqual([]); // the recovered call is not an error
    await gql("query { ok }");
    expect(graphqlCalls.at(-1)).toBe("Bearer tok-2"); // the fresh token is the cached one now
  });
  test("a 401 that survives the fresh token is a WclError, after exactly one retry", async () => {
    rejected.add("Bearer tok-1");
    rejected.add("Bearer tok-2");
    const e = await gql("query { ok }").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WclError);
    expect(e as WclError).toMatchObject({ kind: "http", status: 401 });
    expect(graphqlCalls).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });
  test("a member's own client recovers the same way, without touching the env client's token", async () => {
    await gql("query { ok }"); // env client: tok-1
    await runWithWclClient({ creds: { clientId: "u1", clientSecret: "s1" }, onRateLimit: null }, async () => {
      await gql("query { ok }"); // own client: tok-2
      rejected.add("Bearer tok-2");
      expect(await gql<{ ok: boolean }>("query { ok }")).toEqual({ ok: true }); // own client: tok-3
    });
    await gql("query { ok }");
    expect(graphqlCalls).toEqual(["Bearer tok-1", "Bearer tok-2", "Bearer tok-2", "Bearer tok-3", "Bearer tok-1"]);
  });
});
