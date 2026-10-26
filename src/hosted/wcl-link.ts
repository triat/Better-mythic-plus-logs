// Warcraft Logs account link, step 1: the measurement gate (spec docs/superpowers/specs/2026-10-26-wcl-account-link-design.md,
// decision 1). An admin connects their WCL account through the authorization code flow (with PKCE); bmpl reads the
// user token's counter and the instance client's counter, runs a few public queries with the user token, reads both
// counters again, and shows the result. The token is used for that one request and never stored, logged or returned.
import { createHash, randomBytes } from "node:crypto";
import { timedFetch } from "../upstream.ts";

export const WCL_AUTHORIZE_URL = "https://www.warcraftlogs.com/oauth/authorize";
export const WCL_TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
export const WCL_USER_GRAPHQL = "https://www.warcraftlogs.com/api/v2/user";

/** A PKCE pair (RFC 7636, S256): the verifier stays server side (the nonce cookie), the challenge goes to WCL. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function wclAuthorizeUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", state: o.state,
    code_challenge: o.challenge, code_challenge_method: "S256",
  });
  return `${WCL_AUTHORIZE_URL}?${q}`;
}

/** What the token answer says about itself, never the token values (the probe's report). */
export interface TokenFacts { tokenType: string | null; expiresInS: number | null; refreshToken: boolean; scope: string | null }

export type Exchange = { ok: true; accessToken: string; facts: TokenFacts } | { ok: false; error: string };

/** Trades the callback's code for a user token: the client's id and secret in basic auth, plus the PKCE verifier. */
export async function exchangeWclCode(
  o: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string }, fetchFn: typeof fetch,
): Promise<Exchange> {
  const res = await timedFetch("wcl", "oauth_user", () => fetchFn(WCL_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${o.clientId}:${o.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier }),
  }));
  if (!res.ok) return { ok: false, error: `token endpoint answered HTTP ${res.status}` };
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const accessToken = typeof body?.access_token === "string" ? body.access_token : null;
  if (!accessToken) return { ok: false, error: "token endpoint answered without access_token" };
  return {
    ok: true, accessToken,
    facts: {
      tokenType: typeof body?.token_type === "string" ? body.token_type : null,
      expiresInS: typeof body?.expires_in === "number" ? body.expires_in : null,
      refreshToken: typeof body?.refresh_token === "string" && body.refresh_token.length > 0,
      scope: typeof body?.scope === "string" ? body.scope : null,
    },
  };
}

export type Gql = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

/** A GraphQL call on the user endpoint with the member's token; throws with the status or the first GraphQL error. */
export function userGql(token: string, fetchFn: typeof fetch): Gql {
  return async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
    const res = await timedFetch("wcl", "user", () => fetchFn(WCL_USER_GRAPHQL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    }));
    if (!res.ok) throw new Error(`user endpoint answered HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0]!.message.slice(0, 200)}`);
    if (!json.data) throw new Error("GraphQL: no data");
    return json.data;
  };
}

interface Counter { limitPerHour: number; pointsSpentThisHour: number; pointsResetIn: number }
const RATE = `{ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }`;
const ME = `{ userData { currentUser { id name } } }`;
const ZONES = `{ worldData { zones { id name frozen encounters { id name } } } }`;
const RANKINGS = `query($e: Int!, $p: Int!) {
  worldData { encounter(id: $e) { characterRankings(className: "Mage", specName: "Fire", serverRegion: "EU", page: $p, metric: dps) } }
}`;
/** Pages of one public ladder read with the user token: enough to move a counter by a few points. */
const PAGES = [1, 2, 3];

export interface ProbeReport {
  token: TokenFacts;
  currentUser: { id: number; name: string } | { error: string };
  publicQueries: { ok: true; pages: number } | { ok: false; error: string };
  user: { before: Counter | { error: string }; after: Counter | { error: string } };
  instance: { before: Counter | { error: string }; after: Counter | { error: string } };
  /** Decision 1: the user token's own counter rose while the instance's did not (members' requests in the same seconds aside). */
  verdict: "user budget" | "instance budget" | "both moved" | "nothing moved" | "unreadable";
}

const counter = async (q: Gql): Promise<Counter | { error: string }> => {
  try { return (await q<{ rateLimitData: Counter }>(RATE)).rateLimitData; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
};
const spent = (c: Counter | { error: string }): number | null => ("error" in c ? null : c.pointsSpentThisHour);

/** The gate's measurement. `instance` is the instance client's gql (client credentials, the shared meter). */
export async function probeUserToken(facts: TokenFacts, user: Gql, instance: Gql): Promise<ProbeReport> {
  const userBefore = await counter(user);
  const instanceBefore = await counter(instance);
  let currentUser: ProbeReport["currentUser"];
  try { currentUser = (await user<{ userData: { currentUser: { id: number; name: string } } }>(ME)).userData.currentUser; } catch (e) {
    currentUser = { error: e instanceof Error ? e.message : String(e) };
  }
  let publicQueries: ProbeReport["publicQueries"];
  try {
    const zones = (await user<{ worldData: { zones: Array<{ name: string; frozen: boolean; encounters: Array<{ id: number }> }> } }>(ZONES)).worldData.zones;
    const zone = zones.find((z) => /^Mythic\+/.test(z.name) && !z.frozen);
    const encounter = zone?.encounters[0]?.id;
    if (encounter === undefined) throw new Error("no current Mythic+ zone");
    for (const p of PAGES) await user(RANKINGS, { e: encounter, p });
    publicQueries = { ok: true, pages: PAGES.length };
  } catch (e) {
    publicQueries = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const userAfter = await counter(user);
  const instanceAfter = await counter(instance);
  const du = spent(userAfter) !== null && spent(userBefore) !== null ? spent(userAfter)! - spent(userBefore)! : null;
  const di = spent(instanceAfter) !== null && spent(instanceBefore) !== null ? spent(instanceAfter)! - spent(instanceBefore)! : null;
  const verdict: ProbeReport["verdict"] =
    du === null || di === null ? "unreadable"
      : du > 0 && di <= 0 ? "user budget"
        : du <= 0 && di > 0 ? "instance budget"
          : du > 0 && di > 0 ? "both moved" : "nothing moved";
  return {
    token: facts, currentUser, publicQueries,
    user: { before: userBefore, after: userAfter }, instance: { before: instanceBefore, after: instanceAfter }, verdict,
  };
}
