# Battle.net linking — implementation plan

**Goal:** a hosted member links Battle.net once, picks up to 20 characters from the account's list, and those become
"My characters" (`source: "bnet"`); the server re-checks each one within 30 days; manual entries are removed from
the hosted instance at launch.

**Architecture:** one server-side OAuth round trip (`/auth/bnet/start` → Blizzard → `/auth/bnet/callback`) that
reads `/userinfo` and `/profile/user/wow` in four regions, keeps a one-hour candidate list in `bnet_imports`, and
drops the token. The member's pick (`PUT /api/bnet/characters`) is checked against that list. A six-hourly timer in
the hosted runtime calls Blizzard's character status endpoint with an application token. The front gets a link
card, a picker and a linked state on `/me`, designed on the canvas first.

**Spec:** `docs/superpowers/specs/2026-10-11-battlenet-linking-design.md` (approved 2026-10-11).

## Global Constraints (from the spec, verbatim where quoted)

- Hosted only. Local mode keeps the manual list ("No Battle.net in local mode").
- Required variables `BMPL_BNET_CLIENT_ID`, `BMPL_BNET_CLIENT_SECRET`; redirect URI `${BMPL_BASE_URL}/auth/bnet/callback`;
  `describeConfig` shows only whether the secret is set.
- Scope `wow.profile` only. Authorize/token `https://oauth.battle.net/authorize` / `/token`; the token request uses
  "the developer's client ID and secret with HTTP basic authorization". User info `https://oauth.battle.net/userinfo`.
- Character list `GET https://{region}.api.blizzard.com/profile/user/wow?namespace=profile-{region}&locale=en_US`
  for `eu`, `us`, `kr`, `tw`; a 404 in a region = no characters there.
- Status `GET https://{region}.api.blizzard.com/profile/wow/character/{realmSlug}/{characterName}/status?namespace=profile-{region}&locale=en_US`;
  remove on 404, `is_valid: false` or another id.
- No Blizzard token stored. `bnet_imports` lives **1 hour**.
- `MAX_CHARACTERS` = **20** (server) and `MAX_ME` = **20** (front), both modes.
- Check round every **6 hours**; due when `verifiedAt` is older than **25 days**; forced removal past **30 days**.
- One Battle.net account per member (`account_id UNIQUE`); a second member gets `bnet_taken`.
- Hosted `PUT /api/settings` may only reorder or remove characters, never add one.
- Launch migration removes every `source: "manual"` entry, one `characters_reset` audit row per member touched.
- Unlink (`DELETE /api/bnet`) and account deletion remove `user_bnet`, `bnet_imports` and every `bnet` character.
- No WCL points spent anywhere in this feature.
- Any visible UI change goes through the canvas first (spec decision 10).

## Before you start

- Bun 1.4.3 (`.tool-versions`). Gate: `bun run typecheck && bun run --cwd web typecheck && bun test` with `web/dist`
  absent; the strict script stops on the first failure.
- Code facts this plan relies on (checked 2026-10-11):
  - Discord's start route is `GET /auth/discord` (`src/server/routes-auth.ts:46`).
  - `checkOrigin` runs only for non-GET (`src/server.ts:151`), so the GET OAuth routes rely on the session cookie,
    the `state` and the nonce cookie, like Discord's.
  - `/auth/*` is rate limited per IP by `limits.auth` (`src/server.ts:73-84`).
  - There is no schema version table. One-time migrations are self-detecting and idempotent, run from `openHosted`
    at every start (precedent `migrateRegionlessKeys`, `src/hosted/history.ts:52-72`).
  - `parseCharacters` rebuilds entries with four fields (`src/self/characters.ts:43`), so new fields must be added
    there or they are stripped.
  - The front's boot effect erases the query string on every page (`web/src/App.tsx:234-238`), so `?bnet=` must
    be read at module level, like `page` (`App.tsx:54`).
  - New tables with `REFERENCES users(id) ON DELETE CASCADE` are removed by `DELETE /api/me` without code.
- The operator added the Blizzard client to the production `.env` on 2026-10-11. Do not read, print or copy it.

## Files

| File | Responsibility |
|---|---|
| `src/hosted/config.ts`, `src/hosted/instance.ts`, `.env.hosted.example` | the two variables |
| `src/self/characters.ts` | cap 20, `bnetId`/`verifiedAt`, `characterKey`, `restrictToStored` |
| `src/server/validate.ts` | `MY_CHARACTER` accepts `bnet`; `BNET_PICK_BODY` |
| `src/hosted/schema.ts` | `user_bnet`, `bnet_imports` |
| `src/hosted/bnet-db.ts` (new) | `BnetRepo`, `resetManualCharacters` |
| `src/hosted/db.ts` | `HostedDb.bnet`, migration call |
| `src/hosted/audit.ts`, `web/src/lib/admin.ts` | four new actions |
| `src/hosted/bnet.ts` (new) | Blizzard HTTP: authorize URL, code exchange, userinfo, account list, app token, status |
| `src/hosted/bnet-check.ts` (new) | the 30-day check round |
| `src/hosted/runtime.ts` | `bnetStates`, `bnetApp`, the 6-hour timer |
| `src/server/routes-bnet.ts` (new), `src/server.ts` | the five routes |
| `src/server/routes-user.ts` | hosted settings rule |
| `web/src/api.ts`, `web/src/lib/bnet.ts` (new), `web/src/lib/self.ts`, `web/src/lib/me.ts` | client calls and view models |
| `web/src/components/me/*`, `web/src/components/self/MeChip.tsx`, `web/src/components/account/PrivacyPage.tsx`, `web/src/App.tsx` | the screens (after the canvas) |
| `web/src/i18n/en.ts`, `fr.ts` | strings |
| `test/hosted/bnet*.test.ts`, `test/server-bnet.test.ts`, `test/fixtures/bnet-*.json`, existing tests | tests |
| `docs/hosted.md`, `docs/operator.md`, `deploy/README.md`, `docs/agents/*.md`, `AGENTS.md`, the parent spec | docs |

---

## Task 1 — Config: the two Blizzard variables

**Files:** `src/hosted/config.ts`, `src/hosted/instance.ts`, `.env.hosted.example`, `test/hosted/helpers.ts`,
`test/hosted/config.test.ts`, `test/hosted/instance.test.ts`, `test/cli-serve.test.ts`.

1. Tests first:
   - `test/hosted/config.test.ts`: add `BMPL_BNET_CLIENT_ID: "bnet-client-id"` and `BMPL_BNET_CLIENT_SECRET: "bnet-secret"`
     to `FULL`.
   - Extend "lists the seven variables" to nine, in this order: base URL, session secret, the two Discord variables,
     admin ids, **the two Blizzard variables**, the two WCL variables.
   - New test: a missing `BMPL_BNET_CLIENT_SECRET` makes `validateHostedEnv` return `missing: ["BMPL_BNET_CLIENT_SECRET"]`.
   - New test: the valid config has `bnetClientId: "bnet-client-id"` and `bnetClientSecret: "bnet-secret"`.
   - `test/hosted/instance.test.ts`: the rows contain `{ key: "BMPL_BNET_CLIENT_ID", value: "bnet-client-id", secret: false }`
     and `{ key: "BMPL_BNET_CLIENT_SECRET", value: "•••• (set)", secret: true }` right after `BMPL_ADMIN_DISCORD_IDS`.
   - Run `bun test test/hosted/config.test.ts test/hosted/instance.test.ts`: expect failures.
2. Code:
   ```ts
   // config.ts
   export const HOSTED_ENV_VARS = ["BMPL_BASE_URL", "BMPL_SESSION_SECRET", "BMPL_DISCORD_CLIENT_ID", "BMPL_DISCORD_CLIENT_SECRET",
     "BMPL_ADMIN_DISCORD_IDS", "BMPL_BNET_CLIENT_ID", "BMPL_BNET_CLIENT_SECRET", "WCL_CLIENT_ID", "WCL_CLIENT_SECRET"] as const;
   // HostedConfig: add
   /** Blizzard Battle.net OAuth client (Battle.net linking spec, decision 1). */
   bnetClientId: string;
   bnetClientSecret: string;
   // validateHostedEnv's returned object: add
   bnetClientId: read(env, "BMPL_BNET_CLIENT_ID"),
   bnetClientSecret: read(env, "BMPL_BNET_CLIENT_SECRET"),
   ```
   ```ts
   // instance.ts describeConfig, after BMPL_ADMIN_DISCORD_IDS
   { key: "BMPL_BNET_CLIENT_ID", value: config.bnetClientId, secret: false },
   { key: "BMPL_BNET_CLIENT_SECRET", value: config.bnetClientSecret ? SET : NOT_SET, secret: true },
   ```
   - `TEST_HOSTED_CONFIG`: add `bnetClientId: "bnet-test-client", bnetClientSecret: "bnet-test-secret"`.
   - `test/cli-serve.test.ts`: add the two fields to both literal `hostedConfig` objects.
   - `.env.hosted.example`: line 1 becomes "The nine variables above the "Optional" line are required." After
     `BMPL_ADMIN_DISCORD_IDS=`, add:
     ```
     # Battle.net application (https://community.developer.battle.net → API Access → Create New Client; two-factor
     # authentication required). Redirect URL to register: <BMPL_BASE_URL>/auth/bnet/callback
     BMPL_BNET_CLIENT_ID=
     BMPL_BNET_CLIENT_SECRET=
     ```
3. Run the gate. Commit `feat(hosted): BMPL_BNET_CLIENT_ID / _SECRET, required in hosted mode`.

## Task 2 — Characters: cap 20, Blizzard fields, the subset rule

**Files:** `src/self/characters.ts`, `src/server/validate.ts`, `web/src/lib/self.ts`, `test/self/characters.test.ts`,
`web/src/lib/self.test.ts`, `web/src/lib/me.test.ts`, `web/src/i18n/en.ts`, `fr.ts`.

1. Tests first (`test/self/characters.test.ts`):
   - `expect(MAX_CHARACTERS).toBe(20)`.
   - `parseCharacters` keeps `bnetId` and `verifiedAt` on a `bnet` entry. It drops them from a `manual` entry. It
     drops a `bnet` entry whose `bnetId` is not a positive integer.
   - `restrictToStored(next, stored)`:
     - returns the stored objects in `next`'s order;
     - returns `null` when `next` holds an entry absent from `stored`;
     - matches case-insensitively on region, realm and name (`characterKey`);
     - an empty `next` returns `[]`.
2. Code (`src/self/characters.ts`):
   ```ts
   export const MAX_CHARACTERS = 20;
   export interface MyCharacter {
     name: string;
     /** The WCL realm slug (`payload.character.realmSlug`); Blizzard's `realm.slug` for a `bnet` entry. */
     realm: string;
     region: Region;
     source: CharacterSource;
     /** `bnet` only: Blizzard's character id, the key of the 30-day status check. */
     bnetId?: number;
     /** `bnet` only: last successful status check (or the pick), epoch ms. */
     verifiedAt?: number;
   }
   const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
   // isCharacter: add `&& (o.source !== "bnet" || (posInt(o.bnetId) && posInt(o.verifiedAt)))`
   export const characterKey = (c: { name: string; realm: string; region: Region }): string =>
     `${c.region}|${c.realm.toLowerCase()}|${c.name.toLowerCase()}`;
   // parseCharacters: use characterKey as idOf, and build
   out.push(c.source === "bnet"
     ? { name: c.name, realm: c.realm, region: c.region, source: "bnet", bnetId: c.bnetId!, verifiedAt: c.verifiedAt! }
     : { name: c.name, realm: c.realm, region: c.region, source: "manual" });
   /** Hosted PUT /api/settings (Battle.net spec, decision 4): a reorder or a subset of the stored list, never an addition. */
   export function restrictToStored(next: readonly { name: string; realm: string; region: Region }[], stored: readonly MyCharacter[]): MyCharacter[] | null {
     const byKey = new Map(stored.map((c) => [characterKey(c), c]));
     const out: MyCharacter[] = [];
     for (const c of next) {
       const s = byKey.get(characterKey(c));
       if (!s) return null;
       out.push(s);
     }
     return out;
   }
   ```
   - `validate.ts` `MY_CHARACTER`: `source: oneOf(["manual", "bnet"] as const)`, plus `bnetId: opt(int({ min: 1 }))` and
     `verifiedAt: opt(int({ min: 1 }))`. Keep the comment, reworded: "the shape the front sends back; the hosted route
     keeps only stored entries (restrictToStored)".
   - Front: `web/src/lib/self.ts` `MAX_ME = 20`.
   - Front tests that build a full list from five names: build it from
     `Array.from({ length: MAX_ME }, (_, i) => c(\`N${String.fromCharCode(97 + i)}\`))`, a valid two-letter name.
     The "Up to 5 characters" expectation becomes "Up to 20 characters".
3. `test/server-user-state.test.ts:219-228` ("a bnet entry or a sixth character is refused") is rewritten in Task 7.
   Until then, mark nothing as skipped: change its sixth-character list to 21 entries and drop the `bnet` assertion.
   Task 7 adds the real rule.
4. Run the gate. Commit `feat(self): My characters up to 20, Blizzard id and check time on bnet entries`.

## Task 3 — Schema, repository, launch migration

**Files:** `src/hosted/schema.ts`, `src/hosted/bnet-db.ts` (new), `src/hosted/db.ts`, `test/hosted/bnet-db.test.ts` (new).

1. Schema (append to `HOSTED_SCHEMA`):
   ```sql
   CREATE TABLE IF NOT EXISTS user_bnet (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     account_id TEXT NOT NULL UNIQUE,
     battletag TEXT,
     linked_at INTEGER NOT NULL,
     removed TEXT
   );
   CREATE TABLE IF NOT EXISTS bnet_imports (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     candidates TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   ```
   `removed` holds a JSON array of the `Name-Realm` labels the check round removed, shown on `/me` until the next pick
   or unlink.
2. Tests first (`test/hosted/bnet-db.test.ts`, `openHosted(new Database(":memory:"))`, users seeded with
   `upsertFromDiscord`):
   - `link.put` then `link.get`; `link.byAccount(accountId)` finds the owner; a second user putting the same account
     id throws (UNIQUE), so the route checks `byAccount` first.
   - `imports.put` overwrites. `imports.get(userId, now)` returns `null` once `now - createdAt > BNET_IMPORT_TTL_MS`
     and deletes the row.
   - `removed.add(userId, labels)` appends; `removed.clear(userId)`.
   - `unlink(userId)` removes `user_bnet`, `bnet_imports` and the `bnet` characters of `user_settings`, and keeps
     every other setting.
   - `withBnetCharacters()` lists `{ userId, characters }` for every settings row holding at least one `bnet` entry.
   - `resetManualCharacters(db, now)`:
     - removes `manual` entries and keeps `bnet` ones;
     - writes one `characters_reset` audit row per member touched (`target: "user <id>"`, `detail: {"removed": n}`);
     - a second call changes nothing and writes no row.
   - Deleting the user cascades both tables.
3. Code: `src/hosted/bnet-db.ts`:
   ```ts
   // Battle.net linking storage (spec docs/superpowers/specs/2026-10-11-battlenet-linking-design.md): the link, the
   // one-hour candidate list of an import, the labels the 30-day check removed, and the launch migration.
   import type { Database } from "bun:sqlite";
   import { parseCharacters, type MyCharacter } from "../self/characters.ts";
   import type { Region } from "../wow/regions.ts";

   export const BNET_IMPORT_TTL_MS = 60 * 60 * 1000;

   /** One character of the account as `/profile/user/wow` lists it, already checked against bmpl's name/realm rules. */
   export interface BnetCandidate { bnetId: number; name: string; realm: string; realmName: string; region: Region; level: number; classID: number | null }
   export interface BnetLink { userId: number; accountId: string; battletag: string | null; linkedAt: number; removed: string[] }

   export interface BnetRepo {
     link: { get(userId: number): BnetLink | null; byAccount(accountId: string): number | null; put(userId: number, accountId: string, battletag: string | null, now: number): void };
     imports: { put(userId: number, candidates: BnetCandidate[], now: number): void; get(userId: number, now: number): { candidates: BnetCandidate[]; createdAt: number } | null; delete(userId: number): void };
     removed: { add(userId: number, labels: string[]): void; clear(userId: number): void };
     /** Every member whose list holds a `bnet` entry (the check round's input). */
     withBnetCharacters(): Array<{ userId: number; characters: MyCharacter[] }>;
     /** DELETE /api/bnet: the link, any import, and the `bnet` entries of the list. */
     unlink(userId: number, now: number): void;
   }
   ```
   Implement the repo with prepared statements, following `src/hosted/defensives.ts`. Notes:
   - `unlink` reads `user_settings.characters` through `parseCharacters`, filters `source !== "bnet"`, and writes it
     back with `UPDATE user_settings SET characters = ?, updated_at = ? WHERE user_id = ?`, all in `db.transaction`.
   - `withBnetCharacters` uses `SELECT user_id, characters FROM user_settings WHERE characters LIKE '%"bnet"%'`, then
     `parseCharacters` and a filter.
   - `resetManualCharacters(db, now): number` uses `SELECT user_id, characters FROM user_settings WHERE characters LIKE '%"manual"%'`,
     writes the filtered list back, and inserts
     `INSERT INTO audit_log (at, user_id, action, target, detail, ip) VALUES (?, ?, 'characters_reset', ?, ?, NULL)`.
     It returns the number of members touched.
   - `db.ts`: `HostedDb` gains `bnet: BnetRepo`. `openHosted` calls `resetManualCharacters(db, Date.now())` after
     `applyHostedSchema`, with the comment "Battle.net spec, decision 7: hosted members' manual entries go at the
     first start of the release; self-detecting, so later starts are no-ops", and builds `bnet: openBnet(db)`.
4. Run the gate. Existing hosted tests that seed `source: "manual"` characters now see them removed when the server
   reopens the db (`test/server-season.test.ts:82` seeds one): seed `source: "bnet"`, `bnetId`, `verifiedAt` instead.
   Commit `feat(hosted): Battle.net link and import tables, launch removal of manual characters`.

## Task 4 — Audit actions

**Files:** `src/hosted/audit.ts`, `web/src/lib/admin.ts`, `web/src/i18n/en.ts`, `fr.ts`, `test/hosted/audit.test.ts`,
`web/src/lib/admin.test.ts`.

1. Add `"bnet_link" | "bnet_unlink" | "bnet_character_removed" | "characters_reset"` to `AuditAction`. All four get
   kind `"login"` in `ACTION_KIND`, with the account actions, and in the front's `AUDIT_KIND_OF`.
2. `auditDetail` cases (each with a test):
   - `bnet_link`: `t("admin.audit.detail.bnetLink", { battletag })`, "linked {battletag}".
   - `bnet_character_removed`: `t("admin.audit.detail.bnetRemoved", { character, reason })`, "{character} · {reason}",
     where reason is `not_found`, `invalid`, `other_id` or `unchecked_30d`, kept raw.
   - `characters_reset`: `t("admin.audit.detail.charactersReset", { count })`, a plural "{count} manual character(s) removed".
   - `bnet_unlink`: `""`.
3. Gate, commit `feat(hosted): audit actions for Battle.net linking`.

## Task 5 — Blizzard HTTP client

**Files:** `src/hosted/bnet.ts` (new), `test/hosted/bnet.test.ts` (new), `test/fixtures/bnet-profile-eu.json`,
`test/fixtures/bnet-profile-us.json`, `test/fixtures/bnet-status-valid.json` (new, hand-written from the documented
shape: `wow_accounts[].characters[]` with `id`, `name`, `realm{slug,name}`, `playable_class{id}`, `level`; status
`{ id, is_valid }`; names and ids fictional).

Every call goes through an injected `fetchFn`; errors are returned, never thrown (as `discord.ts`).

```ts
// Battle.net OAuth and WoW Profile API (Battle.net linking spec, section "Sources"). Server-side only.
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

export type BnetFailure = { ok: false; kind: "scope" | "down" | "invalid"; error: string };
export type Cfg = { bnetClientId: string; bnetClientSecret: string; baseUrl: string };

export function bnetAuthorizeUrl(cfg: Cfg, state: string): string { /* client_id, response_type=code, scope, redirect_uri, state */ }
export async function exchangeBnetCode(cfg: Cfg, code: string, fetchFn: typeof fetch): Promise<{ ok: true; accessToken: string; scope: string | null } | BnetFailure>;
export async function fetchBnetUser(token: string, fetchFn: typeof fetch): Promise<{ ok: true; accountId: string; battletag: string | null } | BnetFailure>;
/** One region: `[]` on 404 (no account there, or the privacy option off). 401/403 → scope. */
export async function fetchAccountCharacters(token: string, region: Region, fetchFn: typeof fetch): Promise<{ ok: true; candidates: BnetCandidate[] } | BnetFailure>;
/** Every region merged, deduplicated by region + id, sorted by level (high first) then name. */
export function mergeCandidates(lists: BnetCandidate[][]): BnetCandidate[];
/** Application token (client credentials), cached until 60 s before `expires_in`. */
export class BnetAppToken { constructor(cfg: Cfg, fetchFn: typeof fetch); get(now: number): Promise<{ ok: true; token: string } | BnetFailure>; }
/** The status endpoint: `valid`, `gone` (404, is_valid false, another id) or a failure (network, 429, 5xx). */
export async function characterStatus(token: string, c: { region: Region; realm: string; name: string; bnetId: number }, fetchFn: typeof fetch):
  Promise<{ ok: true; outcome: "valid" } | { ok: true; outcome: "gone"; reason: "not_found" | "invalid" | "other_id" } | BnetFailure>;
```

Rules:
- `exchangeBnetCode` POSTs `grant_type=authorization_code&code=…&redirect_uri=…` as form-urlencoded with the Basic
  header. A non-2xx answer gives `invalid`. A `scope` string without `wow.profile` gives `scope`.
- `fetchBnetUser` reads `id` (number or string, else `sub`) and `battletag`. A missing id gives `invalid`.
- Every Profile call sends `Authorization: Bearer …` (the docs reject query-string tokens since 2024-09-30).
  - Account list: 404 → `[]`; 401/403 → `scope`; 429/5xx/network → `down`.
  - Candidates: `name` must match `CHARACTER_PATTERNS.name` and `realm.slug` must match `CHARACTER_PATTERNS.realm`,
    else the character is skipped. `classID = playable_class?.id ?? null`.
- `characterStatus` builds the path with `encodeURIComponent(realm)` and `encodeURIComponent(name.toLowerCase())`.
  - 404 → `gone/not_found`.
  - `is_valid === false` → `gone/invalid`.
  - `id !== bnetId` → `gone/other_id`.

Tests (fake `fetchFn` switching on the URL, throwing on an unexpected one, as `test/server-auth.test.ts:16-29`):
- authorize URL params;
- the Basic header and body of the code exchange;
- the scope refusal;
- userinfo with a numeric id, with `sub`, and with none;
- the account list for 200 (fixture), 404, 403 and 500;
- a skipped invalid name;
- merge order and dedupe;
- the app token cached across two `get` calls and refreshed after expiry;
- each status outcome.

Gate, commit `feat(hosted): Blizzard OAuth and profile client for Battle.net linking`.

## Task 6 — Routes

**Files:** `src/server/routes-bnet.ts` (new), `src/server.ts`, `src/hosted/runtime.ts`, `test/server-bnet.test.ts` (new).

Runtime: `HostedRuntime` gains `bnetStates: OAuthStates` (its own instance, so a Discord state is never consumed
here) and `bnetApp: BnetAppToken`. `server.ts` registers `...bnetRoutes(runtime)` after `authRoutes`.

| Route | Auth | Does |
|---|---|---|
| `GET /auth/bnet/start` | user | issues a state, sets the `bmpl_bnet` nonce cookie (path `/auth/bnet`, 600 s, HttpOnly, SameSite=Lax), 302 to `bnetAuthorizeUrl` |
| `GET /auth/bnet/callback` | public (checks the session itself) | the flow below, always a 302 to `/me?bnet=<code>` |
| `GET /api/bnet` | user | `{ ok, link: { battletag, linkedAt } \| null, removed: string[], import: { candidates, createdAt } \| null }` |
| `PUT /api/bnet/characters` | user | body `BNET_PICK_BODY = obj({ picks: arr(obj({ region: oneOf(REGIONS), bnetId: int({ min: 1 }) }), { min: 1, max: MAX_CHARACTERS }) })` |
| `DELETE /api/bnet` | user | `rt.db.bnet.unlink`, audit `bnet_unlink`, `{ ok: true }` |

Callback flow, in order (each failure clears the nonce cookie and redirects):
1. No session user → `/me?bnet=state`.
2. `?error=access_denied` (or any `error`) → `cancelled`.
3. Missing `code`, `state` or cookie, or `!rt.bnetStates.consume(...)` → `state`.
4. `exchangeBnetCode`:
   - `scope` → `scope`;
   - anything else not ok → `down`.
5. `fetchBnetUser` not ok → `down`.
6. `rt.db.bnet.link.byAccount(accountId)` is another user → `taken`, with audit `login_denied`
   `{ reason: "bnet_taken" }` and target `user <id>`.
7. For each of `BNET_REGIONS`, `fetchAccountCharacters`:
   - `scope` → `scope`;
   - `down` → `down` (nothing stored).
8. `link.put(user, accountId, battletag, now)`, audit `bnet_link` `{ battletag }`.
9. Merged candidates empty → `empty`. Otherwise `imports.put` → `pick`.

Errors go to `rt.errors.push(err, "bnet callback")`, never with the code or a token. `console.error` gets
`bnet link: <kind>` only.

`PUT /api/bnet/characters`:
- `imports.get` null → 410 `{ error: "bnet_import_expired" }`.
- A pick not in the candidates → 400 `bnet_unknown_character`.
- Otherwise:
  - write `characters` = picks mapped to `{ name, realm, region, source: "bnet", bnetId, verifiedAt: now }`, in the
    picks' order;
  - delete the import, clear `removed`;
  - answer `{ ok: true, settings }`.

Tests (`test/server-bnet.test.ts`, harness of `test/server-auth.test.ts` with a fake fetch for the Blizzard URLs and
`loginAs` for the session):
- the start redirect params and cookie;
- a full callback to `/me?bnet=pick`, with the rows written;
- each error code: cancelled, state (no cookie; replayed state), scope, taken, empty, down;
- `GET /api/bnet`;
- a pick in order;
- the 410 and the 400;
- unlink;
- `DELETE /api/me` removes both tables (cascade).

Gate, commit `feat(server): Battle.net link, import and unlink routes`.

## Task 7 — Hosted settings: no additions

**Files:** `src/server/routes-user.ts`, `test/server-user-state.test.ts`.

In the `PUT /api/settings` handler, after `parseSettingsPatch`:
```ts
if (parsed.patch.characters !== undefined) {
  const kept = restrictToStored(parsed.patch.characters, rt.db.settings.get(ctx.user!.id).characters);
  if (kept === null) return jsonResponse({ ok: false, error: "characters_from_bnet", message: "Characters come from your Battle.net account: link it on My characters." }, 400);
  parsed.patch.characters = kept;
}
```
Tests replace the old "a bnet entry or a sixth character is refused" test:
- removing one stored entry: 200;
- reordering: 200, order kept, `bnetId` and `verifiedAt` kept;
- adding a `manual` one: 400 `characters_from_bnet`;
- adding a `bnet` one not stored: 400;
- a 21-entry list: 400 (validation).

Update the season and lookup test seeds that relied on manual characters (Task 3 note).

Gate, commit `feat(server): hosted My characters come only from Battle.net`.

## Task 8 — The 30-day check

**Files:** `src/hosted/bnet-check.ts` (new), `src/hosted/runtime.ts`, `test/hosted/bnet-check.test.ts` (new).

```ts
export const BNET_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const BNET_CHECK_AFTER_MS = 25 * 24 * 60 * 60 * 1000;
export const BNET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** One round (spec decision 6). Never throws; returns counts for the log. */
export async function checkBnetCharacters(deps: { db: HostedDb; audit: AuditLog; app: BnetAppToken; fetchFn: typeof fetch; now: number }):
  Promise<{ checked: number; kept: number; removed: number; failed: number }>;
```

For each `withBnetCharacters()` member, for each `bnet` entry with `now - verifiedAt > BNET_CHECK_AFTER_MS`, call
`characterStatus` with the app token:
- `valid` → `verifiedAt = now`.
- `gone` → removed, audit `bnet_character_removed` `{ character: "Name-Realm", reason }` with `userId` and `target`
  passed explicitly (outside a request scope).
- A failure is kept, unless `now - verifiedAt > BNET_MAX_AGE_MS`; then it is removed with reason `unchecked_30d`.
- An app-token failure ends the round (every entry kept, except the ones past 30 days, removed).

Write each member's list once (`db.settings.update`) and `db.bnet.removed.add` the labels.

Runtime: `checkBnetCharacters` runs once 60 s after start (`setTimeout(...).unref()`), then on
`setInterval(..., BNET_CHECK_INTERVAL_MS).unref()`. A round is skipped while the previous one is still running.

Tests, with a fake fetch and fixed `now`:
- not due (24 d);
- valid → `verifiedAt` updated;
- each gone reason;
- a network error at 26 d keeps it;
- a network error at 31 d removes it;
- a token failure;
- labels added to `removed`;
- the audit rows.

Gate, commit `feat(hosted): re-check Battle.net characters every 30 days`.

## Task 9 — Canvas (gate for Tasks 10–11)

Follow `docs/agents/web-front.md` "Design first" exactly:
1. Read the artifact (https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s) first, in case it was edited in the GUI.
2. Copy `docs/design/canvas/*` to a scratch dir and add a page `{ "id": "bnet", "name": "Battle.net linking" }`, an
   annotation `bnet-brief`, and these artboards (1440 × 800, x = 0 / 1560 / 3120, details at y = 940):
   - `BnetPickA.dc.html`, `BnetPickB.dc.html`, `BnetPickC.dc.html`: three picker variants. Each shows the account list
     (class colour name, realm, region chip, level), the ticks, the main marker, "{n} of 20" and Save.
   - `BnetDetails.dc.html`:
     - the `/me` link card for a member without characters;
     - the linked state (BattleTag, "Import again", "Unlink" with its confirmation);
     - the removal notice;
     - each `?bnet=` error;
     - the result-page header with and without "This is me" (the spec's open point);
     - the `/privacy` paragraph;
     - local mode unchanged.
3. Lift every value from `app.css` and `tokens.css`; no new token. Battle.net is a brand name, not copy, and gets no
   brand colour (`--discord` stays the sign-in only).
4. Seed and republish the same artifact with `contract: "0.1.31"`, favicon 🛡️ and no capabilities. Copy the sources
   back into `docs/design/canvas/`.
5. Commit `docs(design): Battle.net linking artboards`. **Stop and ask the user to choose** a picker variant and the
   "This is me" rule. Record the answer in the spec's decision 10 and amend Tasks 10–11 with the chosen variant's
   markup before going on.

## Task 10 — Front: API, view models, strings

**Files:** `web/src/api.ts`, `web/src/types.ts`, `web/src/lib/bnet.ts` (new) + test, `web/src/lib/self.ts` + test,
`web/src/lib/me.ts` + test, `web/src/i18n/en.ts`, `fr.ts`.

- `types.ts` re-exports `BnetCandidate` from `@shared/hosted/bnet-db.ts`.
- `api.bnet`:
  ```ts
  bnet: {
    get: () => call<{ link: { battletag: string | null; linkedAt: number } | null; removed: string[]; import: { candidates: BnetCandidate[]; createdAt: number } | null }>("/api/bnet"),
    pick: (picks: { region: Region; bnetId: number }[]) => call<{ settings: Settings }>("/api/bnet/characters", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ picks }) }),
    unlink: () => call<Record<never, never>>("/api/bnet", { method: "DELETE" }),
  },
  ```
- `lib/bnet.ts`, pure and tested:
  - `BNET_CODES = ["pick", "cancelled", "state", "scope", "taken", "empty", "down"] as const`;
    `bnetCodeOf(search): BnetCode | null`.
  - `bnetNotice(t, code)` returns `{ text, tone: "bad" | "muted" } | null`, with the spec's error-table wording.
  - `pickKey(c) = \`${c.region}|${c.bnetId}\``.
  - `togglePick(picked, key, max = MAX_ME)` returns `string[] | null` (null when full).
  - `makeMainPick(picked, key)`.
  - `pickerRows(t, candidates, picked)` returns rows `{ key, name, realm: realmName, region: regionLabel, level, classID, checked, main }`.
  - `pickCount(t, picked)` returns "{n} of 20".
  - `picksBody(candidates, picked)` returns picks in `picked` order.
  - `removedNotice(t, removed)`.
- `lib/self.ts`:
  - `toggleMe(chars, p, hosted)`: hosted can only remove (returns `null` for an addition).
  - `meChip(t, chars, p, hosted)`: hidden (`null`) in hosted mode for a character not on the list, unless the canvas
    answer keeps it as a pointer.
- `lib/me.ts`: `addCharacter` is unchanged (local only).
- Strings:
  - New `me.bnet.*` keys: link card, picker, linked line, unlink confirmation, notices, removal notice.
  - `me.sub` split into `me.subLocal` / `me.subHosted`, dropping "until Battle.net linking". `me.bnet` and
    `me.bnetChip` are replaced.
  - New `privacy.bnet` / `privacy.bnetLine`; `privacy.historyLine` and `privacy.deleteLine` mention the Battle.net link.
  - French mirrors with "tu"; `i18n.test.ts` stays green.

Gate, commit `feat(web): Battle.net linking view models and strings`.

## Task 11 — Front: screens

**Files:** `web/src/App.tsx`, `web/src/components/me/*` (new `BnetCard.tsx`, `BnetPicker.tsx`),
`web/src/components/self/MeChip.tsx`, `web/src/components/self/ResultHead.tsx`, `web/src/components/Detail.tsx`,
`web/src/components/account/PrivacyPage.tsx`, `web/src/styles/app.css`.

- `App.tsx`: `const bnetCode = bnetCodeOf(location.search);` at module level, next to `page`, passed to `MePage`.
- `MePage`, hosted:
  - no add field and no "This is me" hint;
  - `BnetCard` (link / linked / notices) above the list;
  - `BnetPicker` when `GET /api/bnet` returns an import;
  - the list rows as today (make main, remove).
- `MePage`, local: unchanged.
- After a pick: `self.setCharacters` with the returned settings' characters (no second PUT).
- The link button is a plain `<a className="btn btn-primary" href="/auth/bnet/start">`, like `SignIn.tsx:29`'s Discord
  link: a top-level navigation, allowed by the CSP.
- Errors: a page-local `Toast` (pattern `SettingsPage.tsx:23-44`).
- `MeChip` and its two call sites pass `self.hosted`.
- Markup exactly as the chosen canvas variant (Task 9 amends this task).

Verify in a browser before committing:
- Local mode: `just build`, then `./bmpl serve`, and check `/me` (unchanged).
- Hosted screens: there is no fake Blizzard server, so run `just web-dev` against a hosted `bmpl serve` on a scratch
  db seeded with a `user_bnet` row, a `bnet_imports` row and `bnet` characters. That shows the picker, the linked
  state and the removal notice. Open `/me?bnet=<code>` for each notice.

The real OAuth round trip is checked in Task 13. Gate, commit
`feat(web): Battle.net link card, picker and linked state on My characters`.

## Task 12 — Docs

- `docs/hosted.md`:
  - "Login": a Battle.net paragraph (client creation, two-factor, redirect `https://<host>/auth/bnet/callback`).
  - "Privacy and account deletion": what is stored, the 30-day check, unlink.
  - "Environment": add the row `BMPL_BNET_CLIENT_ID` / `BMPL_BNET_CLIENT_SECRET` to the required table.
  - "Routes": the five routes.
- `docs/operator.md`:
  - § 7: the secret rotation row ("new links fail until updated; linked characters are unaffected").
  - § 10: "Battle.net link lands on `/me?bnet=down`" (redirect URI mismatch, client secret, Blizzard outage) and
    "`/me?bnet=empty`" (the member's Blizzard privacy option).
- `deploy/README.md`: "nine" variables; the Blizzard client next to the Discord application in step 3; the rotation
  prose.
- `docs/agents/architecture.md`: the routes, the tables, the timer, the migration, the "never store a Blizzard
  token" rule.
- `docs/agents/web-front.md`: the `lib/bnet.ts` view models, the components map entry, the canvas page "bnet".
- `AGENTS.md`: the roadmap line (Battle.net linking implemented).
- The parent spec's decision 1 gains "implemented <date>". This spec's status line gets "implemented <date>".
- `test/docs-links.test.ts` stays green (anchors `#login`, `#environment` unchanged).

Commit `docs: Battle.net linking`.

## Task 13 — Review and live check

1. Whole-branch review (spec + quality). Fix the findings in loops; list the deferred minors in the final report.
2. Gate, `bun audit` on both lockfiles.
3. PR, merge and release only when the user asks.
4. After the release, the spec's "Live check" with the operator's account. Record:
   - the real `/userinfo` keys;
   - one realm slug with a space or an apostrophe, against WCL;
   - whether the list matches the armory;
   - that a manual `Name-Realm` can no longer be added;
   - that unlink empties the list.

   Write the results into the spec's "Live check" section. No WCL points unless a sync is started.
