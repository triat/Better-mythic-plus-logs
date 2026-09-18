import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeConfig, lastBackupAt } from "../../src/hosted/instance.ts";
import { TEST_HOSTED_CONFIG } from "./helpers.ts";

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
