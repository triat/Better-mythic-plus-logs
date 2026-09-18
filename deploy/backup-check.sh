#!/usr/bin/env bash
# Hourly: verify the newest litestream snapshot of bmpl.db is younger than MAX_AGE_MIN and
# touch /opt/bmpl/last-backup — the admin page's Instance section shows its mtime as "last backup".
set -euo pipefail
MAX_AGE_MIN="${MAX_AGE_MIN:-90}"
MARKER=/opt/bmpl/last-backup
# `litestream snapshots` prints one row per snapshot with its creation time (RFC 3339) in the 4th column.
newest=$(litestream snapshots -config /etc/litestream.yml /opt/bmpl/bmpl.db | awk 'NR > 1 { print $4 }' | sort | tail -n 1)
if [ -z "$newest" ]; then echo "backup-check: no snapshot found" >&2; exit 1; fi
age_min=$(( ( $(date +%s) - $(date -d "$newest" +%s) ) / 60 ))
if [ "$age_min" -gt "$MAX_AGE_MIN" ]; then echo "backup-check: newest snapshot is ${age_min} min old (> ${MAX_AGE_MIN})" >&2; exit 1; fi
touch "$MARKER"
chown bmpl:bmpl "$MARKER"
echo "backup-check: ok, newest snapshot ${age_min} min old"
