# Better Mythic+ Logs (`bmpl`)

A CLI that queries Warcraft Logs and renders a compact vetting view for any
WoW character's Mythic+ profile. Built for the "someone applied to my key —
should I invite them?" question.

## What you get

For a given character and target key level, `bmpl lookup` shows:

- **Identity**: name, spec, class, current season M+ score, region/server rank
- **Target check**: `✓ has N run(s) at or above +<target>`
- **Best run at the previous level**: DPS/HPS, parse %, date, report link — falls back to N−2, N−3… if nothing at N−1
- **Per-dungeon profile**: one best run per dungeon in the season (8 entries),
  sorted by key level. Median stats, coverage (`6/8 at or above +18`), and a
  stale-data warning for runs older than 14 days.

If you don't pass `--level`, the target auto-detects to the character's
highest key run — so `bmpl lookup Drahous-Archimonde` "just works".

The metric also auto-selects: `hps` for healers, `dps` for DPS and tanks.

## Requirements

- [Bun](https://bun.sh/) 1.3+ (for running from source / building)
- A Warcraft Logs v2 API client — free, see below
- `just` (optional but recommended) — https://github.com/casey/just

## Getting Warcraft Logs API credentials

`bmpl` uses Warcraft Logs' v2 API, which requires a Client ID + Secret.
Creating them takes ~30 seconds.

1. Log in at https://www.warcraftlogs.com/ (any free account works).
2. Go to https://www.warcraftlogs.com/api/clients/
   (or: avatar → **Clients** under the API section).
3. Click **Create Client**.
4. Fill the form:
   - **Application Name**: anything, e.g. `bmpl`
   - **Redirect URLs**: required but unused for our flow — put
     `http://localhost` (this is a server-to-server client, no browser
     redirect happens)
   - **Public Client?**: leave **unchecked** — `bmpl` uses the
     `client_credentials` OAuth flow, which needs a confidential client.
5. Submit. The page now shows your **Client ID** and **Client Secret** —
   copy both into your `.env` as `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET`.

Keep the secret private. If it ever leaks, return to the same page,
delete the client, and create a new one. Rate limit is **3600 points per
hour** per client, which is ~700 `bmpl lookup` calls.

## Setup

```bash
git clone git@github.com:triat/Better-mythic-plus-logs.git
cd Better-mythic-plus-logs
bun install

cp .env.example .env
# edit .env and paste your WCL_CLIENT_ID + WCL_CLIENT_SECRET

just ping
# ✓ auth ok
#   budget: 3600 / 3600 pts remaining (resets in 60m)
```

Only EU is wired up (region is hardcoded in `src/config.ts`).

## Usage

### Vet one player

```bash
# auto-detect target from their highest run
just l Drahous-Archimonde

# force a specific target level
just l Drahous-Archimonde --level 18

# only consider runs on one spec
just l Biwaadrood-Nerzhul --spec Restoration

# JSON output (for scripts/pipelines)
just l Drahous-Archimonde --json
```

Both forms work — combined `Name-Realm` (what you get from WoW's in-game copy)
or `Name Realm` as two args.

### Hands-free (clipboard watcher)

The real killer feature. Leave this running in a terminal:

```bash
just watch                # target auto-detects per character
just watch --level 18     # force every lookup to target +18
just watch --spec Restoration
```

Then in-game: right-click an applicant → **Copy Name** → alt-tab → the lookup
is already printed. Copy the next applicant; the next lookup runs.

`bmpl` polls the system clipboard (Windows via PowerShell, macOS via
`pbpaste`, Linux via `wl-paste`/`xclip`) and fires on any string matching the
`Name-Realm` shape.

### Other commands

```bash
just m Drahous-Archimonde     # full M+ summary, per-key-level breakdown
just c Drahous-Archimonde     # basic character info
just ping                     # auth + rate-limit budget
just zones                    # list WCL zones (M+ filter: `just zones`)
just --list                   # all recipes
```

### Flags (shared across `lookup`, `mplus`, `watch`)

| Flag | Meaning |
|---|---|
| `--level N` | Target key level. Default: auto (highest run in profile) |
| `--spec <name>` | Filter to one spec (`Augmentation`, `Restoration`, …). Case-insensitive |
| `--metric dps \| hps` | Override the auto-selected metric |
| `--json` | Structured output (lookup / mplus only) |
| `--interval <ms>` | Clipboard poll rate for `watch` (default 750ms) |

## Windows

Cross-compile a standalone `.exe` (no Bun install needed on the target):

```bash
just build-windows
# → bmpl.exe (~115 MB, bundles the Bun runtime)
```

On the Windows machine:

1. Copy `bmpl.exe` + your `.env` to e.g. `C:\tools\bmpl\`
2. Open **PowerShell** / **Windows Terminal** (don't double-click — it's a CLI)
3. `cd C:\tools\bmpl` and run `.\bmpl.exe watch`

To run `bmpl` from anywhere:

- Add `C:\tools\bmpl` to your PATH, **and** either:
  - `cd` into a folder containing `.env` before running, or
  - Set the creds as Windows user env vars — no `.env` needed:
    ```powershell
    [Environment]::SetEnvironmentVariable("WCL_CLIENT_ID", "…", "User")
    [Environment]::SetEnvironmentVariable("WCL_CLIENT_SECRET", "…", "User")
    ```
    Restart the terminal after setting.

## Security

- **`watch` reads every copied value** while running — passwords, tokens,
  chat messages. Only run it when actively vetting; Ctrl+C when done.
- `.env` is git-ignored. Never commit it. If it leaks, rotate the secret.
- If you share `bmpl` with others, **don't share your `.env`** — every
  lookup they run eats your 3600 pts/hr API budget. Have them register
  their own client.
- Prefer sharing the source (this repo) over shipping a binary; a compiled
  `.exe` is opaque to the recipient.

## API cost

- Auth: 0 pts (OAuth2 token is cached in memory)
- `lookup` / `mplus`: ~5 pts per character (2 round-trips: metric probe +
  per-dungeon batch)
- Budget: 3600 pts/hr → ~700 lookups/hr

## Repo layout

```
src/
  cli.ts          command dispatch
  config.ts       env → config
  mplus.ts        fetch + analyze (auto-metric, spec filter, per-dungeon)
  watch.ts        clipboard polling
  roles.ts        spec → role mapping
  util.ts         realm slugging, age formatting
  format.ts       color helpers
  format-mplus.ts rendering
  wcl/            OAuth2 + GraphQL client + queries + types
scripts/
  introspect.ts   GraphQL schema explorer (dev-only)
```

## Troubleshooting

- **`character not found`** — check the realm slug. `bmpl` normalizes
  `Ner'zhul` → `nerzhul` and `ArgentDawn` → `argent-dawn` (WCL's convention),
  but an obscure realm might need manual spelling.
- **`No active (non-frozen) Mythic+ zone found`** — WCL has frozen all
  zones between seasons. Check `just zones` for a non-frozen one.
- **`Clipboard read failed`** on Linux — install `wl-clipboard` (Wayland)
  or `xclip` (X11). On WSL, make sure `powershell.exe` is in PATH (Windows
  interop is usually on by default).
- **Stale data warning on a run** — the run's `startTime` is >14 days ago;
  yellow-colored in the output. Not an error, just a flag.
