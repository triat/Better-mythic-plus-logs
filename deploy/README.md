# deploy/

Templates and scripts for running bmpl in hosted mode on a bare VPS (Debian/Ubuntu), behind Caddy, with SQLite continuously replicated by litestream. See the main `README.md` § "Deploying on a VPS" for the full runbook.

| File | VPS path | Purpose |
|---|---|---|
| `bootstrap.sh` | run once, from this directory | Installs Caddy, litestream, ufw, sqlite3; creates the `bmpl` system user; opens 22/80/443 only; installs the units below and enables them |
| `Caddyfile` | `/etc/caddy/Caddyfile` | Reverse proxy to `127.0.0.1:3000`, automatic HTTPS, HSTS, compression |
| `bmpl.service` | `/etc/systemd/system/bmpl.service` | Runs `/opt/bmpl/bmpl serve --hosted --port 3000 --host 127.0.0.1` as user `bmpl`, hardened, `Restart=always` |
| `litestream.yml` | `/etc/litestream.yml` | Continuous replication config for `/opt/bmpl/bmpl.db` to an S3-compatible bucket |
| `litestream.service` | `/etc/systemd/system/litestream.service` | Runs `litestream replicate -config /etc/litestream.yml` |
| `backup-check.sh` | `/opt/bmpl/backup-check.sh` | Verifies the newest litestream snapshot is fresh; touches `/opt/bmpl/last-backup` |
| `bmpl-backup-check.service` | `/etc/systemd/system/bmpl-backup-check.service` | Oneshot wrapper around `backup-check.sh` |
| `bmpl-backup-check.timer` | `/etc/systemd/system/bmpl-backup-check.timer` | Runs the backup check hourly |

Also expected on the VPS but not shipped from here: the `bmpl` binary at `/opt/bmpl/bmpl` and the env file at `/opt/bmpl/.env` (mode 600, owner `bmpl`) — see `just deploy` and `.env.hosted.example` at the repo root.

## Order of operations

1. `sudo ./bootstrap.sh bmpl.example.com` on the fresh VPS — installs packages, the `bmpl` user, the firewall rules, and the systemd units (disabled where they still need config).
2. Fill `/opt/bmpl/.env` on the VPS (copied from `.env.hosted.example` by bootstrap if absent) with real secrets.
3. `just deploy` from your machine — builds and ships the `bmpl` binary to `/opt/bmpl/bmpl`, then starts/restarts `bmpl.service`.
4. Fill `/etc/litestream.yml` with the real bucket, endpoint and keys, then `sudo systemctl restart litestream`.
5. Verify: `systemctl status bmpl caddy litestream bmpl-backup-check.timer`, hit `https://bmpl.example.com/api/health`, and after the first hour check `/opt/bmpl/last-backup` exists.

See `README.md` § "Deploying on a VPS" for the full runbook.
