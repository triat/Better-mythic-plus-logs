import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import type { VerifyOutcome } from "../src/hosted/wcl-clients.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { resetAuthCache } from "../src/wcl/auth.ts";
import type { WclCredentials } from "../src/wcl/auth.ts";
import { TEST_ENCRYPTION_KEY, TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let noKeyServer: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let member: ReturnType<typeof loginAs>;
let noKeyMember: ReturnType<typeof loginAs>;

const RL = { limitPerHour: 3600, pointsSpentThisHour: 1412, pointsResetIn: 100 };
let verifyResult: VerifyOutcome = { ok: true, rateLimit: RL };
const seenCreds: WclCredentials[] = [];

const u = (p: string) => `http://localhost:${server.port}${p}`;
const nk = (p: string) => `http://localhost:${noKeyServer.port}${p}`;
const json = (method: string, body?: unknown, cookie?: string): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

const assets = (d: string) => async () => ({
  index: join(d, "index.html"),
  appJs: join(d, "assets", "app.js"),
  appCss: join(d, "assets", "app.css"),
  whConfigJs: join(d, "wh-config.js"),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-account-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  // Never let this suite reach real WCL: fetchMplusData's ZONES_QUERY would otherwise use whatever
  // is in .env.
  process.env.WCL_CLIENT_ID = "env-id";
  process.env.WCL_CLIENT_SECRET = "env-secret";
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0,
    open: false,
    hosted: true,
    hostedConfig: { ...TEST_HOSTED_CONFIG, encryptionKey: TEST_ENCRYPTION_KEY },
    assets: assets(dir),
    verifyWclClient: async (c) => { seenCreds.push(c); return verifyResult; },
  });
  noKeyServer = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets: assets(dir) });
  db = openHosted((await getStore())._db);
  member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
  noKeyMember = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "987654321098765432", role: "member", username: "nokey" });
});
afterAll(() => {
  server.stop(true);
  noKeyServer.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  delete process.env.WCL_CLIENT_ID;
  delete process.env.WCL_CLIENT_SECRET;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET/PUT/DELETE /api/me/wcl-client", () => {
  test("no client yet", async () => {
    expect(await (await fetch(u("/api/me/wcl-client"), { headers: { cookie: member.cookie } })).json()).toEqual({ ok: true, enabled: true, client: null });
    expect((await fetch(u("/api/me/wcl-client"))).status).toBe(401);
  });
  test("PUT verifies, stores, audits; /api/me carries ownClient; verify re-stamps; DELETE removes", async () => {
    const put = await fetch(u("/api/me/wcl-client"), json("PUT", { clientId: "a3f1000000009c2e", clientSecret: "hunter2" }, member.cookie));
    expect(put.status).toBe(200);
    const body = await put.json();
    expect(body.client).toMatchObject({ clientId: "a3f1…9c2e", snapshot: { pointsSpentThisHour: 1412 } });
    expect(seenCreds.at(-1)).toEqual({ clientId: "a3f1000000009c2e", clientSecret: "hunter2" });
    expect(JSON.stringify(body)).not.toContain("hunter2");
    const me = await (await fetch(u("/api/me"), { headers: { cookie: member.cookie } })).json();
    expect(me.ownClient.clientId).toBe("a3f1…9c2e");
    expect(db.audit.list({ actions: ["wcl_client_set"], before: null, limit: 1 })[0]).toMatchObject({ userId: member.user.id, target: "a3f1…9c2e" });
    expect(JSON.stringify(db.audit.list({ actions: null, before: null, limit: 50 }))).not.toContain("hunter2");
    const verify = await fetch(u("/api/me/wcl-client/verify"), json("POST", undefined, member.cookie));
    expect((await verify.json()).client.verifiedAt).toBeGreaterThan(0);
    verifyResult = { ok: false, error: "HTTP 401: invalid_client" };
    expect(await (await fetch(u("/api/me/wcl-client/verify"), json("POST", undefined, member.cookie))).json()).toEqual({ ok: false, error: "WCL refused these credentials: HTTP 401: invalid_client" });
    expect(await (await fetch(u("/api/me/wcl-client"), json("PUT", { clientId: "x", clientSecret: "y" }, member.cookie))).json()).toEqual({ ok: false, error: "WCL refused these credentials: HTTP 401: invalid_client" });
    expect(db.wclClients.get(member.user.id)!.clientId).toBe("a3f1000000009c2e"); // the refused PUT did not replace it
    verifyResult = { ok: true, rateLimit: RL };
    expect(await (await fetch(u("/api/me/wcl-client"), { method: "DELETE", headers: { cookie: member.cookie } })).json()).toEqual({ ok: true });
    expect(await (await fetch(u("/api/me/wcl-client"), { method: "DELETE", headers: { cookie: member.cookie } })).json()).toEqual({ ok: false });
    expect(db.audit.list({ actions: ["wcl_client_remove"], before: null, limit: 1 })[0]!.userId).toBe(member.user.id);
    expect((await (await fetch(u("/api/me"), { headers: { cookie: member.cookie } })).json()).ownClient).toBeNull();
  });
  test("bad bodies", async () => {
    expect((await fetch(u("/api/me/wcl-client"), json("PUT", { clientId: "a" }, member.cookie))).status).toBe(400);
    expect((await fetch(u("/api/me/wcl-client"), json("PUT", { clientId: "a", clientSecret: "b", x: 1 }, member.cookie))).status).toBe(400);
  });
});

describe("lookups through the member's own client", () => {
  test("a member with a client runs outside the quota gate and inside the WCL scope; nothing is charged to usage_hourly", async () => {
    resetAuthCache();
    await fetch(u("/api/me/wcl-client"), json("PUT", { clientId: "own-id", clientSecret: "own-secret" }, member.cookie));
    db.usage.add(member.user.id, Date.now(), 300); // quota exhausted for the shared client
    // A fake WCL: the rankings query answers with an empty character so the lookup ends with a 404 *after* the first gql call.
    const realFetch = globalThis.fetch;
    const auths: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const h = new Headers(init?.headers);
      if (url.startsWith("http://localhost")) return realFetch(input, init);
      if (url.endsWith("/oauth/token")) return Response.json({ access_token: `tok-${h.get("authorization")}`, expires_in: 3600, token_type: "bearer" });
      auths.push(h.get("authorization")!);
      return Response.json({ data: { rateLimitData: { limitPerHour: 3600, pointsSpentThisHour: 50, pointsResetIn: 100 }, worldData: { zones: [] }, characterData: { character: null } } });
    }) as unknown as typeof fetch;
    try {
      const r = await fetch(u("/api/lookup"), json("POST", { character: "Nobody-Hyjal" }, member.cookie));
      expect(r.status).not.toBe(429);             // the shared quota (exhausted) was not consulted
      expect(auths.length).toBeGreaterThan(0);
      expect(auths.every((a) => a === `Bearer tok-Basic ${btoa("own-id:own-secret")}`)).toBe(true);
      expect(db.usage.used(member.user.id, Date.now())).toBe(300); // unchanged
      const me = await (await fetch(u("/api/me"), { headers: { cookie: member.cookie } })).json();
      expect(me.ownClient.snapshot.pointsSpentThisHour).toBe(50);
    } finally {
      globalThis.fetch = realFetch;
      await fetch(u("/api/me/wcl-client"), { method: "DELETE", headers: { cookie: member.cookie } });
    }
  });
  test("a member without a client is still refused by the exhausted quota", async () => {
    const r = await fetch(u("/api/lookup"), json("POST", { character: "Nobody-Hyjal" }, member.cookie));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("quota");
  });
});

describe("disabled instance (no BMPL_ENCRYPTION_KEY)", () => {
  test("GET reports disabled, PUT/verify refuse with 503, DELETE is a no-op", async () => {
    expect(await (await fetch(nk("/api/me/wcl-client"), { headers: { cookie: noKeyMember.cookie } })).json()).toEqual({ ok: true, enabled: false, client: null });
    const put = await fetch(nk("/api/me/wcl-client"), json("PUT", { clientId: "a", clientSecret: "b" }, noKeyMember.cookie));
    expect(put.status).toBe(503);
    expect(await put.json()).toEqual({ ok: false, error: "This instance does not store WCL clients (no BMPL_ENCRYPTION_KEY)" });
    const verify = await fetch(nk("/api/me/wcl-client/verify"), json("POST", undefined, noKeyMember.cookie));
    expect(verify.status).toBe(503);
    expect(await verify.json()).toEqual({ ok: false, error: "This instance does not store WCL clients (no BMPL_ENCRYPTION_KEY)" });
    expect(await (await fetch(nk("/api/me/wcl-client"), { method: "DELETE", headers: { cookie: noKeyMember.cookie } })).json()).toEqual({ ok: false });
  });
});
