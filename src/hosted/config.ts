// Hosted-mode configuration: pure functions over an env record so the CLI can validate
// before starting the server and tests never touch process.env.

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
}

export const MIN_SESSION_SECRET_BYTES = 32;

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

export function validateHostedEnv(env: Env): { ok: true; config: HostedConfig } | { ok: false; missing: string[]; invalid: string[] } {
  const missing = HOSTED_ENV_VARS.filter((k) => read(env, k) === "");
  const invalid: string[] = [];

  const baseUrl = missing.includes("BMPL_BASE_URL") ? null : parseOrigin(read(env, "BMPL_BASE_URL"));
  if (baseUrl === null && !missing.includes("BMPL_BASE_URL")) invalid.push("BMPL_BASE_URL: must be an http(s) origin without a path, e.g. https://bmpl.example.com");

  const secret = read(env, "BMPL_SESSION_SECRET");
  if (secret !== "" && Buffer.byteLength(secret, "utf8") < MIN_SESSION_SECRET_BYTES) invalid.push(`BMPL_SESSION_SECRET: at least ${MIN_SESSION_SECRET_BYTES} bytes (got ${Buffer.byteLength(secret, "utf8")})`);

  const adminDiscordIds = read(env, "BMPL_ADMIN_DISCORD_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  if (!missing.includes("BMPL_ADMIN_DISCORD_IDS")) {
    if (adminDiscordIds.length === 0) invalid.push("BMPL_ADMIN_DISCORD_IDS: at least one Discord user id, comma-separated");
    for (const id of adminDiscordIds) if (!DISCORD_ID.test(id)) invalid.push(`BMPL_ADMIN_DISCORD_IDS: not a Discord id: ${id}`);
  }

  const discordClientId = read(env, "BMPL_DISCORD_CLIENT_ID");
  if (!missing.includes("BMPL_DISCORD_CLIENT_ID") && !DISCORD_ID.test(discordClientId)) invalid.push("BMPL_DISCORD_CLIENT_ID: not a Discord application id");

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      baseUrl: baseUrl!,
      sessionSecret: secret,
      discordClientId,
      discordClientSecret: read(env, "BMPL_DISCORD_CLIENT_SECRET"),
      adminDiscordIds,
    },
  };
}
