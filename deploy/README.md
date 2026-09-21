# deploy/

Templates and scripts for running bmpl in hosted mode on a bare VPS (Debian/Ubuntu), behind Caddy, with SQLite continuously replicated by litestream. The full runbook is below, under [Deploying on a VPS](#deploying-on-a-vps).

| File | VPS path | Purpose |
|---|---|---|
| `bootstrap.sh` | run once, from this directory | Installs Caddy, litestream, ufw, sqlite3; creates the `bmpl` system user and the `deploy` user; opens 22/80/443 only; installs the units below and enables them |
| `sudoers-bmpl-deploy` | `/etc/sudoers.d/bmpl-deploy` | What `deploy` may do without a password: install the binary and restart `bmpl` as root, anything as `bmpl` |
| `restore-test.sh` | `/usr/local/sbin/bmpl-restore-test` | `just deploy-restore-test`: restores the latest replica into a scratch dir, checks it opens (runs as user `bmpl`) |
| `Caddyfile` | `/etc/caddy/Caddyfile` | Reverse proxy to `127.0.0.1:3000`, automatic HTTPS, HSTS, compression |
| `bmpl.service` | `/etc/systemd/system/bmpl.service` | Runs `/opt/bmpl/bmpl serve --hosted --port 3000 --host 127.0.0.1` as user `bmpl`, hardened, `Restart=always` |
| `litestream.yml` | `/etc/litestream.yml` | Continuous replication config for `/opt/bmpl/bmpl.db` to an S3-compatible bucket |
| `litestream.service` | `/etc/systemd/system/litestream.service` | Runs `litestream replicate -config /etc/litestream.yml` |
| `backup-check.sh` | `/usr/local/sbin/bmpl-backup-check` | Verifies the newest litestream snapshot is fresh; touches `/opt/bmpl/last-backup` (runs as user `bmpl`, root-owned script) |
| `bmpl-backup-check.service` | `/etc/systemd/system/bmpl-backup-check.service` | Oneshot wrapper around `bmpl-backup-check`, runs as `User=bmpl` |
| `bmpl-backup-check.timer` | `/etc/systemd/system/bmpl-backup-check.timer` | Runs the backup check hourly |

Also expected on the VPS but not shipped from here: the `bmpl` binary at `/opt/bmpl/bmpl` and the env file at `/opt/bmpl/.env` (mode 600, owner `bmpl`) — see `just deploy` and `.env.hosted.example` at the repo root.

Copy both this `deploy/` directory and `.env.hosted.example` to the VPS before running `bootstrap.sh` (or copy the whole repo).

## Order of operations

1. `sudo bash bootstrap.sh bmpl.example.com` on the fresh VPS (the scripts ship with the exec bit set; `bash bootstrap.sh` also works if it was lost in transfer) — installs packages, the `bmpl` and `deploy` users, the firewall rules, and the systemd units (enabled, not started).
2. Put your public key in `/home/deploy/.ssh/authorized_keys` — `just deploy` logs in as `deploy`, never as root.
3. Fill `/opt/bmpl/.env` on the VPS (copied from `.env.hosted.example` by bootstrap if absent) with real secrets.
4. Fill `/etc/litestream.yml` with the real bucket, endpoint and keys (or a local `type: file` replica).
5. `BMPL_DEPLOY_HOST=deploy@bmpl.example.com just deploy` from your machine — builds and ships the `bmpl` binary to `/opt/bmpl/bmpl`, then starts/restarts `bmpl.service`.
6. First deploy only: `sudo systemctl start litestream bmpl-backup-check.timer`.
7. Verify: `systemctl status bmpl caddy litestream bmpl-backup-check.timer`, hit `https://bmpl.example.com/api/health` (`curl -s … | jq .warnings` should print `[]` once the first backup snapshot and check have run), and after the first hour check `/opt/bmpl/last-backup` exists.

`/opt/bmpl/.env` also takes four optional variables beyond the required ones: `BMPL_OPEN_SIGNUP`, `BMPL_DISCORD_GUILD_ID`, `BMPL_ENCRYPTION_KEY` (enables members' own Warcraft Logs clients — generate with `openssl rand -base64 32`), `BMPL_OPERATOR`. See `.env.hosted.example` and [docs/hosted.md](../docs/hosted.md#environment) for what each does.

## Deploying on a VPS

One Linux VPS runs one instance: `bmpl serve --hosted` binds `127.0.0.1:3000`
(`--host` / `BMPL_HOST` override it; local mode keeps Bun's default), Caddy
owns 80/443 and proxies to it with automatic HTTPS, litestream replicates
`bmpl.db` to a bucket. The server-side files live in `deploy/` (the table
above maps each one to its path on the VPS); the client side is the `justfile`
(`build-linux`, `deploy`, `deploy-status`, `deploy-logs`, `deploy-restore-test`).
Every `deploy-*` recipe is run from your machine, by you, never by an automated
agent, and logs in as the `deploy` user — root is for the operator's own
administration (`.env`, `litestream.yml`, re-running `bootstrap.sh`).

**1. What you need.** A Debian/Ubuntu VPS with a public IPv4 and root SSH; a
DNS `A` record `bmpl.<domain>` pointing at it, live before bootstrap (Caddy
needs it to obtain the certificate); an S3-compatible bucket (Backblaze B2,
Hetzner Object Storage, …) with an application key that can read and write
it; a Discord application (see [Login](../docs/hosted.md#login)); a Warcraft Logs API client
(see [the README](../README.md#getting-warcraft-logs-api-credentials)). On your machine: this repo,
Bun, `just`, and an SSH key that opens `root@<vps>` (bootstrap and
administration) — the same key or a dedicated one goes to `deploy@<vps>` for
the `deploy-*` recipes.

**2. Bootstrap** (once). Key-only SSH first: on Ubuntu 24.04 cloud images
`/etc/ssh/sshd_config.d/50-cloud-init.conf` sets `PasswordAuthentication yes`
and overrides the main file. sshd keeps the *first* value it reads and the
drop-ins are included in lexical order, so put `PasswordAuthentication no` in
a drop-in that sorts *before* it, `/etc/ssh/sshd_config.d/00-bmpl.conf` (a
`zz-` name is silently ignored; deleting the cloud-init drop-in also works),
then `sshd -t && systemctl restart ssh`. Verify with `sshd -T | grep -i
passwordauthentication` and keep the current session open until a fresh
key-based login works. Then, from the repo root:

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
shell, home `/opt/bmpl`, mode 750) and the `deploy` user (bash, home
`/home/deploy`, member of `systemd-journal`, sudo limited by
`/etc/sudoers.d/bmpl-deploy` to `install … /opt/bmpl/bmpl`, `systemctl
restart bmpl` and anything as `bmpl`); writes `/etc/caddy/Caddyfile` with your
domain and runs `caddy validate`; installs `bmpl.service`,
`litestream.service`, `bmpl-backup-check.service` and
`bmpl-backup-check.timer` into `/etc/systemd/system/` and the two scripts,
root-owned, at `/usr/local/sbin/bmpl-backup-check` and
`/usr/local/sbin/bmpl-restore-test`; installs the
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

**3. Configure.** First the deploy key: `ssh root@<vps> 'cat >>
/home/deploy/.ssh/authorized_keys' < ~/.ssh/id_ed25519.pub` (the file already
exists with the right owner and mode), then check `ssh deploy@<vps> sudo -n
-l` lists the two root commands and `(bmpl) ALL`. Then `ssh root@<vps> 'nano
/opt/bmpl/.env'` and fill every
variable of [the environment table](../docs/hosted.md#environment): `BMPL_BASE_URL=https://bmpl.<domain>`,
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
BMPL_DEPLOY_HOST=deploy@<vps> just deploy
ssh root@<vps> 'systemctl start litestream bmpl-backup-check.timer'   # first deploy only: the database now exists
BMPL_DEPLOY_HOST=deploy@<vps> just deploy-status  # unit states, /api/health (backupAgeS = the last-backup marker's age)
BMPL_DEPLOY_HOST=deploy@<vps> just deploy-logs    # journalctl -u bmpl -f
```

`just deploy` runs `build-linux` (Vite build of the web front, then
`bun build --compile --target=bun-linux-x64` → `dist/bmpl-linux`; it
cross-compiles from any OS), copies the binary to `/home/deploy/bmpl.new`,
installs it as `/opt/bmpl/bmpl` (owner `bmpl`, mode 755) and runs
`systemctl restart bmpl` through the two sudo rules, then polls `http://127.0.0.1:3000/api/health` for
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

Test the restore without touching production: `BMPL_DEPLOY_HOST=deploy@<vps>
just deploy-restore-test` runs `/usr/local/sbin/bmpl-restore-test` as user
`bmpl`: it restores the latest replica into a temporary directory on the VPS,
runs `PRAGMA integrity_check` and counts the `users` rows, then deletes the
directory. Do it once after the first day of
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
`BMPL_DEPLOY_HOST=deploy@<vps> just deploy`. The schema is additive
(`CREATE … IF NOT EXISTS`), there is no migration step, and cached WCL data is
kept. Downgrade: check out the previous commit and `just deploy` again. If the
`deploy/` files changed, copy them again and re-run `bootstrap.sh` (it keeps
your `.env` and `litestream.yml`), then `systemctl restart bmpl litestream`
if the units changed.

**9. Auto-deploy from GitHub.** `.github/workflows/deploy.yml` ships a
published release (`gh release create vX.Y.Z --generate-notes`, or the
*Releases* page) — never a plain push to `main`. The job checks the tag
against `"version"` in `package.json` (bump it in the release commit),
installs with frozen lockfiles, runs `just check` and `bun test` (no `.env`:
everything runs on fakes, no WCL points), builds `dist/bmpl-linux`, then does
exactly what `just deploy` does over SSH as the `deploy` user, and finally
checks `<BMPL_PUBLIC_URL>/api/health` reports `ok` with the new version. A
failure before the SSH step leaves the VPS untouched. *Run workflow* on the
Actions page re-deploys any ref by hand (`gh workflow run deploy --ref
vX.Y.Z`), which is also the rollback. It needs, in the repository settings:

| Kind | Name | Value |
|---|---|---|
| secret | `BMPL_DEPLOY_SSH_KEY` | a private key whose public half is in `/home/deploy/.ssh/authorized_keys` — a dedicated one (`ssh-keygen -t ed25519 -C bmpl-ci`), so it can be revoked alone |
| secret | `BMPL_DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 <ip>` — the VPS host key, pinned instead of trusting on first use |
| variable | `BMPL_DEPLOY_HOST` | `deploy@<ip>` |
| variable | `BMPL_PUBLIC_URL` | `https://bmpl.<domain>` |

`gh secret set BMPL_DEPLOY_SSH_KEY < key`, `gh secret set
BMPL_DEPLOY_KNOWN_HOSTS < known_hosts`, `gh variable set BMPL_DEPLOY_HOST
--body deploy@<ip>`. Revoke the CI key by deleting its line in
`/home/deploy/.ssh/authorized_keys`; rotate the host key secret after a
reinstall of the VPS. `concurrency: deploy` queues overlapping runs instead
of interleaving them.

**10. Uninstall.** On the VPS as root:

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
