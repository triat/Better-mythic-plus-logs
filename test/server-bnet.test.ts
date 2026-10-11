// Battle.net linking routes (spec docs/superpowers/specs/2026-10-11-battlenet-linking-design.md, plan Task 6):
// start, callback, GET /api/bnet, the pick, unlink, and the cascade of DELETE /api/me. Blizzard is a fake fetch.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { BNET_IMPORT_TTL_MS } from "../src/hosted/bnet-db.ts";
import type { Region } from "../src/wow/regions.ts";
import { getHostedRuntime, runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { loadBnetFixture } from "./fixtures.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

const CODE = "bnet-good-code";
const USER_TOKEN = "bnet-user-token";
const basicOk = `Basic ${Buffer.from(`${TEST_HOSTED_CONFIG.bnetClientId}:${TEST_HOSTED_CONFIG.bnetClientSecret}`).toString("base64")}`;

// The fake Blizzard: what each endpoint answers in the current test (reset in beforeEach).
let fake: { scope: string; tokenStatus: number; accountId: string; battletag: string; regions: Record<Region, number> };
let profiles: Record<string, unknown>;
// Each test links its own Battle.net account (one account per member, decision 5).
let accountSeq = 900000;
const reset = (): void => {
  fake = { scope: "wow.profile openid", tokenStatus: 200, accountId: String(++accountSeq), battletag: "Tom#1234", regions: { eu: 200, us: 200, kr: 404, tw: 404 } };
};
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get("authorization");
  if (url === "https://oauth.battle.net/token") {
    const body = new URLSearchParams(String(init?.body));
    if (auth !== basicOk || body.get("code") !== CODE || body.get("grant_type") !== "authorization_code") return new Response("bad", { status: 400 });
    if (fake.tokenStatus !== 200) return new Response("", { status: fake.tokenStatus });
    return Response.json({ access_token: USER_TOKEN, token_type: "bearer", expires_in: 86399, scope: fake.scope });
  }
  if (url === "https://oauth.battle.net/userinfo") {
    if (auth !== `Bearer ${USER_TOKEN}`) return new Response("", { status: 401 });
    return Response.json({ sub: fake.accountId, id: Number(fake.accountId), battletag: fake.battletag });
  }
  const m = /^https:\/\/(eu|us|kr|tw)\.api\.blizzard\.com\/profile\/user\/wow\?namespace=profile-\1&locale=en_US$/.exec(url);
  if (m) {
    if (auth !== `Bearer ${USER_TOKEN}`) return new Response("", { status: 401 });
    const region = m[1] as Region;
    const status = fake.regions[region];
    if (status !== 200) return new Response("", { status });
    return Response.json(profiles[region] ?? { wow_accounts: [] });
  }
  throw new Error("unexpected fetch " + url);
}) as unknown as typeof fetch;

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let raw: Database;
let nextId = 0;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const noRedirect = { redirect: "manual" as const };
const cookieOf = (res: Response, name: string): string | null => {
  for (const c of res.headers.getSetCookie()) if (c.startsWith(name + "=")) return c.split(";")[0]!;
  return null;
};
const member = () => loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: `3000000000000${String(nextId++).padStart(5, "0")}`, role: "member" });
const json = (cookie: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: { cookie, "content-type": "application/json", origin: "http://localhost" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-bnet-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, fetchFn: fakeFetch,
    rateLimits: { auth: { limit: 1_000, windowMs: 60_000 } },
    assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }),
  });
  raw = (await getStore())._db;
  db = openHosted(raw);
  profiles = { eu: await loadBnetFixture("profile-eu"), us: await loadBnetFixture("profile-us") };
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });
beforeEach(reset);

/** /auth/bnet/start then the callback with the state and nonce it issued (or overrides); returns both responses. */
async function link(cookie: string | null, o: { state?: string; nonce?: string | null; query?: string } = {}): Promise<{ start: Response; cb: Response; state: string; nonce: string | null }> {
  const start = await fetch(u("/auth/bnet/start"), { ...noRedirect, headers: cookie ? { cookie } : {} });
  const issued = start.status === 302 ? new URL(start.headers.get("location")!).searchParams.get("state")! : "none";
  const state = o.state ?? issued;
  const nonce = o.nonce === undefined ? cookieOf(start, "bmpl_bnet") : o.nonce;
  const query = o.query ?? `code=${CODE}&state=${encodeURIComponent(state)}`;
  const cookies = [cookie, nonce].filter((c): c is string => !!c).join("; ");
  const cb = await fetch(u(`/auth/bnet/callback?${query}`), { ...noRedirect, headers: cookies ? { cookie: cookies } : {} });
  return { start, cb, state, nonce };
}
const codeOf = (res: Response): string | null => {
  expect(res.status).toBe(302);
  const loc = res.headers.get("location")!;
  expect(loc.startsWith("/me?bnet=")).toBe(true);
  return new URL(loc, "http://x").searchParams.get("bnet");
};
const nonceCleared = (res: Response): boolean =>
  res.headers.getSetCookie().some((c) => c.startsWith("bmpl_bnet=;") && c.includes("Max-Age=0") && c.includes("Path=/auth/bnet"));

describe("GET /auth/bnet/start", () => {
  test("redirects to Battle.net with wow.profile and the callback, and sets the bmpl_bnet nonce cookie", async () => {
    const { cookie } = member();
    const res = await fetch(u("/auth/bnet/start"), { ...noRedirect, headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://oauth.battle.net/authorize");
    expect(loc.searchParams.get("client_id")).toBe("bnet-test-client");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("scope")).toBe("wow.profile");
    expect(loc.searchParams.get("redirect_uri")).toBe("http://localhost/auth/bnet/callback");
    expect(loc.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = res.headers.getSetCookie().find((x) => x.startsWith("bmpl_bnet="))!;
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Path=/auth/bnet");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=600");
    expect(c).not.toContain("Secure"); // baseUrl is http in tests
  });
  test("needs a signed-in member", async () => {
    const res = await fetch(u("/auth/bnet/start"), noRedirect);
    expect(res.status).toBe(401);
  });
  test("a Discord state is not a Battle.net state (separate OAuthStates)", async () => {
    const { cookie } = member();
    const discord = await fetch(u("/auth/discord"), noRedirect);
    const dState = new URL(discord.headers.get("location")!).searchParams.get("state")!;
    const dNonce = cookieOf(discord, "bmpl_oauth")!.split("=")[1]!;
    const { cb } = await link(cookie, { state: dState, nonce: `bmpl_bnet=${dNonce}` });
    expect(codeOf(cb)).toBe("state");
  });
});

describe("GET /auth/bnet/callback", () => {
  test("full round trip: link and import stored, /me?bnet=pick, nonce cleared, audit bnet_link", async () => {
    const { cookie, user } = member();
    const { cb } = await link(cookie);
    expect(codeOf(cb)).toBe("pick");
    expect(nonceCleared(cb)).toBe(true);
    expect(db.bnet.link.get(user.id)).toMatchObject({ userId: user.id, accountId: fake.accountId, battletag: "Tom#1234", removed: [] });
    const imp = db.bnet.imports.get(user.id, Date.now())!;
    expect(imp.candidates.map((c) => `${c.region}:${c.name}`)).toEqual(["eu:Aelinora", "us:Brannoc", "eu:Thornwick", "us:Zephyrine", "eu:Pebblet"]);
    const row = db.audit.list({ actions: ["bnet_link"], before: null, limit: 1 })[0]!;
    expect(row).toMatchObject({ userId: user.id, detail: null }); // no BattleTag in the audit log (decision 8)
    // The settings are untouched until the pick.
    expect(db.settings.get(user.id).characters).toEqual([]);
  });
  test("cancelled at Battle.net (?error=access_denied)", async () => {
    const { cookie, user } = member();
    const { cb } = await link(cookie, { query: "error=access_denied&state=x" });
    expect(codeOf(cb)).toBe("cancelled");
    expect(nonceCleared(cb)).toBe(true);
    expect(db.bnet.link.get(user.id)).toBeNull();
  });
  test("state: no session, no nonce cookie, no code, a replayed state", async () => {
    const { cookie, user } = member();
    // No session: the nonce alone is not enough.
    const start = await fetch(u("/auth/bnet/start"), { ...noRedirect, headers: { cookie } });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const nonce = cookieOf(start, "bmpl_bnet")!;
    const anon = await fetch(u(`/auth/bnet/callback?code=${CODE}&state=${encodeURIComponent(state)}`), { ...noRedirect, headers: { cookie: nonce } });
    expect(codeOf(anon)).toBe("state");
    expect(nonceCleared(anon)).toBe(true);
    // No nonce cookie.
    expect(codeOf((await link(cookie, { nonce: null })).cb)).toBe("state");
    // No code.
    const noCode = await link(cookie, { query: "state=abc" });
    expect(codeOf(noCode.cb)).toBe("state");
    // A state used once cannot be used again.
    const first = await link(cookie);
    expect(codeOf(first.cb)).toBe("pick");
    const replay = await fetch(u(`/auth/bnet/callback?code=${CODE}&state=${encodeURIComponent(first.state)}`), { ...noRedirect, headers: { cookie: `${cookie}; ${first.nonce}` } });
    expect(codeOf(replay)).toBe("state");
    expect(db.bnet.link.get(user.id)).not.toBeNull();
  });
  test("scope: the token was granted without wow.profile, or a region answers 403", async () => {
    const { cookie, user } = member();
    fake.scope = "openid";
    expect(codeOf((await link(cookie)).cb)).toBe("scope");
    reset();
    fake.regions.us = 403;
    expect(codeOf((await link(cookie)).cb)).toBe("scope");
    expect(db.bnet.link.get(user.id)).toBeNull();
    expect(db.bnet.imports.get(user.id, Date.now())).toBeNull();
  });
  test("down: the token endpoint fails or a region answers 500; nothing stored", async () => {
    const { cookie, user } = member();
    fake.tokenStatus = 500;
    expect(codeOf((await link(cookie)).cb)).toBe("down");
    reset();
    fake.regions.kr = 503;
    const { cb } = await link(cookie);
    expect(codeOf(cb)).toBe("down");
    expect(nonceCleared(cb)).toBe(true);
    expect(db.bnet.link.get(user.id)).toBeNull();
    expect(db.bnet.imports.get(user.id, Date.now())).toBeNull();
  });
  test("taken: the account is linked to another member; audit login_denied, nothing stored", async () => {
    const owner = member();
    db.bnet.link.put(owner.user.id, "777777", "Owner#1", Date.now());
    const { cookie, user } = member();
    fake.accountId = "777777";
    const { cb } = await link(cookie);
    expect(codeOf(cb)).toBe("taken");
    expect(db.bnet.link.get(user.id)).toBeNull();
    expect(db.bnet.imports.get(user.id, Date.now())).toBeNull();
    const row = db.audit.list({ actions: ["login_denied"], before: null, limit: 1 })[0]!;
    expect(row).toMatchObject({ userId: user.id, target: `user ${owner.user.id}`, detail: { reason: "bnet_taken" } });
    // The owner relinking the same account is not "taken".
    fake.accountId = "777777";
    expect(codeOf((await link(owner.cookie)).cb)).toBe("pick");
  });
  test("linking a different account drops the first account's characters, which another member can then link", async () => {
    const a = member();
    fake.accountId = "555111";
    expect(codeOf((await link(a.cookie)).cb)).toBe("pick");
    expect((await fetch(u("/api/bnet/characters"), json(a.cookie, "PUT", { picks: [{ region: "eu", bnetId: 70000101 }] }))).status).toBe(200);
    expect(db.settings.get(a.user.id).characters.map((c) => c.bnetId)).toEqual([70000101]);
    // A links another account that has no characters: the first account's characters leave A's list.
    fake.accountId = "555222";
    fake.regions = { eu: 404, us: 404, kr: 404, tw: 404 };
    expect(codeOf((await link(a.cookie)).cb)).toBe("empty");
    expect(db.bnet.link.get(a.user.id)?.accountId).toBe("555222");
    expect(db.settings.get(a.user.id).characters).toEqual([]);
    // The first account is free again, and only its new holder owns its characters.
    const b = member();
    reset();
    fake.accountId = "555111";
    expect(codeOf((await link(b.cookie)).cb)).toBe("pick");
    expect((await fetch(u("/api/bnet/characters"), json(b.cookie, "PUT", { picks: [{ region: "eu", bnetId: 70000101 }] }))).status).toBe(200);
    expect(db.settings.get(b.user.id).characters.map((c) => c.bnetId)).toEqual([70000101]);
    expect(db.settings.get(a.user.id).characters).toEqual([]);
  });
  test("the state works only for the member who started: another member's session is refused", async () => {
    const a = member();
    const start = await fetch(u("/auth/bnet/start"), { ...noRedirect, headers: { cookie: a.cookie } });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const nonce = cookieOf(start, "bmpl_bnet")!;
    const b = member();
    const cb = await fetch(u(`/auth/bnet/callback?code=${CODE}&state=${encodeURIComponent(state)}`), { ...noRedirect, headers: { cookie: `${b.cookie}; ${nonce}` } });
    expect(codeOf(cb)).toBe("state");
    expect(db.bnet.link.get(b.user.id)).toBeNull();
    expect(db.bnet.link.get(a.user.id)).toBeNull();
  });
  test("taken when another member links the same account while the regions are read (no 500)", async () => {
    const other = member();
    const { cookie, user } = member();
    fake.accountId = "666333";
    // The EU answer arrives after another member linked the account.
    const eu = profiles.eu;
    profiles.eu = new Proxy(eu as object, { get(t, k) { if (k === "wow_accounts" && !db.bnet.link.get(other.user.id)) db.bnet.link.put(other.user.id, "666333", null, Date.now()); return Reflect.get(t, k); } });
    try {
      const { cb } = await link(cookie);
      expect(codeOf(cb)).toBe("taken");
      expect(nonceCleared(cb)).toBe(true);
    } finally {
      profiles.eu = eu;
    }
    expect(db.bnet.link.get(user.id)).toBeNull();
    expect(db.bnet.link.byAccount("666333")).toBe(other.user.id);
  });
  test("empty: no character in any region; the link is stored, no import", async () => {
    const { cookie, user } = member();
    fake.regions = { eu: 404, us: 404, kr: 404, tw: 404 };
    expect(codeOf((await link(cookie)).cb)).toBe("empty");
    expect(db.bnet.link.get(user.id)?.accountId).toBe(fake.accountId);
    expect(db.bnet.imports.get(user.id, Date.now())).toBeNull();
  });
  test("no code, token or client secret in the audit log, the error ring or the console", async () => {
    const { cookie } = member();
    const since = Date.now();
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
    try {
      fake.regions.tw = 500;
      expect(codeOf((await link(cookie)).cb)).toBe("down");
      fake.regions.tw = 404;
      fake.scope = "openid";
      expect(codeOf((await link(cookie)).cb)).toBe("scope");
    } finally {
      console.error = orig;
    }
    expect(logged).toEqual(["bnet link: down", "bnet link: scope"]);
    const errors = getHostedRuntime()!.errors.list({ since, limit: 50 });
    expect(errors.map((e) => e.target)).toEqual(["bnet callback", "bnet callback"]);
    const audit = db.audit.list({ actions: null, before: null, limit: 500 });
    const all = JSON.stringify([getHostedRuntime()!.errors.list({ since: null, limit: 500 }), audit, logged]);
    for (const secret of [CODE, USER_TOKEN, TEST_HOSTED_CONFIG.bnetClientSecret]) expect(all).not.toContain(secret);
  });
});

describe("GET /api/bnet", () => {
  test("nothing linked, then the link and the import", async () => {
    const { cookie, user } = member();
    expect(await (await fetch(u("/api/bnet"), { headers: { cookie } })).json()).toEqual({ ok: true, link: null, removed: [], import: null });
    await link(cookie);
    db.bnet.removed.add(user.id, ["Gone-Realm"]);
    const body = await (await fetch(u("/api/bnet"), { headers: { cookie } })).json();
    expect(body).toMatchObject({ ok: true, link: { battletag: "Tom#1234", linkedAt: expect.any(Number) }, removed: ["Gone-Realm"], import: { createdAt: expect.any(Number) } });
    expect(body.import.candidates).toHaveLength(5);
    expect(body.link.accountId).toBeUndefined(); // the account id stays server-side
  });
  test("needs a signed-in member", async () => {
    expect((await fetch(u("/api/bnet"))).status).toBe(401);
  });
});

describe("PUT /api/bnet/characters", () => {
  test("writes the picks in order as bnet entries, deletes the import, clears removed", async () => {
    const { cookie, user } = member();
    await link(cookie);
    db.bnet.removed.add(user.id, ["Gone-Realm"]);
    const before = Date.now();
    const res = await fetch(u("/api/bnet/characters"), json(cookie, "PUT", { picks: [{ region: "us", bnetId: 80000202 }, { region: "eu", bnetId: 70000101 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.settings.characters).toEqual([
      { name: "Zephyrine", realm: "ironhollow", region: "us", source: "bnet", bnetId: 80000202, verifiedAt: expect.any(Number) },
      { name: "Thornwick", realm: "silverbough", region: "eu", source: "bnet", bnetId: 70000101, verifiedAt: expect.any(Number) },
    ]);
    expect(body.settings.characters[0].verifiedAt).toBeGreaterThanOrEqual(before);
    expect(db.settings.get(user.id).characters).toEqual(body.settings.characters);
    expect(db.bnet.imports.get(user.id, Date.now())).toBeNull();
    expect(db.bnet.link.get(user.id)?.removed).toEqual([]);
  });
  test("410 when the import is missing or expired", async () => {
    const { cookie, user } = member();
    const none = await fetch(u("/api/bnet/characters"), json(cookie, "PUT", { picks: [{ region: "eu", bnetId: 1 }] }));
    expect(none.status).toBe(410);
    expect(await none.json()).toMatchObject({ ok: false, error: "bnet_import_expired" });
    await link(cookie);
    raw.query("UPDATE bnet_imports SET created_at = ? WHERE user_id = ?").run(Date.now() - BNET_IMPORT_TTL_MS - 1000, user.id);
    const old = await fetch(u("/api/bnet/characters"), json(cookie, "PUT", { picks: [{ region: "eu", bnetId: 70000101 }] }));
    expect(old.status).toBe(410);
  });
  test("400 for a pick outside the import (same id, other region), nothing written", async () => {
    const { cookie, user } = member();
    await link(cookie);
    const res = await fetch(u("/api/bnet/characters"), json(cookie, "PUT", { picks: [{ region: "eu", bnetId: 70000101 }, { region: "us", bnetId: 70000102 }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "bnet_unknown_character" });
    expect(db.settings.get(user.id).characters).toEqual([]);
    expect(db.bnet.imports.get(user.id, Date.now())).not.toBeNull();
  });
  test("400 for an invalid body (empty, 21 picks, unknown field)", async () => {
    const { cookie } = member();
    await link(cookie);
    for (const body of [{ picks: [] }, { picks: Array.from({ length: 21 }, (_, i) => ({ region: "eu", bnetId: i + 1 })) }, { picks: [{ region: "eu", bnetId: 70000101, name: "x" }] }, { picks: [{ region: "cn", bnetId: 1 }] }]) {
      expect((await fetch(u("/api/bnet/characters"), json(cookie, "PUT", body))).status).toBe(400);
    }
  });
});

describe("DELETE /api/bnet", () => {
  test("removes the link, the import and the bnet characters; audit bnet_unlink", async () => {
    const { cookie, user } = member();
    await link(cookie);
    await fetch(u("/api/bnet/characters"), json(cookie, "PUT", { picks: [{ region: "eu", bnetId: 70000101 }] }));
    await link(cookie); // a fresh import, pending
    db.settings.update(user.id, { yourKey: 12 }, Date.now());
    const res = await fetch(u("/api/bnet"), json(cookie, "DELETE"));
    expect(await res.json()).toEqual({ ok: true });
    expect(db.bnet.link.get(user.id)).toBeNull();
    expect(db.bnet.imports.get(user.id, Date.now())).toBeNull();
    expect(db.settings.get(user.id)).toMatchObject({ characters: [], yourKey: 12 });
    const row = db.audit.list({ actions: ["bnet_unlink"], before: null, limit: 1 })[0]!;
    expect(row.userId).toBe(user.id);
  });
});

describe("DELETE /api/me", () => {
  test("leaves no user_bnet or bnet_imports row (cascade)", async () => {
    const { cookie, user } = member();
    await link(cookie);
    const count = (table: string) => raw.query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(user.id)!.n;
    expect(count("user_bnet")).toBe(1);
    expect(count("bnet_imports")).toBe(1);
    const res = await fetch(u("/api/me"), json(cookie, "DELETE"));
    expect(await res.json()).toEqual({ ok: true });
    expect(count("user_bnet")).toBe(0);
    expect(count("bnet_imports")).toBe(0);
  });
});
