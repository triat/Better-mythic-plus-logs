# Operating a bmpl instance

This is the runbook for the person running a hosted bmpl instance day to
day: shipping a change, checking health, managing members, moderating the
defensives table, watching the WCL budget, backing up and restoring,
rotating secrets, tuning the scoring model, picking up a new season, and
troubleshooting. It assumes a VPS already set up per
[deploy/README.md](../deploy/README.md#deploying-on-a-vps) — `bmpl.service`,
`caddy`, `litestream` and `bmpl-backup-check.timer` installed and enabled —
and `BMPL_DEPLOY_HOST=user@host` exported in your own shell (`just` does not
read `.env`). Each section below is **When** it applies, **Do** the
commands, **Check** what confirms it worked, and **Reference** for the
explanation this page deliberately doesn't repeat. Replace `<vps>` with your
SSH destination (e.g. `root@bmpl.example.com`) and `<host>` with your public
hostname (e.g. `bmpl.example.com`).

## 1. Ship a change

**When** — you've merged a change to `main` and want it live.

**Do**

```bash
just check && bun test
BMPL_DEPLOY_HOST=<vps> just deploy
```

**Check**

```bash
BMPL_DEPLOY_HOST=<vps> just deploy-status   # unit states, /api/health, last-backup marker
```

`just deploy` builds `dist/bmpl-linux`, copies it to `/opt/bmpl/bmpl.new`,
installs it over `/opt/bmpl/bmpl`, restarts `bmpl.service` and polls
`/api/health` for up to 30 s; on failure it prints the last 30 journal lines
itself, so a red `deploy` is usually self-explanatory — otherwise:

```bash
BMPL_DEPLOY_HOST=<vps> just deploy-logs   # journalctl -u bmpl -f
```

**There is no automatic rollback and no previous binary kept** — the old
binary is already overwritten by the time `deploy` reports success or
failure. To roll back, deploy the last good commit instead:

```bash
git checkout <previous-sha>            # or: git revert <bad-sha>
BMPL_DEPLOY_HOST=<vps> just deploy
git checkout main                      # once you checked out a sha directly
```

**Reference** — [deploy/README.md § Deploying on a VPS, parts 4 and 8](../deploy/README.md#deploying-on-a-vps).

## 2. Is it healthy?

**When** — routine check, an uptime alert fired, or a member reports lookups
failing.

**Do**

```bash
curl -s https://<host>/api/health | jq
```

**Check** — `ok` reflects only the database (`false`/HTTP 503 means the
database is unreachable); it never flips for the three conditions below, so
read `.warnings` separately:

| Warning | Means | Action |
|---|---|---|
| `no backup marker` | no successful `bmpl-backup-check` run yet | wait for the next hourly run, or trigger it: `ssh <vps> systemctl start bmpl-backup-check.service` then `ssh <vps> journalctl -u bmpl-backup-check -n 20` |
| `last backup N h ago` (N > 2) | litestream/backup-check hasn't confirmed a fresh snapshot in over 2 hours | see [§6 Backups and restore](#6-backups-and-restore) |
| `shared WCL budget under 100 pts` | the shared client is near the floor bmpl refuses to cross | wait for the hourly reset, or see [§5 WCL budget](#5-wcl-budget) |

Also worth a look: the admin page's **Instance** section (version, uptime,
database size, last backup, effective environment) and **Audit** section's
Errors chip; `ssh <vps> journalctl -u caddy` and `ssh <vps> journalctl -u
litestream` for the reverse proxy and replication themselves.

**Reference** — [docs/hosted.md § Health](hosted.md#health), [deploy/README.md § Deploying on a VPS, part 5](../deploy/README.md#deploying-on-a-vps).

## 3. People

**When** — inviting a member, banning one, changing a role, or handling a
"how do I get in" DM.

**Do** — invites (from your machine, over SSH, since they write
`/opt/bmpl/bmpl.db`):

```bash
ssh <vps> "runuser -u bmpl -- /opt/bmpl/bmpl invite <discord-id> --note 'guild mate'"
ssh <vps> "runuser -u bmpl -- /opt/bmpl/bmpl invite --list"
ssh <vps> "runuser -u bmpl -- /opt/bmpl/bmpl invite --remove <discord-id>"
```

or the admin page (`/admin` → Invites), which does the same without SSH
access.

Open signup (anyone with a Discord account can sign in, still subject to the
guild gate and to bans):

```bash
ssh <vps> "sed -i 's/^BMPL_OPEN_SIGNUP=.*/BMPL_OPEN_SIGNUP=true/' /opt/bmpl/.env"
ssh <vps> systemctl restart bmpl
```

Guild gate (only members of one Discord server may sign in — nothing to
change on the Discord application side, the OAuth scope becomes `identify
guilds` automatically):

```bash
ssh <vps> "sed -i 's/^BMPL_DISCORD_GUILD_ID=.*/BMPL_DISCORD_GUILD_ID=<guild-id>/' /opt/bmpl/.env"
ssh <vps> systemctl restart bmpl
```

Ban / unban, promote / demote, revoke sessions: all on the admin page →
Users (or `POST /api/admin/users/:id/ban|unban|role|sessions/revoke`). A ban
ends the member's sessions immediately, refuses every future sign-in, and
keeps their data; an admin cannot ban themselves or another config admin.

Deleting *another* member's account is not a self-service admin feature — a
member deletes their own via Settings. As a last resort (e.g. a legal
request), on the VPS with the service stopped:

```bash
ssh <vps>
systemctl stop bmpl
sqlite3 /opt/bmpl/bmpl.db "PRAGMA foreign_keys=ON; DELETE FROM users WHERE discord_id='<discord-id>';"
systemctl start bmpl
```

`PRAGMA foreign_keys=ON` matters because SQLite does not enforce foreign
keys by default per connection: every dependent table (sessions, history,
settings, usage, this member's defensives proposals, their own WCL client)
is declared `ON DELETE CASCADE`, and without the pragma the `DELETE` would
silently leave those rows orphaned instead of cascading.

**Check** — `bmpl invite --list` (or the admin page) shows the expected
invites; the Users list shows the new role/ban state; a fresh sign-in
attempt is admitted or refused as intended.

**Reference** — [docs/hosted.md § Login](hosted.md#login), [docs/hosted.md § Per-account state](hosted.md#per-account-state).

## 4. Moderate defensives proposals

**When** — a member proposed a correction to the defensives table (panel's
"Propose …" actions), or an audit surfaced something wrong.

**Do** — decide pending proposals on the admin page's proposal queue
(current → proposed, with the author and a note field; approve/reject takes
an optional note the member sees). The same rows are `GET
/api/admin/proposals?status=pending` for scripting.

To see the shared table as it stands, or spend a small WCL budget to check
one spec empirically before deciding:

```bash
ssh <vps> "runuser -u bmpl -- /opt/bmpl/bmpl defensives <Class> <Spec> --shared"
just audit-defensives --shared --only <Class>:<Spec>   # ~9 pts for that spec
```

`just audit-defensives` always runs `bun scripts/audit-defensives.ts` on
**your own machine** (`justfile:149-150`) and ignores `BMPL_DEPLOY_HOST`
entirely. With `--shared`, it reads the hosted layer of *your local*
`bmpl.db` (`openHosted((await getStore())._db)`,
`scripts/audit-defensives.ts:66`) — on a fresh local database that layer is
empty, since it isn't the VPS's database. It always spends your local
`.env`'s WCL client, not any client on the VPS. To audit the live shared
layer instead, bring a copy of the VPS database local first — from a
`litestream restore` output, or `scp` it after stopping the service — and
point `BMPL_DB_PATH` (see `src/setup.ts`) at that copy:

```bash
scp <vps>:/opt/bmpl/bmpl.db ./bmpl-vps.db   # take it from a litestream restore, or stop bmpl first
BMPL_DB_PATH=./bmpl-vps.db just audit-defensives --shared --only <Class>:<Spec>   # ~9 pts for that spec, from your machine
```

For a broad or seasonal correction (many specs at once, or a mapping error
in the shipped data itself), edit `src/deepdive/defensives.json` in the repo
and bump its `version` instead of proposing member-by-member — that's a code
change, ships through [§1](#1-ship-a-change), and is not used in hosted mode
until deployed (the shared table in `bmpl.db` is what's live in the
meantime).

**Check** — the queue is empty of the decided proposal; `bmpl defensives
<Class> <Spec> --shared` shows the entry (or its removal) with the correct
values.

**Reference** — [docs/hosted.md § Shared defensives table](hosted.md#shared-defensives-table), [docs/deep-dive.md](deep-dive.md).

## 5. WCL budget

**When** — the shared-budget warning fired, a member reports "quota
reached", or you want to see who's spending the most.

**Do** — the gauge (this hour per member, the shared client's last
rate-limit snapshot, the last 24 hourly totals) is on the admin page, or
`GET /api/admin/usage`. Per-member spend is capped by
`BMPL_POINTS_PER_USER_HOUR` (default 300; admins are exempt); to change it:

```bash
ssh <vps> "sed -i 's/^BMPL_POINTS_PER_USER_HOUR=.*/BMPL_POINTS_PER_USER_HOUR=<n>/' /opt/bmpl/.env"
ssh <vps> systemctl restart bmpl
```

The 100-point floor that protects the shared client for everyone else is
not configurable. A member who adds their own WCL client (see
[docs/hosted.md](hosted.md#your-own-warcraft-logs-client)) never touches
this budget at all — their row on the admin Users page shows "own client".
To see refusals, open the admin page's Audit section filtered to **Quota**
(`GET /api/admin/audit?kind=quota` is the same rows, for scripting).

**Check** — the gauge drops back under the limit at the top of the next
calendar hour; quota/budget 429s stop.

**Reference** — [docs/hosted.md § WCL budget](hosted.md#wcl-budget), [docs/hosted.md § Your own Warcraft Logs client](hosted.md#your-own-warcraft-logs-client).

## 6. Backups and restore

**When** — routine check, or before/after a suspected data-loss incident.

**Do** — litestream replicates the WAL continuously and snapshots hourly;
`bmpl-backup-check.timer` verifies freshness hourly and touches
`/opt/bmpl/last-backup` (the admin page's *last backup*). Test a restore
without touching production, once after the first day of replication and
again after changing the bucket or its key:

```bash
BMPL_DEPLOY_HOST=<vps> just deploy-restore-test
```

A real restore, on the VPS as root:

```bash
ssh <vps>
systemctl stop bmpl litestream
mv /opt/bmpl/bmpl.db /opt/bmpl/bmpl.db.bak
mv /opt/bmpl/bmpl.db-wal /opt/bmpl/bmpl.db-wal.bak 2>/dev/null; mv /opt/bmpl/bmpl.db-shm /opt/bmpl/bmpl.db-shm.bak 2>/dev/null
litestream restore -config /etc/litestream.yml -o /opt/bmpl/bmpl.db /opt/bmpl/bmpl.db
chown bmpl:bmpl /opt/bmpl/bmpl.db
systemctl start litestream bmpl
```

The database holds members, sessions, per-member history and settings,
hourly usage, defensives proposals and the shared defensives table, the
audit log, encrypted own-WCL-client secrets, and the WCL response cache.

**Check** — `just deploy-restore-test` prints `PRAGMA integrity_check` → `ok`
and a `users` count; after a real restore, `/api/health`'s `warnings` is
empty once the next hourly check runs, and `just deploy-status` shows a
recent `last-backup`.

**Reference** — [deploy/README.md § Deploying on a VPS, part 6](../deploy/README.md#deploying-on-a-vps).

## 7. Rotate a secret

**When** — a secret leaked, expired, or rotation is due.

**Do**

| Variable | Rotate | Breaks |
|---|---|---|
| `BMPL_SESSION_SECRET` | new value in `/opt/bmpl/.env`, `systemctl restart bmpl` | every session cookie stops verifying — everyone is signed out |
| `BMPL_DISCORD_CLIENT_SECRET` | regenerate in the Discord application, edit `.env`, restart `bmpl` | new sign-ins fail until updated; existing sessions are unaffected |
| `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` (shared) | new client at https://www.warcraftlogs.com/api/clients, edit `.env`, restart `bmpl` | shared-client lookups and analyses fail (401) until updated; members with their own WCL client are unaffected |
| `BMPL_ENCRYPTION_KEY` | `openssl rand -base64 32`, edit `.env`, restart `bmpl` | every previously stored member WCL client becomes undecryptable, but silently: `credentials()` returns `null` for the row and logs `wcl client of user N cannot be decrypted (key changed?)` (`src/hosted/wcl-clients.ts:117-126`), so the shared-vs-own scope check falls back to the shared client (`src/server/deepdive.ts:25-26`) — the member sees no error, and until they re-save their client, their lookups spend the shared budget and their own quota instead of their client. The only visible sign is Settings → **Verify again**, which shows "Stored secret cannot be decrypted — save the client again" (`wcl-clients.ts:95`); saving it there fixes that one member |
| litestream bucket key | new key in `/etc/litestream.yml`, `systemctl restart litestream` | nothing live; only replication/restore until rotated — confirm with `just deploy-restore-test` |
| `BMPL_DEPLOY_HOST` | update it in your own shell/`.envrc` | never stored on the VPS; only your local `just deploy*` recipes are affected |

```bash
ssh <vps> 'nano /opt/bmpl/.env'
ssh <vps> systemctl restart bmpl
```

File mode: `/opt/bmpl/.env` must stay `600`, owner `bmpl`:

```bash
ssh <vps> stat -c '%a %U:%G' /opt/bmpl/.env   # expect: 600 bmpl:bmpl
```

**Check** — for `BMPL_SESSION_SECRET`, a previously signed-in browser tab is
signed out on its next request; for the WCL secrets, `/api/health` stays
`ok` and a fresh lookup succeeds; for the bucket key,
`just deploy-restore-test` succeeds with the new key.

**Reference** — [deploy/README.md § Deploying on a VPS, part 7](../deploy/README.md#deploying-on-a-vps), [docs/hosted.md § Environment](hosted.md#environment).

## 8. Tuning

**When** — adjusting the scoring model's curves, weights or thresholds for
this instance.

**Do** — `evaluation.json` lives next to `/opt/bmpl/.env` (or at the path in
`BMPL_EVAL_CONFIG`) and deep-merges into `src/evaluation/default-config.json`
— only list the keys you want to change:

```bash
ssh <vps> 'nano /opt/bmpl/evaluation.json'
ssh <vps> systemctl restart bmpl   # bmpl reads the config once at startup
```

Preview a change locally first, at 0 pts, against a saved payload:

```bash
bmpl evaluate saved.json          # human-readable
bmpl evaluate saved.json --json   # structured
```

A `defensives.json` next to `/opt/bmpl/.env` is **ignored in hosted mode** —
the shared table in `bmpl.db` ([§4](#4-moderate-defensives-proposals)) is
the only override that applies there. `BMPL_OPERATOR` (shown on `/privacy`)
is set the same way as any other variable, restart required.

**Check** — `bmpl evaluate saved.json` reflects the intended change before
you restart the server; a fresh lookup after restart reflects it live.

**Reference** — [docs/scoring.md § Verdict and axes](scoring.md#verdict-and-axes).

## 9. New season

**When** — WoW ships a new Mythic+ season or dungeon rotation.

**Do**, in the repo:

1. Add `src/signals/avoidable/season-<slug>.json` and wire it into the
   `avoidableSpellIdsFor` mapping (`src/signals/avoidable/index.ts`).
2. Update `src/deepdive/defensives.json` for the new dungeons and bump its
   `version`.
3. Add `expectedIlvl["<rio season slug>"]` to
   `src/evaluation/default-config.json` — or to `evaluation.json` next to
   `/opt/bmpl/.env` for an immediate fix without a redeploy.
4. Validate the defensives table against real runs of the new season:

   ```bash
   just audit-defensives
   ```

5. Ship it ([§1](#1-ship-a-change)):

   ```bash
   just check && bun test
   BMPL_DEPLOY_HOST=<vps> just deploy
   ```

**Check** — a lookup against the new season shows fresh (non-stale) item
level badges, and avoidable-damage signals populate for its dungeons.

Until steps 1 and 3 land, ilvl-vs-level falls back to the last known
season's curve, and the UI marks a run's badge stale once it's over 14 days
old — expected in the gap, not a bug.

**Reference** — [docs/scoring.md § Verdict and axes](scoring.md#verdict-and-axes), [docs/deep-dive.md](deep-dive.md).

## 10. Troubleshooting

**When** — something's broken and you need the fastest path to "why".

| Symptom | Cause | Fix |
|---|---|---|
| Login loop, lands back on `/?login=failed` | `BMPL_BASE_URL` doesn't match the redirect URL registered in the Discord application (must be exactly `<BMPL_BASE_URL>/auth/discord/callback`) | fix the mismatched one; check `ssh <vps> journalctl -u bmpl` for `discord login: <error>` |
| `403 {"error":"Cross-site request refused"}` | the request's `Origin` isn't `BMPL_BASE_URL`'s origin, or `Sec-Fetch-Site` says cross-site/same-site | usually a misconfigured `BMPL_BASE_URL` or a proxy in front of Caddy rewriting `Origin`; fix the env var or the proxy |
| `429` on a request | which limit: `/auth/*` 10/min/IP, lookups 30/min/member, deep-dive analyses 60/min/member, new-account signups 5/h/IP under open signup | expected under load; if it's one member hitting lookups, that's the per-member limit working as intended |
| "web UI not built" (503 on `/`) | binary was compiled without `web/dist` | `just build-linux` (runs `web-build` first), then [§1](#1-ship-a-change) |
| WCL `401` on shared-client lookups | shared `WCL_CLIENT_SECRET` rotated or revoked without updating `.env` | see [§7](#7-rotate-a-secret) |
| WCL `429` / "shared WCL budget under 100 pts" | shared client near or at its hourly limit | see [§5](#5-wcl-budget); wait for the hourly reset |
| A member's own WCL client fails with `OAuth failed: <status> <body> — check your client in Settings` | their stored client id/secret is wrong or revoked on the WCL side | ask them to re-verify or re-save it in Settings |
| A member's own WCL client saved fine, but their lookups silently count against the shared budget and their per-member quota, and the user menu shows the shared-quota line instead of their client — no error anywhere except Settings | `BMPL_ENCRYPTION_KEY` was rotated since they saved it: their row is now undecryptable, `credentials()` returns `null` and logs `wcl client of user N cannot be decrypted (key changed?)` (`src/hosted/wcl-clients.ts:117-126`), and `wclScopeFor` falls back to the shared client (`src/server/deepdive.ts:25-26`) | have them open Settings → **Verify again** — it shows `Stored secret cannot be decrypted — save the client again` (`wcl-clients.ts:95`) — then re-save the client |
| `database is locked` | a manual `sqlite3` session (e.g. [§3](#3-people)'s last-resort delete) left open against `bmpl.db` while `bmpl` or `litestream` is running | close the `sqlite3` session, or stop `bmpl` first next time |
| Disk filling up on the VPS | `bmpl.db` and its WAL grow with usage; litestream keeps the 30-day (`retention: 720h`) snapshot history in the *bucket*, not locally | `ssh <vps> df -h /opt/bmpl`; litestream itself uses little local disk beyond the live database |

**Reference** — [docs/cli.md § Troubleshooting](cli.md#troubleshooting), [docs/hosted.md § Hardening](hosted.md#hardening), [docs/hosted.md § Health](hosted.md#health).
