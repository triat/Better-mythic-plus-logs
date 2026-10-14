import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
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
    whConfigJs: join(dir, "wh-config.js"), geistWoff2: join(dir, "fonts/Geist-Variable.woff2"), geistMonoWoff2: join(dir, "fonts/GeistMono-Variable.woff2"),
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
    const assets = async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets", "app.js"), appCss: join(dir, "assets", "app.css"), whConfigJs: join(dir, "wh-config.js"), geistWoff2: join(dir, "fonts/Geist-Variable.woff2"), geistMonoWoff2: join(dir, "fonts/GeistMono-Variable.woff2") });
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
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: true, region: null, locale: null, liveSort: "arrival", liveRoles: ["tank", "healer", "dps"], liveClasses: [], characters: [], lastSeenVersion: null } });
  });

  test("PUT merges partial patches per user", async () => {
    const liveDefaults = { liveSort: "arrival", liveRoles: ["tank", "healer", "dps"], liveClasses: [], characters: [], lastSeenVersion: null };
    expect(await (await put(a, { yourKey: 22 })).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: true, region: null, locale: null, ...liveDefaults } });
    expect(await (await put(a, { legendOpen: false })).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: false, region: null, locale: null, ...liveDefaults } });
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: false, region: null, locale: null, ...liveDefaults } });
    expect(await (await fetch(h("/api/settings"), as(b))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: true, region: null, locale: null, ...liveDefaults } });
    expect(await (await put(a, { yourKey: null })).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: false, region: null, locale: null, ...liveDefaults } });
  });

  test("PUT validates its body", async () => {
    for (const body of ["not json", {}, { yourKey: 1 }, { yourKey: 41 }, { yourKey: "18" }, { yourKey: 18.5 }, { legendOpen: "yes" }, { region: "cn" }, { region: 1 }, { locale: "de" }, { locale: 1 }, { other: 1 }]) {
      const res = await put(a, body);
      expect(res.status).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toMatchObject({ ok: true, settings: { yourKey: null, legendOpen: false, region: null, locale: null } });
  });

  test("PUT /api/settings remembers the region; junk is refused; an old database gains the column", async () => {
    expect(await (await put(a, { region: "kr" })).json()).toMatchObject({ ok: true, settings: { yourKey: null, legendOpen: false, region: "kr", locale: null } });
    expect((await put(a, { region: "cn" })).status).toBe(400);
    expect(await (await put(a, { region: null })).json()).toMatchObject({ settings: { region: null } });
  });

  test("PUT /api/settings remembers the locale; junk is refused", async () => {
    expect(await (await put(a, { locale: "fr" })).json()).toMatchObject({ ok: true, settings: { yourKey: null, legendOpen: false, region: null, locale: "fr" } });
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toMatchObject({ settings: { locale: "fr" } });
    expect((await put(a, { locale: "de" })).status).toBe(400);
    expect(await (await put(a, { locale: null })).json()).toMatchObject({ settings: { locale: null } });
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
    expect(body).toEqual({ ok: false, error: "quota", message: body.message, used: 300, limit: 300, resetInS: body.resetInS, needed: 20 });
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

describe("PUT /api/settings — characters (Battle.net spec, decision 4)", () => {
  // Stored `bnet` entries are seeded through the db: hosted members' characters only come from the Battle.net import.
  const stored = (name: string, bnetId: number) => ({ name, realm: "hyjal", region: "eu" as const, source: "bnet" as const, bnetId, verifiedAt: 1_700_000_000_000 + bnetId });
  const seed = (...list: ReturnType<typeof stored>[]) => db.settings.update(a.user.id, { characters: list }, Date.now());
  const put = (characters: unknown[]) => fetch(h("/api/settings"), as(a, { method: "PUT", body: JSON.stringify({ characters }) }));
  const read = async () => (await (await fetch(h("/api/settings"), as(a))).json()).settings.characters;
  const refusal = { ok: false, error: "characters_from_bnet", message: "Characters come from your Battle.net account: link it on My characters." };

  test("removing one stored entry: 200", async () => {
    seed(stored("Biwaasham", 1), stored("Muleyoxo", 2));
    const r = await put([stored("Muleyoxo", 2)]);
    expect(r.status).toBe(200);
    expect(await read()).toEqual([stored("Muleyoxo", 2)]);
  });

  test("reordering: 200, order kept, bnetId and verifiedAt are the stored ones", async () => {
    seed(stored("Biwaasham", 1), stored("Muleyoxo", 2));
    // The front sends back what it received; a client-side change to bnetId/verifiedAt is ignored.
    const r = await put([{ ...stored("Muleyoxo", 2), bnetId: 99, verifiedAt: 5 }, { ...stored("biwaasham", 1), realm: "Hyjal" }]);
    expect(r.status).toBe(200);
    expect((await r.json()).settings.characters).toEqual([stored("Muleyoxo", 2), stored("Biwaasham", 1)]);
    expect(await read()).toEqual([stored("Muleyoxo", 2), stored("Biwaasham", 1)]);
  });

  test("adding a manual entry: 400 characters_from_bnet, list unchanged", async () => {
    seed(stored("Biwaasham", 1));
    const r = await put([stored("Biwaasham", 1), { name: "Noshiidk", realm: "draenor", region: "eu", source: "manual" }]);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual(refusal);
    expect(await read()).toEqual([stored("Biwaasham", 1)]);
  });

  test("adding a bnet entry that is not stored: 400", async () => {
    seed(stored("Biwaasham", 1));
    const r = await put([stored("Biwaasham", 1), stored("Muleyoxo", 2)]);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual(refusal);
    expect(await read()).toEqual([stored("Biwaasham", 1)]);
  });

  test("a twenty-first character is refused by validation", async () => {
    const list = Array.from({ length: 21 }, (_, i) => stored(`N${String.fromCharCode(97 + i)}`, i + 1));
    seed(...list.slice(0, 20));
    const r = await put(list);
    expect(r.status).toBe(400);
    expect((await r.json()).error).not.toBe("characters_from_bnet");
  });

  test("duplicates are dropped before storing, so the answer matches a later GET", async () => {
    seed(stored("Biwaasham", 1));
    const r = await put([stored("Biwaasham", 1), stored("biwaasham", 1)]);
    expect((await r.json()).settings.characters).toEqual([stored("Biwaasham", 1)]);
    expect(await read()).toEqual([stored("Biwaasham", 1)]);
  });
});


describe("a hosted read re-evaluates and syncs only the reader's history row", () => {
  let raw: Database;
  const row = (userId: number, key: string) =>
    raw.query<{ verdict: string | null; score: number | null }, [number, string]>("SELECT verdict, score FROM user_history WHERE user_id = ? AND key = ?").get(userId, key)!;
  // A row whose verdict/score went stale (written under older rules); the payload itself is unchanged.
  const setStale = (userId: number, key: string) =>
    raw.query("UPDATE user_history SET verdict = 'pass', score = 1.5 WHERE user_id = ? AND key = ?").run(userId, key);

  test("GET /api/history/:key and a lookup cache hit correct the caller's row, never another member's", async () => {
    raw = (await getStore())._db;
    const c = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "200000000000000031", role: "member" });
    const d = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "200000000000000032", role: "member" });
    const rec = { result: seedPayload("Staleo"), label: "Staleo-Silvermoon", charClass: 7, spec: "Holy", targetLevel: 19, targetAutoDetected: false };
    const key = db.history.forUser(c.user.id).record(request("Staleo-Silvermoon", 19), rec).key;
    db.history.forUser(d.user.id).record(request("Staleo-Silvermoon", 19), rec);
    setStale(c.user.id, key);
    setStale(d.user.id, key);

    const read = await (await fetch(h(`/api/history/${encodeURIComponent(key)}`), as(c))).json();
    expect(read.ok).toBe(true);
    const want = { verdict: read.result.evaluation.verdict === "insufficient" ? null : read.result.evaluation.verdict, score: read.result.evaluation.global };
    expect(row(c.user.id, key)).toEqual(want);
    expect(row(d.user.id, key)).toEqual({ verdict: "pass", score: 1.5 });
    const listed = await (await fetch(h("/api/history"), as(c))).json();
    expect(listed.items.map((i: { verdict: unknown; score: unknown }) => ({ verdict: i.verdict, score: i.score }))).toEqual([want]);

    // A hosted lookup served from history (dummy credentials, no fetch) syncs the same way, for its caller only.
    const hit = await (await fetch(h("/api/lookup"), as(d, { method: "POST", body: JSON.stringify({ character: "Staleo-Silvermoon", level: 19 }) }))).json();
    expect(hit.ok).toBe(true);
    expect(hit.fromCache).toBe(true);
    expect(row(d.user.id, key)).toEqual(want);
  });
});
