import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEvalConfig, loadConfig } from "../src/evaluation/config.ts";
import { runServer } from "../src/server.ts";
import { docsResponse } from "../src/server/routes-shared.ts";
import { closeStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG } from "./hosted/helpers.ts";

const savedCreds = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;

beforeAll(async () => {
  process.env.WCL_CLIENT_ID = "bmpl-test";
  process.env.WCL_CLIENT_SECRET = "bmpl-test";
  dir = mkdtempSync(join(tmpdir(), "bmpl-docs-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "");
  writeFileSync(join(dir, "assets", "app.css"), "");
  writeFileSync(join(dir, "wh-config.js"), "");
  server = await runServer({
    port: 0,
    open: false,
    assets: async () => ({
      index: join(dir, "index.html"),
      appJs: join(dir, "assets", "app.js"),
      appCss: join(dir, "assets", "app.css"),
      whConfigJs: join(dir, "wh-config.js"),
    }),
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  if (savedCreds.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedCreds.id;
  if (savedCreds.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedCreds.secret;
});

const u = (p: string) => `http://localhost:${server.port}${p}`;

describe("GET /api/docs", () => {
  test("public, local mode; registry keys match the effective config", async () => {
    const r = await fetch(u("/api/docs"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b.hosted).toBe(false);
    expect(b.quota).toEqual({ pointsPerUserHour: null, wclPointsPerHour: 3600 });
    for (const k of Object.keys(b.config.axes)) {
      expect(Object.keys(b.docs.axes[k].subSignals).sort()).toEqual(Object.keys(b.config.axes[k].subSignals).sort());
    }
    expect(b.config.verdict).toEqual((await getEvalConfig()).verdict);
    expect(typeof b.defensives.version).toBe("string");
    expect(b.season).toBe(Object.keys(b.config.expectedIlvl).at(-1));
    expect(JSON.stringify(b)).not.toContain(process.env.WCL_CLIENT_ID!);
  });

  test("served body equals docsResponse(effective config, false)", async () => {
    const b = await (await fetch(u("/api/docs"))).json();
    const expected = JSON.parse(JSON.stringify(docsResponse(await getEvalConfig(), false)));
    expect(b).toEqual(expected);
  });

  test("docsResponse reflects an evaluation.json override", async () => {
    const overrideDir = mkdtempSync(join(tmpdir(), "bmpl-docs-override-"));
    const overridePath = join(overrideDir, "evaluation.json");
    writeFileSync(overridePath, JSON.stringify({ verdict: { invite: 80 } }));
    const { config } = await loadConfig(overridePath);
    const overridden = docsResponse(config, false);
    expect(overridden.config.verdict.invite).toBe(80);
    const { config: baseConfig } = await loadConfig(null);
    const baseline = docsResponse(baseConfig, false);
    expect(overridden.config.version).not.toBe(baseline.config.version);
    rmSync(overrideDir, { recursive: true, force: true });
  });

  test("/help is served as an SPA entry point", async () => {
    expect((await fetch(u("/help"))).status).toBe(200);
  });
});

describe("GET /api/docs (hosted, anonymous)", () => {
  let hdir: string;
  let hserver: Awaited<ReturnType<typeof runServer>>;

  beforeAll(async () => {
    hdir = mkdtempSync(join(tmpdir(), "bmpl-docs-hosted-"));
    mkdirSync(join(hdir, "assets"));
    for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(hdir, f), "");
    closeStore();
    process.env.BMPL_DB_PATH = join(hdir, "bmpl.db");
    hserver = await runServer({
      port: 0,
      open: false,
      hosted: true,
      hostedConfig: TEST_HOSTED_CONFIG,
      assets: async () => ({
        index: join(hdir, "index.html"),
        appJs: join(hdir, "assets/app.js"),
        appCss: join(hdir, "assets/app.css"),
        whConfigJs: join(hdir, "wh-config.js"),
      }),
    });
  });
  afterAll(() => {
    hserver.stop(true);
    closeStore();
    delete process.env.BMPL_DB_PATH;
    rmSync(hdir, { recursive: true, force: true });
  });

  test("anonymous request succeeds and reports hosted: true", async () => {
    const url = `http://localhost:${hserver.port}/api/docs`;
    const r = await fetch(url);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.hosted).toBe(true);
    // The /help guide prints the instance's per-member quota next to WCL's own limit.
    expect(b.quota).toEqual({ pointsPerUserHour: TEST_HOSTED_CONFIG.pointsPerUserHour, wclPointsPerHour: 3600 });
  });
});
