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
- **Gameplay quality per run** (fetched from each run's raw log, cached forever
  in a local `bmpl.db`): **timed / depleted** with chest count and clear time,
  **deaths** with what killed them and whether it was a group wipe, **DTPS vs
  the DPS in the same group**, **avoidable damage** (Blizzard's in-game
  classification, list courtesy of
  [postmortem](https://github.com/Sharpened-Banana/postmortem)), **interrupts
  normalized by the spec's kick cooldown** vs peers, and **dispels**. Skip with
  `--no-stats` to save API budget (~10 pts per uncached run).
- **Raider.IO profile** (free, no key): item level, last 10 runs with
  timed/depleted, current + previous season score per role. A missing previous
  season shows `—` — the player may simply have rerolled.

If you don't pass `--level`, the target auto-detects to the level the
character actually plays at — the median of their best run per dungeon, not
their single highest key (which is often a lone depleted push) — so
`bmpl lookup Biwaadrood-Nerzhul` "just works".

The metric also auto-selects: `hps` for healers, `dps` for DPS and tanks.

## Requirements

- [Bun](https://bun.sh/) ≥ 1.3 (pinned in `.tool-versions` for asdf/mise users)
- A Warcraft Logs v2 API client — free, see below
- `just` (optional but recommended) — https://github.com/casey/just
- For building from source: the web front builds with Vite (`just web-install`
  once, then `just build`). Node is not required — Bun runs Vite.
- For a VPS: `just build-linux` cross-compiles the hosted binary
  (`dist/bmpl-linux`) from any OS — see
  [Deploying on a VPS](deploy/README.md#deploying-on-a-vps).

`bmpl` caches WCL run enrichment and Raider.IO responses in a local SQLite
file, `bmpl.db`, created next to your `.env`. It's git-ignored; override the
location with `BMPL_DB_PATH` if you want it elsewhere.

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

## Security

- **`watch` reads every copied value** while running — passwords, tokens,
  chat messages. Only run it when actively vetting; Ctrl+C when done.
- `.env` is git-ignored. Never commit it. If it leaks, rotate the secret.
- If you share `bmpl` with others, **don't share your `.env`** — every
  lookup they run eats your 3600 pts/hr API budget. Have them register
  their own client.
- Prefer sharing the source (this repo) over shipping a binary; a compiled
  `.exe` is opaque to the recipient.
- Hosted mode: the app rate-limits and origin-checks on its own (the
  [Hardening](docs/hosted.md#hardening) section of hosted mode) and binds
  `127.0.0.1`; only the reverse proxy owns 80/443 and adds TLS, HSTS and
  compression. Firewall, the `bmpl` system user, the hardened unit and the
  backups are in [Deploying on a VPS](deploy/README.md#deploying-on-a-vps).

## Hosted mode (multi-user)

One instance for several people behind a reverse proxy: Discord login,
per-member quotas, shared corrections, admin page. Reference:
[docs/hosted.md](docs/hosted.md). Deploying:
[deploy/README.md](deploy/README.md#deploying-on-a-vps).

## Repo layout

```
src/
  cli.ts          command dispatch
  config.ts       env → config
  mplus.ts        fetch + analyze (auto-metric, spec filter, per-dungeon)
  lookup.ts       shared lookup flow: rankings → analysis → (WCL enrichment ‖ Raider.IO)
  watch.ts        clipboard polling
  roles.ts        spec → role mapping
  util.ts         realm slugging, age formatting
  format.ts       color helpers
  format-mplus.ts rendering
  web-static.ts   maps request paths to embedded web/dist assets
  web-assets.ts   embeds web/dist into the binary at build time
  wow/classes.ts  class names + hex colors (shared by CLI and web front)
  wcl/            OAuth2 + GraphQL client + queries + types
  signals/        gameplay-quality signals (the "vetting" layer)
    types.ts          shared types (RunSignals, RioProfile, ...)
    wcl-run.ts         parse a raw WCL run report into RunSignals
    enrich.ts          fetch/parse signals for the runs a lookup displays
    kick-cooldowns.ts  per-spec interrupt cooldowns
    peers.ts           peer-comparison medians
    rio-client.ts      Raider.IO fetch with retry/backoff + cache
    rio-profile.ts     parse a raw Raider.IO profile
    summary.ts         cross-run aggregates (tiles / compare rows)
    store.ts           SQLite cache (WCL runs + Raider.IO profiles)
    avoidable/         per-dungeon avoidable-damage spell lists
  deepdive/       defensive-cooldown deep-dive (the "bmpl analyze" layer)
    types.ts          shared types (RunDefensives, DefensiveUse, DeepdiveSummary, ...)
    defensives.json   shipped per-spec defensive tables
    table.ts          effective table: shipped + override, patch/add/ignore
    wcl.ts            fetch a run's cast/buff/death events from WCL
    analyze.ts        usage-vs-capacity + per-death defensive audit
    aggregate.ts      cross-run summary of analyses (the Survival sub-signals live in src/evaluation/)
    attach.ts         attaches deepdive/deepdiveSummary to a lookup payload
    player.ts         resolves the character's actor id / class / spec from the cached run
    run.ts            analyze one run end to end
scripts/
  introspect.ts                    GraphQL schema explorer (dev-only)
  import-postmortem-avoidable.ts   regenerate signals/avoidable/*.json from postmortem
deploy/
  Caddyfile, bmpl.service, litestream.yml, litestream.service,
  backup-check.sh, bmpl-backup-check.{service,timer}, bootstrap.sh
                                   VPS files, see deploy/README.md § Deploying on a VPS
test/
  *.test.ts, signals/*.test.ts, fixtures/   bun:test suite + fixture data
docs/
  agents/         developer / AI-agent guide (architecture, front, testing, workflow) — entry point: AGENTS.md at the root
  superpowers/    design specs and implementation plans, one per sub-project
  design/canvas/  source artboards of the Claude Design canvas used for UI mockups
web/
  src/
    lib/          pure, tested view models (format, verdict, radar, history,
                   axes, tiles, runs, compare)
    components/   Home, Detail, Compare, Setup, Header, Tabs, Toast,
                   VerdictHero, AxisRows, Radar, SignalTiles, DungeonRuns,
                   RioSection
    api.ts        fetch wrapper for /api/*
    types.ts      type-only re-exports from src/
    styles/       CSS
  dist/           built output (git-ignored), embedded into the binary by
                   src/web-assets.ts
```
