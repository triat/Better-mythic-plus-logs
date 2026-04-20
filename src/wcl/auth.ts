import { config } from "../config.ts";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cache: TokenCache | null = null;

export const resetAuthCache = (): void => {
  cache = null;
};

export async function getAccessToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now() + 60_000) {
    return cache.token;
  }

  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "WCL credentials not configured. Fill WCL_CLIENT_ID and WCL_CLIENT_SECRET in .env, or run `bmpl serve` for a guided setup.",
    );
  }

  const basic = btoa(`${config.clientId}:${config.clientSecret}`);
  const res = await fetch(config.oauthUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!res.ok) {
    throw new Error(`WCL OAuth failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as TokenResponse;
  cache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}
