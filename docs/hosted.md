# bmpl — hosted mode (multi-user)

Detailed reference; the README has the short version.

`bmpl serve --hosted` (or `BMPL_MODE=hosted`) runs one instance for several
people behind a reverse proxy: Discord login (invite-only, an optional open
signup, or a Discord-server allow-list), per-account lookup history and
settings, a shared WCL budget with per-member hourly quotas or a member's own
Warcraft Logs client, a shared/proposed defensives table, a privacy page and
self-service account deletion, and an admin page (`/admin`) that can ban
accounts. It disables the local-only routes (`/api/setup`, `/api/quit`,
clipboard watch), never opens a browser, adds security headers (CSP, nosniff,
frame-ancestors none, …) and exposes `GET /api/health` for the proxy's health
check and an uptime monitor.

## Hardening

State-changing requests must come from `BMPL_BASE_URL`
(Origin / Sec-Fetch-Site), `/auth/*` is limited to 10 requests per minute per IP,
lookups to 30 and analyses to 60 per minute per member (429 with `Retry-After`) —
the app reads the client IP from the last `X-Forwarded-For` entry, so the reverse
proxy must set that header (Caddy does; the shipped `deploy/Caddyfile` sets no
`trusted_proxies` and bmpl binds `127.0.0.1`, so it cannot be forged — see
[Deploying on a VPS](../deploy/README.md#deploying-on-a-vps)),
every JSON body is validated against an explicit shape (unknown fields are
refused), server errors never carry messages or paths, and the audit log
(`GET /api/admin/audit?kind=&before=&limit=`, the admin page's Audit section) keeps
90 days of logins, admin actions, quota refusals, security rejections and
WCL/server errors.

## Login

Hosted mode signs people in with Discord (scope `identify` only —
no e-mail, no server list — unless `BMPL_DISCORD_GUILD_ID` is set, which adds
`guilds` and reads the member's server list once at sign-in to check
membership; nothing from that list is stored). The guild gate is checked at
sign-in only: a member who leaves the server keeps their session until it
expires or an admin revokes it. Create an application at
https://discord.com/developers/applications → OAuth2: copy the *Client ID*
and *Client Secret* into `BMPL_DISCORD_CLIENT_ID` / `BMPL_DISCORD_CLIENT_SECRET`
and add the redirect `https://<your host>/auth/discord/callback`. By default
access is invite-only: the Discord ids in `BMPL_ADMIN_DISCORD_IDS` are admins
and can always sign in; everyone else needs an invite — `bmpl invite
<discord-id> [--note "guild mate"]` on the server (`bmpl invite --list`,
`--remove <id>`), or the admin page (`/admin`, admins only): invites with a
note, who signed in, remove. Setting `BMPL_OPEN_SIGNUP=true` lets any Discord
account sign in without an invite (still subject to the guild gate and to
bans); new accounts that get in through open signup — not invited, not an
admin — are limited to 5 per hour per source IP (`?denied=rate` when that
limit is hit). A banned account (admin page → Users
→ Ban) is refused at sign-in regardless of invite or open signup. The sign-in
page is a single **Sign in with Discord** button; a refused sign-in comes
back to it with a notice: *Invitation required* shows the Discord id (with a
Copy button) so the user can send it to you; *Members of the guild's Discord
only*, *Account banned* and *Too many new accounts* explain the other three
(`?denied=<discordId>|guild|banned|rate`). Sessions last 30 days (sliding) in
an `HttpOnly` cookie; **Sign out** ends one. Removing an id from
`BMPL_ADMIN_DISCORD_IDS` does not demote an existing admin — change the role
on the admin page (Users → make admin / make member) or via
`POST /api/admin/users/:id/role`; **Revoke sessions** signs a user out
everywhere (`POST /api/admin/users/:id/sessions/revoke`); **Ban** (`POST
/api/admin/users/:id/ban`) does the same and blocks every future sign-in
(**Unban** reverses it); an admin cannot ban themselves or another config
admin, and a banned member's rows stay until they delete their account or an
admin unbans them.

## Per-account state

Each member has their own lookup history (20 tabs, kept
in `bmpl.db` across restarts), their own "your key" and legend preference
(`GET/PUT /api/settings`), and their own live-event stream. Two members looking
up the same character within 6 hours share one WCL fetch: the second lookup
reuses the first member's result (shown as cached; **Refresh** fetches again).
Deep-dive analyses are attached when a tab is opened, so an analysis run by one
member shows up for everyone who has that run in a tab. Local mode is unchanged:
history in memory, settings in the browser.

## WCL budget

The instance shares one Warcraft Logs API client (3600 pts/h).
Every point spent is measured from the `rateLimitData` WCL returns and charged
to the member whose request spent it. Each member may spend
`BMPL_POINTS_PER_USER_HOUR` points per calendar hour (default 300; admins are
exempt); a lookup or an analysis that would exceed it is refused with
`429 { error: "quota", message, used, limit, resetInS }` before the step that
would exceed it: a refusal before the rankings query or before an analysis
spends nothing; a lookup refused before its run enrichment has already paid
the rankings query (about 10 pts), which is why the first check blocks as soon
as fewer than 10 pts are left. Cached data — a tab in your history, a run
already in the cache, an analysis already done — never counts. Whatever the quotas say, the client is
not knowingly driven below 100 points left (the floor is checked against the last `rateLimitData`
seen and the estimates, so it is best effort) (`429 { error: "budget", … }`), so cached lookups keep
working for everyone. The user menu (avatar · name, top right) shows "N of L pts left this hour"
with a bar and the reset time; the header itself only turns red ("quota reached · resets in N min")
once nothing is left. Analyze buttons are disabled with that reset time as tooltip when the estimate
exceeds what is left; a 429 shows the server's message as a toast and refreshes the numbers
(from `error: "quota"` bodies — the member's own; a `budget` refusal only shows the toast).
`GET /api/me` and every lookup/analysis response carry `quota`, and admins can read
`GET /api/admin/usage` (this hour per member, the client's last
`rateLimitData`, the last 24 hourly totals) — the admin page shows it as a
gauge (this hour vs the client's limit, reset countdown, top consumers, the
last 24 h per hour). Estimates before spending:
rankings ≈ 10 pts, each uncached run ≈ 10 pts, an analysis ≈ 3 pts. Attribution
is exact when requests do not overlap and approximate when they do; the hour's
total is always exact.

## Your own Warcraft Logs client

When the admin sets `BMPL_ENCRYPTION_KEY`,
a member can add their own WCL client (`/settings`, "Your Warcraft Logs
client" card, or `GET/PUT/DELETE /api/me/wcl-client` and `POST
/api/me/wcl-client/verify`): create one at
https://www.warcraftlogs.com/api/clients (any name, no redirect URL needed)
and paste the client id and secret. Saving (and "Verify again") sends one 0-pt
PING to WCL to check the credentials before they are stored; the secret is
encrypted at rest (AES-256-GCM, `BMPL_ENCRYPTION_KEY`), never returned by the
API and never logged — the card only ever shows the abbreviated client id
(`a3f1…9c2e`). Every lookup and deep-dive the member runs afterwards goes
through *their* client instead of the shared one: it does not count against
`BMPL_POINTS_PER_USER_HOUR`, does not touch the shared budget shown on
`/api/admin/usage`, and the user menu shows "Your WCL client · 1 412 / 3 600
pts" instead of the shared quota line. Without `BMPL_ENCRYPTION_KEY` the
feature is off instance-wide (`GET /api/status` → `wclClients: false`, the
settings card reads "This instance does not store WCL clients"); losing the
key after members have saved clients makes those rows undecryptable (a member
simply saves their client again). `PUT`/`POST /api/me/wcl-client/verify` are
rate-limited like a lookup (30/min per member).

## Privacy and account deletion

`/privacy` (linked from the sign-in page
and the user menu, readable signed out) lists exactly what a row in `bmpl.db`
can hold about a member: Discord id/username/avatar, lookup history, settings,
hourly WCL usage, defensives proposals, an own WCL client if added, and the
30-day session and 90-day audit rows. Settings → **Delete my account** (typing
the word "delete" to confirm) calls `DELETE /api/me`, which records the
deletion in the audit log, deletes the user row (cascading to sessions,
history, settings, usage, their own defensives proposals and their own WCL
client), clears the session cookie and signs them out. An approved defensives
correction lives in a separate table keyed by the *deciding* admin, so it
stays in the shared table regardless of what happens to the account that
proposed it; if the deleted account had itself approved or decided other
members' proposals as an admin, those rows keep the correction but lose the
admin's name. The audit log keeps the member's Discord id, the username they
had at deletion and their IP for up to 90 days, unlinked from any account.

## Shared defensives table

Corrections made from the panel are proposals:
they apply to you immediately (marked "pending review" — in the panel a
yellow dot before the entry, a blue one for the approved layer, and a "Your
proposals" footer with each decision and the admin's note; the actions read
"Propose + major / Propose ignore / Propose cd / Propose removal" for members
(admins keep the local wording, their correction is approved on the spot))
and to everyone once an admin approves them (the admin page's proposal queue
shows what changes — current → proposed — with the author; `GET
/api/admin/proposals` returns the same rows with `current`, `POST
/api/admin/proposals/:id/approve|reject { note }` decides); a rejected one is
dropped for you too, with the admin's note visible in `GET /api/defensives`
→ `proposals`. An admin's own correction is approved on the spot. The
server's `defensives.json` is not used in hosted mode; the approved layer
lives in
`bmpl.db` (`bmpl defensives <Class> <Spec> --shared` and `just
audit-defensives --shared` read it).

## Instance info

`GET /api/admin/instance` (and the page's Instance
section) reports the version, uptime, database size, the last backup (mtime
of a `last-backup` file next to `.env`, touched by the hourly backup check of
the VPS deployment — see
[Deploying on a VPS](../deploy/README.md#deploying-on-a-vps)) and the effective environment
with secrets masked (including the four optional variables below —
`BMPL_ENCRYPTION_KEY` shows only whether a key is set). WCL errors are in the
audit log (Errors chip).

## Health

`GET /api/health` is public and unauthenticated (for the reverse
proxy and an uptime monitor): `{ ok, version, uptimeS, db, hosted: true,
users, sessions, wcl: { pointsSpentThisHour, limitPerHour, pointsResetIn } |
null, backupAgeS: number | null, warnings: string[] }`. `ok` only reflects the
database (`db: "error"` → `ok: false`, HTTP 503); `warnings` never flips it,
so alert on it separately — e.g. an uptime check or cron running `curl -s
https://<host>/api/health | jq .warnings` and paging on a non-empty array.
Today's warnings: `"no backup marker"` (no `last-backup` file yet),
`"last backup N h ago"` (older than 2 hours), and `"shared WCL budget under
100 pts"` (the instance-wide floor, not a member's own quota). Local mode
keeps the plain `{ ok, version, uptimeS, db }`.

## Environment

Required environment (copy `.env.hosted.example`):

| Variable | Meaning |
|---|---|
| `BMPL_BASE_URL` | Public origin, no path (`https://bmpl.example.com`) |
| `BMPL_SESSION_SECRET` | ≥ 32 random bytes (`openssl rand -base64 48`); placeholders and low-variety strings are refused |
| `BMPL_DISCORD_CLIENT_ID` / `BMPL_DISCORD_CLIENT_SECRET` | Discord OAuth application |
| `BMPL_ADMIN_DISCORD_IDS` | Comma-separated Discord user ids of the admins |
| `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` | The shared Warcraft Logs client |

Optional:

| Variable | Meaning |
|---|---|
| `BMPL_POINTS_PER_USER_HOUR` | WCL points each member may spend per calendar hour (default 300; admins are exempt) |
| `BMPL_OPEN_SIGNUP` | `true` lets any Discord account sign in without an invite (default `false`) |
| `BMPL_DISCORD_GUILD_ID` | Only accounts in this Discord server may sign in (adds the `guilds` OAuth scope) |
| `BMPL_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`); enables members' own WCL clients — losing it makes stored clients unusable |
| `BMPL_OPERATOR` | Who runs this instance, shown on `/privacy` (default "the admin of this instance") |

Missing or invalid variables make `bmpl serve --hosted` exit with code 2 and
the list of what to fix. Local mode (`bmpl serve`) is unchanged.

## Routes

Auth is the hosted-mode gate (`src/hosted/auth.ts`'s `authGate`); local mode
never gates a request, so every route below is reachable without signing in
when it is registered locally at all. Shared routes (`src/server/routes-shared.ts`)
are registered in both modes; the local-only routes
(`src/server/routes-local.ts`) are registered only in local mode; the
`/auth/*`, `/api/me`, `/api/settings`, `/api/me/wcl-client*` and
`/api/admin/*` routes (`src/server/routes-auth.ts`, `routes-user.ts`,
`routes-admin.ts`) are registered only in hosted mode.

| Method | Path | Auth | What |
|---|---|---|---|
| POST | `/api/lookup` | user | Run a lookup (rankings → analysis → WCL/RIO enrichment) |
| POST | `/api/deepdive` | user | Run the defensive-cooldown deep-dive on one run |
| GET | `/api/defensives` | user | Effective defensives table (shipped + override/shared, with proposals) |
| POST | `/api/defensives` | user | Local mode: edit `defensives.json`. Hosted mode: propose a correction |
| GET | `/api/history` | user | List the caller's lookup history (local: process-wide; hosted: per-member) |
| DELETE | `/api/history` | user | Clear the caller's lookup history |
| GET | `/api/history/:key` | user | One history entry (hosted: with today's cached analyses attached) |
| DELETE | `/api/history/:key` | user | Remove one history entry |
| GET | `/api/events` | user | Server-sent events: watcher/lookup status stream |
| GET | `/api/health` | public | Health check for the reverse proxy / uptime monitor |
| GET | `/api/status` | public | Whether credentials are set, hosted config flags (open signup, guild gate, own WCL clients, operator) |
| GET | `/api/docs` | public | The documentation registry plus the effective evaluation config, for `/help` |
| POST | `/api/setup` | local mode only | Write `WCL_CLIENT_ID`/`WCL_CLIENT_SECRET` to `.env` |
| POST | `/api/watch/start` | local mode only | Start clipboard watch |
| POST | `/api/watch/stop` | local mode only | Stop clipboard watch |
| GET | `/api/watch/status` | local mode only | Clipboard watch status |
| POST | `/api/quit` | local mode only | Stop the watcher and exit the process |
| GET | `/auth/discord` | public | Start the Discord OAuth flow |
| GET | `/auth/discord/callback` | public | Discord OAuth callback: admits, checks the guild gate, creates the session |
| POST | `/auth/logout` | public | End the caller's session |
| GET | `/api/me` | user | The signed-in member, their quota status and own WCL client (if any) |
| DELETE | `/api/me` | user | Delete the caller's account (cascades sessions, history, settings, usage, proposals, own WCL client) |
| GET | `/api/settings` | user | The caller's settings ("your key", legend preference) |
| PUT | `/api/settings` | user | Update the caller's settings |
| GET | `/api/me/wcl-client` | user | The caller's own WCL client, if set |
| PUT | `/api/me/wcl-client` | user | Save the caller's own WCL client (verified with a 0-pt PING first) |
| POST | `/api/me/wcl-client/verify` | user | Re-verify the caller's saved WCL client |
| DELETE | `/api/me/wcl-client` | user | Remove the caller's own WCL client |
| GET | `/api/admin/invites` | admin | List invites |
| POST | `/api/admin/invites` | admin | Add an invite (Discord id + optional note) |
| DELETE | `/api/admin/invites/:discordId` | admin | Remove an invite (also revokes that user's sessions) |
| GET | `/api/admin/audit` | admin | Paged audit log (`kind`, `before`, `limit`) |
| GET | `/api/admin/usage` | admin | WCL budget gauge: this hour per member, the shared client's last `rateLimitData`, last 24 hourly totals |
| GET | `/api/admin/proposals` | admin | Pending/approved/rejected defensives proposals (`status`) |
| POST | `/api/admin/proposals/:id/approve\|reject` | admin | Decide a defensives proposal |
| GET | `/api/admin/users` | admin | List users with usage, session count and admin/own-client flags |
| POST | `/api/admin/users/:id/sessions/revoke\|ban\|unban\|role` | admin | Revoke sessions, ban/unban, or change a user's role |
| GET | `/api/admin/instance` | admin | Version, uptime, database size, last backup, effective environment (secrets masked) |
