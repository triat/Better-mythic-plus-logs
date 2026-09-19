import { config } from "../config.ts";

export interface WclCredentials {
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

/** One cached token per client id (the env client and each member's own client). */
const cache = new Map<string, TokenCache>();

export const resetAuthCache = (): void => {
  cache.clear();
};

/** Drops one client's cached token (e.g. after its secret is re-saved). */
export const forgetToken = (clientId: string): void => {
  cache.delete(clientId);
};

/** Longest slice of an OAuth failure body kept in the thrown error. */
const ERROR_TEXT_MAX = 200;
const clipText = (s: string): string => (s.length > ERROR_TEXT_MAX ? s.slice(0, ERROR_TEXT_MAX - 1) + "…" : s);

/** No `creds` = the env client (`WCL_CLIENT_ID`/`WCL_CLIENT_SECRET`). */
export async function getAccessToken(creds?: WclCredentials): Promise<string> {
  const { clientId, clientSecret } = creds ?? { clientId: config.clientId, clientSecret: config.clientSecret };

  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      "WCL credentials not configured. Fill WCL_CLIENT_ID and WCL_CLIENT_SECRET in .env, or run `bmpl serve` for a guided setup.",
    );
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(config.oauthUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!res.ok) {
    throw new Error(`WCL OAuth failed: ${res.status} ${clipText(await res.text())}`);
  }

  const data = (await res.json()) as TokenResponse;
  cache.set(clientId, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
