// Battle.net OAuth and WoW Profile API (Battle.net linking spec, section "Sources"). Server-side only. Every HTTP
// call goes through the injected fetchFn so tests never touch the network. Errors are returned, never thrown, and
// name the endpoint and status only: never a token, a code or the client secret.
import type { Region } from "../wow/regions.ts";
import type { BnetCandidate } from "./bnet-db.ts";
import { CHARACTER_PATTERNS } from "../self/characters.ts";

export const BNET_AUTHORIZE_URL = "https://oauth.battle.net/authorize";
export const BNET_TOKEN_URL = "https://oauth.battle.net/token";
export const BNET_USERINFO_URL = "https://oauth.battle.net/userinfo";
export const BNET_SCOPE = "wow.profile";
export const BNET_REGIONS: readonly Region[] = ["eu", "us", "kr", "tw"];
export const bnetRedirectUri = (baseUrl: string): string => `${baseUrl}/auth/bnet/callback`;
const apiHost = (r: Region): string => `https://${r}.api.blizzard.com`;
const basic = (id: string, secret: string): string => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const profileQuery = (r: Region): string => `namespace=profile-${r}&locale=en_US`;

export type BnetFailure = { ok: false; kind: "scope" | "down" | "invalid"; error: string };
export type Cfg = { bnetClientId: string; bnetClientSecret: string; baseUrl: string };

const fail = (kind: BnetFailure["kind"], error: string): BnetFailure => ({ ok: false, kind, error });
/** 429 and 5xx are Blizzard being unavailable (retry later); any other non-2xx is a refused request. */
const transient = (status: number): boolean => status === 429 || status >= 500;
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const readJson = async (res: Response): Promise<Record<string, unknown> | null> => asRecord(await res.json().catch(() => null));

export function bnetAuthorizeUrl(cfg: Cfg, state: string): string {
  const u = new URL(BNET_AUTHORIZE_URL);
  u.searchParams.set("client_id", cfg.bnetClientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", BNET_SCOPE);
  u.searchParams.set("redirect_uri", bnetRedirectUri(cfg.baseUrl));
  u.searchParams.set("state", state);
  return u.toString();
}

const postToken = (cfg: Cfg, body: URLSearchParams, fetchFn: typeof fetch): Promise<Response> =>
  fetchFn(BNET_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basic(cfg.bnetClientId, cfg.bnetClientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

/** The authorization code flow's token request. The member may have unticked the scope: no `wow.profile` → `scope`. */
export async function exchangeBnetCode(
  cfg: Cfg,
  code: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; accessToken: string; scope: string | null } | BnetFailure> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: bnetRedirectUri(cfg.baseUrl) });
  let res: Response;
  try {
    res = await postToken(cfg, body, fetchFn);
  } catch {
    return fail("down", "Battle.net token request failed");
  }
  if (!res.ok) return fail("invalid", `Battle.net token endpoint answered ${res.status}`);
  const j = await readJson(res);
  if (!j || typeof j.access_token !== "string" || !j.access_token) return fail("invalid", "Battle.net token response has no access_token");
  const scope = typeof j.scope === "string" ? j.scope : null;
  if (scope !== null && !scope.split(/\s+/).includes(BNET_SCOPE)) return fail("scope", `Battle.net token was granted without ${BNET_SCOPE}`);
  return { ok: true, accessToken: j.access_token, scope };
}

/** `/userinfo`: the account id (Blizzard's link key) and the BattleTag. */
export async function fetchBnetUser(
  token: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; accountId: string; battletag: string | null } | BnetFailure> {
  let res: Response;
  try {
    res = await fetchFn(BNET_USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return fail("down", "Battle.net /userinfo request failed");
  }
  if (!res.ok) return fail(transient(res.status) ? "down" : "invalid", `Battle.net /userinfo answered ${res.status}`);
  const j = await readJson(res);
  const id = j ? idString(j.id) ?? idString(j.sub) : null;
  if (!j || id === null) return fail("invalid", "Battle.net /userinfo payload has no id");
  return { ok: true, accountId: id, battletag: typeof j.battletag === "string" && j.battletag ? j.battletag : null };
}

const idString = (v: unknown): string | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? String(v) : typeof v === "string" && v ? v : null;

/**
 * Blizzard's `playable_class.id` (Game Data playable-class index: 1 Warrior … 13 Evoker) to the WCL class id the rest
 * of bmpl uses (src/wow/classes.ts: 1 Death Knight … 13 Evoker). The two numberings differ: Blizzard 5 is Priest,
 * WCL 5 is Monk. An unknown id maps to null.
 */
export const BLIZZARD_TO_WCL_CLASS: Readonly<Record<number, number>> = {
  1: 11, 2: 6, 3: 3, 4: 8, 5: 7, 6: 1, 7: 9, 8: 4, 9: 10, 10: 5, 11: 2, 12: 12, 13: 13,
};

/** One character of `wow_accounts[].characters[]`, or null when it breaks bmpl's name/realm rules or has no id. */
function candidate(raw: unknown, region: Region): BnetCandidate | null {
  const c = asRecord(raw);
  if (!c) return null;
  const realm = asRecord(c.realm);
  const slug = realm?.slug;
  if (typeof c.id !== "number" || !Number.isSafeInteger(c.id) || c.id < 1) return null;
  if (typeof c.name !== "string" || !CHARACTER_PATTERNS.name.test(c.name)) return null;
  if (typeof slug !== "string" || !CHARACTER_PATTERNS.realm.test(slug)) return null;
  const classID = asRecord(c.playable_class)?.id;
  return {
    bnetId: c.id,
    name: c.name,
    realm: slug,
    realmName: typeof realm?.name === "string" && realm.name ? realm.name : slug,
    region,
    level: typeof c.level === "number" && Number.isFinite(c.level) ? c.level : 0,
    classID: typeof classID === "number" ? BLIZZARD_TO_WCL_CLASS[classID] ?? null : null,
  };
}

/** One region: `[]` on 404 (no account there, or the privacy option off). 401/403 → scope. */
export async function fetchAccountCharacters(
  token: string,
  region: Region,
  fetchFn: typeof fetch,
): Promise<{ ok: true; candidates: BnetCandidate[] } | BnetFailure> {
  const endpoint = `Battle.net /profile/user/wow (${region})`;
  let res: Response;
  try {
    res = await fetchFn(`${apiHost(region)}/profile/user/wow?${profileQuery(region)}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return fail("down", `${endpoint} request failed`);
  }
  if (res.status === 404) return { ok: true, candidates: [] };
  if (res.status === 401 || res.status === 403) return fail("scope", `${endpoint} answered ${res.status}`);
  // Any other refusal is treated like an outage: nothing is imported, the member can retry.
  if (!res.ok) return fail("down", `${endpoint} answered ${res.status}`);
  const j = await readJson(res);
  if (!j || !Array.isArray(j.wow_accounts)) return fail("invalid", `${endpoint} payload has no wow_accounts`);
  const candidates: BnetCandidate[] = [];
  for (const account of j.wow_accounts) {
    const chars = asRecord(account)?.characters;
    if (!Array.isArray(chars)) continue;
    for (const raw of chars) {
      const c = candidate(raw, region);
      if (c) candidates.push(c);
    }
  }
  return { ok: true, candidates };
}

/** Every region merged, deduplicated by region + id, sorted by level (high first) then name. */
export function mergeCandidates(lists: BnetCandidate[][]): BnetCandidate[] {
  const byKey = new Map<string, BnetCandidate>();
  for (const list of lists) for (const c of list) {
    const key = `${c.region}:${c.bnetId}`;
    if (!byKey.has(key)) byKey.set(key, c);
  }
  return [...byKey.values()].sort((a, b) =>
    b.level - a.level ||
    a.name.localeCompare(b.name) ||
    BNET_REGIONS.indexOf(a.region) - BNET_REGIONS.indexOf(b.region) ||
    a.bnetId - b.bnetId);
}

const REFRESH_MARGIN_MS = 60_000;

/** Application token (client credentials), cached until 60 s before `expires_in`. */
export class BnetAppToken {
  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<{ ok: true; token: string } | BnetFailure> | null = null;

  constructor(private readonly cfg: Cfg, private readonly fetchFn: typeof fetch) {}

  get(now: number): Promise<{ ok: true; token: string } | BnetFailure> {
    if (this.cached && now < this.cached.expiresAt - REFRESH_MARGIN_MS) return Promise.resolve({ ok: true, token: this.cached.token });
    if (!this.inflight) this.inflight = this.fetchToken(now).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async fetchToken(now: number): Promise<{ ok: true; token: string } | BnetFailure> {
    let res: Response;
    try {
      res = await postToken(this.cfg, new URLSearchParams({ grant_type: "client_credentials" }), this.fetchFn);
    } catch {
      return fail("down", "Battle.net client credentials request failed");
    }
    if (!res.ok) return fail(transient(res.status) ? "down" : "invalid", `Battle.net token endpoint answered ${res.status} (client credentials)`);
    const j = await readJson(res);
    if (!j || typeof j.access_token !== "string" || !j.access_token) return fail("invalid", "Battle.net client credentials response has no access_token");
    // Without a usable expires_in the token serves this call only.
    const ttlMs = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in * 1000 : 0;
    this.cached = { token: j.access_token, expiresAt: now + ttlMs };
    return { ok: true, token: j.access_token };
  }
}

/** The status endpoint: `valid`, `gone` (404, is_valid false, another id) or a failure (network, 429, 5xx). */
export async function characterStatus(
  token: string,
  c: { region: Region; realm: string; name: string; bnetId: number },
  fetchFn: typeof fetch,
): Promise<{ ok: true; outcome: "valid" } | { ok: true; outcome: "gone"; reason: "not_found" | "invalid" | "other_id" } | BnetFailure> {
  const endpoint = `Battle.net character status (${c.region})`;
  const path = `/profile/wow/character/${encodeURIComponent(c.realm)}/${encodeURIComponent(c.name.toLowerCase())}/status`;
  let res: Response;
  try {
    res = await fetchFn(`${apiHost(c.region)}${path}?${profileQuery(c.region)}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return fail("down", `${endpoint} request failed`);
  }
  if (res.status === 404) return { ok: true, outcome: "gone", reason: "not_found" };
  if (!res.ok) return fail(transient(res.status) ? "down" : "invalid", `${endpoint} answered ${res.status}`);
  const j = await readJson(res);
  // A malformed answer is not proof the character is gone: it stays, and the next round retries.
  if (!j || typeof j.id !== "number") return fail("invalid", `${endpoint} payload has no id`);
  if (j.is_valid === false) return { ok: true, outcome: "gone", reason: "invalid" };
  if (j.id !== c.bnetId) return { ok: true, outcome: "gone", reason: "other_id" };
  return { ok: true, outcome: "valid" };
}
