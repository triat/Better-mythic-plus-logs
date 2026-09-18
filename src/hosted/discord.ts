// Discord OAuth2 (authorization code, scope "identify"). Every HTTP call goes through the
// injected fetchFn so tests never touch the network. Errors are returned, never thrown.
import type { DiscordIdentity } from "./db.ts";

export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_ME_URL = "https://discord.com/api/users/@me";

export type FetchFn = typeof fetch;

export const redirectUri = (baseUrl: string): string => `${baseUrl}/auth/discord/callback`;

export function authorizeUrl(cfg: { discordClientId: string; baseUrl: string }, state: string): string {
  const u = new URL(DISCORD_AUTHORIZE_URL);
  u.searchParams.set("client_id", cfg.discordClientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "identify");
  u.searchParams.set("redirect_uri", redirectUri(cfg.baseUrl));
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "none"); // returning users are not re-asked to authorize
  return u.toString();
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function exchangeCode(
  cfg: { discordClientId: string; discordClientSecret: string; baseUrl: string },
  code: string,
  fetchFn: FetchFn,
): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const body = new URLSearchParams({
    client_id: cfg.discordClientId,
    client_secret: cfg.discordClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(cfg.baseUrl),
  });
  try {
    const res = await fetchFn(DISCORD_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!res.ok) return { ok: false, error: `Discord token endpoint answered ${res.status}` };
    const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!json || typeof json.access_token !== "string" || !json.access_token) return { ok: false, error: "Discord token response has no access_token" };
    return { ok: true, accessToken: json.access_token };
  } catch (e) {
    return { ok: false, error: `Discord token request failed: ${message(e)}` };
  }
}

export async function fetchDiscordUser(
  accessToken: string,
  fetchFn: FetchFn,
): Promise<{ ok: true; identity: DiscordIdentity } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(DISCORD_ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { ok: false, error: `Discord /users/@me answered ${res.status}` };
    const j = (await res.json().catch(() => null)) as { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown } | null;
    if (!j || typeof j.id !== "string" || typeof j.username !== "string") return { ok: false, error: "Discord /users/@me payload is missing id/username" };
    return {
      ok: true,
      identity: {
        discordId: j.id,
        username: j.username,
        globalName: typeof j.global_name === "string" ? j.global_name : null,
        avatarHash: typeof j.avatar === "string" ? j.avatar : null,
      },
    };
  } catch (e) {
    return { ok: false, error: `Discord /users/@me request failed: ${message(e)}` };
  }
}

/** Discord CDN avatar; users without a custom avatar get one of the six default embeds. */
export function avatarUrl(discordId: string, avatarHash: string | null): string {
  if (avatarHash) return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=64`;
  const index = (BigInt(discordId) >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
