# Better Mythic+ Logs (`bmpl`)

A CLI that queries Warcraft Logs and renders a compact vetting view for any
WoW character's Mythic+ profile. Built for the "someone applied to my key —
should I invite them?" question.

## What you get

For a given character and target key level, `bmpl lookup` shows:

- **Identity**: name, spec, class, current season M+ score, region/server rank
- **Target check**: `✓ has N run(s) at or above +<target>`
- **Best run at the previous level**: DPS/HPS, parse %, date, report link — falls back to N−2, N−3… if nothing at N−1
- **Per-dungeon profile**: one best run per dungeon in the season (8 entries),
  sorted by key level. Median stats, coverage (`6/8 at or above +18`), and a
  stale-data warning for runs older than 14 days.
- **Gameplay quality per run** (fetched from each run's raw log, cached forever
  in a local `bmpl.db`): **timed / depleted** with chest count and clear time,
  **deaths** with what killed them and whether it was a group wipe, **DTPS vs
  the DPS in the same group**, **avoidable damage** (Blizzard's in-game
  classification, list courtesy of
  [postmortem](https://github.com/Sharpened-Banana/postmortem)), **interrupts
  normalized by the spec's kick cooldown** vs peers, and **dispels**. Skip with
  `--no-stats` to save API budget (~10 pts per uncached run).
- **Raider.IO profile** (free, no key): item level, last 10 runs with
  timed/depleted, current + previous season score per role. A missing previous
  season shows `—` — the player may simply have rerolled.

If you don't pass `--level`, the target auto-detects to the level the
character actually plays at — the median of their best run per dungeon, not
their single highest key (which is often a lone depleted push) — so
`bmpl lookup Biwaadrood-Nerzhul` "just works".

The metric also auto-selects: `hps` for healers, `dps` for DPS and tanks.

## Requirements

- [Bun](https://bun.sh/) ≥ 1.3 (pinned in `.tool-versions` for asdf/mise users)
- A Warcraft Logs v2 API client — free, see below
- `just` (optional but recommended) — https://github.com/casey/just
- For building from source: the web front builds with Vite (`just web-install`
  once, then `just build`). Node is not required — Bun runs Vite.
- For a VPS: `just build-linux` cross-compiles the hosted binary
  (`dist/bmpl-linux`) from any OS — see *Deploying on a VPS*.

`bmpl` caches WCL run enrichment and Raider.IO responses in a local SQLite
file, `bmpl.db`, created next to your `.env`. It's git-ignored; override the
location with `BMPL_DB_PATH` if you want it elsewhere.

## Getting Warcraft Logs API credentials

`bmpl` uses Warcraft Logs' v2 API, which requires a Client ID + Secret.
Creating them takes ~30 seconds.

1. Log in at https://www.warcraftlogs.com/ (any free account works).
2. Go to https://www.warcraftlogs.com/api/clients/
   (or: avatar → **Clients** under the API section).
3. Click **Create Client**.
4. Fill the form:
   - **Application Name**: anything, e.g. `bmpl`
   - **Redirect URLs**: required but unused for our flow — put
     `http://localhost` (this is a server-to-server client, no browser
     redirect happens)
   - **Public Client?**: leave **unchecked** — `bmpl` uses the
     `client_credentials` OAuth flow, which needs a confidential client.
5. Submit. The page now shows your **Client ID** and **Client Secret** —
   copy both into your `.env` as `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET`.

Keep the secret private. If it ever leaks, return to the same page,
delete the client, and create a new one. Rate limit is **3600 points per
hour** per client, which is ~700 `bmpl lookup` calls.

## Setup

```bash
git clone git@github.com:triat/Better-mythic-plus-logs.git
cd Better-mythic-plus-logs
bun install

cp .env.example .env
# edit .env and paste your WCL_CLIENT_ID + WCL_CLIENT_SECRET

just ping
# ✓ auth ok
#   budget: 3600 / 3600 pts remaining (resets in 60m)
```

Only EU is wired up (region is hardcoded in `src/config.ts`).

## Security

- **`watch` reads every copied value** while running — passwords, tokens,
  chat messages. Only run it when actively vetting; Ctrl+C when done.
- `.env` is git-ignored. Never commit it. If it leaks, rotate the secret.
- If you share `bmpl` with others, **don't share your `.env`** — every
  lookup they run eats your 3600 pts/hr API budget. Have them register
  their own client.
- Prefer sharing the source (this repo) over shipping a binary; a compiled
  `.exe` is opaque to the recipient.
- Hosted mode: the app rate-limits and origin-checks on its own (hardening
  paragraph of *Hosted mode*) and binds `127.0.0.1`; only the reverse proxy
  owns 80/443 and adds TLS, HSTS and compression. Firewall, the `bmpl` system
  user, the hardened unit and the backups are in *Deploying on a VPS*.

## Hosted mode (multi-user)

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

**Hardening** (issue #9): state-changing requests must come from `BMPL_BASE_URL`
(Origin / Sec-Fetch-Site), `/auth/*` is limited to 10 requests per minute per IP,
lookups to 30 and analyses to 60 per minute per member (429 with `Retry-After`) —
the app reads the client IP from the last `X-Forwarded-For` entry, so the reverse
proxy must set that header (Caddy does; the shipped `deploy/Caddyfile` sets no
`trusted_proxies` and bmpl binds `127.0.0.1`, so it cannot be forged — see
*Deploying on a VPS*),
every JSON body is validated against an explicit shape (unknown fields are
refused), server errors never carry messages or paths, and the audit log
(`GET /api/admin/audit?kind=&before=&limit=`, the admin page's Audit section) keeps
90 days of logins, admin actions, quota refusals, security rejections and
WCL/server errors.

**Login.** Hosted mode signs people in with Discord (scope `identify` only —
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

**Per-account state.** Each member has their own lookup history (20 tabs, kept
in `bmpl.db` across restarts), their own "your key" and legend preference
(`GET/PUT /api/settings`), and their own live-event stream. Two members looking
up the same character within 6 hours share one WCL fetch: the second lookup
reuses the first member's result (shown as cached; **Refresh** fetches again).
Deep-dive analyses are attached when a tab is opened, so an analysis run by one
member shows up for everyone who has that run in a tab. Local mode is unchanged:
history in memory, settings in the browser.

**WCL budget.** The instance shares one Warcraft Logs API client (3600 pts/h).
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

**Your own Warcraft Logs client.** When the admin sets `BMPL_ENCRYPTION_KEY`,
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

**Privacy and account deletion.** `/privacy` (linked from the sign-in page
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

**Shared defensives table.** Corrections made from the panel are proposals:
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

**Instance info.** `GET /api/admin/instance` (and the page's Instance
section) reports the version, uptime, database size, the last backup (mtime
of a `last-backup` file next to `.env`, touched by the hourly backup check of
the VPS deployment — see *Deploying on a VPS*) and the effective environment
with secrets masked (including the four optional variables below —
`BMPL_ENCRYPTION_KEY` shows only whether a key is set). WCL errors are in the
audit log (Errors chip).

**Health.** `GET /api/health` is public and unauthenticated (for the reverse
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

### Deploying on a VPS

One Linux VPS runs one instance: `bmpl serve --hosted` binds `127.0.0.1:3000`
(`--host` / `BMPL_HOST` override it; local mode keeps Bun's default), Caddy
owns 80/443 and proxies to it with automatic HTTPS, litestream replicates
`bmpl.db` to a bucket. The server-side files live in `deploy/` (`deploy/README.md`
maps each one to its path on the VPS); the client side is the `justfile`
(`build-linux`, `deploy`, `deploy-status`, `deploy-logs`, `deploy-restore-test`).
Every `deploy-*` recipe is run from your machine, by you, never by an automated
agent.

**1. What you need.** A Debian/Ubuntu VPS with a public IPv4 and root SSH; a
DNS `A` record `bmpl.<domain>` pointing at it, live before bootstrap (Caddy
needs it to obtain the certificate); an S3-compatible bucket (Backblaze B2,
Hetzner Object Storage, …) with an application key that can read and write
it; a Discord application (see *Login* above); a Warcraft Logs API client
(see *Getting Warcraft Logs API credentials*). On your machine: this repo,
Bun, `just`, and an SSH key that opens `root@<vps>`.

**2. Bootstrap** (once). Key-only SSH first: on Ubuntu 24.04 cloud images
`/etc/ssh/sshd_config.d/50-cloud-init.conf` sets `PasswordAuthentication yes`
and overrides the main file, so put `PasswordAuthentication no` in a drop-in
that sorts after it, `/etc/ssh/sshd_config.d/zz-bmpl.conf` (or delete the
cloud-init drop-in), then `systemctl restart ssh`. Verify with `sshd -T |
grep -i passwordauthentication` and keep the current session open until a
fresh key-based login works. Then, from the repo root:

```bash
ssh root@<vps> 'mkdir -p /root/bmpl-deploy'
scp -r deploy .env.hosted.example root@<vps>:/root/bmpl-deploy/
ssh root@<vps> 'cd /root/bmpl-deploy/deploy && bash bootstrap.sh bmpl.<domain>'
```

`bootstrap.sh` is idempotent (re-run it after a `git pull` that touched
`deploy/`). It installs `curl`, `ufw`, `sqlite3`, `gnupg`, Caddy (its official
apt repository) and litestream (the `.deb` of `LITESTREAM_VERSION`, 0.3.13 by
default); sets ufw to deny incoming and allows `22/tcp`, `80/tcp`, `443/tcp`
only (port 3000 never leaves loopback); creates the `bmpl` system user (no
shell, home `/opt/bmpl`, mode 750); writes `/etc/caddy/Caddyfile` with your
domain and runs `caddy validate`; installs `bmpl.service`,
`litestream.service`, `bmpl-backup-check.service` and
`bmpl-backup-check.timer` into `/etc/systemd/system/` and the check script,
root-owned, at `/usr/local/sbin/bmpl-backup-check`; installs the
`/etc/litestream.yml` template (owner `bmpl`, mode 600) unless a file already
mentioning `/opt/bmpl/bmpl.db` is there; seeds `/opt/bmpl/.env` from
`.env.hosted.example` (never overwrites an existing `.env`); enables and
starts Caddy, and enables `bmpl`, `litestream` and the timer without starting
them — they start once configured and deployed. If sshd listens on a port
other than 22, change the `ufw allow 22/tcp` line before running the script,
or you lock yourself out. ACME starts as soon as the config loads — during
bootstrap's `reload` — and retries in the background on failure, so the DNS
`A` record must already point at the VPS before you run `bootstrap.sh`;
watch `journalctl -u caddy` to see the certificate obtained.

**3. Configure.** `ssh root@<vps> 'nano /opt/bmpl/.env'` and fill every
variable of the table above: `BMPL_BASE_URL=https://bmpl.<domain>`,
`BMPL_SESSION_SECRET` from `openssl rand -base64 48`, the Discord client id
and secret with `https://bmpl.<domain>/auth/discord/callback` registered as
the redirect URL in the Discord application, your own Discord id in
`BMPL_ADMIN_DISCORD_IDS`, the WCL client id and secret. Then
`ssh root@<vps> 'nano /etc/litestream.yml'`: `bucket`, `endpoint` (B2:
`https://s3.<region>.backblazeb2.com`; Hetzner:
`https://<region>.your-objectstorage.com`), `access-key-id`,
`secret-access-key`; keep `path: /opt/bmpl/bmpl.db`, `retention: 720h` (30
days of snapshots) and `snapshot-interval: 1h`.

**4. Deploy.** From your machine, with `BMPL_DEPLOY_HOST` exported in your
shell (`just` does not read `.env`):

```bash
BMPL_DEPLOY_HOST=root@<vps> just deploy
ssh root@<vps> 'systemctl start litestream bmpl-backup-check.timer'   # first deploy only: the database now exists
BMPL_DEPLOY_HOST=root@<vps> just deploy-status  # unit states, /api/health, last-backup marker
BMPL_DEPLOY_HOST=root@<vps> just deploy-logs    # journalctl -u bmpl -f
```

`just deploy` runs `build-linux` (Vite build of the web front, then
`bun build --compile --target=bun-linux-x64` → `dist/bmpl-linux`; it
cross-compiles from any OS), copies the binary to `/opt/bmpl/bmpl.new`,
installs it as `/opt/bmpl/bmpl` (owner `bmpl`, mode 755), runs
`systemctl restart bmpl` and polls `http://127.0.0.1:3000/api/health` for
up to 30 s; when the app does not answer it prints the last 30 journal lines
and exits 1 (the previous binary is already replaced — deploy the last good
commit to roll back). The first admin is the Discord id you put in
`BMPL_ADMIN_DISCORD_IDS`: open `https://bmpl.<domain>`, **Sign in with
Discord**, open `/admin` and invite the others by Discord id (they read theirs
on the *Invitation required* notice).

**5. Monitor.** Point UptimeRobot (or any HTTP pinger) at
`https://bmpl.<domain>/api/health`: 200 with `"ok":true`, 503 with
`"db":"error"` when the database is unreachable (Caddy itself checks the same
URL every 30 s and answers a 5xx of its own while bmpl is down). `ok` covers
only the database; a stale backup or a shared budget running low show up as
text in the response's `warnings` array without flipping `ok`, so watch them
separately — a cron or uptime-check body match on
`curl -s https://bmpl.<domain>/api/health | jq .warnings` is enough to page
on `"no backup marker"`, `"last backup N h ago"` or `"shared WCL budget under
100 pts"` instead of checking the backup marker by hand. The admin page's
Instance section shows the same version, uptime, database size and *last
backup*, plus the effective environment (including whether open signup, the
guild gate and members' own WCL clients are on). Errors: `journalctl -u bmpl`
(or `just deploy-logs`), the Caddy access log at `/var/log/caddy/bmpl.log`,
and the audit log (`/admin` → Audit) for logins, bans, account deletions,
quota refusals, security rejections and WCL/server errors. If a guild behind
one NAT hits the `/auth/*` limit (10 per minute per IP), the numbers are
`DEFAULT_RATE_LIMITS` in `src/hosted/ratelimit.ts`.

**6. Backups and restore.** litestream replicates the WAL continuously and
takes a snapshot every hour; `bmpl-backup-check.timer` runs
`/usr/local/sbin/bmpl-backup-check` hourly as user `bmpl`, which lists the
snapshots, fails if the newest is older than 90 minutes (`MAX_AGE_MIN`), and
otherwise touches `/opt/bmpl/last-backup` — the file whose mtime the admin
page shows as *last backup*. "never (no last-backup file yet)" means the
timer has not passed yet or the check fails: `journalctl -u bmpl-backup-check`
says which. Restore, on the VPS as root:

```bash
systemctl stop bmpl litestream
mv /opt/bmpl/bmpl.db /opt/bmpl/bmpl.db.bak
mv /opt/bmpl/bmpl.db-wal /opt/bmpl/bmpl.db-wal.bak 2>/dev/null; mv /opt/bmpl/bmpl.db-shm /opt/bmpl/bmpl.db-shm.bak 2>/dev/null
litestream restore -config /etc/litestream.yml -o /opt/bmpl/bmpl.db /opt/bmpl/bmpl.db
chown bmpl:bmpl /opt/bmpl/bmpl.db
systemctl start litestream bmpl
```

Test the restore without touching production: `BMPL_DEPLOY_HOST=root@<vps>
just deploy-restore-test` restores the latest replica into a temporary
directory on the VPS, runs `PRAGMA integrity_check` and counts the `users`
rows, then deletes the directory. Do it once after the first day of
replication and note the date; repeat after changing the bucket or its key.

**7. Rotate a secret.** `BMPL_SESSION_SECRET`: new value in `/opt/bmpl/.env`,
`systemctl restart bmpl` — session cookies are signed with it, so every
cookie stops verifying and everyone signs in again. Discord client secret:
regenerate it in the Discord application, edit `.env`, restart `bmpl`. WCL
client secret: same, from https://www.warcraftlogs.com/api/clients. Bucket
key: new key in `/etc/litestream.yml`,
`systemctl restart litestream`, then `just deploy-restore-test` to prove the
new key reads the replica.

**8. Upgrade.** `git pull` on your machine, then
`BMPL_DEPLOY_HOST=root@<vps> just deploy`. The schema is additive
(`CREATE … IF NOT EXISTS`), there is no migration step, and cached WCL data is
kept. Downgrade: check out the previous commit and `just deploy` again. If the
`deploy/` files changed, copy them again and re-run `bootstrap.sh` (it keeps
your `.env` and `litestream.yml`), then `systemctl restart bmpl litestream`
if the units changed.

**9. Uninstall.** On the VPS as root:

```bash
systemctl disable --now bmpl litestream bmpl-backup-check.timer
rm /etc/systemd/system/{bmpl,litestream,bmpl-backup-check}.service /etc/systemd/system/bmpl-backup-check.timer
rm /usr/local/sbin/bmpl-backup-check /etc/litestream.yml
apt-get remove litestream
systemctl daemon-reload
userdel bmpl && rm -rf /opt/bmpl
rm -f /var/log/caddy/bmpl.log*
```

Then remove the site block from `/etc/caddy/Caddyfile` (`systemctl reload
caddy`, or `apt-get remove caddy`), and delete the bucket.

## Repo layout

```
src/
  cli.ts          command dispatch
  config.ts       env → config
  mplus.ts        fetch + analyze (auto-metric, spec filter, per-dungeon)
  lookup.ts       shared lookup flow: rankings → analysis → (WCL enrichment ‖ Raider.IO)
  watch.ts        clipboard polling
  roles.ts        spec → role mapping
  util.ts         realm slugging, age formatting
  format.ts       color helpers
  format-mplus.ts rendering
  web-static.ts   maps request paths to embedded web/dist assets
  web-assets.ts   embeds web/dist into the binary at build time
  wow/classes.ts  class names + hex colors (shared by CLI and web front)
  wcl/            OAuth2 + GraphQL client + queries + types
  signals/        gameplay-quality signals (the "vetting" layer)
    types.ts          shared types (RunSignals, RioProfile, ...)
    wcl-run.ts         parse a raw WCL run report into RunSignals
    enrich.ts          fetch/parse signals for the runs a lookup displays
    kick-cooldowns.ts  per-spec interrupt cooldowns
    peers.ts           peer-comparison medians
    rio-client.ts      Raider.IO fetch with retry/backoff + cache
    rio-profile.ts     parse a raw Raider.IO profile
    summary.ts         cross-run aggregates (tiles / compare rows)
    store.ts           SQLite cache (WCL runs + Raider.IO profiles)
    avoidable/         per-dungeon avoidable-damage spell lists
  deepdive/       defensive-cooldown deep-dive (the "bmpl analyze" layer)
    types.ts          shared types (RunDefensives, DefensiveUse, DeepdiveSummary, ...)
    defensives.json   shipped per-spec defensive tables
    table.ts          effective table: shipped + override, patch/add/ignore
    wcl.ts            fetch a run's cast/buff/death events from WCL
    analyze.ts        usage-vs-capacity + per-death defensive audit
    aggregate.ts      cross-run summary of analyses (the Survival sub-signals live in src/evaluation/)
    attach.ts         attaches deepdive/deepdiveSummary to a lookup payload
    player.ts         resolves the character's actor id / class / spec from the cached run
    run.ts            analyze one run end to end
scripts/
  introspect.ts                    GraphQL schema explorer (dev-only)
  import-postmortem-avoidable.ts   regenerate signals/avoidable/*.json from postmortem
deploy/
  Caddyfile, bmpl.service, litestream.yml, litestream.service,
  backup-check.sh, bmpl-backup-check.{service,timer}, bootstrap.sh
                                   VPS files (see "Deploying on a VPS"); README.md maps each to its path
test/
  *.test.ts, signals/*.test.ts, fixtures/   bun:test suite + fixture data
docs/
  agents/         developer / AI-agent guide (architecture, front, testing, workflow) — entry point: AGENTS.md at the root
  superpowers/    design specs and implementation plans, one per sub-project
  design/canvas/  source artboards of the Claude Design canvas used for UI mockups
web/
  src/
    lib/          pure, tested view models (format, verdict, radar, history,
                   axes, tiles, runs, compare)
    components/   Home, Detail, Compare, Setup, Header, Tabs, Toast,
                   VerdictHero, AxisRows, Radar, SignalTiles, DungeonRuns,
                   RioSection
    api.ts        fetch wrapper for /api/*
    types.ts      type-only re-exports from src/
    styles/       CSS
  dist/           built output (git-ignored), embedded into the binary by
                   src/web-assets.ts
```
