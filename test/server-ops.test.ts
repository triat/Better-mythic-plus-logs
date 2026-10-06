// Read-only ops routes (spec 2026-10-05-ops-read-access-design.md): bearer token, GET only, no
// identifying data — end to end through the hosted server. Never reaches WCL.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/hosted/config.ts";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { ErrorRing } from "../src/hosted/error-ring.ts";
import type { HostedRuntime } from "../src/hosted/runtime.ts";
import { runServer } from "../src/server.ts";
import { cacheKey } from "../src/server-history.ts";
import { opsRoutes, opsTokenMatches } from "../src/server/routes-ops.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

const TOKEN = "Zq8vN3kP0rT6wY1bC4eH7jL2mQ5sU9xAopsTestToken";
const bearer = (t = TOKEN): RequestInit => ({ headers: { authorization: `Bearer ${t}` } });

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let member: ReturnType<typeof loginAs>;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const savedCreds = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };

beforeAll(async () => {
  process.env.WCL_CLIENT_ID = "test";
  process.env.WCL_CLIENT_SECRET = "test";
  dir = mkdtempSync(join(tmpdir(), "bmpl-ops-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({
    port: 0,
    open: false,
    hosted: true,
    hostedConfig: { ...TEST_HOSTED_CONFIG, opsTokenSha256: sha256Hex(TOKEN) },
    rateLimits: { security: { limit: 2, windowMs: 60_000 } },
    assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }),
  });
  db = openHosted((await getStore())._db);
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

describe("token", () => {
  test("opsTokenMatches: exact bearer only", () => {
    const h = sha256Hex(TOKEN);
    expect(opsTokenMatches(`Bearer ${TOKEN}`, h)).toBe(true);
    expect(opsTokenMatches(`Bearer ${TOKEN}x`, h)).toBe(false);
    expect(opsTokenMatches(TOKEN, h)).toBe(false);
    expect(opsTokenMatches(`bearer ${TOKEN}`, h)).toBe(false);
    expect(opsTokenMatches(null, h)).toBe(false);
  });
  test("no token configured: no routes at all", () => {
    expect(opsRoutes({ config: { ...TEST_HOSTED_CONFIG, opsTokenSha256: null } } as HostedRuntime)).toEqual([]);
  });
  test("no header or a wrong token: 401, audited as ops_denied (throttled per IP); a session cookie is not enough", async () => {
    const before = db.audit.list({ actions: ["ops_denied"], before: null, limit: 50 }).length;
    for (const init of [{}, bearer("wrong-token"), { headers: { cookie: member.cookie } }]) {
      const r = await fetch(u("/api/ops/status"), init);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ ok: false, error: "Unauthorized" });
    }
    const rows = db.audit.list({ actions: ["ops_denied"], before: null, limit: 50 });
    expect(rows.length - before).toBe(2); // the security limiter allows 2 rows per IP per window
    expect(rows[0]!.target).toBe("GET /api/ops/status");
    expect(JSON.stringify(rows)).not.toContain("wrong-token");
  });
  test("GET only", async () => {
    expect((await fetch(u("/api/ops/status"), { method: "POST", ...bearer() })).status).toBe(404);
  });
});

describe("routes", () => {
  test("status: version, uptime, masked env", async () => {
    const r = await (await fetch(u("/api/ops/status"), bearer())).json();
    expect(r.ok).toBe(true);
    expect(typeof r.version).toBe("string");
    expect(r.env.find((e: { key: string }) => e.key === "BMPL_OPS_TOKEN").value).toBe("•••• (set)");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(TEST_HOSTED_CONFIG.sessionSecret);
  });
  test("an uncaught error: its stack in /logs, its audit row in /errors, without ip, Discord id or username", async () => {
    // Same trick as server-hardening.test.ts: a stored payload that is not JSON makes the history read throw.
    const request = { character: "Corrupt-Realm", level: 10, spec: null, metric: null, region: "eu" as const };
    const key = cacheKey(request);
    (await getStore())._db.run(
      "INSERT INTO user_history (user_id, key, request, payload, label, char_class, spec, target_level, target_auto, fetched_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [member.user.id, key, JSON.stringify(request), "x", "Corrupt", 1, null, 10, 0, Date.now(), 1],
    );
    const since = Date.now() - 1;
    expect((await fetch(u(`/api/history/${encodeURIComponent(key)}`), { headers: { cookie: member.cookie } })).status).toBe(500);

    const logs = await (await fetch(u(`/api/ops/logs?since=${since}`), bearer())).json();
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].target).toBe(`GET /api/history/${encodeURIComponent(key)}`);
    expect(logs.entries[0].message).toContain("JSON Parse error");
    expect(logs.entries[0].stack).toContain("history.ts");

    const errors = await (await fetch(u(`/api/ops/errors?since=${since}`), bearer())).json();
    expect(errors.rows).toHaveLength(1);
    expect(errors.rows[0]).toMatchObject({ action: "server_error", user: `user#${member.user.id}` });
    const all = JSON.stringify([logs, errors]);
    expect(all).not.toContain("127.0.0.1");
    expect(all).not.toContain("123456789012345678");
    expect(all).not.toContain('"tom"');
    expect(Object.keys(errors.rows[0]).sort()).toEqual(["action", "at", "detail", "id", "target", "user"]);
  });
  test("bad paging parameters: 400", async () => {
    for (const q of ["since=abc", "limit=0", "limit=999", "before=0"]) {
      expect((await fetch(u(`/api/ops/errors?${q}`), bearer())).status).toBe(400);
    }
    expect((await fetch(u("/api/ops/logs?since=-1"), bearer())).status).toBe(400);
  });
});

describe("ErrorRing", () => {
  test("keeps the newest `size` entries, newest first, filtered by `since`, stack clipped", () => {
    const ring = new ErrorRing(3);
    for (let i = 1; i <= 5; i++) ring.push(new Error(`e${i}`), `GET /${i}`, i * 1000);
    ring.push("not an error", null, 6000);
    expect(ring.list({ since: null, limit: 10 }).map((e) => e.message)).toEqual(["not an error", "e5", "e4"]);
    expect(ring.list({ since: 5000, limit: 10 }).map((e) => e.at)).toEqual([6000, 5000]);
    expect(ring.list({ since: null, limit: 1 })).toEqual([{ at: 6000, target: null, message: "not an error", stack: null }]);
    expect(ring.list({ since: null, limit: 10 })[1]!.stack).toContain("Error: e5");
  });
});
