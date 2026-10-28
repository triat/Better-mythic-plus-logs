// Umami analytics (spec 2026-10-28-umami-analytics-design.md): the status names the instance and the CSP opens to its
// origin only when the hosted config has one. Never reaches WCL.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runServer } from "../src/server.ts";
import { cspFor, SECURITY_HEADERS } from "../src/server/security.ts";
import { closeStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG } from "./hosted/helpers.ts";

const ANALYTICS = { url: "https://analytics.example.com", websiteId: "77bb2d19-7cfd-4c46-9100-232862ecd092" };
let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
const u = (p: string) => `http://localhost:${server.port}${p}`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-analytics-"));
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({ port: 0, open: false, hosted: true, hostedConfig: { ...TEST_HOSTED_CONFIG, analytics: ANALYTICS } });
});
afterAll(() => {
  server.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("analytics", () => {
  test("GET /api/status names the Umami instance", async () => {
    const body = await (await fetch(u("/api/status"))).json();
    expect(body.analytics).toEqual(ANALYTICS);
  });
  test("the CSP lets the tracker load and send, nothing else changes", async () => {
    const csp = (await fetch(u("/api/status"))).headers.get("content-security-policy")!;
    expect(csp).toBe(cspFor(ANALYTICS.url));
    expect(csp).toContain(`script-src 'self' https://wow.zamimg.com ${ANALYTICS.url}`);
    expect(csp).toContain(`connect-src 'self' https://nether.wowhead.com ${ANALYTICS.url}`);
    expect(csp.replaceAll(` ${ANALYTICS.url}`, "")).toBe(SECURITY_HEADERS["Content-Security-Policy"]!);
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toContain("analytics");
  });
});
