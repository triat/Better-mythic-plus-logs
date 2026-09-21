#!/usr/bin/env bash
# `just deploy-restore-test`: restore the latest litestream replica into a scratch directory, check it
# opens, count the users, delete the directory. Runs as user `bmpl` (reads /etc/litestream.yml).
set -euo pipefail
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
litestream restore -config /etc/litestream.yml -o "$d/bmpl.db" /opt/bmpl/bmpl.db
sqlite3 "$d/bmpl.db" "PRAGMA integrity_check; SELECT COUNT(*) AS users FROM users;"
