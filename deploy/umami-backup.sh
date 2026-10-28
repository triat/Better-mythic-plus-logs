#!/usr/bin/env bash
# Daily, as pgrust: pg_dump -Fc of Umami's database into /var/backups/umami, the newest 7 kept. They guard against a
# pgrust bug that damages the data (the main risk of a beta database), not against losing the VPS: no off-site copy.
# Restoring into stock PostgreSQL 18 works too (pg_restore), the way out if pgrust misbehaves.
# One JSON line in the journal per run (identifier umami-backup), which Grafana Alloy ships with bmpl's own.
set -euo pipefail
DIR=/var/backups/umami
KEEP=7
out="$DIR/umami-$(date +%F).dump"
report() {
  printf '{"ts":"%s","level":"%s","event":"umami_backup","msg":"umami backup %s","result":"%s","bytes":%d}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$([ "$1" = ok ] && echo info || echo error)" "$1" "$1" "${2:-0}" | systemd-cat -t umami-backup
}
if ! /usr/lib/postgresql/18/bin/pg_dump -h /run/pgrust -p 5432 -Fc umami -f "$out.part"; then
  rm -f "$out.part"
  report failed
  exit 1
fi
mv "$out.part" "$out"
# shellcheck disable=SC2012
ls -1t "$DIR"/umami-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f
report ok "$(stat -c %s "$out")"
