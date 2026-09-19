import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetAuthCache } from "../../src/wcl/auth.ts";
import { currentWclClient, gql, runWithWclClient, setRateLimitObserver } from "../../src/wcl/client.ts";

// Never reaches WCL: fetch is replaced for the whole file, and the env is pinned/restored around it.
const realFetch = globalThis.fetch;
const savedEnv = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
let auths: string[] = [];
beforeEach(() => {
  auths = [];
  resetAuthCache();
  process.env.WCL_CLIENT_ID = "env-id";
  process.env.WCL_CLIENT_SECRET = "env-secret";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: `tok-${h.get("authorization")}`, expires_in: 3600, token_type: "bearer" });
    auths.push(h.get("authorization")!);
    return Response.json({ data: { rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: 12, pointsResetIn: 100 } } });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; setRateLimitObserver(null); resetAuthCache(); });
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
});
