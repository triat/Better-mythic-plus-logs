// The WCL account link's measurement gate (spec docs/superpowers/specs/2026-10-26-wcl-account-link-design.md,
// decision 1): admin only, a state bound to the admin and the nonce cookie, PKCE in the authorize URL. The success
// path (token exchange and probe) is covered by test/hosted/wcl-link.test.ts with fake endpoints: here it would
// reach WCL through the instance client.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

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
  dir = mkdtempSync(join(tmpdir(), "bmpl-wcl-link-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG,
    fetchFn: (async () => new Response("unexpected", { status: 500 })) as unknown as typeof fetch,
    rateLimits: { auth: { limit: 1_000, windowMs: 60_000 } },
    assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js"), geistWoff2: join(dir, "fonts/Geist-Variable.woff2"), geistMonoWoff2: join(dir, "fonts/GeistMono-Variable.woff2") }),
  });
  db = openHosted((await getStore())._db);
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

describe("WCL account link: the measurement gate", () => {
  test("start: admins only; a 302 to WCL's authorize page with PKCE, the nonce and verifier in an HttpOnly cookie", async () => {
    const member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "400000000000000001", role: "member" });
    expect((await fetch(u("/auth/wcl/start"), { ...noRedirect, headers: { cookie: member.cookie } })).status).toBe(403);
    const admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "400000000000000002", role: "admin" });
    const res = await fetch(u("/auth/wcl/start"), { ...noRedirect, headers: { cookie: admin.cookie } });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe("https://www.warcraftlogs.com/oauth/authorize");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${TEST_HOSTED_CONFIG.baseUrl}/auth/wcl/callback`);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    const set = res.headers.getSetCookie().find((c) => c.startsWith("bmpl_wcl="))!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Path=/auth/wcl");
  });

  test("callback: a member, an unknown state, a stolen nonce or WCL's refusal answer an error and clear the cookie", async () => {
    const admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "400000000000000003", role: "admin" });
    const other = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "400000000000000004", role: "admin" });
    const member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "400000000000000005", role: "member" });
    const start = await fetch(u("/auth/wcl/start"), { ...noRedirect, headers: { cookie: admin.cookie } });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const nonce = cookieOf(start, "bmpl_wcl")!;
    const call = (cookie: string, query: string) => fetch(u(`/auth/wcl/callback?${query}`), { ...noRedirect, headers: { cookie } });
    expect((await call(`${member.cookie}; ${nonce}`, `code=c&state=${state}`)).status).toBe(403);
    expect((await call(`${admin.cookie}; ${nonce}`, "code=c&state=nope")).status).toBe(400);
    // Another admin's session with this admin's nonce: the state is bound to the admin who started.
    expect((await call(`${other.cookie}; ${nonce}`, `code=c&state=${state}`)).status).toBe(400);
    const refused = await call(`${admin.cookie}; ${nonce}`, "error=access_denied");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ ok: false, error: "Warcraft Logs answered: access_denied" });
    expect(refused.headers.getSetCookie().some((c) => c.startsWith("bmpl_wcl=;") && c.includes("Max-Age=0"))).toBe(true);
  });
});
