#!/usr/bin/env bash
# First-time VPS setup for bmpl hosted mode. Safe to re-run. Usage: sudo ./bootstrap.sh bmpl.example.com
set -euo pipefail
DOMAIN="${1:?usage: bootstrap.sh <domain>}"
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.3.13}"

# 1. Packages: Caddy (official repo), ufw, curl, sqlite3.
apt-get update -y
apt-get install -y curl ufw debian-keyring debian-archive-keyring apt-transport-https sqlite3
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
