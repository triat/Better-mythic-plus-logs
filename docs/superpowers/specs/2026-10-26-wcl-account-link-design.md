# Warcraft Logs account link: "Connect Warcraft Logs" before "your own API key" — design

Status: approved 2026-10-26 ("ok go"; the operator added the redirect `https://bmpl.riat.dev/auth/wcl/callback` to the
instance's WCL client the same day). Decision 1's gate implemented 2026-10-26: `src/hosted/wcl-link.ts`,
`src/server/routes-wcl-link.ts`; result pending the first run. User's direction (2026-10-26): "il faut aller vers le 3 directement. Au lieu de
proposer d'enregistrer une clé en premier, il faut leur proposer d'authentifier leur compte WCL."

## Goal

A hosted member whose lookups hit the shared quota connects their Warcraft Logs account in two clicks (WCL's
authorization page, then back to bmpl) instead of creating an API client on warcraftlogs.com and pasting its id and
secret. From then on their lookups run on their own WCL budget, like an own client today (issue #11), and stop
drawing on the shared meter.

## Why

Production, 2026-10-26 (ops API): 20 active members in a day for the first time, 67 lookups, the shared client at
`limitPerHour: 3600`, `BMPL_POINTS_PER_USER_HOUR=300`; `page_settings` 0 visits, `wcl_client_set` 0. Nobody even
opened the page where the own client is set up. Creating a WCL API client asks a player to find a developer page,
name a client, copy two values: too much for someone who only wants to vet an applicant.

## Non-goals

- No sign-in with Warcraft Logs. Discord stays the hosted sign-in; WCL is linked to an account that exists.
- No WCL link in local mode. Local mode runs on the operator's own client.
- No private reports. bmpl reads public rankings and reports; it asks for the smallest scope WCL allows.
- No removal of the own-client option: it stays, as the advanced path (decision 5).
- No change to the quota numbers in this spec.

## Sources (2026-10-26)

`www.warcraftlogs.com/api/docs` answers 403 to both the fetch tool and curl; its content is quoted here from a web
search's extracts of that page and from two third-party clients. To re-check by hand before the plan.

| Fact | Source | Quote |
|---|---|---|
| Flows | WCL API docs (search extract) | the v2 API supports "the client credentials flow or the the authorization code flow, or the PKCE code flow" |
| Authorize / token | WCL API docs (search extract); go-wcl `AuthorizeURL` | `https://www.warcraftlogs.com/oauth/authorize`, `https://www.warcraftlogs.com/oauth/token` |
| User endpoint | WCL API docs (search extract) | the private API is at `/api/v2/user`, uses the authorization code flow, "so you have to get the user's permission" |
| Public endpoint | same | `/api/v2/client`, client credentials, "only public information is accessible" |
| Scopes | aurokin/warcraft_cli docs | "`view-user-profile` for `currentUser` data", "`view-private-reports` for private or guild-stealth reports" |
| Points | go-wcl | "The API uses an hourly point budget" (no word on per client or per user) |

**Unknown, and decisive** (decision 1): whether a request made with a member's user token is charged to the
member's own hourly budget or to bmpl's client. Also unknown: the token's lifetime, whether a refresh token is
issued, whether `/api/v2/user` answers the public queries bmpl runs (`worldData`, `characterData`, `reportData`),
and whether a scope can be omitted.

## Decisions

1. **Measure first (a gate, not a step).** Before any UI: the OAuth round trip, admin-only, behind
   `/auth/wcl/start` → WCL → `/auth/wcl/callback`. The admin connects their own WCL account once; bmpl runs the 0-pt
   `rateLimitData` query on `/api/v2/user` with the user token and on `/api/v2/client` with the instance token, then
   one cached-free lookup with the user token, and reads both counters again. The result goes in this spec:
   - the user token has its own counter (different `limitPerHour` or `pointsSpentThisHour` that moves alone): the
     feature goes ahead;
   - both counters move together: the link saves no budget; stop here and fall back to raising the shared budget
     (the operator's WCL subscription: the recalibration spec recorded 18,000 pts/h, production shows 3,600).
   Also recorded: the token's `expires_in`, a `refresh_token` or not, the scope accepted, and whether
   `/api/v2/user` answers `worldData`/`characterData`/`reportData`.
2. **One WCL client for the instance, its redirect added.** The instance's existing client (`WCL_CLIENT_ID`) gets
   the redirect `${BMPL_BASE_URL}/auth/wcl/callback` in its settings on warcraftlogs.com (the operator, once). No new
   variable. The flow uses PKCE in addition to the client secret, and a single-use `state` (the Battle.net link's
   `OAuthStates`, its own instance).
3. **Stored like an own client's secret.** The access token (and the refresh token if decision 1 finds one) is kept
   only as AES-256-GCM ciphertext (`src/hosted/crypto.ts`), with its expiry, in a `wcl_links` row per member (the WCL
   user id and name, linked date). Decrypted for one request only. Without `BMPL_ENCRYPTION_KEY` the link is not
   offered, as the own client today.
4. **Used like an own client.** A linked member's requests run through `runWithWclClient` with the user token on
   `/api/v2/user`: they bypass the shared meter and the quota gate, their spend goes to `usage_hourly_own`
   (admin page), the request log marks `client: "own"`. A member with both a link and an own client: the own client
   wins (an explicit choice). An expired or refused token: the request falls back to the shared client, and the
   member sees "Reconnect Warcraft Logs".
5. **The UI leads with the link.** Wherever bmpl suggests an own client today (the quota line in the sidebar, the
   toast on a 429, the Settings card), it offers **Connect Warcraft Logs** first; "Use your own API key" moves under
   an "Advanced" disclosure in Settings. Visible change: the Claude Design canvas first (decision of the user's
   workflow).
6. **Unlink and delete.** Settings shows the linked WCL name, the budget left this hour, **Disconnect** (deletes the
   row). Account deletion deletes it too. Audit rows: `wcl_link`, `wcl_unlink` (kind `login`). The privacy page says
   what is kept (the WCL user id and name, the encrypted token) and why.

### The gate as built (decision 1)

`GET /auth/wcl/start` (admins only) issues a `state` bound to the admin and a PKCE pair; the nonce and the verifier
ride in the HttpOnly `bmpl_wcl` cookie (path `/auth/wcl`, 10 minutes). `GET /auth/wcl/callback` checks the admin
session and the state, trades the code (basic auth + `code_verifier`), then `probeUserToken`: `rateLimitData` on
both endpoints, `currentUser`, the current Mythic+ zone and three pages of one public ladder with the user token,
`rateLimitData` again. It answers the report as JSON (token facts without the values, both counters before and after,
`verdict`: `user budget`, `instance budget`, `both moved`, `nothing moved`, `unreadable`) and logs a
`wcl_link_probe` line. Nothing is stored. Run it when no member is looking players up: a member's lookup in the same
seconds moves the instance counter too.

## Data flow

```
member → GET /auth/wcl/start (signed in, hosted, key set) → 302 warcraftlogs.com/oauth/authorize?…&state&code_challenge
WCL → GET /auth/wcl/callback?code&state → POST /oauth/token (secret + verifier) → token
   → currentUser { id name } on /api/v2/user → wcl_links row (encrypted) → 302 /settings?wcl=linked
lookup → wclScopeFor(member): own client > WCL link > shared → gql on /api/v2/user with the user token
```

## Error handling

- WCL refuses or the member cancels: back to `/settings?wcl=cancelled|failed`, a notice, nothing stored.
- `state` unknown or used: `failed`, nothing exchanged.
- Token expired or 401 on a request: the link is marked stale, the request falls back to the shared client, the
  member sees "Reconnect Warcraft Logs".
- `BMPL_ENCRYPTION_KEY` rotated: the link no longer decrypts; same as stale.

## Tests

- The flow: start (state + PKCE), callback (state single-use, code exchanged, `currentUser` read, row encrypted, no
  token in a log line or an audit row), cancel and failure paths.
- `wclScopeFor`: own client > link > shared; a stale link falls back.
- The spend of a linked member lands in `usage_hourly_own`, never in the quota gate.
- Account deletion and Disconnect remove the row.
- View models of the new UI (sidebar line, toast, Settings card), French and English.

## Out of scope

- Raising the shared quota or the operator's WCL subscription (an operator decision, no code).
- Private reports (`view-private-reports`).
- Sign-in with Warcraft Logs.
