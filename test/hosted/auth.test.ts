import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LOCAL_CONTEXT, authGate, clientIp, resolveRequest } from "../../src/hosted/auth.ts";
import { signSessionId } from "../../src/hosted/cookie.ts";
import { openHosted } from "../../src/hosted/db.ts";
import { History } from "../../src/server-history.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./helpers.ts";

const SECRET = TEST_HOSTED_CONFIG.sessionSecret;
const req = (cookie?: string, extra: Record<string, string> = {}) =>
  new Request("http://x/api/history", { headers: { ...(cookie ? { cookie } : {}), ...extra } });

describe("clientIp", () => {
  test("hosted trusts the LAST X-Forwarded-For entry (the nearest proxy's), local uses the fallback", () => {
    expect(clientIp(req(undefined, { "x-forwarded-for": " 9.9.9.9 , 10.0.0.1" }), true, "127.0.0.1")).toBe("10.0.0.1");
    expect(clientIp(req(undefined, { "x-forwarded-for": "9.9.9.9" }), false, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp(req(), true, null)).toBe("");
  });
  test("last entry: a client-prepended list still resolves to the proxy's entry; single entry as is; empty → fallback; bounded to 64 chars", () => {
    expect(clientIp(req(undefined, { "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), true, "127.0.0.1")).toBe("2.2.2.2");
    expect(clientIp(req(undefined, { "x-forwarded-for": "1.1.1.1" }), true, "127.0.0.1")).toBe("1.1.1.1");
    expect(clientIp(req(undefined, { "x-forwarded-for": "1.1.1.1, 2.2.2.2, " }), true, "127.0.0.1")).toBe("2.2.2.2"); // trailing empty entry ignored
    expect(clientIp(req(undefined, { "x-forwarded-for": "" }), true, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp(req(undefined, { "x-forwarded-for": " , " }), true, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp(req(undefined, { "x-forwarded-for": "" }), true, null)).toBe("");
    expect(clientIp(req(undefined, { "x-forwarded-for": "x".repeat(200) }), true, null)).toBe("x".repeat(64));
  });
});

describe("resolveRequest", () => {
  test("valid cookie → user; tampered/missing/expired/unknown → anonymous", () => {
    const db = openHosted(new Database(":memory:"));
    const { cookie, user, sessionId } = loginAs(db, SECRET, { discordId: "123456789012345678", role: "member" }, 1000);
    const ok = resolveRequest(req(cookie), { db, secret: SECRET, now: 2000, ip: "1.1.1.1" });
    expect(ok.user).toMatchObject({ id: user.id, discordId: "123456789012345678", role: "member" });
    expect(ok.sessionId).toBe(sessionId);
    expect(ok.hosted).toBe(true);
    expect(ok.ip).toBe("1.1.1.1");
    expect(ok.now).toBe(2000);
    expect(ok.history?.size).toBe(0);
    const tampered = resolveRequest(req(cookie.slice(0, -2) + "zz"), { db, secret: SECRET, now: 2000, ip: "" });
    expect(tampered.user).toBeNull();
    expect(resolveRequest(req(), { db, secret: SECRET, now: 2000, ip: "" }).user).toBeNull();
    expect(resolveRequest(req(), { db, secret: SECRET, now: 2000, ip: "" }).history).toBeNull();
    const unknown = `bmpl_session=${signSessionId("not-a-session", SECRET)}`;
    expect(resolveRequest(req(unknown), { db, secret: SECRET, now: 2000, ip: "" }).user).toBeNull();
    db.sessions.delete(sessionId);
    expect(resolveRequest(req(cookie), { db, secret: SECRET, now: 2000, ip: "" }).user).toBeNull();
  });
});

describe("authGate", () => {
  const anon = { hosted: true, user: null, sessionId: null, ip: "", now: 0, history: null };
  const member = { ...anon, user: { id: 1, discordId: "1", username: "m", globalName: null, avatarHash: null, role: "member" as const }, sessionId: "s" };
  const admin = { ...member, user: { ...member.user, role: "admin" as const } };
  test("public passes everyone; user needs a session; admin needs the role", async () => {
    expect(authGate({ auth: "public" }, anon)).toBeNull();
    const r401 = authGate({ auth: "user" }, anon)!;
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ ok: false, error: "sign in" });
    expect(authGate({ auth: "user" }, member)).toBeNull();
    const r403 = authGate({ auth: "admin" }, member)!;
    expect(r403.status).toBe(403);
    expect(await r403.json()).toEqual({ ok: false, error: "admin only" });
    expect(authGate({ auth: "admin" }, admin)).toBeNull();
  });
  test("local context is never gated", () => {
    expect(authGate({ auth: "admin" }, LOCAL_CONTEXT("127.0.0.1", new History(1)))).toBeNull();
  });
});
