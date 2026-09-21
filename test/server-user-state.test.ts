import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { cacheKey } from "../src/server-history.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { payloadWith } from "./evaluation/helpers.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let hosted: Awaited<ReturnType<typeof runServer>>;
let local: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let a: ReturnType<typeof loginAs>;
let b: ReturnType<typeof loginAs>;
const savedCreds = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET, region: process.env.BMPL_REGION };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-user-state-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "");
  writeFileSync(join(dir, "assets", "app.css"), "");
  writeFileSync(join(dir, "wh-config.js"), "const whTooltips = {};");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  // Dummy credentials: hasCredentials() must pass for /api/lookup, and a cache miss (a bug in this
  // plan) then fails at WCL OAuth instead of spending points.
  process.env.WCL_CLIENT_ID = "bmpl-test";
  process.env.WCL_CLIENT_SECRET = "bmpl-test";
  process.env.BMPL_REGION = "eu"; // the instance default the region tests below assume
  const assets = async () => ({
    index: join(dir, "index.html"),
    appJs: join(dir, "assets", "app.js"),
    appCss: join(dir, "assets", "app.css"),
    whConfigJs: join(dir, "wh-config.js"),
  });
  hosted = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets });
  local = await runServer({ port: 0, open: false, hosted: false, assets });
  db = openHosted((await getStore())._db);
  a = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "200000000000000001", role: "member" });
  b = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "200000000000000002", role: "member" });
});
afterAll(() => {
  hosted.stop(true);
  local.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  if (savedCreds.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedCreds.id;
  if (savedCreds.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedCreds.secret;
  if (savedCreds.region === undefined) delete process.env.BMPL_REGION; else process.env.BMPL_REGION = savedCreds.region;
  rmSync(dir, { recursive: true, force: true });
});

const h = (p: string) => `http://localhost:${hosted.port}${p}`;
const l = (p: string) => `http://localhost:${local.port}${p}`;
const as = (who: { cookie: string }, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), cookie: who.cookie, "Content-Type": "application/json" } });

/** A payload attachDeepdive accepts: no runs, so it only re-runs the evaluation and yields `deepdive: []`. */
const seedPayload = (name: string) => ({ ...payloadWith([]), character: { name, classID: 7, spec: "Holy" }, deepdive: [] });
const request = (character: string, level: number | null) => ({ character, level, spec: null, metric: null, region: "eu" as const });

describe("per-user history (hosted)", () => {
  test("a user's entries are invisible to another user; lists, reads, deletes and clears are scoped", async () => {
    const key = db.history.forUser(a.user.id).record(request("Muleyoxo-Silvermoon", 21), {
      result: seedPayload("Muleyoxo"), label: "Muleyoxo-Silvermoon", charClass: 7, spec: "Holy", targetLevel: 21, targetAutoDetected: false,
    }).key;
    expect(key).toBe(cacheKey(request("Muleyoxo-Silvermoon", 21)));
    const mine = await (await fetch(h("/api/history"), as(a))).json();
    expect(mine.items.map((i: { key: string }) => i.key)).toEqual([key]);
    const theirs = await (await fetch(h("/api/history"), as(b))).json();
    expect(theirs.items).toEqual([]);
    expect((await fetch(h(`/api/history/${encodeURIComponent(key)}`), as(b))).status).toBe(404);
    expect((await (await fetch(h(`/api/history/${encodeURIComponent(key)}`), as(b, { method: "DELETE" }))).json()).ok).toBe(false);
    expect((await fetch(h("/api/history"), as(b, { method: "DELETE" }))).status).toBe(200);
    expect((await (await fetch(h("/api/history"), as(a))).json()).items.length).toBe(1);
  });

  test("a hosted read attaches today's analyses (0 pts) — stored payloads stay raw", async () => {
    const key = cacheKey(request("Muleyoxo-Silvermoon", 21));
    const res = await fetch(h(`/api/history/${encodeURIComponent(key)}`), as(a));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(true);
    expect(body.result.deepdive).toEqual([]);
    expect(body.result.deepdiveSummary.analyzedRuns).toBe(0);
    expect(typeof body.result.evaluation.verdict).toBe("string");
  });

  test("the same character costs one WCL fetch: A's own hit, then B inherits it as a cache hit", async () => {
    const own = await (await fetch(h("/api/lookup"), as(a, { method: "POST", body: JSON.stringify({ character: "Muleyoxo-Silvermoon", level: 21 }) }))).json();
    expect(own.ok).toBe(true);
    expect(own.fromCache).toBe(true);
    expect(own.result.deepdive).toEqual([]);
    const inherited = await (await fetch(h("/api/lookup"), as(b, { method: "POST", body: JSON.stringify({ character: "Muleyoxo-Silvermoon", level: 21 }) }))).json();
    expect(inherited.ok).toBe(true);
    expect(inherited.fromCache).toBe(true);
    expect(inherited.key).toBe(own.key);
    const theirs = await (await fetch(h("/api/history"), as(b))).json();
    expect(theirs.items.map((i: { key: string }) => i.key)).toEqual([own.key]);
  });

  test("POST /api/lookup: region validated, defaults to the instance region, stored on the history item", async () => {
    const bad = await fetch(h("/api/lookup"), as(a, { method: "POST", body: JSON.stringify({ character: "Muleyoxo-Silvermoon", region: "cn" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("region");
    // No region in the body: the instance default (eu) keys the request, so the seeded entry is a hit.
    const own = await (await fetch(h("/api/lookup"), as(a, { method: "POST", body: JSON.stringify({ character: "Muleyoxo-Silvermoon", level: 21 }) }))).json();
    expect(own.fromCache).toBe(true);
    expect(own.request).toEqual(request("Muleyoxo-Silvermoon", 21));
    const mine = await (await fetch(h("/api/history"), as(a))).json();
    expect(mine.items.map((i: { request: { region: string } }) => i.request.region)).toEqual(["eu"]);
  });

  test("history survives a server restart", async () => {
    hosted.stop(true);
    const assets = async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets", "app.js"), appCss: join(dir, "assets", "app.css"), whConfigJs: join(dir, "wh-config.js") });
    hosted = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets });
    const mine = await (await fetch(h("/api/history"), as(a))).json();
    expect(mine.items.length).toBe(1);
  });

  test("local mode still serves the process-wide history without a session", async () => {
    expect((await fetch(l("/api/history"))).status).toBe(200);
    expect((await (await fetch(l("/api/history"))).json()).items).toEqual([]);
  });
});

describe("/api/settings (hosted)", () => {
  const put = (who: { cookie: string }, body: unknown) => fetch(h("/api/settings"), as(who, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));

  test("401 without a session; defaults for a fresh user", async () => {
    expect((await fetch(h("/api/settings"))).status).toBe(401);
    expect((await fetch(h("/api/settings"), { method: "PUT", body: "{}" })).status).toBe(401);
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: true } });
  });

  test("PUT merges partial patches per user", async () => {
    expect(await (await put(a, { yourKey: 22 })).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: true } });
    expect(await (await put(a, { legendOpen: false })).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: false } });
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: false } });
    expect(await (await fetch(h("/api/settings"), as(b))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: true } });
    expect(await (await put(a, { yourKey: null })).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: false } });
  });

  test("PUT validates its body", async () => {
    for (const body of ["not json", {}, { yourKey: 1 }, { yourKey: 41 }, { yourKey: "18" }, { yourKey: 18.5 }, { legendOpen: "yes" }, { other: 1 }]) {
      const res = await put(a, body);
      expect(res.status).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: false } });
  });

  test("local mode does not register the settings routes", async () => {
    expect((await fetch(l("/api/settings"))).status).toBe(404);
    expect((await fetch(l("/api/settings"), { method: "PUT", body: "{}" })).status).toBe(404);
  });
});

describe("/api/me quota (hosted)", () => {
  test("/api/me carries the quota: members have a limit, admins do not", async () => {
    const me = await (await fetch(h("/api/me"), as(a))).json();
    expect(me.quota).toEqual({ used: 0, limit: 300, resetInS: me.quota.resetInS });
    expect(me.quota.resetInS).toBeGreaterThan(0);
  });
});

// `HostedDb.usage` has no delete API, so `db.usage.add` below permanently raises `a`'s usage for this
// hour; these tests must stay last in the file (nothing after them may assume `a` is under quota).
describe("quota on the hosted routes", () => {
  test("a cached lookup carries pointsSpent 0 and the caller's quota", async () => {
    const res = await fetch(h("/api/lookup"), as(a, { method: "POST", body: JSON.stringify({ character: "Muleyoxo-Silvermoon", level: 21 }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pointsSpent).toBe(0);
    expect(typeof body.quota.used).toBe("number");
    expect(body.quota.limit).toBe(300);
    expect(body.quota.resetInS).toBeGreaterThan(0);
  });

  test("a reserve refusal answers 429 with the caller's quota before any WCL fetch", async () => {
    db.usage.add(a.user.id, Date.now(), 300);
    const res = await fetch(h("/api/lookup"), as(a, { method: "POST", body: JSON.stringify({ character: "Nobodyhere-Silvermoon", level: 15 }) }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "quota", message: body.message, used: 300, limit: 300, resetInS: body.resetInS });
    expect(body.message).toContain("Hourly quota reached");
    expect(typeof body.resetInS).toBe("number");
  });

  test("a deep-dive on an uncached run 404s before the quota gate is even consulted (still at 300/300)", async () => {
    // Using `b`'s character here would reach WCL (a cache miss) — the point of this test is that the
    // cache check in runDeepdive precedes the reserve, so `a`, already over quota, still gets a plain
    // 404 rather than a 429.
    const res = await fetch(h("/api/deepdive"), as(a, { method: "POST", body: JSON.stringify({ reportCode: "NOPE", fightID: 1, character: "X" }) }));
    expect(res.status).toBe(404);
  });
});
