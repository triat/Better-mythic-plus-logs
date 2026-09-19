import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeConfig, lastBackupAt } from "../../src/hosted/instance.ts";
import { TEST_ENCRYPTION_KEY, TEST_HOSTED_CONFIG } from "./helpers.ts";

describe("describeConfig", () => {
  test("masks secrets, shows the session secret's byte length and a WCL id abbreviation", () => {
    const rows = describeConfig(TEST_HOSTED_CONFIG, { clientId: "a3f1b2c3d4e59c2e", hasSecret: true });
    expect(rows).toEqual([
      { key: "BMPL_BASE_URL", value: "http://localhost", secret: false },
      { key: "BMPL_DISCORD_CLIENT_ID", value: "123456789012345678", secret: false },
      { key: "BMPL_DISCORD_CLIENT_SECRET", value: "•••• (set)", secret: true },
      { key: "BMPL_SESSION_SECRET", value: "•••• (32 bytes)", secret: true },
      { key: "BMPL_ADMIN_DISCORD_IDS", value: "111111111111111111, 444444444444444444", secret: false },
      { key: "BMPL_POINTS_PER_USER_HOUR", value: "300", secret: false },
      { key: "BMPL_OPEN_SIGNUP", value: "false", secret: false },
      { key: "BMPL_DISCORD_GUILD_ID", value: "(not set)", secret: false },
      { key: "BMPL_ENCRYPTION_KEY", value: "(not set)", secret: true },
      { key: "BMPL_OPERATOR", value: "the admin of this instance", secret: false },
      { key: "WCL_CLIENT_ID", value: "a3f1…9c2e", secret: false },
      { key: "WCL_CLIENT_SECRET", value: "•••• (set)", secret: true },
    ]);
  });
  test("missing WCL credentials read as not set; a short WCL id is shown whole", () => {
    const rows = describeConfig(TEST_HOSTED_CONFIG, { clientId: null, hasSecret: false });
    expect(rows.find((r) => r.key === "WCL_CLIENT_ID")!.value).toBe("(not set)");
    expect(rows.find((r) => r.key === "WCL_CLIENT_SECRET")!.value).toBe("(not set)");
    expect(describeConfig(TEST_HOSTED_CONFIG, { clientId: "abcdefgh", hasSecret: true }).find((r) => r.key === "WCL_CLIENT_ID")!.value).toBe("abcdefgh");
  });
});

describe("phase 2", () => {
  test("phase 2 rows: flags, guild, masked key, operator", () => {
    const rows = describeConfig({ ...TEST_HOSTED_CONFIG, openSignup: true, discordGuildId: "987654321098765432", encryptionKey: TEST_ENCRYPTION_KEY, operator: "Muleyoxo" }, { clientId: null, hasSecret: false });
    const keys = rows.map((r) => r.key);
    expect(keys.slice(keys.indexOf("BMPL_POINTS_PER_USER_HOUR"), keys.indexOf("WCL_CLIENT_ID"))).toEqual(["BMPL_POINTS_PER_USER_HOUR", "BMPL_OPEN_SIGNUP", "BMPL_DISCORD_GUILD_ID", "BMPL_ENCRYPTION_KEY", "BMPL_OPERATOR"]);
    expect(rows.find((r) => r.key === "BMPL_OPEN_SIGNUP")).toEqual({ key: "BMPL_OPEN_SIGNUP", value: "true", secret: false });
    expect(rows.find((r) => r.key === "BMPL_ENCRYPTION_KEY")).toEqual({ key: "BMPL_ENCRYPTION_KEY", value: "•••• (set)", secret: true });
    expect(describeConfig(TEST_HOSTED_CONFIG, { clientId: null, hasSecret: false }).find((r) => r.key === "BMPL_DISCORD_GUILD_ID")!.value).toBe("(not set)");
  });
});

describe("lastBackupAt", () => {
  test("mtime of last-backup next to the env file; null when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-instance-"));
    try {
      expect(lastBackupAt(dir)).toBeNull();
      writeFileSync(join(dir, "last-backup"), "");
      utimesSync(join(dir, "last-backup"), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
      expect(lastBackupAt(dir)).toBe(1_700_000_000_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
