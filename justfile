# list recipes
default:
    @just --list

# install dependencies
install:
    bun install

# typecheck
check:
    bun run typecheck

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

# basic character info (combined form: `just c Drahous-Archimonde`)
c nameRealm:
    bun src/cli.ts char {{nameRealm}}

# full M+ season summary (pass `--json` at the end for JSON)
mplus name realm *flags:
    bun src/cli.ts mplus {{name}} {{realm}} {{flags}}

# full M+ summary (combined form: `just m Drahous-Archimonde [--json]`)
m nameRealm *flags:
    bun src/cli.ts mplus {{nameRealm}} {{flags}}

# vet a player for a +N key
lookup name realm level *flags:
    bun src/cli.ts lookup {{name}} {{realm}} --level {{level}} {{flags}}

# vet a player (combined form, level auto-detected): `just l Drahous-Archimonde [--level 18]`
l nameRealm *flags:
    bun src/cli.ts lookup {{nameRealm}} {{flags}}

# clipboard watcher, level auto-detected per char: `just watch [--level 18] [--spec X]`
watch *flags:
    bun src/cli.ts watch {{flags}}

# local web UI + auto-open browser: `just serve [--port 3000] [--no-open]`
serve *flags:
    bun src/cli.ts serve {{flags}}

# build a standalone binary for the current platform (./bmpl)
build:
    bun build src/cli.ts --compile --outfile bmpl

# cross-compile a standalone Windows executable (./bmpl.exe)
# Note: --windows-hide-console is only available when compiling ON Windows;
# for a truly console-free launch, run this recipe on a Windows host.
build-windows:
    bun build src/cli.ts --compile --target=bun-windows-x64 --outfile bmpl.exe

# build on Windows (PowerShell) — adds --windows-hide-console so double-click has no console flash
build-windows-native:
    bun build src/cli.ts --compile --windows-hide-console --windows-title="bmpl" --outfile bmpl.exe

# introspect a GraphQL type (defaults to Character)
introspect type="Character":
    bun scripts/introspect.ts {{type}}

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
