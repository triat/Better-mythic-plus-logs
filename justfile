# deploy target — SSH destination and remote install dir for `just deploy` and friends
deploy_host := env_var_or_default("BMPL_DEPLOY_HOST", "")
deploy_dir := "/opt/bmpl"

# list recipes
default:
    @just --list

# install dependencies
install:
    bun install

# typecheck (CLI + web front)
check:
    bun run typecheck
    bun run --cwd web typecheck

# known-vulnerability check of both lockfiles (bun audit); run before a release
check-deps:
    bun audit && cd web && bun audit

# install web front dependencies
web-install:
    bun install --cwd web

# web front dev server (Vite on :5173, proxies /api to `just serve --no-open` on :3000)
web-dev:
    bun run --cwd web dev

# build the web front into web/dist (embedded by `just build`)
web-build:
    bun run --cwd web build

# run unit tests
test *args:
    bun test {{args}}

# dev watch mode — pass CLI args after: `just dev ping`
dev *args:
    bun --watch src/cli.ts {{args}}

# verify WCL auth + show rate-limit budget
ping:
    bun src/cli.ts ping

# list M+ zones (all seasons)
zones:
    bun src/cli.ts zones --mplus

# basic character info
char name realm:
    bun src/cli.ts char {{name}} {{realm}}

# basic character info (combined form: `just c Biwaadrood-Nerzhul`)
c nameRealm:
    bun src/cli.ts char {{nameRealm}}

# full M+ season summary (pass `--json` at the end for JSON)
mplus name realm *flags:
    bun src/cli.ts mplus {{name}} {{realm}} {{flags}}

# full M+ summary (combined form: `just m Biwaadrood-Nerzhul [--json]`)
m nameRealm *flags:
    bun src/cli.ts mplus {{nameRealm}} {{flags}}

# vet a player for a +N key
lookup name realm level *flags:
    bun src/cli.ts lookup {{name}} {{realm}} --level {{level}} {{flags}}

# vet a player (combined form, level auto-detected): `just l Biwaadrood-Nerzhul [--level 18]`
l nameRealm *flags:
    bun src/cli.ts lookup {{nameRealm}} {{flags}}

# clipboard watcher, level auto-detected per char: `just watch [--level 18] [--spec X]`
watch *flags:
    bun src/cli.ts watch {{flags}}

# local web UI + auto-open browser: `just serve [--port 3000] [--no-open]`
serve *flags:
    bun src/cli.ts serve {{flags}}

# re-run the evaluation model on a saved `bmpl lookup --json` payload
evaluate file *flags:
    bun src/cli.ts evaluate {{file}} {{flags}}

# build a standalone binary for the current platform (./bmpl) — builds the web front first
build: web-build
    bun build src/cli.ts --compile --outfile bmpl

# cross-compile a standalone Windows executable (./bmpl.exe)
# Note: --windows-hide-console is only available when compiling ON Windows;
# for a truly console-free launch, run this recipe on a Windows host.
build-windows: web-build
    bun build src/cli.ts --compile --target=bun-windows-x64 --outfile bmpl.exe

# build on Windows (PowerShell) — adds --windows-hide-console so double-click has no console flash
build-windows-native: web-build
    bun build src/cli.ts --compile --windows-hide-console --windows-title="bmpl" --outfile bmpl.exe

# cross-compile the hosted binary for the VPS (web front embedded) → dist/bmpl-linux
build-linux: web-build
    mkdir -p dist
    bun build src/cli.ts --compile --target=bun-linux-x64 --outfile dist/bmpl-linux

# ship dist/bmpl-linux to the VPS, restart the unit, wait for /api/health (BMPL_DEPLOY_HOST=user@host)
deploy: build-linux
    @test -n "{{deploy_host}}" || { echo "set BMPL_DEPLOY_HOST=deploy@host"; exit 2; }
    scp dist/bmpl-linux {{deploy_host}}:/home/deploy/bmpl.new
    ssh {{deploy_host}} 'sudo -n install -o bmpl -g bmpl -m 755 /home/deploy/bmpl.new {{deploy_dir}}/bmpl && rm /home/deploy/bmpl.new && sudo -n systemctl restart bmpl && for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && { echo "bmpl is up"; exit 0; }; sleep 1; done; echo "bmpl did not answer /api/health in 30 s" >&2; journalctl -u bmpl -n 30 --no-pager; exit 1'

# follow the app log on the VPS
deploy-logs:
    ssh {{deploy_host}} 'journalctl -u bmpl -f'

# unit states, health (backupAgeS is the last-backup marker's age)
deploy-status:
    ssh {{deploy_host}} 'systemctl is-active bmpl caddy litestream bmpl-backup-check.timer; curl -fsS http://127.0.0.1:3000/api/health; echo'

# restore the latest replica into a scratch dir on the VPS and check it opens (the runbook's test)
deploy-restore-test:
    ssh {{deploy_host}} 'sudo -n -u bmpl /usr/local/sbin/bmpl-restore-test'

# introspect a GraphQL type (defaults to Character)
introspect type="Character":
    bun scripts/introspect.ts {{type}}

# refresh the avoidable-damage spell list from postmortem
import-avoidable:
    bun scripts/import-postmortem-avoidable.ts

# dump raw zoneRankings JSON for a char
raw-rankings name realm zone *flags:
    bun src/cli.ts raw-rankings {{name}} {{realm}} --zone {{zone}} {{flags}}

# dump raw encounterRankings JSON for a char
raw-encounter name realm encounter *flags:
    bun src/cli.ts raw-encounter {{name}} {{realm}} --encounter {{encounter}} {{flags}}

# remove built binary
clean:
    rm -f bmpl bmpl.exe

# remove build artefacts + node_modules (full reset)
distclean: clean
    rm -rf node_modules
    rm -f bun.lock bun.lockb

# empirical audit of the shipped defensives table against top runs (~350 WCL pts for all specs)
audit-defensives *flags:
    bun scripts/audit-defensives.ts {{flags}}

# regenerate the addon's golden vectors from today's codec — run after any codec.ts change
live-vectors:
    bun scripts/live-vectors.ts > addon/bmpl/tests/vectors.txt

# zip the in-game addon for distribution (dist/bmpl-addon.zip)
addon-zip:
    rm -f dist/bmpl-addon.zip
    mkdir -p dist
    cd addon && zip -r ../dist/bmpl-addon.zip bmpl -x '*/tests/*'
