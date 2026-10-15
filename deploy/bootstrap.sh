#!/usr/bin/env bash
# First-time VPS setup for bmpl hosted mode. Safe to re-run. Usage: sudo ./bootstrap.sh bmpl.example.com
set -euo pipefail
DOMAIN="${1:?usage: bootstrap.sh <domain>}"
export DEBIAN_FRONTEND=noninteractive
# The 0.3.x line; only the amd64 asset is fetched below (no arm64 VPS support here).
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.3.13}"
# The logs stack (spec docs/superpowers/specs/2026-10-15-observability-design.md): VictoriaLogs pinned with its checksum,
# the Grafana plugin pinned; Grafana and Alloy come from Grafana's apt repository.
VICTORIALOGS_VERSION="${VICTORIALOGS_VERSION:-v1.53.0}"
VICTORIALOGS_SHA256="${VICTORIALOGS_SHA256:-55feba89713cafa952673f91b8b38e7701bb0290989263da671b47a0de16edd3}"
VL_PLUGIN_VERSION="${VL_PLUGIN_VERSION:-0.32.0}"

# 1. Packages: Caddy (official repo), ufw, curl, sqlite3, gnupg, fail2ban, unattended-upgrades.
apt-get update -y
apt-get install -y curl ufw debian-keyring debian-archive-keyring apt-transport-https sqlite3 gnupg fail2ban python3-systemd unattended-upgrades
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --batch --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
if ! command -v litestream >/dev/null; then
  deb=$(mktemp)
  curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.deb" -o "$deb"
  dpkg -i "$deb"
  rm -f "$deb"
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

# 3b. The deploy user: what `just deploy` logs in as. Not root — a sudoers file grants it the two
# gestures of a deploy (install the binary, restart the unit) and anything as `bmpl`; the
# systemd-journal group lets `just deploy-logs` read the unit's journal. Its SSH keys are yours to
# add: /home/deploy/.ssh/authorized_keys.
HERE="$(cd "$(dirname "$0")" && pwd)"
id -u deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups systemd-journal deploy
usermod -aG systemd-journal deploy
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
visudo -cf "$HERE/sudoers-bmpl-deploy" >/dev/null
install -o root -g root -m 440 "$HERE/sudoers-bmpl-deploy" /etc/sudoers.d/bmpl-deploy

# 4. Files from this directory → their places (never overwrite an existing .env or litestream.yml).
sed "s/bmpl\.example\.com/${DOMAIN}/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
# Caddy >= 2.8 opens the access log during validation, creating it root:root 0600;
# hand it back to caddy or the reload/restart below fails under set -e.
if [ -e /var/log/caddy/bmpl.log ]; then chown caddy:caddy /var/log/caddy/bmpl.log; fi
# Readable by the caddy group (Grafana Alloy ships it): the Caddyfile's `mode 640` covers files Caddy creates from now on.
if [ -d /var/log/caddy ]; then chgrp caddy /var/log/caddy && chmod g+rx /var/log/caddy; fi
if [ -e /var/log/caddy/bmpl.log ]; then chmod 640 /var/log/caddy/bmpl.log; fi
install -m 644 "$HERE/bmpl.service" /etc/systemd/system/bmpl.service
install -m 644 "$HERE/litestream.service" /etc/systemd/system/litestream.service
install -m 644 "$HERE/bmpl-backup-check.service" /etc/systemd/system/bmpl-backup-check.service
install -m 644 "$HERE/bmpl-backup-check.timer" /etc/systemd/system/bmpl-backup-check.timer
# The weekly recalibration (spec docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md): hourly sampling
# and the Wednesday fit, both with the bmpl binary and .env, writing only calibration.db and its aggregates.
for u in bmpl-calibrate-collect.service bmpl-calibrate-collect.timer bmpl-calibrate-fit.service bmpl-calibrate-fit.timer; do
  install -m 644 "$HERE/$u" "/etc/systemd/system/$u"
done
install -m 755 "$HERE/backup-check.sh" /usr/local/sbin/bmpl-backup-check
install -m 755 "$HERE/restore-test.sh" /usr/local/sbin/bmpl-restore-test
# The litestream .deb ships its own sample /etc/litestream.yml — check its content, not just its presence.
grep -qs "/opt/bmpl/bmpl.db" /etc/litestream.yml || install -o bmpl -g bmpl -m 600 "$HERE/litestream.yml" /etc/litestream.yml
if [ -f /opt/bmpl/.env ]; then
  :
elif [ -f "$HERE/../.env.hosted.example" ]; then
  install -o bmpl -g bmpl -m 600 "$HERE/../.env.hosted.example" /opt/bmpl/.env
else
  echo "note: copy .env.hosted.example to /opt/bmpl/.env by hand"
fi

# 4c. The logs stack: VictoriaLogs (90 days, loopback :9428), Grafana Alloy (journal + Caddy log → VictoriaLogs),
# Grafana (loopback :3001, served as logs.<domain> by Caddy). Each runs under a MemoryMax so it can never starve bmpl.
if ! /usr/local/bin/victoria-logs-prod -version 2>/dev/null | grep -q -- "-tags-${VICTORIALOGS_VERSION}-"; then
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/VictoriaMetrics/VictoriaLogs/releases/download/${VICTORIALOGS_VERSION}/victoria-logs-linux-amd64-${VICTORIALOGS_VERSION}.tar.gz" -o "$tmp/vl.tar.gz"
  echo "${VICTORIALOGS_SHA256}  $tmp/vl.tar.gz" | sha256sum -c -
  tar -xzf "$tmp/vl.tar.gz" -C "$tmp" victoria-logs-prod
  install -m 755 "$tmp/victoria-logs-prod" /usr/local/bin/victoria-logs-prod
  rm -rf "$tmp"
fi
id -u victorialogs >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin victorialogs
install -d -o victorialogs -g victorialogs -m 750 /var/lib/victorialogs
install -m 644 "$HERE/victorialogs.service" /etc/systemd/system/victorialogs.service
if ! dpkg -s grafana >/dev/null 2>&1 || ! dpkg -s alloy >/dev/null 2>&1; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor --batch --yes -o /etc/apt/keyrings/grafana.gpg
  echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" > /etc/apt/sources.list.d/grafana.list
  apt-get update -y && apt-get install -y grafana alloy
fi
# Alloy: our pipeline, the caddy group for the access log (the .deb already adds adm and systemd-journal).
install -m 644 "$HERE/alloy/config.alloy" /etc/alloy/config.alloy
usermod -aG caddy alloy
install -d -m 755 /etc/systemd/system/alloy.service.d
install -m 644 "$HERE/alloy/alloy-bmpl.conf" /etc/systemd/system/alloy.service.d/bmpl.conf
# Grafana: the VictoriaLogs plugin, the settings drop-in, the secrets file (created once, never overwritten), the
# provisioned data source and dashboards. The alert rules need the Discord webhook: without it Grafana refuses the
# contact point and would not start, so they are installed only once DISCORD_ALERT_WEBHOOK is set.
if ! grep -qs "\"version\": \"${VL_PLUGIN_VERSION}\"" /var/lib/grafana/plugins/victoriametrics-logs-datasource/plugin.json; then
  grafana cli plugins install victoriametrics-logs-datasource "$VL_PLUGIN_VERSION"
  chown -R grafana:grafana /var/lib/grafana/plugins
fi
install -d -m 755 /etc/systemd/system/grafana-server.service.d
install -m 644 "$HERE/grafana/systemd/grafana-bmpl.conf" /etc/systemd/system/grafana-server.service.d/bmpl.conf
if [ ! -f /etc/grafana/grafana.env ]; then
  umask 027
  printf 'GF_SERVER_DOMAIN=logs.%s\nGF_SERVER_ROOT_URL=https://logs.%s/\nGF_SECURITY_ADMIN_PASSWORD=%s\nDISCORD_ALERT_WEBHOOK=\n' \
    "$DOMAIN" "$DOMAIN" "$(openssl rand -base64 24 | tr -d '/+=')" > /etc/grafana/grafana.env
  umask 022
  chown root:grafana /etc/grafana/grafana.env && chmod 640 /etc/grafana/grafana.env
  echo "Grafana: user admin, password in /etc/grafana/grafana.env (GF_SECURITY_ADMIN_PASSWORD)"
fi
install -d -o root -g grafana -m 750 /etc/grafana/dashboards/bmpl
install -o root -g grafana -m 640 "$HERE"/grafana/dashboards/*.json /etc/grafana/dashboards/bmpl/
install -o root -g grafana -m 640 "$HERE/grafana/provisioning/datasources/victorialogs.yaml" /etc/grafana/provisioning/datasources/victorialogs.yaml
install -o root -g grafana -m 640 "$HERE/grafana/provisioning/dashboards/bmpl.yaml" /etc/grafana/provisioning/dashboards/bmpl.yaml
if grep -qs '^DISCORD_ALERT_WEBHOOK=.\+' /etc/grafana/grafana.env; then
  install -o root -g grafana -m 640 "$HERE/grafana/provisioning/alerting/bmpl.yaml" /etc/grafana/provisioning/alerting/bmpl.yaml
else
  rm -f /etc/grafana/provisioning/alerting/bmpl.yaml
  echo "Grafana alerts: off until DISCORD_ALERT_WEBHOOK is set in /etc/grafana/grafana.env (then re-run bootstrap.sh)"
fi

# 5. Hardening: fail2ban on sshd (bans through ufw) and unattended security upgrades with a
# scheduled reboot — Ubuntu ships 20auto-upgrades already enabled, this only adds the reboot policy.
install -m 644 "$HERE/fail2ban-jail.local" /etc/fail2ban/jail.local
install -m 644 "$HERE/52unattended-upgrades-bmpl" /etc/apt/apt.conf.d/52unattended-upgrades-bmpl
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now fail2ban
fail2ban-client reload >/dev/null

# 6. Services. bmpl itself starts once the binary and .env are in place (`just deploy`).
systemctl daemon-reload
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy
systemctl enable bmpl litestream bmpl-backup-check.timer
# The timers run the deployed binary; before the first `just deploy` their runs fail harmlessly.
systemctl enable --now bmpl-calibrate-collect.timer bmpl-calibrate-fit.timer
# The logs stack: restarted so a re-run picks up new configuration, dashboards and alert rules.
systemctl enable victorialogs alloy grafana-server
systemctl restart victorialogs alloy grafana-server
echo "bootstrap done — next: your public key in /home/deploy/.ssh/authorized_keys, fill /opt/bmpl/.env and /etc/litestream.yml, then 'just deploy' from your machine"
