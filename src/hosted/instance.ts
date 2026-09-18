// Instance panel of the admin page: the effective configuration with secrets masked, and the deploy's backup marker.
import { statSync } from "node:fs";
import { join } from "node:path";
import type { HostedConfig } from "./config.ts";

export interface EnvRow { key: string; value: string; secret: boolean }

const SET = "•••• (set)";
const NOT_SET = "(not set)";
const abbreviate = (id: string): string => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

/** The env the instance runs with, in `.env.hosted.example` order; secrets never leave the server. */
export function describeConfig(config: HostedConfig, wcl: { clientId: string | null; hasSecret: boolean }): EnvRow[] {
  return [
    { key: "BMPL_BASE_URL", value: config.baseUrl, secret: false },
    { key: "BMPL_DISCORD_CLIENT_ID", value: config.discordClientId, secret: false },
    { key: "BMPL_DISCORD_CLIENT_SECRET", value: config.discordClientSecret ? SET : NOT_SET, secret: true },
    { key: "BMPL_SESSION_SECRET", value: `•••• (${Buffer.byteLength(config.sessionSecret)} bytes)`, secret: true },
    { key: "BMPL_ADMIN_DISCORD_IDS", value: config.adminDiscordIds.join(", "), secret: false },
    { key: "BMPL_POINTS_PER_USER_HOUR", value: String(config.pointsPerUserHour), secret: false },
    { key: "WCL_CLIENT_ID", value: wcl.clientId ? abbreviate(wcl.clientId) : NOT_SET, secret: false },
    { key: "WCL_CLIENT_SECRET", value: wcl.hasSecret ? SET : NOT_SET, secret: true },
  ];
}

/** mtime of `<dir>/last-backup` (written by the deploy's litestream check, issue #10); null when absent. */
export function lastBackupAt(dir: string): number | null {
  try { return Math.round(statSync(join(dir, "last-backup")).mtimeMs); } catch { return null; }
}
