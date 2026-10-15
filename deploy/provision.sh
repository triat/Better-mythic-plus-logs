#!/usr/bin/env bash
# bmpl-provision <vX.Y.Z> [--force] [--domain <domain>] — applies deploy/ of a release to this VPS, only when it changed.
# Installed root-owned as /usr/local/sbin/bmpl-provision by bootstrap.sh; the deploy user may run it through sudo
# (sudoers-bmpl-deploy), never edit it. It downloads the tag from GitHub itself (the repository is public), so nothing
# the deploy job sends is ever run as root: a leaked deploy key can at most re-apply an official release. Run by
# .github/workflows/deploy.yml after the binary is installed. The first time, straight from GitHub, as root:
#   curl -fsSL https://raw.githubusercontent.com/triat/Better-mythic-plus-logs/<tag>/deploy/provision.sh \
#     | sudo bash -s -- <tag> --domain bmpl.example.com
set -euo pipefail
usage() { echo "usage: bmpl-provision <vX.Y.Z> [--force] [--domain <domain>]" >&2; exit 2; }
TAG="${1:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
shift
FORCE=""
NEW_DOMAIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=--force ;;
    --domain) [ $# -ge 2 ] || usage; NEW_DOMAIN="$2"; shift ;;
    *) usage ;;
  esac
  shift
done
if [ -n "$NEW_DOMAIN" ]; then
  [[ "$NEW_DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo "bmpl-provision: bad domain: $NEW_DOMAIN" >&2; exit 2; }
  install -d -m 755 /etc/bmpl
  [ -f /etc/bmpl/provision.conf ] || printf 'DOMAIN=%s\nREPO=triat/Better-mythic-plus-logs\n' "$NEW_DOMAIN" > /etc/bmpl/provision.conf
fi
[ -f /etc/bmpl/provision.conf ] || { echo "bmpl-provision: first run: pass --domain <domain>" >&2; exit 2; }
# shellcheck disable=SC1091
. /etc/bmpl/provision.conf # DOMAIN=…, REPO=owner/name
STATE=/var/lib/bmpl-provision
install -d -m 700 "$STATE"
exec 9>/run/bmpl-provision.lock
flock -w 600 9 || { echo "bmpl-provision: another run holds the lock" >&2; exit 1; }

started=$(date +%s)
# One JSON line in the journal per run (identifier bmpl-provision), which Grafana Alloy ships with bmpl's own.
report() {
  local result="$1" detail="$2"
  printf '{"ts":"%s","level":"%s","event":"provision","msg":"provision %s %s","tag":"%s","result":"%s","detail":"%s","s":%d}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$([ "$result" = failed ] && echo error || echo info)" "$TAG" "$result" "$TAG" "$result" \
    "$detail" "$(( $(date +%s) - started ))" | systemd-cat -t bmpl-provision
  echo "bmpl-provision: $TAG $result${detail:+ ($detail)}"
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if ! curl -fsSL --max-time 120 "https://codeload.github.com/${REPO}/tar.gz/refs/tags/${TAG}" -o "$work/src.tar.gz"; then
  report failed "download"
  exit 1
fi
tar -xzf "$work/src.tar.gz" -C "$work"
src=$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -n 1)
[ -f "$src/deploy/bootstrap.sh" ] || { report failed "no deploy/bootstrap.sh in ${TAG}"; exit 1; }

# The fingerprint: every file under deploy/, path and content. (The alert webhook in grafana.env has its own watch:
# bmpl-grafana-alerts.path.)
fingerprint=$( (cd "$src" && find deploy -type f -print0 | sort -z | xargs -0 sha256sum) | sha256sum | cut -d' ' -f1)
if [ "$FORCE" != "--force" ] && [ "$(cat "$STATE/applied" 2>/dev/null || true)" = "$fingerprint" ]; then
  report unchanged "deploy/ as applied"
  exit 0
fi

if bash "$src/deploy/bootstrap.sh" "$DOMAIN"; then
  echo "$fingerprint" > "$STATE/applied"
  echo "$TAG" > "$STATE/applied-tag"
  report applied "$([ "$FORCE" = "--force" ] && echo forced || echo "deploy/ changed")"
else
  report failed "bootstrap.sh exited non-zero"
  exit 1
fi
