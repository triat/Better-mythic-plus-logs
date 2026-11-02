// Members' feedback (canvas "bmpl · Retours"): general messages, a verdict judged per character and level, the admin
// list. Never reaches WCL.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
let member: ReturnType<typeof loginAs>;
let quiet: ReturnType<typeof loginAs>;
let admin: ReturnType<typeof loginAs>;
const u = (p: string) => `http://localhost:${server.port}${p}`;
const json = (method: string, body: unknown, cookie?: string): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const VERDICT = { region: "eu", realm: "ysondre", name: "vachâman", level: 16, label: "Vachâman-Ysondre", verdict: "invite", score: 78 };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-feedback-"));
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG });
  db = openHosted((await getStore())._db);
  member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
  quiet = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345679", role: "member", username: "shy" });
  admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "111111111111111111", role: "admin", username: "boss" });
});
afterAll(() => {
  server.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("feedback", () => {
  test("a general message: signed in only, validated, then the invitation knows it was sent", async () => {
    expect((await fetch(u("/api/feedback"), json("POST", { kind: "idea", message: "x", replyOk: true }))).status).toBe(401);
    expect((await fetch(u("/api/feedback"), json("POST", { kind: "rant", message: "x", replyOk: true }, member.cookie))).status).toBe(400);
    expect((await fetch(u("/api/feedback"), json("POST", { kind: "idea", message: "  ", replyOk: true }, member.cookie))).status).toBe(400);
    expect((await (await fetch(u("/api/feedback"), { headers: { cookie: member.cookie } })).json()).sentGeneral).toBe(false);
    const r = await fetch(u("/api/feedback"), json("POST", { kind: "idea", message: "Two key levels side by side", replyOk: true, page: "candidate" }, member.cookie));
    expect(r.status).toBe(200);
    expect((await fetch(u("/api/feedback"), json("POST", { kind: "problem", message: "Slow", replyOk: false }, quiet.cookie))).status).toBe(200);
    expect((await (await fetch(u("/api/feedback"), { headers: { cookie: member.cookie } })).json()).sentGeneral).toBe(true);
  });
  test("a verdict judged: one per member, character and level, replaced by a later answer", async () => {
    const put = (body: unknown) => fetch(u("/api/feedback/verdict"), json("PUT", body, member.cookie));
    expect((await put({ ...VERDICT, rating: "meh" })).status).toBe(400);
    expect((await put({ ...VERDICT, rating: "unfair", reason: "generous", message: "Dies on packs" })).status).toBe(200);
    const q = `/api/feedback?region=eu&realm=ysondre&name=${encodeURIComponent("vachâman")}&level=16`;
    expect((await (await fetch(u(q), { headers: { cookie: member.cookie } })).json()).verdict).toMatchObject({ rating: "unfair", reason: "generous", message: "Dies on packs" });
    // "fair" drops the reason.
    await put({ ...VERDICT, name: "VACHÂMAN", rating: "fair", reason: "harsh" });
    expect((await (await fetch(u(q), { headers: { cookie: member.cookie } })).json()).verdict).toMatchObject({ rating: "fair", reason: null });
    expect((await (await fetch(u(q.replace("level=16", "level=17")), { headers: { cookie: member.cookie } })).json()).verdict).toBeNull();
  });
  test("admin list: newest first, the Discord name only when the member agreed, read marks; members are refused", async () => {
    expect((await fetch(u("/api/admin/feedback"), { headers: { cookie: member.cookie } })).status).toBe(403);
    const body = await (await fetch(u("/api/admin/feedback"), { headers: { cookie: admin.cookie } })).json();
    expect(body.rows.map((r: { kind: string }) => r.kind)).toEqual(["verdict", "problem", "idea"]);
    expect(body.unread).toBe(3);
    const [verdict, problem, idea] = body.rows;
    expect(idea).toMatchObject({ username: "tom", replyOk: true, message: "Two key levels side by side", context: { page: "candidate" } });
    expect(problem).toMatchObject({ username: null, discordId: null, replyOk: false });
    expect(verdict).toMatchObject({ rating: "fair", context: { label: "Vachâman-Ysondre", verdict: "invite", score: 78 } });
    const r = await (await fetch(u(`/api/admin/feedback/${idea.id}/read`), { method: "POST", headers: { cookie: admin.cookie } })).json();
    expect(r.unread).toBe(2);
  });
  test("deleting the account deletes its feedback", () => {
    db.users.delete(quiet.user.id);
    expect(db.feedback.list(10).some((r) => r.userId === quiet.user.id)).toBe(false);
  });
});
