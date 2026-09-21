// Hosted hardening (issue #9): Origin / Sec-Fetch-Site refusals, in-app rate limits, secrets hygiene
// and the bare "Internal error" of an uncaught throw — end to end through the hosted server.
// Never reaches WCL: the only /api/lookup calls send invalid bodies (400 before any fetch).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { cacheKey } from "../src/server-history.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let admin: ReturnType<typeof loginAs>;
let member: ReturnType<typeof loginAs>;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const json = (method: string, body?: unknown, cookie?: string): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const savedCreds = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };

beforeAll(async () => {
  process.env.WCL_CLIENT_ID = "test";
  process.env.WCL_CLIENT_SECRET = "test";
  dir = mkdtempSync(join(tmpdir(), "bmpl-hardening-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  writeFileSync(join(dir, ".env"), "WCL_CLIENT_SECRET=do-not-serve\n");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0,
    open: false,
    hosted: true,
    hostedConfig: TEST_HOSTED_CONFIG,
    rateLimits: { auth: { limit: 3, windowMs: 60_000 }, lookup: { limit: 2, windowMs: 60_000 } },
    assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }),
  });
  db = openHosted((await getStore())._db);
  admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "111111111111111111", role: "admin", username: "boss" });
  member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
});
afterAll(() => {
  server.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  if (savedCreds.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedCreds.id;
  if (savedCreds.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedCreds.secret;
  rmSync(dir, { recursive: true, force: true });
});

const audit = async (query: string) => (await fetch(u(`/api/admin/audit?${query}`), { headers: { cookie: admin.cookie } })).json();

describe("origin check", () => {
  test("cross-site POSTs are refused before auth, same-origin and header-less ones pass", async () => {
    const evil = await fetch(u("/api/settings"), { method: "PUT", headers: { cookie: member.cookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ ok: false, error: "Cross-site request refused" });
    expect(evil.headers.get("X-Content-Type-Options")).toBe("nosniff"); // refusals still get the security headers
    const fetchSite = await fetch(u("/api/settings"), { method: "PUT", headers: { cookie: member.cookie, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body: "{}" });
    expect(fetchSite.status).toBe(403);
    expect((await fetch(u("/api/settings"), { method: "PUT", headers: { cookie: member.cookie, "Content-Type": "application/json", Origin: TEST_HOSTED_CONFIG.baseUrl }, body: JSON.stringify({ legendOpen: false }) })).status).toBe(200);
    expect((await fetch(u("/api/settings"), { method: "PUT", headers: { cookie: member.cookie, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ legendOpen: true }) })).status).toBe(200);
    expect((await fetch(u("/api/settings"), json("PUT", { legendOpen: false }, member.cookie))).status).toBe(200); // no header at all
    // Public routes too, and before the auth gate: no cookie, still 403 rather than 401.
    const logout = await fetch(u("/auth/logout"), { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(logout.status).toBe(403);
    const r = await audit("kind=security");
    expect(r.rows[0]).toMatchObject({ action: "origin_rejected", userId: null, target: "POST /auth/logout", detail: { origin: "https://evil.example", fetchSite: null, why: "origin" } });
    expect(r.rows[1]).toMatchObject({ action: "origin_rejected", userId: null, target: "PUT /api/settings", detail: { origin: "", fetchSite: "cross-site", why: "fetch-site" } });
    expect(r.rows[2]).toMatchObject({ action: "origin_rejected", userId: null, target: "PUT /api/settings", detail: { origin: "https://evil.example", why: "origin" } });
  });
  test("the 403 is unconditional but the audit row is throttled: 7 cross-site POSTs from one IP → 7 × 403, 5 origin_rejected rows", async () => {
    const ip = "203.0.113.7"; // its own key: the earlier refusals of this file came from the socket peer
    const rowsFor = async () => ((await audit("kind=security&limit=200")).rows as { action: string; ip: string }[]).filter((r) => r.action === "origin_rejected" && r.ip === ip);
    expect(await rowsFor()).toHaveLength(0);
    for (let i = 0; i < 7; i++) {
      const r = await fetch(u("/auth/logout"), { method: "POST", headers: { Origin: "https://evil.example", "X-Forwarded-For": `1.2.3.4, ${ip}` } });
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ ok: false, error: "Cross-site request refused" });
    }
    const rows = await rowsFor();
    expect(rows).toHaveLength(5); // DEFAULT_RATE_LIMITS.security: 5 rows per IP per minute
    expect(rows[0]!.ip).toBe(ip); // the last X-Forwarded-For entry, not the client-prepended one
  });
  test("GET is never origin-checked", async () => {
    expect((await fetch(u("/api/me"), { headers: { cookie: member.cookie, Origin: "https://evil.example" } })).status).toBe(200);
    expect((await fetch(u("/api/me"), { headers: { cookie: member.cookie, "Sec-Fetch-Site": "cross-site" } })).status).toBe(200);
  });
});

describe("rate limits", () => {
  test("/auth/* per IP: the 4th hit in a minute is 429 with Retry-After and an audit row", async () => {
    for (let i = 0; i < 3; i++) expect((await fetch(u("/auth/discord"), { redirect: "manual" })).status).toBe(302);
    const r = await fetch(u("/auth/discord"), { redirect: "manual" });
    expect(r.status).toBe(429);
    const retryAfter = Number(r.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await r.json()).toEqual({ ok: false, error: `Too many requests — try again in ${retryAfter} s` });
    const a = await audit("kind=security&limit=1");
    expect(a.rows[0]).toMatchObject({ action: "rate_limited", userId: null, target: "GET /auth/discord", detail: { limit: 3, windowS: 60, retryAfterS: retryAfter } });
    expect(a.rows[0].ip).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/); // the socket peer (127.0.0.1, ::ffff:127.0.0.1 or ::1 depending on how localhost resolves); no X-Forwarded-For here
    // Only the first refusal of the burst is audited: 5 more 429s, still exactly one rate_limited row for this target.
    for (let i = 0; i < 5; i++) expect((await fetch(u("/auth/discord"), { redirect: "manual" })).status).toBe(429);
    const rows = ((await audit("kind=security&limit=200")).rows as { action: string; target: string }[]).filter((r) => r.action === "rate_limited" && r.target === "GET /auth/discord");
    expect(rows).toHaveLength(1);
  });
  test("/api/lookup per user: invalid bodies count, the 3rd is 429, another user is unaffected", async () => {
    const bad = () => fetch(u("/api/lookup"), json("POST", { nope: 1 }, member.cookie));
    expect((await bad()).status).toBe(400);
    expect((await bad()).status).toBe(400);
    const r = await bad();
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect((await fetch(u("/api/lookup"), json("POST", { nope: 1 }, admin.cookie))).status).toBe(400);
    const a = await audit("kind=security&limit=1");
    expect(a.rows[0]).toMatchObject({ action: "rate_limited", userId: member.user.id, target: "POST /api/lookup", detail: { limit: 2, windowS: 60 } });
  });
  test("an anonymous POST /api/lookup is 401, not counted against anyone", async () => {
    expect((await fetch(u("/api/lookup"), json("POST", { nope: 1 }))).status).toBe(401);
  });
});

describe("secrets hygiene", () => {
  test(".env and dotfiles are never served", async () => {
    for (const p of ["/.env", "/../.env", "/.git/config", "/bmpl.db", "/assets/../.env"]) {
      const r = await fetch(u(p));
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain("do-not-serve");
    }
  });
  test("the SSE endpoint is GET-only", async () => {
    expect((await fetch(u("/api/events"), { method: "POST", headers: { cookie: member.cookie } })).status).toBe(404);
  });
  test("a handler that throws answers a bare Internal error and logs server_error", async () => {
    // A stored payload that is not JSON makes the history read throw inside the handler
    // (`JSON.parse` in src/hosted/history.ts `entry()`), after the auth gate and inside the audit scope.
    const request = { character: "Corrupt-Realm", level: 10, spec: null, metric: null, region: "eu" as const };
    const key = cacheKey(request);
    (await getStore())._db.run(
      "INSERT INTO user_history (user_id, key, request, payload, label, char_class, spec, target_level, target_auto, fetched_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [member.user.id, key, JSON.stringify(request), "x", "Corrupt", 1, null, 10, 0, Date.now(), 1],
    );
    const r = await fetch(u(`/api/history/${encodeURIComponent(key)}`), { headers: { cookie: member.cookie } });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, error: "Internal error" });
    const a = await audit("kind=error&limit=1");
    expect(a.rows[0]).toMatchObject({ action: "server_error", userId: member.user.id, target: `GET /api/history/${encodeURIComponent(key)}` });
    expect(typeof a.rows[0].detail.message).toBe("string");
    expect(a.rows[0].detail.message).not.toContain(dir);
  });
});
