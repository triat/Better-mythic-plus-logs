import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG } from "./hosted/helpers.ts";

// Fake Discord: one token endpoint, one /users/@me, one /users/@me/guilds; `who` selects the
// identity returned, `guilds` the guild ids the fake account belongs to.
let who = { id: "123456789012345678", username: "tom", global_name: "Tom" as string | null, avatar: "abc" as string | null };
let tokenStatus = 200;
let guilds: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://discord.com/api/oauth2/token") {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("code") !== "good-code") return new Response("bad code", { status: 400 });
    return tokenStatus === 200 ? Response.json({ access_token: "tok-" + who.id }) : new Response("", { status: tokenStatus });
  }
  if (url === "https://discord.com/api/users/@me") {
    if (new Headers(init?.headers).get("authorization") !== "Bearer tok-" + who.id) return new Response("", { status: 401 });
    return Response.json(who);
  }
  if (url === "https://discord.com/api/users/@me/guilds") return Response.json(guilds.map((id) => ({ id })));
  throw new Error("unexpected fetch " + url);
}) as unknown as typeof fetch;

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const noRedirect = { redirect: "manual" as const };
const cookieOf = (res: Response, name: string): string | null => {
  for (const c of res.headers.getSetCookie()) if (c.startsWith(name + "=")) return c.split(";")[0]!;
  return null;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-auth-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, fetchFn: fakeFetch,
    // This file drives the login flow many times from one IP; the /auth/* limit itself is covered by test/server-hardening.test.ts.
    rateLimits: { auth: { limit: 1_000, windowMs: 60_000 } },
    assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }),
  });
  db = openHosted((await getStore())._db);
  db.invites.add("123456789012345678", "test", null, Date.now());
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

/** Runs /auth/discord then the callback with the state + nonce it issued; returns the callback response. */
async function login(overrides: { state?: string; oauthCookie?: string | null; code?: string } = {}, base: (p: string) => string = u): Promise<{ start: Response; cb: Response }> {
  const start = await fetch(base("/auth/discord"), noRedirect);
  const location = new URL(start.headers.get("location")!);
  const state = overrides.state ?? location.searchParams.get("state")!;
  const oauth = overrides.oauthCookie === undefined ? cookieOf(start, "bmpl_oauth") : overrides.oauthCookie;
  const cb = await fetch(base(`/auth/discord/callback?code=${overrides.code ?? "good-code"}&state=${encodeURIComponent(state)}`), { ...noRedirect, headers: oauth ? { cookie: oauth } : {} });
  return { start, cb };
}

describe("GET /auth/discord", () => {
  test("redirects to Discord with identify scope, sets the oauth cookie, no session needed", async () => {
    const res = await fetch(u("/auth/discord"), noRedirect);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(loc.searchParams.get("scope")).toBe("identify");
    expect(loc.searchParams.get("redirect_uri")).toBe("http://localhost/auth/discord/callback");
    expect(loc.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const oauth = res.headers.getSetCookie().find((c) => c.startsWith("bmpl_oauth="))!;
    expect(oauth).toContain("HttpOnly");
    expect(oauth).toContain("Path=/auth");
    expect(oauth).toContain("SameSite=Lax");
    expect(oauth).not.toContain("Secure"); // baseUrl is http in tests
    expect(oauth).toContain("Max-Age=600");
  });
});

describe("GET /auth/discord/callback", () => {
  test("full round-trip: session cookie set, redirect to /, user row created, /api/me works", async () => {
    const { cb } = await login();
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/");
    const session = cb.headers.getSetCookie().find((c) => c.startsWith("bmpl_session="))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    expect(session).toContain("Path=/");
    expect(session).toContain("Max-Age=2592000");
    expect(cb.headers.getSetCookie().find((c) => c.startsWith("bmpl_oauth=") && c.includes("Max-Age=0"))).toBeDefined();
    const cookie = session.split(";")[0]!;
    const me = await fetch(u("/api/me"), { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody).toEqual({ ok: true, user: { id: expect.any(Number), discordId: "123456789012345678", username: "tom", globalName: "Tom", avatarUrl: "https://cdn.discordapp.com/avatars/123456789012345678/abc.png?size=64", role: "member" }, quota: { used: 0, limit: 300, resetInS: meBody.quota.resetInS }, ownClient: null });
    expect(meBody.quota.resetInS).toBeGreaterThan(0);
    expect(db.users.byDiscordId("123456789012345678")?.role).toBe("member");
    // /api/me re-issues the session cookie so its Max-Age slides with the server-side expiry.
    const reissued = me.headers.getSetCookie().find((c) => c.startsWith("bmpl_session="))!;
    expect(reissued).toBeDefined();
    expect(reissued).toContain("Max-Age=2592000");
  });
  test("a second login rotates the session: an old cookie sent to the callback stops working", async () => {
    const first = await login();
    const firstCookie = cookieOf(first.cb, "bmpl_session")!;
    expect((await fetch(u("/api/me"), { headers: { cookie: firstCookie } })).status).toBe(200);

    const start2 = await fetch(u("/auth/discord"), noRedirect);
    const state2 = new URL(start2.headers.get("location")!).searchParams.get("state")!;
    const oauth2 = cookieOf(start2, "bmpl_oauth")!;
    const cb2 = await fetch(u(`/auth/discord/callback?code=good-code&state=${encodeURIComponent(state2)}`), {
      ...noRedirect,
      headers: { cookie: `${oauth2}; ${firstCookie}` }, // simulates the browser sending its still-valid session cookie along
    });
    expect(cb2.status).toBe(302);
    const secondCookie = cookieOf(cb2, "bmpl_session")!;

    expect((await fetch(u("/api/me"), { headers: { cookie: firstCookie } })).status).toBe(401);
    expect((await fetch(u("/api/me"), { headers: { cookie: secondCookie } })).status).toBe(200);
  });
  test("a config admin is admitted without an invite and gets role admin", async () => {
    who = { id: "111111111111111111", username: "boss", global_name: null, avatar: null };
    const { cb } = await login();
    expect(cb.status).toBe(302);
    const cookie = cookieOf(cb, "bmpl_session")!;
    const me = await (await fetch(u("/api/me"), { headers: { cookie } })).json();
    expect(me.user.role).toBe("admin");
    expect(me.user.avatarUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
    who = { id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" };
  });
  test("an uninvited user gets no session and is sent to /?denied=<id>", async () => {
    who = { id: "999999999999999999", username: "stranger", global_name: null, avatar: null };
    const { cb } = await login();
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/?denied=999999999999999999");
    expect(cookieOf(cb, "bmpl_session")).toBeNull();
    expect(db.users.byDiscordId("999999999999999999")).toBeNull();
    who = { id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" };
  });
  test("state is single-use, bound to the oauth cookie, and required", async () => {
    const first = await login();
    expect(first.cb.status).toBe(302);
    const state = new URL(first.start.headers.get("location")!).searchParams.get("state")!;
    const oauth = cookieOf(first.start, "bmpl_oauth");
    const replay = await fetch(u(`/auth/discord/callback?code=good-code&state=${state}`), { ...noRedirect, headers: { cookie: oauth! } });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ ok: false, error: "Invalid OAuth state" });
    expect((await login({ oauthCookie: null })).cb.status).toBe(400);
    expect((await login({ oauthCookie: "bmpl_oauth=someone-elses-nonce" })).cb.status).toBe(400);
    expect((await login({ state: "forged" })).cb.status).toBe(400);
    expect((await fetch(u("/auth/discord/callback"), noRedirect)).status).toBe(400);
  });
  test("Discord failures redirect to /?login=failed without a session (top-level navigation, not a bare 502)", async () => {
    const bad = await login({ code: "wrong-code" });
    expect(bad.cb.status).toBe(302);
    expect(bad.cb.headers.get("location")).toBe("/?login=failed");
    expect(cookieOf(bad.cb, "bmpl_session")).toBeNull();
    tokenStatus = 500;
    const second = await login();
    expect(second.cb.status).toBe(302);
    expect(second.cb.headers.get("location")).toBe("/?login=failed");
    tokenStatus = 200;
  });
  test("a user-cancelled login (Discord's `error` param) redirects to / and never touches the pending state", async () => {
    const res = await fetch(u("/auth/discord/callback?error=access_denied"), noRedirect);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(cookieOf(res, "bmpl_session")).toBeNull();
    expect(res.headers.getSetCookie().find((c) => c.startsWith("bmpl_oauth=") && c.includes("Max-Age=0"))).toBeDefined();
  });
});

describe("POST /auth/logout and /api/me", () => {
  test("logout deletes the session and clears the cookie; /api/me is 401 after", async () => {
    const { cb } = await login();
    const cookie = cookieOf(cb, "bmpl_session")!;
    const out = await fetch(u("/auth/logout"), { method: "POST", headers: { cookie }, ...noRedirect });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect(out.headers.getSetCookie().find((c) => c.startsWith("bmpl_session=;") && c.includes("Max-Age=0"))).toBeDefined();
    expect((await fetch(u("/api/me"), { headers: { cookie } })).status).toBe(401);
    expect((await fetch(u("/auth/logout"), { method: "POST" })).status).toBe(200); // anonymous logout is a no-op
  });
  test("/api/me without a session is 401", async () => {
    const res = await fetch(u("/api/me"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "sign in" });
  });
});

describe("phase 2 admission (closed signup)", () => {
  test("a banned invited user is refused with ?denied=banned and the reason is audited", async () => {
    who = { id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" };
    const first = await login();
    expect(first.cb.headers.get("location")).toBe("/");
    const banned = db.users.byDiscordId(who.id)!;
    db.users.ban(banned.id, 1, Date.now());
    const { cb } = await login();
    expect(cb.headers.get("location")).toBe("/?denied=banned");
    expect(cookieOf(cb, "bmpl_session")).toBeNull();
    const row = db.audit.list({ actions: ["login_denied"], before: null, limit: 1 })[0]!;
    expect(row.detail).toEqual({ reason: "banned" });
    db.users.unban(banned.id);
  });
  test("DELETE /api/me removes the account, clears the cookie and audits account_delete", async () => {
    who = { id: "123456789012345678", username: "tom", global_name: "Tom", avatar: "abc" };
    const { cb } = await login();
    const cookie = cookieOf(cb, "bmpl_session")!;
    const res = await fetch(u("/api/me"), { method: "DELETE", headers: { cookie } });
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.getSetCookie().some((c) => c.startsWith("bmpl_session=;") || /bmpl_session=.*Max-Age=0/.test(c))).toBe(true);
    expect(db.users.byDiscordId(who.id)).toBeNull();
    expect((await fetch(u("/api/me"), { headers: { cookie } })).status).toBe(401);
    const row = db.audit.list({ actions: ["account_delete"], before: null, limit: 1 })[0]!;
    expect(row).toMatchObject({ userId: null, target: "discord 123456789012345678", detail: { username: "tom" } });
  });
});

describe("phase 2 admission (open signup + guild gate)", () => {
  let dir2: string;
  let server2: Awaited<ReturnType<typeof runServer>>;
  let db2: HostedDb;
  const u2 = (p: string) => `http://localhost:${server2.port}${p}`;

  beforeAll(async () => {
    dir2 = mkdtempSync(join(tmpdir(), "bmpl-auth2-"));
    mkdirSync(join(dir2, "assets"));
    for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir2, f), "");
    closeStore();
    process.env.BMPL_DB_PATH = join(dir2, "bmpl.db");
    server2 = await runServer({
      port: 0, open: false, hosted: true,
      hostedConfig: { ...TEST_HOSTED_CONFIG, openSignup: true, discordGuildId: "987654321098765432" },
      fetchFn: fakeFetch,
      rateLimits: { auth: { limit: 1_000, windowMs: 60_000 }, signup: { limit: 2, windowMs: 3_600_000 } },
      assets: async () => ({ index: join(dir2, "index.html"), appJs: join(dir2, "assets/app.js"), appCss: join(dir2, "assets/app.css"), whConfigJs: join(dir2, "wh-config.js") }),
    });
    db2 = openHosted((await getStore())._db);
  });
  afterAll(() => { server2.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir2, { recursive: true, force: true }); });

  test("a stranger in the guild gets in as a member; not in the guild → ?denied=guild", async () => {
    who = { id: "777777777777777777", username: "stranger", global_name: null, avatar: null };
    guilds = [];
    expect((await login({}, u2)).cb.headers.get("location")).toBe("/?denied=guild");
    expect(db2.users.byDiscordId(who.id)).toBeNull();
    guilds = ["987654321098765432"];
    const { cb } = await login({}, u2);
    expect(cb.headers.get("location")).toBe("/");
    expect(db2.users.byDiscordId(who.id)!.role).toBe("member");
  });
  test("the authorize URL asks for the guilds scope", async () => {
    const start = await fetch(u2("/auth/discord"), noRedirect);
    expect(new URL(start.headers.get("location")!).searchParams.get("scope")).toBe("identify guilds");
  });
  test("new accounts are rate-limited per IP; an existing account is not", async () => {
    guilds = ["987654321098765432"];
    who = { id: "777777777777777778", username: "s2", global_name: null, avatar: null };
    expect((await login({}, u2)).cb.headers.get("location")).toBe("/"); // 2nd new account this hour (the first was above)
    who = { id: "777777777777777779", username: "s3", global_name: null, avatar: null };
    expect((await login({}, u2)).cb.headers.get("location")).toBe("/?denied=rate");
    expect(db2.users.byDiscordId(who.id)).toBeNull();
    expect(db2.audit.list({ actions: ["rate_limited"], before: null, limit: 1 })[0]!.target).toBe("GET /auth/discord/callback");
    who = { id: "777777777777777778", username: "s2", global_name: null, avatar: null };
    expect((await login({}, u2)).cb.headers.get("location")).toBe("/"); // existing account: no limiter
  });
});
