#!/usr/bin/env bash
# /usr/local/sbin/bmpl-grafana-alerts — installs Grafana's alert rules when /etc/grafana/grafana.env holds a Discord
# webhook, removes them when it does not, and restarts Grafana only when that changed anything. Grafana refuses to start
# with an empty contact-point URL, hence the rules are never installed without one. Run by bmpl-grafana-alerts.path
# whenever grafana.env is saved (so pasting the webhook is enough), and by bootstrap.sh.
set -euo pipefail
SRC=/usr/local/share/bmpl/grafana-alerting.yaml
DST=/etc/grafana/provisioning/alerting/bmpl.yaml
changed=0
if grep -qs '^DISCORD_ALERT_WEBHOOK=.\+' /etc/grafana/grafana.env; then
  if ! cmp -s "$SRC" "$DST"; then
    install -o root -g grafana -m 640 "$SRC" "$DST"
    changed=1
    echo "bmpl-grafana-alerts: alert rules installed"
  fi
elif [ -e "$DST" ]; then
  rm -f "$DST"
  changed=1
  echo "bmpl-grafana-alerts: alert rules removed (no DISCORD_ALERT_WEBHOOK)"
else
  echo "bmpl-grafana-alerts: off until DISCORD_ALERT_WEBHOOK is set in /etc/grafana/grafana.env"
fi
# A new webhook URL alone (rules unchanged) still needs a restart: Grafana reads its environment at start.
state=/var/lib/bmpl-provision/grafana-env.sha256
mkdir -p "$(dirname "$state")"
now=$(sha256sum /etc/grafana/grafana.env 2>/dev/null | cut -d' ' -f1 || true)
# (The first run only records it.)
if [ -f "$state" ] && [ "$now" != "$(cat "$state")" ]; then changed=1; fi
echo "$now" > "$state"
if [ "$changed" = 1 ] && systemctl is-active --quiet grafana-server; then
  systemctl restart grafana-server
  echo "bmpl-grafana-alerts: grafana-server restarted"
fi
