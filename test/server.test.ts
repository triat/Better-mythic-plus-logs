import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runServer } from "../src/server.ts";
import { createStaticHandler } from "../src/web-static.ts";

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let savedRegion: string | undefined;

beforeAll(async () => {
  savedRegion = process.env.BMPL_REGION;
  process.env.BMPL_REGION = "eu";
  dir = mkdtempSync(join(tmpdir(), "bmpl-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(dir, "assets", "app.css"), "body{}");
  writeFileSync(join(dir, "wh-config.js"), "const whTooltips = {};");
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
  if (savedRegion === undefined) delete process.env.BMPL_REGION;
  else process.env.BMPL_REGION = savedRegion;
});

const url = (p: string) => `http://localhost:${server.port}${p}`;

describe("static routes", () => {
  test("/, /setup and /admin serve index.html with no-cache", async () => {
    for (const p of ["/", "/setup", "/admin"]) {
      const res = await fetch(url(p));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(await res.text()).toContain('id=root');
    }
  });
  test("assets", async () => {
    const js = await fetch(url("/assets/app.js"));
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await js.text()).toBe("console.log(1)");
    const css = await fetch(url("/assets/app.css"));
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
  });
  test("/wh-config.js is served as JavaScript", async () => {
    const res = await fetch(url("/wh-config.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toContain("whTooltips");
  });
  test("unknown path is 404; API still answers", async () => {
    expect((await fetch(url("/nope"))).status).toBe(404);
    const st = await fetch(url("/api/status"));
    expect(st.status).toBe(200);
    const stBody = await st.json();
    expect(stBody.ok).toBe(true);
    expect(stBody.region).toBe("eu");
    expect((await fetch(url("/api/status"))).headers.get("content-security-policy")).toBeNull();
  });
});

describe("GET /api/health", () => {
  test("local mode's body has exactly ok, version, uptimeS, db", async () => {
    const body = await (await fetch(url("/api/health"))).json();
    expect(Object.keys(body).sort()).toEqual(["db", "ok", "uptimeS", "version"].sort());
  });
});

describe("createStaticHandler", () => {
  test("503 when the front is not built, and retries the loader next time", async () => {
    let calls = 0;
    const handler = createStaticHandler(async () => { calls++; return null; });
    const res = await handler("/");
    expect(res?.status).toBe(503);
    expect(await res?.text()).toBe("web UI not built — run: just web-build");
    await handler("/assets/app.js");
    expect(calls).toBe(2);
    expect(await handler("/api/status")).toBeNull();
  });
  test("503 when a listed file is missing on disk", async () => {
    const handler = createStaticHandler(async () => ({ index: "/definitely/missing.html", appJs: "/x.js", appCss: "/x.css", whConfigJs: "/x.js" }));
    expect((await handler("/"))?.status).toBe(503);
  });
});
