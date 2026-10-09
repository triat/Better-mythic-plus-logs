// Feature usage end to end through the hosted server (spec 2026-10-09-feature-usage-dashboard-design.md):
// POST /api/usage/events, API events recorded by the dispatcher, GET /api/admin/features and
// GET /api/ops/features. Never reaches WCL.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/hosted/config.ts";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { USAGE_BATCH_MAX_COUNT, USAGE_BATCH_MAX_NAMES, USAGE_EVENTS } from "../src/hosted/usage-catalog.ts";
import { apiEventFor, runServer } from "../src/server.ts";
import { parseUsageEvents } from "../src/server/routes-user.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

const TOKEN = "Zq8vN3kP0rT6wY1bC4eH7jL2mQ5sU9xAusageTestToken";
let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let admin: ReturnType<typeof loginAs>;
let member: ReturnType<typeof loginAs>;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const json = (method: string, body?: unknown, cookie?: string): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const features = async (q = "", cookie = admin.cookie) => (await fetch(u(`/api/admin/features${q}`), { headers: { cookie } })).json();
const uses = (r: { features: Array<{ event: string; uses: number }> }, e: string) => r.features.find((f) => f.event === e)!.uses;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-usage-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0, open: false, hosted: true, hostedConfig: { ...TEST_HOSTED_CONFIG, opsTokenSha256: sha256Hex(TOKEN) },
    rateLimits: { usage: { limit: 5, windowMs: 60_000 } },
    assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }),
  });
  db = openHosted((await getStore())._db);
  admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "111111111111111111", role: "admin", username: "boss" });
  member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

describe("parseUsageEvents", () => {
  test("keeps interface events, drops unknown and api names, rejects bad shapes", () => {
    expect(parseUsageEvents({ axis_expand: 2, lookup: 1, old_name: 3 })).toEqual({ ok: true, events: [["axis_expand", 2]], dropped: 2 });
    expect(parseUsageEvents([]).ok).toBe(false);
    expect(parseUsageEvents({}).ok).toBe(false);
    expect(parseUsageEvents({ axis_expand: 0 }).ok).toBe(false);
    expect(parseUsageEvents({ axis_expand: 1.5 }).ok).toBe(false);
    expect(parseUsageEvents({ axis_expand: USAGE_BATCH_MAX_COUNT + 1 }).ok).toBe(false);
    expect(parseUsageEvents(Object.fromEntries(Array.from({ length: USAGE_BATCH_MAX_NAMES + 1 }, (_, i) => [`e${i}`, 1]))).ok).toBe(false);
  });
});

describe("apiEventFor", () => {
  test("maps the body-independent routes, nothing else", () => {
    expect(apiEventFor("GET", "/api/history/abc")).toBe("history_open");
    expect(apiEventFor("DELETE", "/api/history/abc")).toBe("history_close");
    expect(apiEventFor("DELETE", "/api/history")).toBe("history_clear");
    expect(apiEventFor("GET", "/api/history")).toBeNull();
    expect(apiEventFor("POST", "/api/live/cached")).toBe("live_roster");
    expect(apiEventFor("PUT", "/api/settings")).toBe("settings_save");
    expect(apiEventFor("POST", "/api/lookup")).toBeNull(); // recorded by its handler
    expect(apiEventFor("GET", "/api/admin/features")).toBeNull();
  });
});

describe("POST /api/usage/events", () => {
  test("records a member's interface events; anonymous is 401; bad body 400", async () => {
    const r = await fetch(u("/api/usage/events"), json("POST", { events: { axis_expand: 3, compare_open: 1, ghost: 2 } }, member.cookie));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, recorded: 2, dropped: 1 });
    expect((await fetch(u("/api/usage/events"), json("POST", { events: { axis_expand: 1 } }))).status).toBe(401);
    expect((await fetch(u("/api/usage/events"), json("POST", { events: [] }, member.cookie))).status).toBe(400);
    expect((await fetch(u("/api/usage/events"), json("POST", {}, member.cookie))).status).toBe(400);
    const f = await features();
    expect(uses(f, "axis_expand")).toBe(3);
    expect(uses(f, "compare_open")).toBe(1);
  });
  test("is rate-limited per member", async () => {
    const other = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345679", role: "member", username: "bob" });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await fetch(u("/api/usage/events"), json("POST", { events: { help_link: 1 } }, other.cookie))).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("API events from the dispatcher", () => {
  test("a successful settings save and history clear count; a refused one does not", async () => {
    const before = await features();
    expect((await fetch(u("/api/settings"), json("PUT", { yourKey: 18 }, member.cookie))).status).toBe(200);
    expect((await fetch(u("/api/settings"), json("PUT", {}, member.cookie))).status).toBe(400);
    expect((await fetch(u("/api/history"), json("DELETE", undefined, member.cookie))).status).toBe(200);
    const after = await features();
    expect(uses(after, "settings_save") - uses(before, "settings_save")).toBe(1);
    expect(uses(after, "history_clear") - uses(before, "history_clear")).toBe(1);
  });
});

describe("GET /api/admin/features", () => {
  test("admin only; validates the query; lists every catalogue entry with top members", async () => {
    expect((await fetch(u("/api/admin/features"), { headers: { cookie: member.cookie } })).status).toBe(403);
    expect((await fetch(u("/api/admin/features?days=14"), { headers: { cookie: admin.cookie } })).status).toBe(400);
    const r = await features("?days=7");
    expect(r).toMatchObject({ ok: true, days: 7, includeAdmins: false });
    expect(r.features).toHaveLength(USAGE_EVENTS.length);
    const axis = r.features.find((f: { event: string }) => f.event === "axis_expand");
    expect(axis.top[0]).toMatchObject({ userId: member.user.id, username: "tom", uses: 3 });
  });
  test("an admin's own events count only with admins=1", async () => {
    await fetch(u("/api/usage/events"), json("POST", { events: { page_admin: 1 } }, admin.cookie));
    expect(uses(await features(), "page_admin")).toBe(0);
    expect(uses(await features("?admins=1"), "page_admin")).toBe(1);
  });
});

describe("GET /api/ops/features", () => {
  test("bearer only; same counts, no member named", async () => {
    expect((await fetch(u("/api/ops/features"))).status).toBe(401);
    const r = await (await fetch(u("/api/ops/features"), { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    expect(uses(r, "axis_expand")).toBe(3);
    const text = JSON.stringify(r);
    expect(text).not.toContain("tom");
    expect(text).not.toContain("userId");
    expect(r.features.every((f: { top: unknown[] }) => f.top.length === 0)).toBe(true);
  });
});
