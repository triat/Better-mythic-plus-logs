# deploy/

Templates and scripts for running bmpl in hosted mode on a bare VPS (Debian/Ubuntu), behind Caddy, with SQLite continuously replicated by litestream. See the main `README.md` § "Deploying on a VPS" for the full runbook.

| File | VPS path | Purpose |
|---|---|---|
| `bootstrap.sh` | run once, from this directory | Installs Caddy, litestream, ufw, sqlite3; creates the `bmpl` system user; opens 22/80/443 only; installs the units below and enables them |
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

1. `sudo bash bootstrap.sh bmpl.example.com` on the fresh VPS (both scripts ship with the exec bit set; `bash bootstrap.sh` also works if it was lost in transfer) — installs packages, the `bmpl` user, the firewall rules, and the systemd units (enabled, not started).
2. Fill `/opt/bmpl/.env` on the VPS (copied from `.env.hosted.example` by bootstrap if absent) with real secrets.
3. Fill `/etc/litestream.yml` with the real bucket, endpoint and keys.
4. `just deploy` from your machine — builds and ships the `bmpl` binary to `/opt/bmpl/bmpl`, then starts/restarts `bmpl.service`.
5. First deploy only: `sudo systemctl start litestream bmpl-backup-check.timer`.
6. Verify: `systemctl status bmpl caddy litestream bmpl-backup-check.timer`, hit `https://bmpl.example.com/api/health`, and after the first hour check `/opt/bmpl/last-backup` exists.

See `README.md` § "Deploying on a VPS" for the full runbook.
