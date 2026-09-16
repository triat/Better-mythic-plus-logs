import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDefensives } from "../src/deepdive/table.ts";
import { runServer } from "../src/server.ts";
import { closeStore } from "../src/signals/store.ts";

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-dd-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "");
  writeFileSync(join(dir, "assets", "app.css"), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  process.env.BMPL_DEFENSIVES = join(dir, "defensives.json");
  resetDefensives();
  server = await runServer({ port: 0, open: false, assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets", "app.js"), appCss: join(dir, "assets", "app.css") }) });
});
afterAll(() => {
  server.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  delete process.env.BMPL_DEFENSIVES;
  resetDefensives();
  rmSync(dir, { recursive: true, force: true });
});

const url = (p: string) => `http://localhost:${server.port}${p}`;
const post = (p: string, body: unknown) => fetch(url(p), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/deepdive", () => {
  test("400 on a bad body, 404 when the run is not cached (no network)", async () => {
    expect((await post("/api/deepdive", {})).status).toBe(400);
    const res = await post("/api/deepdive", { reportCode: "NOPE", fightID: 1, character: "X" });
    // Without credentials the server answers 400 before touching the store; with them, 404.
    expect([400, 404]).toContain(res.status);
    expect((await res.json()).ok).toBe(false);
  });
});

describe("/api/defensives", () => {
  test("GET returns the effective table with origins", async () => {
    const res = await fetch(url("/api/defensives?class=Paladin&spec=Holy"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.key).toBe("Paladin:Holy");
    expect(j.tableMissing).toBe(false);
    expect(j.entries.find((e: { id: number }) => e.id === 498).origin).toBe("shipped");
    expect(j.overridePath).toBe(join(dir, "defensives.json"));
    expect((await fetch(url("/api/defensives?class=Paladin"))).status).toBe(400);
  });
  test("POST writes the override, returns the new table; bad patch → 400", async () => {
    const res = await post("/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 498, cooldownS: 45 } });
    expect(res.status).toBe(200);
    const j = await res.json();
    const dp = j.entries.find((e: { id: number }) => e.id === 498);
    expect(dp.cooldownS).toBe(45);
    expect(dp.origin).toBe("override");
    const file = JSON.parse(await Bun.file(join(dir, "defensives.json")).text());
    expect(file["Paladin:Holy"]).toEqual([{ id: 498, cooldownS: 45 }]);
    const ignore = await post("/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 642, ignore: true } });
    expect((await ignore.json()).ignored).toEqual([642]);
    const bad = await post("/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 424242, cooldownS: 1 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/424242/);
  });
});
