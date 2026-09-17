import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runServer } from "../src/server.ts";
import { SECURITY_HEADERS } from "../src/server/security.ts";
import { closeStore } from "../src/signals/store.ts";

let dir: string;
let hosted: Awaited<ReturnType<typeof runServer>>;
let local: Awaited<ReturnType<typeof runServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-hosted-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "");
  writeFileSync(join(dir, "assets", "app.css"), "");
  writeFileSync(join(dir, "wh-config.js"), "const whTooltips = {};");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  const assets = async () => ({
    index: join(dir, "index.html"),
    appJs: join(dir, "assets", "app.js"),
    appCss: join(dir, "assets", "app.css"),
    whConfigJs: join(dir, "wh-config.js"),
  });
  hosted = await runServer({ port: 0, open: true, hosted: true, assets });
  local = await runServer({ port: 0, open: false, hosted: false, assets });
});
afterAll(() => {
  hosted.stop(true);
  local.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const h = (p: string) => `http://localhost:${hosted.port}${p}`;
const l = (p: string) => `http://localhost:${local.port}${p}`;

describe("hosted mode routes", () => {
  test("local-only routes are not registered", async () => {
    expect((await fetch(h("/api/setup"), { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(h("/api/quit"), { method: "POST" })).status).toBe(404);
    expect((await fetch(h("/api/watch/start"), { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(h("/api/watch/stop"), { method: "POST" })).status).toBe(404);
    expect((await fetch(h("/api/watch/status"))).status).toBe(404);
  });
  test("shared routes still answer", async () => {
    expect((await fetch(h("/api/history"))).status).toBe(200);
    expect((await fetch(h("/api/defensives?class=Shaman&spec=Elemental"))).status).toBe(200);
    const bad = await fetch(h("/api/lookup"), { method: "POST", body: "not json" });
    expect(bad.status).toBe(400);
  });
  test("/api/status has no envPath in hosted mode, and has one locally", async () => {
    const hs = await (await fetch(h("/api/status"))).json();
    expect(hs.ok).toBe(true);
    expect(hs.hosted).toBe(true);
    expect(typeof hs.hasCredentials).toBe("boolean");
    expect("envPath" in hs).toBe(false);
    const ls = await (await fetch(l("/api/status"))).json();
    expect(ls.hosted).toBe(false);
    expect(typeof ls.envPath).toBe("string");
  });
  test("the local server still registers the local routes", async () => {
    expect((await fetch(l("/api/watch/status"))).status).toBe(200);
  });
});

describe("security headers", () => {
  test("every hosted response carries them (static, api, 404, SSE)", async () => {
    const responses = [
      await fetch(h("/")),
      await fetch(h("/api/status")),
      await fetch(h("/nope")),
      await fetch(h("/api/watch/status")),
    ];
    for (const res of responses) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    }
    const ctrl = new AbortController();
    const sse = await fetch(h("/api/events"), { signal: ctrl.signal });
    expect(sse.headers.get("content-type")).toBe("text/event-stream");
    expect(sse.headers.get("content-security-policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
    ctrl.abort();
  });
  test("CSP allows only self plus the Wowhead hosts for scripts and has no unsafe-inline for scripts", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy"]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://wow.zamimg.com");
    expect(csp).toContain("connect-src 'self' https://nether.wowhead.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://wow.zamimg.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp.match(/script-src[^;]*/)?.[0]).not.toContain("unsafe-inline");
  });
  test("local mode sends none of them", async () => {
    const res = await fetch(l("/api/status"));
    for (const k of Object.keys(SECURITY_HEADERS)) expect(res.headers.get(k)).toBeNull();
  });
});

describe("/api/health", () => {
  test("answers in both modes with version, uptime and db", async () => {
    for (const u of [h("/api/health"), l("/api/health")]) {
      const res = await fetch(u);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof body.uptimeS).toBe("number");
      expect(body.db).toBe("ok");
    }
  });
});
