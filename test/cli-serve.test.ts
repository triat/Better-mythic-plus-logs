import { describe, expect, test } from "bun:test";
import { planServe } from "../src/cli.ts";

const FULL = {
  BMPL_BASE_URL: "https://bmpl.example.com",
  BMPL_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  BMPL_DISCORD_CLIENT_ID: "123456789012345678",
  BMPL_DISCORD_CLIENT_SECRET: "s",
  BMPL_ADMIN_DISCORD_IDS: "111111111111111111",
  WCL_CLIENT_ID: "w",
  WCL_CLIENT_SECRET: "x",
};

describe("planServe", () => {
  test("defaults: local, port 3000, opens the browser", () => {
    expect(planServe([], {})).toEqual({ ok: true, port: 3000, open: true, hosted: false });
  });
  test("--port and --no-open", () => {
    expect(planServe(["--port", "4000", "--no-open"], {})).toEqual({ ok: true, port: 4000, open: false, hosted: false });
    expect(planServe(["--port", "0"], {}).ok).toBe(false);
    expect(planServe(["--port", "abc"], {}).ok).toBe(false);
  });
  test("--hosted with a full env: hosted, never opens the browser", () => {
    expect(planServe(["--hosted"], FULL)).toEqual({ ok: true, port: 3000, open: false, hosted: true, hostedConfig: { baseUrl: "https://bmpl.example.com", sessionSecret: FULL.BMPL_SESSION_SECRET, discordClientId: FULL.BMPL_DISCORD_CLIENT_ID, discordClientSecret: "s", adminDiscordIds: ["111111111111111111"] } });
  });
  test("BMPL_MODE=hosted is equivalent; a bad BMPL_MODE is an error", () => {
    expect(planServe([], { ...FULL, BMPL_MODE: "hosted" })).toEqual({ ok: true, port: 3000, open: false, hosted: true, hostedConfig: { baseUrl: "https://bmpl.example.com", sessionSecret: FULL.BMPL_SESSION_SECRET, discordClientId: FULL.BMPL_DISCORD_CLIENT_ID, discordClientSecret: "s", adminDiscordIds: ["111111111111111111"] } });
    const r = planServe([], { BMPL_MODE: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("BMPL_MODE");
  });
  test("--hosted with missing variables lists them", () => {
    const r = planServe(["--hosted"], { BMPL_BASE_URL: "https://x.example", BMPL_SESSION_SECRET: "short" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("missing: BMPL_DISCORD_CLIENT_ID, BMPL_DISCORD_CLIENT_SECRET, BMPL_ADMIN_DISCORD_IDS, WCL_CLIENT_ID, WCL_CLIENT_SECRET");
      expect(r.error).toContain("invalid: BMPL_SESSION_SECRET");
    }
  });
});
