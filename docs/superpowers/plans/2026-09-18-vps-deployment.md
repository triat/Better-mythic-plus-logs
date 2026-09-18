# VPS Deployment (Caddy, systemd, litestream, `just deploy`, runbook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything needed to run bmpl hosted on one Linux VPS from the README alone: a `--host` flag (loopback by default in hosted mode), a `deploy/` directory (Caddyfile, systemd units, litestream config, backup check that writes `last-backup`, bootstrap script), `just build-linux / deploy / deploy-logs / deploy-status` recipes, and a README runbook (bootstrap, first admin, monitoring, backup restore, secret rotation, upgrade, uninstall).

**Architecture:** No product code beyond the bind address: `bmpl serve --hosted` binds `127.0.0.1:3000`; Caddy terminates TLS on 443 and proxies to it (setting `X-Forwarded-For`, which the app reads from the last entry); a `bmpl` system user runs the binary under a hardened systemd unit with `WorkingDirectory=/opt/bmpl` so `.env`, `bmpl.db` and `last-backup` sit together; litestream replicates the WAL-mode database continuously to an S3-compatible bucket, and a systemd timer verifies the replica hourly and touches `/opt/bmpl/last-backup` (the admin page's Instance section already reads its mtime). `just deploy` cross-compiles for `bun-linux-x64`, copies the binary, restarts the unit and waits for `/api/health`. The `deploy/` files are plain text checked by a small test so the docs and the units cannot drift apart.

**Tech Stack:** Bun 1.3.4 (`bun build --compile --target=bun-linux-x64`), Caddy 2 (automatic HTTPS), systemd, litestream ≥ 0.3, `just`, ufw, OpenSSH.

**Spec:** GitHub issue #10 (`gh issue view 10`), parent #1. No canvas: nothing visible changes in the UI (the Instance section's "last backup" line already exists from #8). Builds on #2 (`/api/health`), #8 (`lastBackupAt`), #9 (X-Forwarded-For handling, rate limits).

## Global Constraints

- **Never spend WCL points**; nothing here calls WCL. Tests never reach the network or a VPS.
- **Local mode untouched**: `bmpl serve` (local) keeps its bind behaviour and help defaults; only `--host`/`BMPL_HOST` are added (default `127.0.0.1` in hosted mode; local mode keeps Bun's default when neither is given — ruling: local users may rely on LAN access today).
- **Config precedence** flag > env var > file: `--host` beats `BMPL_HOST`.
- **Secrets never in the repo**: `deploy/` ships templates with placeholders (`bmpl.example.com`, `<bucket>`, `<access-key>`); `.env`, `.env.*` stay git-ignored (`.env.hosted.example` is the only committed env file).
- **The VPS files are the documentation's source of truth**: the README quotes paths and commands that exist in `deploy/`; `test/deploy.test.ts` pins the invariants (unit hardening directives, loopback proxy target, HSTS, db path, `last-backup` path, ufw ports).
- **English everywhere**; commit trailers as the session provides; `just check && bun test` green with `web/dist` absent at the end of every task; explicit `git add` paths, never `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`, `web/dist`, `dist/`.
- **Style**: 2 spaces, double quotes, trailing commas, `.ts` extensions; shell scripts `#!/usr/bin/env bash` + `set -euo pipefail`, idempotent (safe to re-run).

## File map

| File | Responsibility |
|---|---|
| `src/cli.ts` (`planServe`, help), `src/server.ts` (`ServeOptions.host`, `Bun.serve({ hostname })`, banner), `test/cli-serve.test.ts`, `test/server-hosted.test.ts` | `--host` / `BMPL_HOST`, hosted default loopback |
| `deploy/Caddyfile` | TLS + reverse proxy + HSTS + compression |
| `deploy/bmpl.service` | hardened unit for the app |
| `deploy/litestream.yml`, `deploy/litestream.service` | continuous replication to an S3-compatible bucket |
| `deploy/backup-check.sh`, `deploy/bmpl-backup-check.service`, `deploy/bmpl-backup-check.timer` | hourly replica verification → `/opt/bmpl/last-backup` |
| `deploy/bootstrap.sh` | idempotent first-time VPS setup (user, dirs, ufw, Caddy, litestream, units) |
| `deploy/README.md` | one screen: what each file is, where it goes on the VPS |
| `test/deploy.test.ts` | invariants of the files above |
| `justfile` | `build-linux`, `deploy`, `deploy-logs`, `deploy-status`, `deploy-restore-test` |
| `README.md`, `.env.hosted.example`, `docs/agents/architecture.md`, `docs/agents/workflow.md`, `docs/agents/testing.md`, `AGENTS.md` | runbook and agent docs |

---

### Task 1: `--host` flag, `BMPL_HOST`, loopback by default in hosted mode

**Files:**
- Modify: `src/cli.ts` (`planServe`, help text), `src/server.ts` (`ServeOptions.host`, `Bun.serve`, banner), `test/cli-serve.test.ts`, `test/server-hosted.test.ts`

**Interfaces:**
- `planServe(args, env)` gains `host: string | null` on every `ok: true` shape: `--host <addr>` if given, else `env.BMPL_HOST` trimmed if non-empty, else `"127.0.0.1"` when hosted, else `null` (local: Bun's default). An empty `--host` value → `{ ok: false, error: "Invalid --host value" }`. No format validation beyond non-empty (IPv6 literals and hostnames are valid inputs for `Bun.serve`).
- `ServeOptions.host?: string | null` → `Bun.serve({ hostname: opts.host ?? undefined, … })`; the banner prints `http://<host>:<port>` with `localhost` when host is null or `0.0.0.0`/`::` (so the local banner is unchanged), and in hosted mode adds `dim("  bound to <host> — put a reverse proxy in front")`.
- `bmpl serve` help: `bmpl serve  [--port <N>] [--host <addr>] [--no-open] [--hosted]` + a line `--host: bind address (hosted default 127.0.0.1 — the reverse proxy talks to it; BMPL_HOST env)`.

- [ ] **Step 1: Failing tests**

`test/cli-serve.test.ts` — update the existing `toEqual` expectations to include `host: null` (local) / `host: "127.0.0.1"` (hosted), and add:

```ts
  test("--host and BMPL_HOST: flag beats env, hosted defaults to loopback, local to Bun's default", () => {
    expect(planServe(["--host", "0.0.0.0"], {})).toMatchObject({ ok: true, host: "0.0.0.0" });
    expect(planServe([], { BMPL_HOST: "::1" })).toMatchObject({ ok: true, host: "::1" });
    expect(planServe(["--host", "10.0.0.5"], { BMPL_HOST: "::1" })).toMatchObject({ ok: true, host: "10.0.0.5" });
    expect(planServe(["--hosted"], FULL)).toMatchObject({ ok: true, host: "127.0.0.1" });
    expect(planServe(["--hosted", "--host", "0.0.0.0"], FULL)).toMatchObject({ ok: true, host: "0.0.0.0" });
    expect(planServe([], {})).toMatchObject({ ok: true, host: null });
    expect(planServe(["--host", ""], {})).toEqual({ ok: false, error: "Invalid --host value" });
  });
```

`test/server-hosted.test.ts` — append (the file already starts hosted and local servers; add a third with `host: "127.0.0.1"` or reuse the hosted one if it can take the option):

```ts
  test("runServer binds the host it is given (hosted deploy binds loopback)", async () => {
    const s = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, host: "127.0.0.1", assets });
    try {
      expect(s.hostname).toBe("127.0.0.1");
      expect((await fetch(`http://127.0.0.1:${s.port}/api/health`)).status).toBe(200);
    } finally { s.stop(true); }
  });
```

(Check how that file builds `assets` and its hosted config; mirror it. If two hosted servers in one process conflict on the store, run this test in `test/cli-serve.test.ts`'s sibling `test/server.test.ts` instead — wherever a hosted server is already spun up with a temp DB.)

- [ ] **Step 2: Run, expect failures** — `bun test test/cli-serve.test.ts test/server-hosted.test.ts`.
- [ ] **Step 3: Implement** `planServe` (`parseFlag(args, "--host")` — the existing helper; note `parseFlag` returns `undefined` when absent, `""` when given empty), the `ok: true` return shapes, `runServer` (`hostname`), the banner, the help text, and the `serve` command call site (`runServer({ …plan, host: plan.host })`).
- [ ] **Step 4: Verify and commit** — `just check && bun test` green.

```bash
git add src/cli.ts src/server.ts test/cli-serve.test.ts test/server-hosted.test.ts
git commit -m "feat(serve): --host / BMPL_HOST bind address, loopback by default in hosted mode"
```

---

### Task 2: The `deploy/` directory and its invariants test

**Files:**
- Create: `deploy/Caddyfile`, `deploy/bmpl.service`, `deploy/litestream.yml`, `deploy/litestream.service`, `deploy/backup-check.sh`, `deploy/bmpl-backup-check.service`, `deploy/bmpl-backup-check.timer`, `deploy/bootstrap.sh`, `deploy/README.md`, `test/deploy.test.ts`

**Interfaces:** the VPS layout every file and the README agree on:
- Binary `/opt/bmpl/bmpl`, env `/opt/bmpl/.env` (mode 600, owner `bmpl`), database `/opt/bmpl/bmpl.db` (+ `-wal`/`-shm`), marker `/opt/bmpl/last-backup`, litestream config `/etc/litestream.yml`, Caddyfile `/etc/caddy/Caddyfile`, units in `/etc/systemd/system/`. The app listens on `127.0.0.1:3000`. System user `bmpl` (no login shell, home `/opt/bmpl`).

- [ ] **Step 1: Failing test** — `test/deploy.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../deploy/${f}`, import.meta.url), "utf8");

describe("deploy/ files agree on the VPS layout", () => {
  test("Caddyfile proxies to loopback only, sets HSTS, compresses", () => {
    const c = read("Caddyfile");
    expect(c).toContain("reverse_proxy 127.0.0.1:3000");
    expect(c).toContain('Strict-Transport-Security "max-age=31536000');
    expect(c).toContain("encode zstd gzip");
    expect(c).not.toContain("trusted_proxies");
  });
  test("bmpl.service runs the binary as bmpl from /opt/bmpl, hardened, restarts", () => {
    const u = read("bmpl.service");
    for (const line of ["User=bmpl", "Group=bmpl", "WorkingDirectory=/opt/bmpl", "EnvironmentFile=/opt/bmpl/.env", "ExecStart=/opt/bmpl/bmpl serve --hosted --port 3000 --host 127.0.0.1", "Restart=always", "ProtectSystem=strict", "ReadWritePaths=/opt/bmpl", "NoNewPrivileges=yes", "PrivateTmp=yes", "ProtectHome=yes", "WantedBy=multi-user.target"]) expect(u).toContain(line);
  });
  test("litestream replicates /opt/bmpl/bmpl.db and runs as its own unit", () => {
    const y = read("litestream.yml");
    expect(y).toContain("path: /opt/bmpl/bmpl.db");
    expect(y).toMatch(/type: s3/);
    expect(y).toContain("<bucket>");
    const u = read("litestream.service");
    expect(u).toContain("ExecStart=/usr/bin/litestream replicate -config /etc/litestream.yml");
    expect(u).toContain("Restart=always");
  });
  test("the backup check writes /opt/bmpl/last-backup only when the replica is fresh, hourly", () => {
    const s = read("backup-check.sh");
    expect(s.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(s).toContain("set -euo pipefail");
    expect(s).toContain("litestream snapshots -config /etc/litestream.yml /opt/bmpl/bmpl.db");
    expect(s).toContain("touch /opt/bmpl/last-backup");
    expect(read("bmpl-backup-check.timer")).toContain("OnCalendar=hourly");
    expect(read("bmpl-backup-check.service")).toContain("ExecStart=/opt/bmpl/backup-check.sh");
  });
  test("bootstrap is idempotent and opens only 22, 80 and 443", () => {
    const b = read("bootstrap.sh");
    expect(b).toContain("set -euo pipefail");
    expect(b).toContain("ufw default deny incoming");
    for (const p of ["22/tcp", "80/tcp", "443/tcp"]) expect(b).toContain(`ufw allow ${p}`);
    expect(b).not.toMatch(/ufw allow 3000/);
    expect(b).toContain("useradd --system");
    expect(b).toContain("install -d -o bmpl -g bmpl -m 750 /opt/bmpl");
    expect(b).toContain("systemctl enable --now caddy");
  });
  test("no real secret or host leaks into the templates", () => {
    for (const f of ["Caddyfile", "litestream.yml", "bootstrap.sh"]) expect(read(f)).not.toMatch(/AKIA|sk_live|BEGIN (RSA|OPENSSH)/);
  });
});
```

- [ ] **Step 2: Run, expect failure** — `bun test test/deploy.test.ts` (files missing).
- [ ] **Step 3: Write the files**

`deploy/Caddyfile`:

```
# bmpl — reverse proxy with automatic HTTPS (Let's Encrypt). Replace the host name.
# Caddy sets X-Forwarded-For to the client address and strips any incoming copy
# (default when trusted_proxies is not configured) — bmpl reads the last entry.
bmpl.example.com {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}
	reverse_proxy 127.0.0.1:3000 {
		health_uri /api/health
		health_interval 30s
	}
	log {
		output file /var/log/caddy/bmpl.log
	}
}
```

`deploy/bmpl.service`:

```
[Unit]
Description=bmpl (Better Mythic+ Logs) hosted mode
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bmpl
Group=bmpl
WorkingDirectory=/opt/bmpl
EnvironmentFile=/opt/bmpl/.env
ExecStart=/opt/bmpl/bmpl serve --hosted --port 3000 --host 127.0.0.1
Restart=always
RestartSec=2
# Hardening: the process may write only its own directory (db, wal, shm).
ProtectSystem=strict
ReadWritePaths=/opt/bmpl
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
UMask=0077

[Install]
WantedBy=multi-user.target
```

`deploy/litestream.yml`:

```yaml
# Continuous replication of the SQLite database (WAL mode) to an S3-compatible bucket.
# Backblaze B2: endpoint https://s3.<region>.backblazeb2.com ; Hetzner: https://<region>.your-objectstorage.com
dbs:
  - path: /opt/bmpl/bmpl.db
    replicas:
      - type: s3
        bucket: <bucket>
        path: bmpl
        endpoint: <https://s3.endpoint.example>
        access-key-id: <access-key>
        secret-access-key: <secret-key>
        retention: 720h
        snapshot-interval: 1h
```

`deploy/litestream.service` (the package ships one; this copy pins the config path and runs as root because it must read the `bmpl`-owned WAL — `SupplementaryGroups=bmpl` + `ReadWritePaths` would also work; keep root, it is the litestream default):

```
[Unit]
Description=litestream — bmpl.db replication
After=network-online.target bmpl.service
Wants=network-online.target

[Service]
ExecStart=/usr/bin/litestream replicate -config /etc/litestream.yml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`deploy/backup-check.sh`:

```bash
#!/usr/bin/env bash
# Hourly: verify the newest litestream snapshot of bmpl.db is younger than MAX_AGE_MIN and
# touch /opt/bmpl/last-backup — the admin page's Instance section shows its mtime as "last backup".
set -euo pipefail
MAX_AGE_MIN="${MAX_AGE_MIN:-90}"
DB=/opt/bmpl/bmpl.db
MARKER=/opt/bmpl/last-backup
# `litestream snapshots` prints one row per snapshot with its creation time (RFC 3339) in the 4th column.
newest=$(litestream snapshots -config /etc/litestream.yml "$DB" | awk 'NR > 1 { print $4 }' | sort | tail -n 1)
if [ -z "$newest" ]; then echo "backup-check: no snapshot found" >&2; exit 1; fi
age_min=$(( ( $(date +%s) - $(date -d "$newest" +%s) ) / 60 ))
if [ "$age_min" -gt "$MAX_AGE_MIN" ]; then echo "backup-check: newest snapshot is ${age_min} min old (> ${MAX_AGE_MIN})" >&2; exit 1; fi
touch "$MARKER"
chown bmpl:bmpl "$MARKER"
echo "backup-check: ok, newest snapshot ${age_min} min old"
```

(Verify the column index against `litestream snapshots` output on the pinned version when testing on the VPS; the README says how — `litestream snapshots -config /etc/litestream.yml /opt/bmpl/bmpl.db` prints `replica  generation  index  created`, so `$4` is `created`.)

`deploy/bmpl-backup-check.service` / `.timer`:

```
[Unit]
Description=bmpl backup freshness check (writes /opt/bmpl/last-backup)
After=litestream.service

[Service]
Type=oneshot
ExecStart=/opt/bmpl/backup-check.sh
```

```
[Unit]
Description=Run the bmpl backup check hourly

[Timer]
OnCalendar=hourly
RandomizedDelaySec=5m
Persistent=true

[Install]
WantedBy=timers.target
```

`deploy/bootstrap.sh` (run as root on a fresh Debian/Ubuntu VPS; idempotent):

```bash
#!/usr/bin/env bash
# First-time VPS setup for bmpl hosted mode. Safe to re-run. Usage: sudo ./bootstrap.sh bmpl.example.com
set -euo pipefail
DOMAIN="${1:?usage: bootstrap.sh <domain>}"
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.3.13}"

# 1. Packages: Caddy (official repo), ufw, curl.
apt-get update -y
apt-get install -y curl ufw debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
if ! command -v litestream >/dev/null; then
  curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.deb" -o /tmp/litestream.deb
  dpkg -i /tmp/litestream.deb
fi

# 2. Firewall: SSH, HTTP (ACME), HTTPS only. The app port 3000 stays on loopback.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 3. The bmpl user and directory (.env, bmpl.db and last-backup live here).
id -u bmpl >/dev/null 2>&1 || useradd --system --home-dir /opt/bmpl --shell /usr/sbin/nologin bmpl
install -d -o bmpl -g bmpl -m 750 /opt/bmpl

# 4. Files from this directory → their places (never overwrite an existing .env or litestream.yml).
HERE="$(cd "$(dirname "$0")" && pwd)"
sed "s/bmpl\.example\.com/${DOMAIN}/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
install -m 644 "$HERE/bmpl.service" /etc/systemd/system/bmpl.service
install -m 644 "$HERE/litestream.service" /etc/systemd/system/litestream.service
install -m 644 "$HERE/bmpl-backup-check.service" /etc/systemd/system/bmpl-backup-check.service
install -m 644 "$HERE/bmpl-backup-check.timer" /etc/systemd/system/bmpl-backup-check.timer
install -m 755 "$HERE/backup-check.sh" /opt/bmpl/backup-check.sh
[ -f /etc/litestream.yml ] || install -m 600 "$HERE/litestream.yml" /etc/litestream.yml
[ -f /opt/bmpl/.env ] || { install -o bmpl -g bmpl -m 600 "$HERE/../.env.hosted.example" /opt/bmpl/.env 2>/dev/null || true; }

# 5. Services. bmpl itself starts once the binary and .env are in place (`just deploy`).
systemctl daemon-reload
systemctl enable --now caddy
systemctl enable bmpl litestream bmpl-backup-check.timer
echo "bootstrap done — next: fill /opt/bmpl/.env and /etc/litestream.yml, then 'just deploy' from your machine"
```

`deploy/README.md`: a table file → VPS path → purpose, the five-step order (bootstrap → `.env` → `just deploy` → litestream → verify), and "see README.md § Deploying on a VPS for the runbook".

- [ ] **Step 4: Verify and commit** — `bun test test/deploy.test.ts` → PASS; `bash -n deploy/*.sh` (syntax); `just check && bun test` green.

```bash
git add deploy test/deploy.test.ts
git commit -m "feat(deploy): Caddyfile, hardened systemd unit, litestream replication, hourly backup check writing last-backup, VPS bootstrap"
```

---

### Task 3: `just build-linux`, `deploy`, `deploy-logs`, `deploy-status`, `deploy-restore-test`

**Files:**
- Modify: `justfile`, `.env.hosted.example` (add the two deploy variables as comments), `.gitignore` (`dist/` already ignored — the linux binary goes to `dist/bmpl-linux`)

**Interfaces:** justfile variables `deploy_host := env_var_or_default("BMPL_DEPLOY_HOST", "")` (SSH target, e.g. `root@bmpl.example.com`) and `deploy_dir := "/opt/bmpl"`. Recipes:

```make
# cross-compile the hosted binary for the VPS (web front embedded) → dist/bmpl-linux
build-linux: web-build
    mkdir -p dist
    bun build src/cli.ts --compile --target=bun-linux-x64 --outfile dist/bmpl-linux

# ship dist/bmpl-linux to the VPS, restart the unit, wait for /api/health (BMPL_DEPLOY_HOST=user@host)
deploy: build-linux
    @test -n "{{deploy_host}}" || { echo "set BMPL_DEPLOY_HOST=user@host"; exit 2; }
    scp dist/bmpl-linux {{deploy_host}}:{{deploy_dir}}/bmpl.new
    ssh {{deploy_host}} 'install -o bmpl -g bmpl -m 755 {{deploy_dir}}/bmpl.new {{deploy_dir}}/bmpl && rm {{deploy_dir}}/bmpl.new && systemctl restart bmpl && for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && { echo "bmpl is up"; exit 0; }; sleep 1; done; echo "bmpl did not answer /api/health in 30 s" >&2; journalctl -u bmpl -n 30 --no-pager; exit 1'

# follow the app log on the VPS
deploy-logs:
    ssh {{deploy_host}} 'journalctl -u bmpl -f'

# unit states, health, last backup marker
deploy-status:
    ssh {{deploy_host}} 'systemctl --no-pager status bmpl caddy litestream bmpl-backup-check.timer | grep -E "●|Active:"; curl -fsS http://127.0.0.1:3000/api/health; echo; stat -c "last-backup: %y" {{deploy_dir}}/last-backup 2>/dev/null || echo "last-backup: never"'

# restore the latest replica into a scratch dir on the VPS and check it opens (the runbook's test)
deploy-restore-test:
    ssh {{deploy_host}} 'd=$(mktemp -d) && litestream restore -config /etc/litestream.yml -o "$d/bmpl.db" {{deploy_dir}}/bmpl.db && sqlite3 "$d/bmpl.db" "PRAGMA integrity_check; SELECT COUNT(*) AS users FROM users;" && rm -rf "$d"'
```

(`sqlite3` CLI: bootstrap installs it — add `sqlite3` to the apt line in Task 2's script and to `test/deploy.test.ts`'s bootstrap assertions: `expect(b).toContain("sqlite3")`.)

- [ ] **Step 1: Write the recipes**; `just --list` shows them; `just build-linux` must succeed locally (it only needs Bun) — run it once, check `file dist/bmpl-linux` says ELF x86-64, then delete `dist/bmpl-linux`. `.env.hosted.example`: append `# Deploy (used by 'just deploy' on your machine, not by the server): BMPL_DEPLOY_HOST=root@bmpl.example.com`.
- [ ] **Step 2: Verify and commit** — `just check && bun test` green (the deploy test's `sqlite3` assertion included).

```bash
git add justfile .env.hosted.example deploy/bootstrap.sh test/deploy.test.ts
git commit -m "feat(deploy): just build-linux / deploy / deploy-logs / deploy-status / deploy-restore-test"
```

---

### Task 4: README runbook and agent docs

**Files:** `README.md`, `docs/agents/architecture.md`, `docs/agents/workflow.md`, `docs/agents/testing.md`, `AGENTS.md`, `docs/superpowers/plans/2026-09-18-vps-deployment.md` (committed with this task if untouched, it already is)

- [ ] **Step 1: README** — rename the section to "Hosted mode (multi-user)" (drop "work in progress"), keep the existing paragraphs, and add a subsection **Deploying on a VPS** after the env table with, in this order (each a short paragraph or a numbered list with the exact commands; every path from Task 2):
  1. *What you need*: a Debian/Ubuntu VPS with a public IP, a DNS `A` record `bmpl.<domain>` → the VPS, an S3-compatible bucket (Backblaze B2 or Hetzner Object Storage) with an application key, a Discord application (link to the Login paragraph), a WCL client.
  2. *Bootstrap* (once): key-only SSH (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, `systemctl restart ssh`), then `scp -r deploy .env.hosted.example root@<vps>:/root/bmpl-deploy && ssh root@<vps> 'cd /root/bmpl-deploy/deploy && ./bootstrap.sh bmpl.<domain>'` — what it does (packages, ufw 22/80/443, user `bmpl`, `/opt/bmpl`, Caddy with the domain, units enabled), and that Caddy obtains the certificate on first request.
  3. *Configure*: `ssh root@<vps> 'nano /opt/bmpl/.env'` — every variable of the table, `openssl rand -base64 48` for the secret, the Discord redirect URL; `nano /etc/litestream.yml` — bucket, endpoint, keys; `systemctl start litestream`.
  4. *Deploy*: `BMPL_DEPLOY_HOST=root@<vps> just deploy` (what it does), `just deploy-status`, `just deploy-logs`; the first admin: their Discord id in `BMPL_ADMIN_DISCORD_IDS` — they sign in at `https://bmpl.<domain>`, open `/admin`, invite the others.
  5. *Monitor*: point UptimeRobot (or any pinger) at `https://bmpl.<domain>/api/health` (expects `{"ok":true,…}`, 503 when the database is unreachable); the admin page's Instance section shows uptime, db size and *last backup*; `journalctl -u bmpl` for errors; the audit log for security events.
  6. *Backups and restore*: litestream replicates continuously; the hourly timer verifies a snapshot is < 90 min old and touches `/opt/bmpl/last-backup` ("never" on the admin page means the timer has not passed yet or the check fails — `journalctl -u bmpl-backup-check`). Restore runbook: `systemctl stop bmpl litestream`, `mv /opt/bmpl/bmpl.db /opt/bmpl/bmpl.db.bak` (and `-wal`/`-shm`), `litestream restore -config /etc/litestream.yml -o /opt/bmpl/bmpl.db /opt/bmpl/bmpl.db`, `chown bmpl:bmpl /opt/bmpl/bmpl.db`, `systemctl start litestream bmpl`. Test it without touching production: `just deploy-restore-test` (restores into a temp dir, runs `PRAGMA integrity_check`, counts users) — do it once after the first day of replication and note the date.
  7. *Rotate a secret*: `BMPL_SESSION_SECRET` (edit `.env`, `systemctl restart bmpl` — everyone is signed out), Discord client secret (regenerate in the Discord portal, edit `.env`, restart), WCL client secret (same), bucket key (edit `/etc/litestream.yml`, `systemctl restart litestream`).
  8. *Upgrade*: `git pull && BMPL_DEPLOY_HOST=… just deploy` — the schema is additive (`CREATE … IF NOT EXISTS`), no migration step; downgrade = deploy an older commit.
  9. *Uninstall*: `systemctl disable --now bmpl litestream bmpl-backup-check.timer`, `rm /etc/systemd/system/{bmpl,litestream,bmpl-backup-check}.{service,timer} /etc/litestream.yml`, `userdel bmpl`, `rm -rf /opt/bmpl`, remove the site from `/etc/caddy/Caddyfile` (`systemctl reload caddy`), delete the bucket.
  Also: "Requirements" mentions `just build-linux` cross-compiles on any OS; "Security" bullet updated to point at the runbook (the app binds loopback in hosted mode; the proxy owns 80/443).
- [ ] **Step 2: Agent docs** — `docs/agents/architecture.md`: a "Deployment" paragraph (VPS layout, `--host`, the `deploy/` files are the truth, `test/deploy.test.ts`). `docs/agents/workflow.md` "Environment gotchas": `just deploy` needs `BMPL_DEPLOY_HOST` and an SSH key; never run it from a subagent (it touches production). `docs/agents/testing.md`: `test/deploy.test.ts` pins the deploy files. `AGENTS.md`: Commands gain `just build-linux` and `just deploy` (one line, "touches the VPS — only when the user asks"); "Where things are" gains `deploy/  VPS files (Caddy, systemd, litestream, bootstrap)`; roadmap: "#2–#10 (…, deployment) are shipped, next is #11 (phase 2)".
- [ ] **Step 3: Verify and commit** — `just check && bun test` green; `git status --short` shows only docs.

```bash
git add README.md docs/agents/architecture.md docs/agents/workflow.md docs/agents/testing.md AGENTS.md docs/superpowers/plans/2026-09-18-vps-deployment.md
git commit -m "docs: VPS deployment runbook (bootstrap, configure, deploy, monitor, backups and restore, rotation, upgrade, uninstall)"
```

---

## Self-review

- **Spec coverage** (issue #10): Caddyfile with reverse proxy, compression, HSTS, automatic HTTPS ✓ (T2); `bmpl.service` as `bmpl` user, `EnvironmentFile`, `WorkingDirectory=/opt/bmpl`, `Restart=always`, `ProtectSystem=strict`, `ReadWritePaths`, `NoNewPrivileges`, `PrivateTmp` ✓ (T2); litestream config + its own unit + `last-backup` written on each successful snapshot check ✓ (T2 — written by the hourly timer's check, not by the app: the app cannot see the bucket; the admin page reads the mtime as designed in #8); `just deploy` (compile linux-x64, scp, restart, wait for health) and `just deploy-logs` ✓ (T3, plus `deploy-status` and `deploy-restore-test`); `.env.hosted.example` complete ✓ (already; deploy variable added); README: bootstrap (user, dirs, ufw 80/443 only, Caddy), first admin, restore runbook, secret rotation, upgrade, uninstall ✓ (T4); firewall/SSH documented, app bound to 127.0.0.1 in hosted mode via `--host` (default loopback) ✓ (T1). Acceptance: fresh VPS from the README alone — the runbook is linear and every command is given; health monitored — documented; restore tested once — `just deploy-restore-test` + the note to run it after the first day (the run itself happens on the user's VPS, not in this plan's execution).
- **Decisions to flag**: local mode keeps Bun's default bind (no behaviour change) — hosted defaults to loopback; `last-backup` is touched by the timer's check (root) and chowned to `bmpl`; litestream runs as root (its package default) to read the `bmpl`-owned WAL; `sqlite3` CLI installed for the restore test; the Caddyfile strips the `Server` header and logs to `/var/log/caddy/bmpl.log`; retention 30 days of snapshots (`720h`), snapshots hourly; the `/auth/*` limit (10/min per IP, #9) is not changed here — the README's monitoring paragraph mentions where to bump it if a NAT'd guild hits it.
- **Placeholder scan**: `deploy/litestream.yml` and the Caddyfile carry intentional `<…>`/`bmpl.example.com` placeholders that the test asserts on; no TODOs in the plan.
- **Type consistency**: `planServe().host: string | null` ↔ `ServeOptions.host?: string | null` (T1); unit `ExecStart` ↔ test string ↔ README (T2/T4); paths `/opt/bmpl/{bmpl,.env,bmpl.db,last-backup,backup-check.sh}`, `/etc/litestream.yml`, `/etc/caddy/Caddyfile` identical across files, test and README.
