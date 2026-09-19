import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetAuthCache } from "../../src/wcl/auth.ts";
import { WclError, currentWclClient, gql, runWithWclClient, setRateLimitObserver, setWclErrorObserver } from "../../src/wcl/client.ts";

// Never reaches WCL: fetch is replaced for the whole file, and the env is pinned/restored around it.
const realFetch = globalThis.fetch;
const savedEnv = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
let auths: string[] = [];
let oauthStatus = 200;
beforeEach(() => {
  auths = [];
  oauthStatus = 200;
  resetAuthCache();
  process.env.WCL_CLIENT_ID = "env-id";
  process.env.WCL_CLIENT_SECRET = "env-secret";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    if (url.endsWith("/oauth/token")) {
      if (oauthStatus !== 200) return new Response('{"error":"invalid_client"}', { status: oauthStatus });
      return Response.json({ access_token: `tok-${h.get("authorization")}`, expires_in: 3600, token_type: "bearer" });
    }
    auths.push(h.get("authorization")!);
    return Response.json({ data: { rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: 12, pointsResetIn: 100 } } });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; setRateLimitObserver(null); setWclErrorObserver(null); resetAuthCache(); });
afterAll(() => {
  if (savedEnv.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedEnv.id;
  if (savedEnv.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedEnv.secret;
});

describe("runWithWclClient", () => {
  test("gql inside the scope uses the scoped credentials and reports rateLimitData to the scope, not the meter observer", async () => {
    const meter: unknown[] = [];
    const own: unknown[] = [];
    setRateLimitObserver((rl) => meter.push(rl));
    await gql("query { rateLimitData { limitPerHour } }");
    expect(currentWclClient()).toBeUndefined();
    await runWithWclClient({ creds: { clientId: "u1", clientSecret: "s1" }, onRateLimit: (rl) => own.push(rl) }, async () => {
      expect(currentWclClient()?.creds.clientId).toBe("u1");
      await gql("query { rateLimitData { limitPerHour } }");
    });
    expect(auths).toEqual([`Bearer tok-Basic ${btoa("env-id:env-secret")}`, `Bearer tok-Basic ${btoa("u1:s1")}`]);
    expect(meter).toHaveLength(1);
    expect(own).toEqual([{ limitPerHour: 3600, pointsSpentThisHour: 12, pointsResetIn: 100 }]);
  });
  test("a refused OAuth inside the scope is a WclError (http, status) pointing at Settings; outside it, no hint", async () => {
    oauthStatus = 401;
    const observed: WclError[] = [];
    setWclErrorObserver((e) => observed.push(e));
    const own = await runWithWclClient({ creds: { clientId: "u1", clientSecret: "s1" }, onRateLimit: null }, () => gql("query { x }")).catch((e: unknown) => e);
    expect(own).toBeInstanceOf(WclError);
    expect(own as WclError).toMatchObject({ kind: "http", status: 401, publicMessage: 'OAuth failed: 401 {"error":"invalid_client"} — check your client in Settings' });
    const shared = await gql("query { x }").catch((e: unknown) => e);
    expect((shared as WclError).publicMessage).toBe('OAuth failed: 401 {"error":"invalid_client"}');
    expect(observed).toHaveLength(2);
    expect(auths).toEqual([]); // never reached the GraphQL endpoint
  });
});
