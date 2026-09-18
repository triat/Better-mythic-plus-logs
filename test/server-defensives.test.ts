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
let admin: ReturnType<typeof loginAs>;
let tom: ReturnType<typeof loginAs>;
let bob: ReturnType<typeof loginAs>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-def-hosted-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }) });
  db = openHosted((await getStore())._db);
  admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "111111111111111111", role: "admin", username: "boss" });
  tom = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
  bob = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345679", role: "member", username: "bob" });
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

const u = (p: string) => `http://localhost:${server.port}${p}`;
const get = (who: { cookie: string }, p: string) => fetch(u(p), { headers: { cookie: who.cookie } });
const post = (who: { cookie: string }, p: string, body?: unknown) =>
  fetch(u(p), { method: "POST", headers: { cookie: who.cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const HOLY = "/api/defensives?class=Paladin&spec=Holy";
const DP = 498;
const dp = async (who: { cookie: string }) => (await (await get(who, HOLY)).json()).entries.find((e: { id: number }) => e.id === DP);

describe("hosted defensives: proposals", () => {
  test("GET is per member: shipped entries, no path, an empty proposals list", async () => {
    const body = await (await get(tom, HOLY)).json();
    expect(body.ok).toBe(true);
    expect(body.overridePath).toBeNull();
    expect(body.proposals).toEqual([]);
    expect((await dp(tom))).toMatchObject({ cooldownS: 60, origin: "shipped" });
  });

  test("a member's POST creates a pending proposal that applies to them only", async () => {
    const r = await post(tom, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, cooldownS: 45 } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.proposal).toMatchObject({ spellId: DP, status: "pending", patch: { id: DP, cooldownS: 45 }, note: null });
    expect(body.entries.find((e: { id: number }) => e.id === DP)).toMatchObject({ cooldownS: 45, origin: "pending" });
    expect(await dp(tom)).toMatchObject({ cooldownS: 45, origin: "pending" });
    expect(await dp(bob)).toMatchObject({ cooldownS: 60, origin: "shipped" });
    const mine = await (await get(tom, HOLY)).json();
    expect(mine.proposals.map((p: { status: string }) => p.status)).toEqual(["pending"]);
  });

  test("a second POST for the same spell merges into the same proposal", async () => {
    const first = (await (await get(tom, HOLY)).json()).proposals[0].id;
    const r = await (await post(tom, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, durationS: 9 } })).json();
    expect(r.proposal.id).toBe(first);
    expect(r.proposal.patch).toEqual({ id: DP, cooldownS: 45, durationS: 9 });
  });

  test("invalid patches are 400 with the validator's message", async () => {
    const r = await post(tom, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 999999, cooldownS: 30 } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/999999/);
  });

  test("moderation is admin-only; approval publishes the correction to everyone", async () => {
    expect((await get(tom, "/api/admin/proposals")).status).toBe(403);
    const list = await (await get(admin, "/api/admin/proposals")).json();
    expect(list.proposals).toHaveLength(1);
    expect(list.proposals[0]).toMatchObject({ key: "Paladin:Holy", spellId: DP, status: "pending", username: "tom", proposedBy: tom.user.id });
    expect((await get(admin, "/api/admin/proposals?status=nope")).status).toBe(400);
    const id = list.proposals[0].id;
    const ok = await post(admin, `/api/admin/proposals/${id}/approve`, { note: "matches the tooltip" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).proposal).toMatchObject({ id, status: "approved", note: "matches the tooltip" });
    expect(await dp(bob)).toMatchObject({ cooldownS: 45, durationS: 9, origin: "shared" });
    expect(await dp(tom)).toMatchObject({ cooldownS: 45, durationS: 9, origin: "shared" });
    expect((await post(admin, `/api/admin/proposals/${id}/approve`)).status).toBe(404);
    expect((await post(admin, "/api/admin/proposals/abc/approve")).status).toBe(400);
    expect((await (await get(admin, "/api/admin/proposals?status=approved")).json()).proposals).toHaveLength(1);
  });

  test("rejection drops the author's correction and leaves the note in their proposals", async () => {
    const r = await (await post(bob, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, ignore: true } })).json();
    expect(await dp(bob)).toBeUndefined();
    const rej = await post(admin, `/api/admin/proposals/${r.proposal.id}/reject`, { note: "Divine Protection is a real defensive" });
    expect(rej.status).toBe(200);
    expect(await dp(bob)).toMatchObject({ cooldownS: 45, origin: "shared" });
    const mine = await (await get(bob, HOLY)).json();
    expect(mine.proposals[0]).toMatchObject({ status: "rejected", note: "Divine Protection is a real defensive" });
  });

  test("an admin's POST is approved on the spot", async () => {
    const r = await (await post(admin, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, cooldownS: 50 } })).json();
    expect(r.proposal.status).toBe("approved");
    expect(await dp(tom)).toMatchObject({ cooldownS: 50, origin: "shared" });
  });

  test("a non-string className is 400, not 500", async () => {
    const r = await post(tom, "/api/defensives", { className: 5, spec: "Holy", patch: { id: 642, cooldownS: 61 } });
    expect(r.status).toBe(400);
  });

  test("a rejection note over 500 chars is truncated to 500 in storage", async () => {
    const proposed = await (await post(bob, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 642, cooldownS: 61 } })).json();
    const id = proposed.proposal.id;
    const long = "x".repeat(600);
    const rej = await post(admin, `/api/admin/proposals/${id}/reject`, { note: long });
    expect(rej.status).toBe(200);
    const rejected = await (await get(admin, "/api/admin/proposals?status=rejected")).json();
    const stored = rejected.proposals.find((p: { id: number }) => p.id === id);
    expect(stored.note.length).toBe(500);
  });

  test("a whitespace-only note stores as null on approve and reject", async () => {
    const proposed1 = await (await post(bob, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 642, cooldownS: 62 } })).json();
    const approved = await post(admin, `/api/admin/proposals/${proposed1.proposal.id}/approve`, { note: "   " });
    expect(approved.status).toBe(200);
    expect((await approved.json()).proposal.note).toBeNull();

    const proposed2 = await (await post(bob, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 642, cooldownS: 63 } })).json();
    const rejected = await post(admin, `/api/admin/proposals/${proposed2.proposal.id}/reject`, { note: "   " });
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).proposal.note).toBeNull();
  });
});
