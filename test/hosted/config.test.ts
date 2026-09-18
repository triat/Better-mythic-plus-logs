import { describe, expect, test } from "bun:test";
import { HOSTED_ENV_VARS, resolveMode, validateHostedEnv } from "../../src/hosted/config.ts";

const FULL: Record<string, string> = {
  BMPL_BASE_URL: "https://bmpl.example.com",
  BMPL_SESSION_SECRET: "0123456789abcdef0123456789abcdef", // 32 bytes
  BMPL_DISCORD_CLIENT_ID: "123456789012345678",
  BMPL_DISCORD_CLIENT_SECRET: "abc",
  BMPL_ADMIN_DISCORD_IDS: "111111111111111111, 222222222222222222",
  WCL_CLIENT_ID: "wcl-id",
  WCL_CLIENT_SECRET: "wcl-secret",
};

describe("resolveMode", () => {
  test("defaults to local", () => {
    expect(resolveMode(false, {})).toEqual({ ok: true, mode: "local" });
  });
  test("--hosted wins", () => {
    expect(resolveMode(true, {})).toEqual({ ok: true, mode: "hosted" });
    expect(resolveMode(true, { BMPL_MODE: "local" })).toEqual({ ok: true, mode: "hosted" });
  });
  test("BMPL_MODE=hosted", () => {
    expect(resolveMode(false, { BMPL_MODE: "hosted" })).toEqual({ ok: true, mode: "hosted" });
    expect(resolveMode(false, { BMPL_MODE: " Hosted " })).toEqual({ ok: true, mode: "hosted" });
    expect(resolveMode(false, { BMPL_MODE: "local" })).toEqual({ ok: true, mode: "local" });
    expect(resolveMode(false, { BMPL_MODE: "" })).toEqual({ ok: true, mode: "local" });
  });
  test("unknown BMPL_MODE is an error", () => {
    const r = resolveMode(false, { BMPL_MODE: "cloud" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cloud");
  });
});

describe("validateHostedEnv", () => {
  test("lists the seven variables", () => {
    expect([...HOSTED_ENV_VARS]).toEqual([
      "BMPL_BASE_URL", "BMPL_SESSION_SECRET", "BMPL_DISCORD_CLIENT_ID", "BMPL_DISCORD_CLIENT_SECRET",
      "BMPL_ADMIN_DISCORD_IDS", "WCL_CLIENT_ID", "WCL_CLIENT_SECRET",
    ]);
  });
  test("full env is ok and parsed", () => {
    const r = validateHostedEnv(FULL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.baseUrl).toBe("https://bmpl.example.com");
      expect(r.config.adminDiscordIds).toEqual(["111111111111111111", "222222222222222222"]);
      expect(r.config.sessionSecret).toBe(FULL.BMPL_SESSION_SECRET);
      expect(r.config.pointsPerUserHour).toBe(300);
    }
  });
  test("missing and blank variables are reported in declaration order", () => {
    const env = { ...FULL, BMPL_DISCORD_CLIENT_ID: "  ", WCL_CLIENT_SECRET: undefined };
    delete (env as Record<string, unknown>).BMPL_BASE_URL;
    const r = validateHostedEnv(env);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual(["BMPL_BASE_URL", "BMPL_DISCORD_CLIENT_ID", "WCL_CLIENT_SECRET"]);
      expect(r.invalid).toEqual([]);
    }
  });
  test("short secret, non-origin base url and empty admin list are invalid", () => {
    const r = validateHostedEnv({
      ...FULL,
      BMPL_SESSION_SECRET: "too-short",
      BMPL_BASE_URL: "https://bmpl.example.com/app",
      BMPL_ADMIN_DISCORD_IDS: " , ",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual([]);
      expect(r.invalid.map((s) => s.split(":")[0])).toEqual(["BMPL_BASE_URL", "BMPL_SESSION_SECRET", "BMPL_ADMIN_DISCORD_IDS"]);
    }
  });
  test("base url: trailing slash is accepted and stripped, http allowed, ftp rejected", () => {
    const ok = validateHostedEnv({ ...FULL, BMPL_BASE_URL: "http://localhost:3000/" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.baseUrl).toBe("http://localhost:3000");
    expect(validateHostedEnv({ ...FULL, BMPL_BASE_URL: "ftp://x" }).ok).toBe(false);
    expect(validateHostedEnv({ ...FULL, BMPL_BASE_URL: "not a url" }).ok).toBe(false);
  });
  test("secret length is measured in bytes", () => {
    // 16 two-byte characters = 32 bytes.
    expect(validateHostedEnv({ ...FULL, BMPL_SESSION_SECRET: "éééééééééééééééé" }).ok).toBe(true);
    expect(validateHostedEnv({ ...FULL, BMPL_SESSION_SECRET: "ééééééééééééééé" }).ok).toBe(false);
  });
  test("Discord ids must be 17-20 digit snowflakes", () => {
    const r = validateHostedEnv({ ...FULL, BMPL_DISCORD_CLIENT_ID: "123", BMPL_ADMIN_DISCORD_IDS: "111, not-an-id" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.invalid).toContain("BMPL_DISCORD_CLIENT_ID: not a Discord application id");
      expect(r.invalid).toContain("BMPL_ADMIN_DISCORD_IDS: not a Discord id: 111");
      expect(r.invalid).toContain("BMPL_ADMIN_DISCORD_IDS: not a Discord id: not-an-id");
    }
  });
  test("BMPL_POINTS_PER_USER_HOUR overrides the default and must be a positive integer", () => {
    const ok = validateHostedEnv({ ...FULL, BMPL_POINTS_PER_USER_HOUR: "500" });
    expect(ok.ok && ok.config.pointsPerUserHour).toBe(500);
    for (const bad of ["0", "-1", "12.5", "lots", "1e3", "0x10"]) {
      const r = validateHostedEnv({ ...FULL, BMPL_POINTS_PER_USER_HOUR: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.invalid).toEqual([`BMPL_POINTS_PER_USER_HOUR: a positive integer (got "${bad}")`]);
    }
  });
});
