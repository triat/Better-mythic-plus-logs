#!/usr/bin/env bash
# VPS setup for bmpl hosted mode, first time and every later change. Safe to re-run: every file is installed only when
# its content differs, and only the services whose files changed are reloaded or restarted. Run through
# deploy/provision.sh: once by hand, as the one-liner in deploy/README.md § 2, then by each release when deploy/ changed
# (.github/workflows/deploy.yml). Direct use still works: sudo ./bootstrap.sh bmpl.example.com [analytics.example.com].
set -euo pipefail
DOMAIN="${1:?usage: bootstrap.sh <domain> [<analytics-domain>]}"
# Optional: Umami on pgrust at this domain (spec docs/superpowers/specs/2026-10-28-umami-analytics-design.md, § 4d).
ANALYTICS_DOMAIN="${2:-}"
export DEBIAN_FRONTEND=noninteractive
# The 0.3.x line; only the amd64 asset is fetched below (no arm64 VPS support here).
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.3.13}"
# The logs stack (spec docs/superpowers/specs/2026-10-15-observability-design.md): VictoriaLogs pinned with its checksum,
# the Grafana plugin pinned; Grafana and Alloy come from Grafana's apt repository.
VICTORIALOGS_VERSION="${VICTORIALOGS_VERSION:-v1.53.0}"
VICTORIALOGS_SHA256="${VICTORIALOGS_SHA256:-55feba89713cafa952673f91b8b38e7701bb0290989263da671b47a0de16edd3}"
VL_PLUGIN_VERSION="${VL_PLUGIN_VERSION:-0.32.0}"
# Analytics (only with an analytics domain): pgrust's release tarball with the checksum of its MANIFEST.txt, and
# Umami's image pinned by its index digest.
PGRUST_VERSION="${PGRUST_VERSION:-0.4-beta}"
PGRUST_SHA256="${PGRUST_SHA256:-9a53fdc039ca338808702641369b0ac7d6c163124f76f2bfd21860b0be9fb7bb}"
UMAMI_IMAGE="${UMAMI_IMAGE:-ghcr.io/umami-software/umami:3.4.1@sha256:e69d1a7932e9dab0fc523edc7be1f3a53f3c261f57856fc2167ae74a8fc022e8}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# Unattended upgrades may hold the dpkg lock for a while: wait for it rather than fail.
APT=(apt-get -o DPkg::Lock::Timeout=600 -y)

# What changed during this run; acted on in section 6.
declare -A CHANGED=()
# put SRC DST MODE OWNER:GROUP [TAG...]: installs SRC as DST when its content, mode or owner differ, and marks each TAG
# as changed. Returns 0 either way.
put() {
  local src="$1" dst="$2" mode="$3" owner="$4"; shift 4
  local same=0
  if [ -f "$dst" ] && cmp -s "$src" "$dst" && [ "$(stat -c '%a %U:%G' "$dst")" = "$mode $owner" ]; then same=1; fi
  if [ "$same" = 0 ]; then
    install -o "${owner%%:*}" -g "${owner##*:}" -m "$mode" "$src" "$dst"
    echo "installed $dst"
    local t; for t in "$@"; do CHANGED[$t]=1; done
  fi
}

# 1. Packages: Caddy (official repo), ufw, curl, sqlite3, gnupg, fail2ban, unattended-upgrades. apt runs only when
# something is missing.
BASE=(curl ufw debian-keyring debian-archive-keyring apt-transport-https sqlite3 gnupg fail2ban python3-systemd unattended-upgrades openssl)
missing=()
for p in "${BASE[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if [ "${#missing[@]}" -gt 0 ]; then "${APT[@]}" update && "${APT[@]}" install "${missing[@]}"; fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --batch --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  "${APT[@]}" update && "${APT[@]}" install caddy
fi
if ! command -v litestream >/dev/null; then
  deb=$(mktemp)
  curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.deb" -o "$deb"
  dpkg -i "$deb"
  rm -f "$deb"
fi

# 2. Firewall: SSH, HTTP (ACME), HTTPS only. The app port 3000 and the logs stack's ports stay on loopback.
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# 3. The bmpl user and directory (.env, bmpl.db and last-backup live here).
id -u bmpl >/dev/null 2>&1 || useradd --system --home-dir /opt/bmpl --shell /usr/sbin/nologin bmpl
install -d -o bmpl -g bmpl -m 750 /opt/bmpl

# 3b. The deploy user: what `just deploy` and the deploy workflow log in as. Not root — a sudoers file grants it the
# gestures of a deploy (install the binary, restart the unit, run bmpl-provision) and anything as `bmpl`; the
# systemd-journal group lets `just deploy-logs` read the unit's journal. Its SSH keys are yours to add:
# /home/deploy/.ssh/authorized_keys.
id -u deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups systemd-journal deploy
usermod -aG systemd-journal deploy
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
visudo -cf "$HERE/sudoers-bmpl-deploy" >/dev/null
put "$HERE/sudoers-bmpl-deploy" /etc/sudoers.d/bmpl-deploy 440 root:root
# The provisioning entry point (root-owned: the deploy user may run it, never change it) and what it needs to know.
put "$HERE/provision.sh" /usr/local/sbin/bmpl-provision 755 root:root
install -d -m 755 /etc/bmpl
if [ ! -f /etc/bmpl/provision.conf ]; then
  printf 'DOMAIN=%s\nREPO=triat/Better-mythic-plus-logs\n' "$DOMAIN" > /etc/bmpl/provision.conf
  chmod 644 /etc/bmpl/provision.conf
fi

# 4. Files from this directory → their places (never overwrite an existing .env or litestream.yml).
tmp_caddy=$(mktemp)
sed "s/bmpl\.example\.com/${DOMAIN}/" "$HERE/Caddyfile" > "$tmp_caddy"
[ -n "$ANALYTICS_DOMAIN" ] && sed "s/analytics\.example\.com/${ANALYTICS_DOMAIN}/" "$HERE/Caddyfile.analytics" >> "$tmp_caddy"
caddy validate --config "$tmp_caddy" --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config "$tmp_caddy" --adapter caddyfile; exit 1; }
put "$tmp_caddy" /etc/caddy/Caddyfile 644 root:root caddy
rm -f "$tmp_caddy"
# Caddy >= 2.8 opens the access log during validation, creating it root:root 0600; hand it back to caddy, readable by
# the caddy group (Grafana Alloy ships it). The Caddyfile's `mode 640` covers the files Caddy creates from now on.
if [ -e /var/log/caddy/bmpl.log ]; then chown caddy:caddy /var/log/caddy/bmpl.log && chmod 640 /var/log/caddy/bmpl.log; fi
if [ -d /var/log/caddy ]; then chgrp caddy /var/log/caddy && chmod g+rx /var/log/caddy; fi
put "$HERE/bmpl.service" /etc/systemd/system/bmpl.service 644 root:root systemd bmpl
put "$HERE/litestream.service" /etc/systemd/system/litestream.service 644 root:root systemd litestream
put "$HERE/bmpl-backup-check.service" /etc/systemd/system/bmpl-backup-check.service 644 root:root systemd
put "$HERE/bmpl-backup-check.timer" /etc/systemd/system/bmpl-backup-check.timer 644 root:root systemd
# The weekly recalibration (spec docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md): hourly sampling
# and the Wednesday fit, both with the bmpl binary and .env, writing only calibration.db and its aggregates.
for u in bmpl-calibrate-collect.service bmpl-calibrate-collect.timer bmpl-calibrate-fit.service bmpl-calibrate-fit.timer; do
  put "$HERE/$u" "/etc/systemd/system/$u" 644 root:root systemd
done
put "$HERE/backup-check.sh" /usr/local/sbin/bmpl-backup-check 755 root:root
put "$HERE/restore-test.sh" /usr/local/sbin/bmpl-restore-test 755 root:root
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
  CHANGED[victorialogs]=1
fi
id -u victorialogs >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin victorialogs
install -d -o victorialogs -g victorialogs -m 750 /var/lib/victorialogs
put "$HERE/victorialogs.service" /etc/systemd/system/victorialogs.service 644 root:root systemd victorialogs
if ! dpkg -s grafana >/dev/null 2>&1 || ! dpkg -s alloy >/dev/null 2>&1; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor --batch --yes -o /etc/apt/keyrings/grafana.gpg
  echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" > /etc/apt/sources.list.d/grafana.list
  "${APT[@]}" update && "${APT[@]}" install grafana alloy
  CHANGED[alloy]=1; CHANGED[grafana]=1
fi
# Alloy: our pipeline, the caddy group for the access log (the .deb already adds adm and systemd-journal).
id -nG alloy | grep -qw caddy || { usermod -aG caddy alloy; CHANGED[alloy]=1; }
put "$HERE/alloy/config.alloy" /etc/alloy/config.alloy 644 root:root alloy
install -d -m 755 /etc/systemd/system/alloy.service.d
put "$HERE/alloy/alloy-bmpl.conf" /etc/systemd/system/alloy.service.d/bmpl.conf 644 root:root systemd alloy
# Grafana: the VictoriaLogs plugin, the settings drop-in, the secrets file (created once, never overwritten), the
# provisioned data source and dashboards (Grafana re-reads dashboards every minute, no restart). The alert rules need
# the Discord webhook: without it Grafana refuses the contact point and would not start, so they are installed only once
# DISCORD_ALERT_WEBHOOK is set.
if ! grep -qs "\"version\": \"${VL_PLUGIN_VERSION}\"" /var/lib/grafana/plugins/victoriametrics-logs-datasource/plugin.json; then
  grafana cli plugins install victoriametrics-logs-datasource "$VL_PLUGIN_VERSION"
  chown -R grafana:grafana /var/lib/grafana/plugins
  CHANGED[grafana]=1
fi
install -d -m 755 /etc/systemd/system/grafana-server.service.d
put "$HERE/grafana/systemd/grafana-bmpl.conf" /etc/systemd/system/grafana-server.service.d/bmpl.conf 644 root:root systemd grafana
if [ ! -f /etc/grafana/grafana.env ]; then
  umask 027
  printf 'GF_SERVER_DOMAIN=logs.%s\nGF_SERVER_ROOT_URL=https://logs.%s/\nGF_SECURITY_ADMIN_PASSWORD=%s\nDISCORD_ALERT_WEBHOOK=\n' \
    "$DOMAIN" "$DOMAIN" "$(openssl rand -base64 24 | tr -d '/+=')" > /etc/grafana/grafana.env
  umask 022
  chown root:grafana /etc/grafana/grafana.env && chmod 640 /etc/grafana/grafana.env
  echo "Grafana: user admin, password in /etc/grafana/grafana.env (GF_SECURITY_ADMIN_PASSWORD)"
  CHANGED[grafana]=1
fi
install -d -o root -g grafana -m 750 /etc/grafana/dashboards/bmpl
for f in "$HERE"/grafana/dashboards/*.json; do put "$f" "/etc/grafana/dashboards/bmpl/$(basename "$f")" 640 root:grafana; done
put "$HERE/grafana/provisioning/datasources/victorialogs.yaml" /etc/grafana/provisioning/datasources/victorialogs.yaml 640 root:grafana grafana
put "$HERE/grafana/provisioning/dashboards/bmpl.yaml" /etc/grafana/provisioning/dashboards/bmpl.yaml 640 root:grafana grafana
# The alert rules: kept aside, installed by bmpl-grafana-alerts once grafana.env holds the webhook; the .path unit runs it
# again whenever grafana.env is saved, so pasting the webhook there is enough.
install -d -m 755 /usr/local/share/bmpl
put "$HERE/grafana/provisioning/alerting/bmpl.yaml" /usr/local/share/bmpl/grafana-alerting.yaml 644 root:root
put "$HERE/grafana-alerts.sh" /usr/local/sbin/bmpl-grafana-alerts 755 root:root
put "$HERE/bmpl-grafana-alerts.service" /etc/systemd/system/bmpl-grafana-alerts.service 644 root:root systemd
put "$HERE/bmpl-grafana-alerts.path" /etc/systemd/system/bmpl-grafana-alerts.path 644 root:root systemd

# 4d. Analytics (only with an analytics domain): pgrust (pinned binary, checksum checked, loopback :5432, its socket in
# /run/pgrust), Docker and Umami's image (loopback :3002, served by Caddy as the analytics domain), pg_dump 18 from the
# PostgreSQL apt repository for the daily dump. Each runs under a memory cap so it can never starve bmpl.
if [ -n "$ANALYTICS_DOMAIN" ]; then
  if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
    install -d -m 755 /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
    "${APT[@]}" update
  fi
  missing=()
  for p in docker.io postgresql-client-18; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if [ "${#missing[@]}" -gt 0 ]; then "${APT[@]}" install "${missing[@]}"; fi
  if ! /usr/local/lib/pgrust/bin/postgres --version 2>/dev/null | grep -q "^pgrust ${PGRUST_VERSION} "; then
    tmp=$(mktemp -d)
    curl -fsSL "https://pgrust.com/downloads/v${PGRUST_VERSION}/pgrust-${PGRUST_VERSION}-linux-x86_64.tar.gz" -o "$tmp/pgrust.tar.gz"
    echo "${PGRUST_SHA256}  $tmp/pgrust.tar.gz" | sha256sum -c -
    tar -xzf "$tmp/pgrust.tar.gz" -C "$tmp"
    rm -rf /usr/local/lib/pgrust.new && mv "$tmp/pgrust-${PGRUST_VERSION}-linux-x86_64" /usr/local/lib/pgrust.new
    chown -R root:root /usr/local/lib/pgrust.new && chmod -R go-w /usr/local/lib/pgrust.new
    rm -rf /usr/local/lib/pgrust && mv /usr/local/lib/pgrust.new /usr/local/lib/pgrust
    rm -rf "$tmp"
    CHANGED[pgrust]=1
  fi
  id -u pgrust >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin pgrust
  install -d -o pgrust -g pgrust -m 700 /var/lib/pgrust /var/backups/umami
  # The cluster, once: its superuser is the pgrust OS user (peer authentication on the socket, no password), TCP
  # connections need a password (scram).
  if [ ! -f /var/lib/pgrust/PG_VERSION ]; then
    (cd / && runuser -u pgrust -- /usr/local/lib/pgrust/bin/initdb -D /var/lib/pgrust -U pgrust -E UTF8 --locale=C.UTF-8 \
      --auth-local=peer --auth-host=scram-sha-256)
  fi
  put "$HERE/pgrust.service" /etc/systemd/system/pgrust.service 644 root:root systemd pgrust
  put "$HERE/umami.service" /etc/systemd/system/umami.service 644 root:root systemd umami
  put "$HERE/umami-backup.service" /etc/systemd/system/umami-backup.service 644 root:root systemd
  put "$HERE/umami-backup.timer" /etc/systemd/system/umami-backup.timer 644 root:root systemd
  put "$HERE/umami-backup.sh" /usr/local/sbin/umami-backup 755 root:root
  # Umami's secrets, once (root only): the umami role's password, the app secret. Never printed.
  install -d -m 700 /etc/umami
  if [ ! -f /etc/umami/umami.env ]; then
    umask 077
    printf 'DATABASE_URL=postgresql://umami:%s@127.0.0.1:5432/umami\nAPP_SECRET=%s\nDISABLE_TELEMETRY=1\nHOSTNAME=127.0.0.1\nPORT=3002\n' \
      "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > /etc/umami/umami.env
    umask 022
    CHANGED[umami]=1
  fi
  tmp_img=$(mktemp)
  printf 'UMAMI_IMAGE=%s\n' "$UMAMI_IMAGE" > "$tmp_img"
  put "$tmp_img" /etc/umami/umami.image 600 root:root umami
  rm -f "$tmp_img"
fi

# 5. Hardening: fail2ban on sshd (bans through ufw) and unattended security upgrades with a
# scheduled reboot — Ubuntu ships 20auto-upgrades already enabled, this only adds the reboot policy.
put "$HERE/fail2ban-jail.local" /etc/fail2ban/jail.local 644 root:root fail2ban
put "$HERE/52unattended-upgrades-bmpl" /etc/apt/apt.conf.d/52unattended-upgrades-bmpl 644 root:root
tmp_apt=$(mktemp)
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > "$tmp_apt"
put "$tmp_apt" /etc/apt/apt.conf.d/20auto-upgrades 644 root:root
rm -f "$tmp_apt"

# 6. Services: enabled every run (idempotent), reloaded or restarted only when their files changed. bmpl and litestream
# start once the binary, .env and litestream.yml are in place (`just deploy`); a running one is restarted on a new unit.
[ -n "${CHANGED[systemd]:-}" ] && systemctl daemon-reload
systemctl enable --now fail2ban >/dev/null 2>&1
[ -n "${CHANGED[fail2ban]:-}" ] && fail2ban-client reload >/dev/null
systemctl enable --now caddy >/dev/null 2>&1
[ -n "${CHANGED[caddy]:-}" ] && { systemctl reload caddy || systemctl restart caddy; }
systemctl enable bmpl litestream bmpl-backup-check.timer >/dev/null 2>&1
for s in bmpl litestream; do
  if [ -n "${CHANGED[$s]:-}" ] && systemctl is-active --quiet "$s"; then systemctl restart "$s"; echo "restarted $s"; fi
done
# The timers run the deployed binary; before the first `just deploy` their runs fail harmlessly.
systemctl enable --now bmpl-calibrate-collect.timer bmpl-calibrate-fit.timer >/dev/null 2>&1
systemctl enable victorialogs alloy grafana-server >/dev/null 2>&1
for s in victorialogs alloy grafana-server; do
  key="$s"; [ "$s" = grafana-server ] && key=grafana
  if [ -n "${CHANGED[$key]:-}" ] || ! systemctl is-active --quiet "$s"; then systemctl restart "$s"; echo "restarted $s"; fi
done
# Analytics: pgrust first, then the umami role and database (once), then Umami, then its default account closed.
if [ -n "$ANALYTICS_DOMAIN" ]; then
  systemctl enable pgrust umami umami-backup.timer >/dev/null 2>&1
  if [ -n "${CHANGED[pgrust]:-}" ] || ! systemctl is-active --quiet pgrust; then systemctl restart pgrust; echo "restarted pgrust"; fi
  psql_pg() { (cd / && runuser -u pgrust -- /usr/local/lib/pgrust/bin/psql -h /run/pgrust -p 5432 -d postgres -v ON_ERROR_STOP=1 -tA "$@"); }
  for _ in $(seq 1 30); do psql_pg -c "select 1" >/dev/null 2>&1 && break; sleep 1; done
  if [ "$(psql_pg -c "select 1 from pg_roles where rolname = 'umami'")" != "1" ]; then
    pw=$(sed -n 's|^DATABASE_URL=postgresql://umami:\([^@]*\)@.*|\1|p' /etc/umami/umami.env)
    psql_pg -c "create role umami login password '${pw}'" >/dev/null
    psql_pg -c "create database umami owner umami" >/dev/null
    unset pw
    echo "pgrust: role and database umami created"
  fi
  systemctl start umami-backup.timer
  if [ -n "${CHANGED[umami]:-}" ] || ! systemctl is-active --quiet umami; then
    docker pull -q "$UMAMI_IMAGE" >/dev/null
    systemctl restart umami
    echo "restarted umami"
  fi
  # Umami creates admin / umami at its first start: replace that password at once, keep the new one for the operator.
  for _ in $(seq 1 90); do curl -sf http://127.0.0.1:3002/api/heartbeat >/dev/null && break; sleep 2; done
  token=$(curl -s -X POST http://127.0.0.1:3002/api/auth/login -H 'content-type: application/json' \
    -d '{"username":"admin","password":"umami"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  if [ -n "$token" ]; then
    newpw=$(openssl rand -base64 24 | tr -d '/+=')
    if curl -sf -X POST http://127.0.0.1:3002/api/me/password -H "authorization: Bearer ${token}" -H 'content-type: application/json' \
      -d "{\"currentPassword\":\"umami\",\"newPassword\":\"${newpw}\"}" >/dev/null; then
      (umask 077; printf '%s\n' "$newpw" > /etc/umami/admin-password)
      echo "Umami: user admin, password in /etc/umami/admin-password (change it at first sign-in)"
    else
      echo "Umami: could not replace the default admin password; change it at first sign-in" >&2
    fi
    unset newpw
  fi
  unset token
fi
# After Grafana is up: the alert rules as grafana.env allows (restarts Grafana only if that changes them), then the watch.
/usr/local/sbin/bmpl-grafana-alerts
systemctl enable --now bmpl-grafana-alerts.path >/dev/null 2>&1
echo "bootstrap done (${#CHANGED[@]} change groups: ${!CHANGED[*]})"
