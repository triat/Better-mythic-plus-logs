// Hosted-mode configuration: pure functions over an env record so the CLI can validate
// before starting the server and tests never touch process.env.
import { createHash } from "node:crypto";

export type Mode = "local" | "hosted";

export const HOSTED_ENV_VARS = [
  "BMPL_BASE_URL",
  "BMPL_SESSION_SECRET",
  "BMPL_DISCORD_CLIENT_ID",
  "BMPL_DISCORD_CLIENT_SECRET",
  "BMPL_ADMIN_DISCORD_IDS",
  "WCL_CLIENT_ID",
  "WCL_CLIENT_SECRET",
] as const;

export interface HostedConfig {
  /** Public origin, no trailing slash (e.g. https://bmpl.example.com). */
  baseUrl: string;
  sessionSecret: string;
  discordClientId: string;
  discordClientSecret: string;
  adminDiscordIds: string[];
  /** Per-member WCL points per calendar hour (admins are exempt). */
  pointsPerUserHour: number;
  /** Any Discord account may sign in (still subject to a ban or the guild gate); default false = invite-only. */
  openSignup: boolean;
  /** Only accounts in this Discord server may sign in; null = no guild gate. */
  discordGuildId: string | null;
  /** AES-256-GCM key for a member's own WCL client secret; null disables that feature (issue #11 Task 2). */
  encryptionKey: Uint8Array | null;
  /** Shown to members who cannot get in (e.g. "ask Muleyoxo on Discord"). */
  operator: string;
  /** SHA-256 (hex) of the bearer token that opens the read-only `/api/ops/*` routes; null = they answer 404. */
  opsTokenSha256: string | null;
}

export const MIN_SESSION_SECRET_BYTES = 32;
export const DEFAULT_POINTS_PER_USER_HOUR = 300;
export const ENCRYPTION_KEY_BYTES = 32;
export const DEFAULT_OPERATOR = "the admin of this instance";
export const MIN_OPS_TOKEN_BYTES = 32;

/**
 * Bootstrap ops token for bmpl.riat.dev only, while its operator cannot edit the VPS `.env`: the
 * SHA-256 of a token held in the operator's agent environment (the token itself is not in the repo).
 * Used only when `BMPL_BASE_URL` is exactly this origin and `BMPL_OPS_TOKEN` is unset, so a
 * self-hosted instance never accepts it. Remove once `BMPL_OPS_TOKEN` is set on that VPS.
 */
export const BOOTSTRAP_OPS = {
  origin: "https://bmpl.riat.dev",
  sha256: "203c828e65e3badb9f92783e98cdeca730b0d728d5e522cf4157e2dc4ff092dc",
} as const;

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

type Env = Record<string, string | undefined>;

const read = (env: Env, key: string): string => (env[key] ?? "").trim();

/** `--hosted` beats `BMPL_MODE`; an unknown BMPL_MODE is refused rather than silently local. */
export function resolveMode(flagHosted: boolean, env: Env): { ok: true; mode: Mode } | { ok: false; error: string } {
  if (flagHosted) return { ok: true, mode: "hosted" };
  const raw = read(env, "BMPL_MODE").toLowerCase();
  if (raw === "" || raw === "local") return { ok: true, mode: "local" };
  if (raw === "hosted") return { ok: true, mode: "hosted" };
  return { ok: false, error: `Unknown BMPL_MODE "${raw}" — expected "local" or "hosted"` };
}

/** Discord snowflake ids are 17-20 digit numbers. */
export const DISCORD_ID = /^\d{17,20}$/;

/** Origin only: http(s), no path/query/hash. Returns the normalised origin or null. */
const parseOrigin = (raw: string): string | null => {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
  return u.origin;
};

/** Why a session secret is unfit even when long enough, or null when it passes. */
export const weakSecret = (s: string): string | null => {
  if (new Set(s).size < 8) return "fewer than 8 distinct characters";
  if (/changeme|secret|password|example/i.test(s)) return "looks like a placeholder";
  return null;
};

export function validateHostedEnv(env: Env): { ok: true; config: HostedConfig } | { ok: false; missing: string[]; invalid: string[] } {
  const missing = HOSTED_ENV_VARS.filter((k) => read(env, k) === "");
  const invalid: string[] = [];

  const baseUrl = missing.includes("BMPL_BASE_URL") ? null : parseOrigin(read(env, "BMPL_BASE_URL"));
  if (baseUrl === null && !missing.includes("BMPL_BASE_URL")) invalid.push("BMPL_BASE_URL: must be an http(s) origin without a path, e.g. https://bmpl.example.com");

  const secret = read(env, "BMPL_SESSION_SECRET");
  if (secret !== "" && Buffer.byteLength(secret, "utf8") < MIN_SESSION_SECRET_BYTES) invalid.push(`BMPL_SESSION_SECRET: at least ${MIN_SESSION_SECRET_BYTES} bytes (got ${Buffer.byteLength(secret, "utf8")})`);
  else if (secret !== "" && weakSecret(secret)) invalid.push(`BMPL_SESSION_SECRET: ${weakSecret(secret)} — generate one with \`openssl rand -base64 48\``);

  const adminDiscordIds = read(env, "BMPL_ADMIN_DISCORD_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  if (!missing.includes("BMPL_ADMIN_DISCORD_IDS")) {
    if (adminDiscordIds.length === 0) invalid.push("BMPL_ADMIN_DISCORD_IDS: at least one Discord user id, comma-separated");
    for (const id of adminDiscordIds) if (!DISCORD_ID.test(id)) invalid.push(`BMPL_ADMIN_DISCORD_IDS: not a Discord id: ${id}`);
  }

  const discordClientId = read(env, "BMPL_DISCORD_CLIENT_ID");
  if (!missing.includes("BMPL_DISCORD_CLIENT_ID") && !DISCORD_ID.test(discordClientId)) invalid.push("BMPL_DISCORD_CLIENT_ID: not a Discord application id");

  const rawPoints = read(env, "BMPL_POINTS_PER_USER_HOUR");
  const pointsPerUserHour = rawPoints === "" ? DEFAULT_POINTS_PER_USER_HOUR : Number(rawPoints);
  // /^\d+$/ rejects forms Number() accepts but that are not plainly a positive integer (e.g. "1e3", "0x10").
  if (!(rawPoints === "" || /^\d+$/.test(rawPoints)) || !(Number.isInteger(pointsPerUserHour) && pointsPerUserHour > 0)) {
    invalid.push(`BMPL_POINTS_PER_USER_HOUR: a positive integer (got "${rawPoints}")`);
  }

  const rawOpen = read(env, "BMPL_OPEN_SIGNUP").toLowerCase();
  if (!["", "true", "false"].includes(rawOpen)) invalid.push(`BMPL_OPEN_SIGNUP: "true" or "false" (got "${read(env, "BMPL_OPEN_SIGNUP")}")`);
  const rawGuild = read(env, "BMPL_DISCORD_GUILD_ID");
  if (rawGuild !== "" && !DISCORD_ID.test(rawGuild)) invalid.push("BMPL_DISCORD_GUILD_ID: not a Discord server id");
  const rawKey = read(env, "BMPL_ENCRYPTION_KEY");
  const keyBytes = rawKey === "" ? null : Buffer.from(rawKey, "base64");
  if (keyBytes !== null && keyBytes.length !== ENCRYPTION_KEY_BYTES) invalid.push("BMPL_ENCRYPTION_KEY: base64 of 32 random bytes — generate one with `openssl rand -base64 32`");
  const operator = read(env, "BMPL_OPERATOR");
  if (operator.length > 80) invalid.push("BMPL_OPERATOR: at most 80 characters");
  // `off` disables the ops routes outright, bootstrap token included.
  const opsToken = read(env, "BMPL_OPS_TOKEN");
  if (opsToken !== "" && opsToken !== "off") {
    if (Buffer.byteLength(opsToken, "utf8") < MIN_OPS_TOKEN_BYTES) invalid.push(`BMPL_OPS_TOKEN: at least ${MIN_OPS_TOKEN_BYTES} bytes, or "off" — generate one with \`openssl rand -base64 48\``);
    else if (weakSecret(opsToken)) invalid.push(`BMPL_OPS_TOKEN: ${weakSecret(opsToken)} — generate one with \`openssl rand -base64 48\``);
  }
  const opsTokenSha256 = opsToken === "off" ? null
    : opsToken !== "" ? sha256Hex(opsToken)
    : baseUrl === BOOTSTRAP_OPS.origin ? BOOTSTRAP_OPS.sha256 : null;

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      baseUrl: baseUrl!,
      sessionSecret: secret,
      discordClientId,
      discordClientSecret: read(env, "BMPL_DISCORD_CLIENT_SECRET"),
      adminDiscordIds,
      pointsPerUserHour,
      openSignup: rawOpen === "true",
      discordGuildId: rawGuild || null,
      encryptionKey: keyBytes ? new Uint8Array(keyBytes) : null,
      operator: operator || DEFAULT_OPERATOR,
      opsTokenSha256,
    },
  };
}
