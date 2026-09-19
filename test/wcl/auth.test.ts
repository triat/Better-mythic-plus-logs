import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { forgetToken, getAccessToken, resetAuthCache } from "../../src/wcl/auth.ts";

// Never reaches WCL: fetch is replaced for the whole file, and the env is pinned/restored around it.
const realFetch = globalThis.fetch;
const savedEnv = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
let calls: Array<{ auth: string | null; body: string }> = [];
let status = 200;
beforeEach(() => {
  calls = [];
  status = 200;
  resetAuthCache();
  process.env.WCL_CLIENT_ID = "env-id";
  process.env.WCL_CLIENT_SECRET = "env-secret";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push({ auth: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
    if (status !== 200) return new Response("nope ".repeat(100), { status });
    return Response.json({ access_token: `tok-${calls.length}`, expires_in: 3600, token_type: "bearer" });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; resetAuthCache(); });
afterAll(() => {
  if (savedEnv.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedEnv.id;
  if (savedEnv.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedEnv.secret;
});

describe("getAccessToken", () => {
  test("caches one token per client id; the env client is the default", async () => {
    expect(await getAccessToken()).toBe("tok-1");
    expect(await getAccessToken()).toBe("tok-1");
    expect(await getAccessToken({ clientId: "u1", clientSecret: "s1" })).toBe("tok-2");
    expect(await getAccessToken({ clientId: "u1", clientSecret: "s1" })).toBe("tok-2");
    expect(await getAccessToken()).toBe("tok-1");
    expect(calls.map((c) => c.auth)).toEqual([`Basic ${btoa("env-id:env-secret")}`, `Basic ${btoa("u1:s1")}`]);
  });
  test("forgetToken drops one client; resetAuthCache drops all", async () => {
    await getAccessToken();
    await getAccessToken({ clientId: "u1", clientSecret: "s1" });
    forgetToken("u1");
    expect(await getAccessToken({ clientId: "u1", clientSecret: "s1" })).toBe("tok-3");
    expect(await getAccessToken()).toBe("tok-1");
    resetAuthCache();
    expect(await getAccessToken()).toBe("tok-4");
  });
  test("a refused OAuth throws a clipped message", async () => {
    status = 401;
    const p = getAccessToken({ clientId: "bad", clientSecret: "bad" });
    await expect(p).rejects.toThrow(/^WCL OAuth failed: 401 /);
    // Bun 1.3.4's `toThrow` does not support a predicate function (throws
    // "instanceof called on an object with an invalid prototype property" even
    // in a minimal repro outside this project) — checked directly instead.
    const err = (await p.catch((e: unknown) => e)) as Error;
    expect(err.message.length).toBeLessThanOrEqual(240);
  });
});
