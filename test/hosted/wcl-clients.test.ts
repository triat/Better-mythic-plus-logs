import { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import { openHosted } from "../../src/hosted/db.ts";
import { UserWclClients, verifyWithPing } from "../../src/hosted/wcl-clients.ts";
import type { Verify } from "../../src/hosted/wcl-clients.ts";
import { decrypt } from "../../src/hosted/crypto.ts";
import { getAccessToken, resetAuthCache } from "../../src/wcl/auth.ts";
import { TEST_ENCRYPTION_KEY } from "./helpers.ts";

const RL = { limitPerHour: 3600, pointsSpentThisHour: 1412, pointsResetIn: 2280 };
const setup = (key: Uint8Array | null, verify: Verify = async () => ({ ok: true, rateLimit: RL })) => {
  const db = openHosted(new Database(":memory:"));
  const u = db.users.upsertFromDiscord({ discordId: "123456789012345678", username: "tom", globalName: null, avatarHash: null }, null, 1000);
  return { db, u, svc: new UserWclClients({ repo: db.wclClients, key, verify, now: () => 5000 }) };
};

describe("UserWclClients", () => {
  test("disabled without a key: view null, save 503, credentials null", async () => {
    const { u, svc } = setup(null);
    expect(svc.enabled).toBe(false);
    expect(await svc.view(u.id)).toBeNull();
    expect(await svc.save(u.id, { clientId: "abcdef1234567890", clientSecret: "s" })).toEqual({ ok: false, status: 503, error: "This instance does not store WCL clients (no BMPL_ENCRYPTION_KEY)" });
    expect(await svc.credentials(u.id)).toBeNull();
  });
  test("save verifies first, stores the secret encrypted, abbreviates the id, keeps the PING snapshot", async () => {
    const seen: string[] = [];
    const { db, u, svc } = setup(TEST_ENCRYPTION_KEY, async (c) => { seen.push(c.clientId); return { ok: true, rateLimit: RL }; });
    const r = await svc.save(u.id, { clientId: "a3f1000000009c2e", clientSecret: "hunter2" });
    expect(r).toEqual({ ok: true, client: { clientId: "a3f1…9c2e", verifiedAt: 5000, updatedAt: 5000, usable: true, snapshot: { ...RL, observedAt: 5000 } } });
    expect(seen).toEqual(["a3f1000000009c2e"]);
    const row = db.wclClients.get(u.id)!;
    expect(row.secretEnc).not.toContain("hunter2");
    expect(await decrypt(TEST_ENCRYPTION_KEY, row.secretEnc)).toBe("hunter2");
    expect(await svc.credentials(u.id)).toEqual({ clientId: "a3f1000000009c2e", clientSecret: "hunter2" });
  });
  test("a refused PING stores nothing and answers 400 with the WCL message", async () => {
    const { db, u, svc } = setup(TEST_ENCRYPTION_KEY, async () => ({ ok: false, error: "HTTP 401: invalid_client" }));
    expect(await svc.save(u.id, { clientId: "abc", clientSecret: "s" })).toEqual({ ok: false, status: 400, error: "WCL refused these credentials: HTTP 401: invalid_client" });
    expect(db.wclClients.get(u.id)).toBeNull();
  });
  test("verify: 404 without a client, 400 when the key changed, success re-stamps verifiedAt", async () => {
    const { db, u, svc } = setup(TEST_ENCRYPTION_KEY);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await svc.verify(u.id)).toEqual({ ok: false, status: 404, error: "No WCL client saved" });
      db.wclClients.put({ userId: u.id, clientId: "abc", secretEnc: "v1.AAAAAAAAAAAAAAAA.AAAA", verifiedAt: null, now: 1 });
      expect(await svc.verify(u.id)).toEqual({ ok: false, status: 400, error: "Stored secret cannot be decrypted — save the client again" });
      expect(await svc.credentials(u.id)).toBeNull();
      // The view says so too, so the menu and the Settings card can warn without a request going out.
      expect((await svc.view(u.id))!.usable).toBe(false);
      expect(svc.has(u.id)).toBe(true);
      // Once per process per user, even across the two undecryptable calls above.
      expect(errSpy).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
    await svc.save(u.id, { clientId: "abc", clientSecret: "s" });
    db.wclClients.setVerified(u.id, 1); // pretend it is old
    const r = await svc.verify(u.id);
    expect(r.ok && r.client.verifiedAt).toBe(5000);
    expect(r.ok && r.client.usable).toBe(true);
  });
  test("save forgets the client's cached token before verifying: a rotated secret is checked against WCL, never replayed from a stale cache", async () => {
    const realFetch = globalThis.fetch;
    const savedEnv = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
    process.env.WCL_CLIENT_ID = "env-id";
    process.env.WCL_CLIENT_SECRET = "env-secret";
    resetAuthCache();
    let status = 200;
    const oauthAuths: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const h = new Headers(init?.headers);
      if (url.endsWith("/oauth/token")) {
        oauthAuths.push(h.get("authorization")!);
        if (status !== 200) return new Response("nope ".repeat(50), { status });
        return Response.json({ access_token: `tok-${h.get("authorization")}`, expires_in: 3600, token_type: "bearer" });
      }
      return Response.json({ data: { rateLimitData: RL } });
    }) as unknown as typeof fetch;
    try {
      const { db, u, svc } = setup(TEST_ENCRYPTION_KEY, verifyWithPing);
      // Pre-seed a token cached under client id "abc", minted with the OLD secret.
      await getAccessToken({ clientId: "abc", clientSecret: "old" });
      // WCL now refuses "abc" (secret rotated on the WCL side, or simply wrong).
      status = 401;
      const r = await svc.save(u.id, { clientId: "abc", clientSecret: "new" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error.startsWith("WCL refused these credentials: ")).toBe(true);
      }
      // The cached token must not have been replayed: a fresh OAuth call was made with the NEW secret.
      expect(oauthAuths).toEqual([`Basic ${btoa("abc:old")}`, `Basic ${btoa("abc:new")}`]);
      expect(db.wclClients.get(u.id)).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
      resetAuthCache();
      if (savedEnv.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedEnv.id;
      if (savedEnv.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedEnv.secret;
    }
  });
  test("observe/forget/remove", async () => {
    const { db, u, svc } = setup(TEST_ENCRYPTION_KEY);
    await svc.save(u.id, { clientId: "abc", clientSecret: "s" });
    svc.observe(u.id, { ...RL, pointsSpentThisHour: 1500 });
    expect((await svc.view(u.id))!.snapshot!.pointsSpentThisHour).toBe(1500);
    svc.forget(u.id);
    expect((await svc.view(u.id))!.snapshot).toBeNull();
    expect(svc.remove(u.id)).toBe(true);
    expect(await svc.view(u.id)).toBeNull();
    expect(svc.has(u.id)).toBe(false);
    expect(db.wclClients.get(u.id)).toBeNull();
    expect(svc.remove(u.id)).toBe(false);
  });
});
