import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { loadWclFixture } from "./fixtures.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let local: Awaited<ReturnType<typeof runServer>>;
let hosted: Awaited<ReturnType<typeof runServer>>;
let member: ReturnType<typeof loginAs>;
const saved = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-season-"));
  mkdirSync(join(dir, "assets"));
  for (const [p, c] of [["index.html", "<!doctype html>"], ["assets/app.js", ""], ["assets/app.css", ""], ["wh-config.js", ""]]) writeFileSync(join(dir, p!), c!);
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  // Dummy credentials: nothing below may reach WCL; a regression fails at OAuth instead of spending points.
  process.env.WCL_CLIENT_ID = "bmpl-test";
  process.env.WCL_CLIENT_SECRET = "bmpl-test";
  const assets = async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") });
  local = await runServer({ port: 0, open: false, hosted: false, assets });
  hosted = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets });
  const store = await getStore();
  member = loginAs(openHosted(store._db), TEST_HOSTED_CONFIG.sessionSecret, { discordId: "300000000000000001", role: "member" });
  const f = await loadWclFixture("s2-healer");
  const key = { region: "eu", realm: "silvermoon", name: "Muleyoxo" };
  store.upsertSeasonRuns(key, 55, "hps", [{ ...f.run }, { ...f.run, reportCode: "UNFETCHED", fightID: 2, startTime: f.run.startTime + 1000 }]);
  store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
});
afterAll(() => {
  local.stop(true);
  hosted.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  if (saved.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = saved.id;
  if (saved.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = saved.secret;
  rmSync(dir, { recursive: true, force: true });
});

const l = (p: string) => `http://localhost:${local.port}${p}`;
const h = (p: string) => `http://localhost:${hosted.port}${p}`;

describe("GET /api/season", () => {
  test("the stored season, analysed from the cache", async () => {
    const r = await fetch(l("/api/season?name=Muleyoxo&realm=silvermoon&region=eu&level=21"));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.season.runs.map((x: { reportCode: string; analysed: boolean }) => [x.reportCode, x.analysed]))
      .toEqual([["UNFETCHED", false], [expect.any(String), true]]);
    // The analysed run lacks crowd control (3 pts), the other lacks everything (10 + 3), plus the rankings (20).
    expect(body.season.state).toEqual({ runs: 2, analysed: 1, pending: 2, controlOnly: 1, failed: 0, estimate: 36 });
  });
  test("an unknown character has no season; bad parameters are a 400", async () => {
    expect((await (await fetch(l("/api/season?name=Nobody&realm=silvermoon&region=eu"))).json()).season).toBeNull();
    expect((await fetch(l("/api/season?name=M&realm=silvermoon&region=eu"))).status).toBe(400);
    expect((await fetch(l("/api/season?name=Muleyoxo&realm=silvermoon&region=xx"))).status).toBe(400);
  });
  test("hosted: signed-in only", async () => {
    expect((await fetch(h("/api/season?name=Muleyoxo&realm=silvermoon&region=eu"))).status).toBe(401);
    expect((await fetch(h("/api/season?name=Muleyoxo&realm=silvermoon&region=eu"), { headers: { cookie: member.cookie } })).status).toBe(200);
  });
});

describe("POST /api/season/sync", () => {
  const sync = (cookie: string) => fetch(h("/api/season/sync"), {
    method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Muleyoxo", realm: "silvermoon", region: "eu" }),
  });
  test("hosted, a character outside the member's list: refused before any WCL call", async () => {
    const r = await sync(member.cookie);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("not_your_character");
  });
  test("hosted without an own WCL client: refused before any WCL call", async () => {
    const store = await getStore();
    openHosted(store._db).settings.update(member.user.id, { characters: [{ name: "Muleyoxo", realm: "silvermoon", region: "eu", source: "manual" }] }, Date.now());
    const r = await fetch(h("/api/season/sync"), {
      method: "POST", headers: { cookie: member.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Muleyoxo", realm: "silvermoon", region: "eu" }),
    });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("own_client_required");
  });
  test("the body is validated", async () => {
    const r = await fetch(l("/api/season/sync"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Muleyoxo" }) });
    expect(r.status).toBe(400);
  });
});
