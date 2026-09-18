import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED } from "../src/deepdive/table.ts";
import { hourStart, openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { propose } from "../src/hosted/defensives.ts";
import { runServer } from "../src/server.ts";
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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-admin-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }) });
  db = openHosted((await getStore())._db);
  admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "111111111111111111", role: "admin", username: "boss" });
  member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

describe("admin gate", () => {
  test("member → 403, anonymous → 401", async () => {
    const r = await fetch(u("/api/admin/invites"), { headers: { cookie: member.cookie } });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: "admin only" });
    expect((await fetch(u("/api/admin/invites"))).status).toBe(401);
  });
});

describe("invites", () => {
  test("add, list, remove", async () => {
    const add = await fetch(u("/api/admin/invites"), json("POST", { discordId: "222222222222222222", note: "guild" }, admin.cookie));
    expect(add.status).toBe(200);
    const body = await add.json();
    expect(body.invite).toMatchObject({ discordId: "222222222222222222", invitedBy: "admin:" + admin.user.id, note: "guild" });
    const list = await (await fetch(u("/api/admin/invites"), { headers: { cookie: admin.cookie } })).json();
    expect(list.invites.map((i: { discordId: string }) => i.discordId)).toEqual(["222222222222222222"]);
    expect((await fetch(u("/api/admin/invites"), json("POST", { discordId: "abc" }, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/invites"), json("POST", {}, admin.cookie))).status).toBe(400);
    expect(await (await fetch(u("/api/admin/invites/222222222222222222"), { method: "DELETE", headers: { cookie: admin.cookie } })).json()).toEqual({ ok: true, sessionsEnded: 0 });
    expect(await (await fetch(u("/api/admin/invites/222222222222222222"), { method: "DELETE", headers: { cookie: admin.cookie } })).json()).toEqual({ ok: false, sessionsEnded: 0 });
  });
});

describe("users", () => {
  test("list shows both users with avatar urls", async () => {
    const r = await (await fetch(u("/api/admin/users"), { headers: { cookie: admin.cookie } })).json();
    expect(r.users.map((x: { username: string; role: string }) => [x.username, x.role]).sort()).toEqual([["boss", "admin"], ["tom", "member"]]);
    expect(r.users[0].avatarUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\//);
  });
  test("role change: promote, demote, cannot change self, unknown id, bad role", async () => {
    const promote = await fetch(u(`/api/admin/users/${member.user.id}/role`), json("POST", { role: "admin" }, admin.cookie));
    expect(promote.status).toBe(200);
    expect((await promote.json()).user.role).toBe("admin");
    expect(db.users.byId(member.user.id)!.role).toBe("admin");
    const demote = await fetch(u(`/api/admin/users/${member.user.id}/role`), json("POST", { role: "member" }, admin.cookie));
    expect((await demote.json()).user.role).toBe("member");
    expect((await fetch(u(`/api/admin/users/${admin.user.id}/role`), json("POST", { role: "member" }, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/users/9999/role"), json("POST", { role: "admin" }, admin.cookie))).status).toBe(404);
    expect((await fetch(u(`/api/admin/users/${member.user.id}/role`), json("POST", { role: "god" }, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/users/abc/role"), json("POST", { role: "admin" }, admin.cookie))).status).toBe(400);
  });
  test("a config admin's role cannot be changed through the API", async () => {
    const configAdmin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "444444444444444444", role: "admin", username: "root2" });
    const res = await fetch(u(`/api/admin/users/${configAdmin.user.id}/role`), json("POST", { role: "member" }, admin.cookie));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "role is set by BMPL_ADMIN_DISCORD_IDS" });
    expect(db.users.byId(configAdmin.user.id)!.role).toBe("admin");
  });
});

describe("removing an invite", () => {
  test("ends the invited user's sessions", async () => {
    await fetch(u("/api/admin/invites"), json("POST", { discordId: "333333333333333333" }, admin.cookie));
    const third = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "333333333333333333", role: "member", username: "third" });
    expect((await fetch(u("/api/me"), { headers: { cookie: third.cookie } })).status).toBe(200);
    const del = await fetch(u("/api/admin/invites/333333333333333333"), { method: "DELETE", headers: { cookie: admin.cookie } });
    expect(await del.json()).toEqual({ ok: true, sessionsEnded: 1 });
    expect((await fetch(u("/api/me"), { headers: { cookie: third.cookie } })).status).toBe(401);
  });
});

describe("GET /api/admin/usage", () => {
  test("members are refused; admins get the gauge data", async () => {
    expect((await fetch(u("/api/admin/usage"), { headers: { cookie: member.cookie } })).status).toBe(403);
    db.usage.add(member.user.id, Date.now(), 12.5);
    const res = await fetch(u("/api/admin/usage"), { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.limitPerUser).toBe(300);
    expect(body.hourStart).toBe(hourStart(Date.now()));
    expect(body.resetInS).toBeGreaterThan(0);
    expect(body.instance).toBeNull(); // no WCL call has been observed in this process
    expect(body.users).toEqual([{ userId: member.user.id, discordId: member.user.discordId, username: member.user.username, role: "member", points: 12.5 }]);
    expect(body.hours).toEqual([{ hourStart: hourStart(Date.now()), points: 12.5 }]);
  });
});

describe("/api/me quota", () => {
  test("/api/me for an admin has limit null", async () => {
    const me = await (await fetch(u("/api/me"), { headers: { cookie: admin.cookie } })).json();
    expect(me.quota.limit).toBeNull();
  });
});

describe("users: points, sessions, revoke", () => {
  test("rows carry this hour's and 24 h points, the live session count and the config-admin flag", async () => {
    const now = Date.now();
    db.usage.add(member.user.id, now - 5 * 3600_000, 40);
    db.usage.add(member.user.id, now, 7.5);
    const r = await (await fetch(u("/api/admin/users"), { headers: { cookie: admin.cookie } })).json();
    const tom = r.users.find((x: { username: string }) => x.username === "tom");
    const thisHour = db.usage.byUser(now).find((x) => x.userId === member.user.id)?.points ?? 0; // the usage test above added 12.5 too
    expect(tom.pointsHour).toBe(thisHour);
    expect(tom.points24h).toBe(thisHour + 40);
    expect(tom.sessions).toBe(1);
    expect(tom.configAdmin).toBe(false);
    expect(r.users.find((x: { username: string }) => x.username === "boss").configAdmin).toBe(true);
  });
  test("revoke ends the user's sessions; self and unknown ids are refused", async () => {
    const r = await fetch(u(`/api/admin/users/${member.user.id}/sessions/revoke`), json("POST", undefined, admin.cookie));
    expect(await r.json()).toEqual({ ok: true, sessionsEnded: 1 });
    expect((await fetch(u("/api/me"), { headers: { cookie: member.cookie } })).status).toBe(401);
    expect((await fetch(u(`/api/admin/users/${admin.user.id}/sessions/revoke`), json("POST", undefined, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/users/9999/sessions/revoke"), json("POST", undefined, admin.cookie))).status).toBe(404);
    member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
  });
});

describe("invites carry the user who signed in", () => {
  test("user is null until the id signs in", async () => {
    await fetch(u("/api/admin/invites"), json("POST", { discordId: "123456789012345678", note: "tom" }, admin.cookie));
    await fetch(u("/api/admin/invites"), json("POST", { discordId: "777777777777777777" }, admin.cookie));
    const list = (await (await fetch(u("/api/admin/invites"), { headers: { cookie: admin.cookie } })).json()).invites;
    expect(list.find((i: { discordId: string }) => i.discordId === "123456789012345678").user).toEqual({ id: member.user.id, username: "tom" });
    expect(list.find((i: { discordId: string }) => i.discordId === "777777777777777777").user).toBeNull();
  });
});

describe("proposals carry the current entry", () => {
  test("current is the shared/shipped entry for the spell, null for an unknown id; ignored reflects the shared layer", async () => {
    const now = Date.now();
    propose(db.defensives, { id: member.user.id, role: "member" }, "Paladin", "Holy", { id: 498, cooldownS: 45 }, now);
    propose(db.defensives, { id: member.user.id, role: "member" }, "Paladin", "Holy", { id: 424242, name: "Made up", kind: "minor", cooldownS: 30, durationS: 5 }, now);
    const r = await (await fetch(u("/api/admin/proposals"), { headers: { cookie: admin.cookie } })).json();
    const shipped = SHIPPED.specs["Paladin:Holy"]!.find((e) => e.id === 498)!;
    const p498 = r.proposals.find((p: { spellId: number }) => p.spellId === 498);
    expect(p498.current).toEqual(shipped);
    expect(p498.ignored).toBe(false);
    const pNew = r.proposals.find((p: { spellId: number }) => p.spellId === 424242);
    expect(pNew.current).toBeNull();
    expect(pNew.key).toBe("Paladin:Holy");
  });
});

describe("GET /api/admin/instance", () => {
  test("version, uptime, db size, no backup file, masked env", async () => {
    expect((await fetch(u("/api/admin/instance"), { headers: { cookie: member.cookie } })).status).toBe(403);
    const r = await (await fetch(u("/api/admin/instance"), { headers: { cookie: admin.cookie } })).json();
    expect(r.ok).toBe(true);
    expect(typeof r.version).toBe("string");
    expect(r.uptimeS).toBeGreaterThanOrEqual(0);
    expect(r.dbPath.endsWith("bmpl.db")).toBe(true);
    expect(r.dbBytes).toBeGreaterThan(0);
    expect(r.lastBackupAt).toBeNull();
    expect(r.env.map((e: { key: string }) => e.key)).toEqual(["BMPL_BASE_URL", "BMPL_DISCORD_CLIENT_ID", "BMPL_DISCORD_CLIENT_SECRET", "BMPL_SESSION_SECRET", "BMPL_ADMIN_DISCORD_IDS", "BMPL_POINTS_PER_USER_HOUR", "WCL_CLIENT_ID", "WCL_CLIENT_SECRET"]);
    expect(JSON.stringify(r)).not.toContain(TEST_HOSTED_CONFIG.sessionSecret);
    expect(JSON.stringify(r)).not.toContain(TEST_HOSTED_CONFIG.discordClientSecret);
  });
});
