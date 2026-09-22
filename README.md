# Better Mythic+ Logs (`bmpl`)

A tool that queries Warcraft Logs and Raider.IO and renders a compact vetting
view for any WoW character's Mythic+ profile — built for the "someone applied
to my key — should I invite them?" question. Use it as a local CLI, a local
web UI (same binary, `bmpl serve`), or host one instance for a group of
people behind a reverse proxy.

## What you get

For a given character and target key level, `bmpl lookup` shows:

- **Identity**: name, spec, class, current season M+ score, region/server rank
- **Target check**: `✓ has N run(s) at or above +<target>`
- **Best run at the previous level**: DPS/HPS, parse %, date, report link —
  falls back to N−2, N−3… if nothing at N−1
- **Per-dungeon profile**: one best run per dungeon in the season, median
  stats, coverage (`6/8 at or above +18`), and a stale-data warning for runs
  older than 14 days
- **Gameplay quality per run**, cached forever in a local `bmpl.db`: timed /
  depleted, deaths (what killed them, group wipe or not), DTPS vs. peers,
  avoidable damage (Blizzard's in-game classification, list courtesy of
  [postmortem](https://github.com/Sharpened-Banana/postmortem)), interrupts
  normalized by kick cooldown, and dispels
- **Raider.IO profile** (free, no key): item level, last 10 runs, current +
  previous season score per role

If you don't pass `--level`, the target auto-detects to the level the
character actually plays at (median of their best run per dungeon, not their
single highest key); the metric auto-selects too — `hps` for healers, `dps`
for DPS and tanks — so `bmpl lookup Biwaadrood-Nerzhul` just works.

## The verdict

On top of the raw stats, `bmpl` computes a rule-based verdict — `INVITE` /
`MAYBE` / `PASS` / `INSUFFICIENT DATA` — with a 0–100 score, from six axes
(Survival, Utility, Throughput, Consistency, Preparation, Experience), each
with plain-language evidence lines. Timed vs. depleted is deliberately not
scored, and fewer than 3 enriched runs always reads `INSUFFICIENT DATA`. The
rules are yours to tune via `evaluation.json`. Details:
[docs/scoring.md](docs/scoring.md#verdict-and-axes); the web UI's Help page
(`/help`) explains every number with this instance's live thresholds and
curves.

## Quick start

### Requirements

- [Bun](https://bun.sh/) ≥ 1.3 (pinned in `.tool-versions`)
- A Warcraft Logs v2 API client — free, see below
- `just` (optional but recommended) — https://github.com/casey/just
- Building from source also needs the web front: `just web-install` once,
  then `just build` (Bun runs Vite, Node is not required)

### Getting Warcraft Logs API credentials

`bmpl` uses Warcraft Logs' v2 API, which requires a Client ID + Secret
(~30 seconds to create):

1. Log in at https://www.warcraftlogs.com/ (any free account works).
2. Go to https://www.warcraftlogs.com/api/clients/ (avatar → **Clients**).
3. Click **Create Client**, name it anything, set **Redirect URLs** to
   `http://localhost` (required but unused — this is a server-to-server
   client), leave **Public Client?** unchecked.
4. Submit, then copy the **Client ID** and **Client Secret** into `.env` as
   `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET`.

Keep the secret private; if it leaks, delete the client on the same page and
create a new one. Rate limit is **3600 points per hour** per client, roughly
360 cached lookups. On a hosted instance every member can add their own
client under Settings — the same steps, written up on the instance's
`/help#wcl-client` page, which the quota messages link to.

### Setup

```bash
git clone git@github.com:triat/Better-mythic-plus-logs.git
cd Better-mythic-plus-logs
bun install

cp .env.example .env
# edit .env and paste your WCL_CLIENT_ID + WCL_CLIENT_SECRET

just ping
# ✓ auth ok
#   budget: 3600.00 / 3600 pts remaining (resets in 60m)
```

Any WCL region works: `bmpl` defaults to EU, override with `BMPL_REGION` in
`.env` or `--region` on `lookup`/`mplus`/`analyze`/`watch`. Then `bmpl serve` opens the web UI at
`http://localhost:3000` — first run lands on a setup page that writes `.env`
for you, no manual editing required.

## Command line

- `bmpl lookup <Name-Realm>` (alias `l`) — vet one player, `--level`/`--spec`/`--metric`/`--region`/`--json`/`--no-stats`
- `bmpl analyze <Name-Realm>` — deep-dive defensive cooldowns, `--run`/`--all`/`--yes`/`--json`/`--region`
- `bmpl watch` — clipboard watcher, hands-free vetting while alt-tabbed into the game, `--region`
- `bmpl evaluate <payload.json>` — replay the scoring model on a saved lookup, 0 API cost
- `bmpl defensives <Class> <Spec>` — print the effective defensives table, or `--check` to validate an override
- `bmpl serve` — the web UI (`--hosted` for multi-user mode, `--port`/`--host`/`--no-open`)

Full reference, flags and the four web-UI screens: [docs/cli.md](docs/cli.md#usage).
Windows (`.exe` cross-compile, double-click flow): [docs/cli.md#windows](docs/cli.md#windows).

## Languages

The web UI reads in English or French — the CLI, `--json` output and the docs stay English. It picks a language
from your browser on first visit (French for `fr`/`fr-FR`/`fr-CA`, English otherwise), and remembers an explicit
choice from the **EN | FR** switch — a chip at the right of the header in local mode, a row in the user menu in
hosted mode — per browser locally (`localStorage`) or per account when hosted (the user-menu row saves it through
`PUT /api/settings`, so it follows you across browsers). WoW terms stay English
in French text the way players say them (*kick, key, timed/depleted, parse, tank/heal, DPS/HPS, Mythic+,
deep-dive, run, reset*); the rest, including the Help page and the verdict wording, is French.

## Deep-dive

`bmpl analyze` goes one level deeper than the per-run signals above: it
fetches a run's raw cast/buff/death events and measures, per defensive
cooldown, usage vs. capacity and, for every death, whether a defensive was
available and unused. It's a separate, opt-in fetch (~3 WCL points per run,
cached forever), and once enough of a character's runs are analyzed it feeds
two extra sub-signals into the Survival axis. Details, the spell-table format
and how to correct it: [docs/deep-dive.md](docs/deep-dive.md#deep-dive-defensive-cooldowns).

## Hosted mode (multi-user)

`bmpl serve --hosted` runs one instance for several people behind a reverse
proxy: Discord login (invite-only, optional open signup, or a guild
allow-list), per-account history and settings, a shared WCL budget with
per-member hourly quotas or a member's own Warcraft Logs client, a
shared/proposed defensives table, a privacy page with self-service account
deletion, and an admin page. Reference and route table:
[docs/hosted.md](docs/hosted.md). Deploying on a VPS:
[deploy/README.md](deploy/README.md#deploying-on-a-vps). Running one
day-to-day: [docs/operator.md](docs/operator.md).

## In-game integration

A small WoW addon (`addon/`) draws a black-and-white pixel strip, top-left, only while the Group
Finder is in play; the web UI's **Live** chip reads it through a screen share and turns it into a live
view of your applicants and party — no server round trip, and the addon sends, receives and stores
nothing. Install guide and slash commands: [addon/README.md](addon/README.md), or `/help#live-addon`
on your own instance.

## API cost

- `lookup`, fully uncached: ~100 pts per character; already cached: ~10 pts
- `lookup --no-stats`: ~10 pts (Raider.IO is still fetched, free)
- `analyze`: ~3 pts per run, once ever — cached forever after
- 3600 pts/hr per client → ~36 fully-uncached lookups/hr, or ~360/hr once cached

Details: [docs/scoring.md#api-cost](docs/scoring.md#api-cost).

## Security

- `watch` reads every copied value while running — passwords, tokens, chat
  messages. Only run it when actively vetting; Ctrl+C when done.
- `.env` is git-ignored. Never commit it; rotate the secret if it leaks.
- Don't share your `.env` with others — every lookup they run eats your
  3600 pts/hr budget. Have them register their own client.
- Prefer sharing the source over shipping a compiled `.exe`, which is opaque
  to the recipient.
- Hosted mode adds its own rate-limiting, origin checks and security headers
  and binds `127.0.0.1` — only the reverse proxy owns 80/443. Details:
  [docs/hosted.md#hardening](docs/hosted.md#hardening).

## Repo layout

```
src/
  cli.ts, server.ts, lookup.ts, mplus.ts, watch.ts, config.ts, setup.ts, …
  wcl/            OAuth2 + GraphQL client + queries + types
  signals/        gameplay-quality signals (timed/deaths/DTPS/avoidable/kicks/dispels), peers, RIO, SQLite store
  deepdive/       defensive-cooldown deep-dive: table, WCL fetch, analyze, aggregate, attach
  evaluation/     axes → verdict (rules in default-config.json)
  hosted/         hosted-mode config, schema/repos, quotas, crypto, auth gate
  server/         route table, shared/local routes, handlers, SSE, security headers
  wow/classes.ts  class names + hex colors (the one runtime import web/ takes from src/)
scripts/          dev-only tools: schema introspection, avoidable-damage import, defensive audit
deploy/           VPS files (Caddy, systemd, litestream, bootstrap) — deploy/README.md
test/             bun:test suite + fixtures/
docs/
  cli.md, scoring.md, deep-dive.md, hosted.md, operator.md   detailed references
  agents/         developer / AI-agent guide — entry point: AGENTS.md at the root
  superpowers/    design specs and implementation plans
  design/canvas/  source artboards of the Claude Design canvas used for UI mockups
web/
  src/lib/        pure, tested view models (format, verdict, radar, history, axes, tiles, runs, compare)
  src/components/ Home, Detail, Compare, Setup, Header, Tabs, Toast, VerdictHero, AxisRows, Radar, ...
  src/api.ts, src/types.ts, src/styles/
  dist/           built output (git-ignored), embedded into the binary by src/web-assets.ts
```

## Development

```
just install && just web-install   # deps (root + web/)
just check                          # tsc for src/ and web/ — must pass before every commit
just test                           # bun test from the repo root
just build                           # web/dist (Vite) then ./bmpl (bun --compile)
```

The developer / AI-agent manual lives in `docs/agents/` (entry point:
`AGENTS.md` at the repo root). Any visible UI change goes through the Claude
Design canvas (`docs/design/canvas/`) before code.

## Troubleshooting

- `character not found` — check the realm slug; an obscure realm might need
  manual spelling.
- `No active (non-frozen) Mythic+ zone found` — WCL has frozen all zones
  between seasons; run `just zones` for a non-frozen one.
- `Clipboard read failed` on Linux — install `wl-clipboard` or `xclip`.

More: [docs/cli.md#troubleshooting](docs/cli.md#troubleshooting).
