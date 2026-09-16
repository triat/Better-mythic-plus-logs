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

## Verdict and axes

On top of the raw stats, `bmpl lookup` (CLI and web) computes a rule-based
**verdict** — `INVITE` / `MAYBE` / `PASS` / `INSUFFICIENT DATA` — with a
0–100 global score, from six axes:

- **Survival** — deaths (individual and in wipes), damage taken vs. the
  group's peers, avoidable damage vs. peers, and (for healers) teammate
  deaths. Once at least `confidence.deepdiveMinRuns` (2 by default) of a
  character's shown runs have been deep-dive analyzed (see "Deep-dive:
  defensive cooldowns" below), two more sub-signals feed in: defensive
  cooldown usage and the share of deaths where a defensive was available and
  unused.
- **Utility** — interrupts vs. peers, normalized by the spec's kick cooldown
  and capacity, plus dispels. Kicks and dispels are each `n/a` when the spec
  has no such ability (rogues, warriors and death knights have no dispel or
  purge at all); the axis is `n/a` only when neither applies — healers are
  always scored, since dispel usage alone is signal.
- **Throughput** — median parse % across runs, and parse % specifically at
  the target key level. A 0% parse means WCL has not ranked that log (yet);
  it is shown as `unranked` and excluded from every parse-based signal.
- **Consistency** — spread (variance) of parse, deaths, and damage taken
  across runs. Needs at least 5 runs; below that it's `n/a`. **Informational
  only**: its weight in the verdict is 0 by default, because variance punishes
  players who push keys (a depleted +21 next to a timed +20 is not
  inconsistency). Raise `axisWeights.<role>.consistency` in `evaluation.json`
  if you disagree.
- **Preparation** — potions and healthstones used per run, and item level
  vs. the season's expected curve at the target level.
- **Experience** — dungeon coverage, share of dungeons at/above target,
  median key level vs. target, recent activity (runs in the last 7 days),
  plus a small bonus — never a penalty — for a strong previous-season score.

Every axis lists its **evidence**: the specific sub-signals that moved the
score, in plain language. **Timed vs. depleted is deliberately not scored**
— it's shown in the run list as context, but a depleted key on an otherwise
strong run isn't held against the player (it's usually the group's fault,
not theirs). With fewer than 3 enriched runs the verdict is always
`INSUFFICIENT DATA` — there just isn't enough signal yet.

The scoring rules — curves, weights, thresholds — live in
`src/evaluation/default-config.json` and are yours to tune. You don't need to
copy the whole file: `evaluation.json` deep-merges into the defaults, so it
only needs the keys you want to change. For example, to raise the invite bar
and make one Survival curve harsher:

```json
{
  "verdict": { "invite": 75 },
  "axes": {
    "survival": {
      "subSignals": {
        "individualDeaths": { "curve": [[0, 100], [1, 60], [3, 10]] }
      }
    }
  }
}
```

`bmpl` looks for `evaluation.json` next to `.env`, or a path in
`BMPL_EVAL_CONFIG` if set. `bmpl serve` reads the config once at startup —
restart the server after editing `evaluation.json` for changes to take
effect. To see the effect of a config change without spending API points,
save a payload once (`bmpl lookup Name-Realm --json > saved.json`) and
replay it through the model:

```bash
bmpl evaluate saved.json          # human-readable verdict block
bmpl evaluate saved.json --json   # structured output
```

## Deep-dive: defensive cooldowns

`bmpl analyze` goes one level deeper than the run signals above: it fetches
the raw cast/buff/event data for one run and measures, per defensive
cooldown, **usage vs. capacity** (casts vs. how many times the cooldown could
have come up in the fight) and, for every death, **whether a defensive was
available and unused** ("immunity available", "defensive available",
"covered", "nothing available"). It's a separate, opt-in fetch — ~3 WCL
points per run, cached forever in `bmpl.db` — because it's a heavier query
than the per-run enrichment `lookup` already does.

```bash
bmpl analyze Biwaadrood-Nerzhul                    # list the runs lookup shows, and which are already analyzed
bmpl analyze Biwaadrood-Nerzhul --all --yes        # analyze every shown run (~3 pts each, once; analyzed ones print from the cache)
bmpl analyze Biwaadrood-Nerzhul --run <code>:<fight>   # analyze one specific run
bmpl analyze Biwaadrood-Nerzhul --all --yes --json # structured output (--json needs --yes to fetch, since it can't prompt)
```

Which spells count as defensives per spec lives in `src/deepdive/defensives.json`
(shipped) and can be extended or corrected with a `defensives.json` next to
your `.env` (or a path in `BMPL_DEFENSIVES`), keyed `"Class:Spec"` or
`"Class:*"`. Each entry supports three shapes:

```json
{
  "Paladin:Holy": [
    { "id": 498, "cooldownS": 42 },
    { "id": 6940, "name": "Blessing of Sacrifice", "cooldownS": 120, "durationS": 12, "kind": "major" },
    { "id": 1044, "ignore": true }
  ]
}
```

- **patch** an existing id (shipped or already in your override) — only the
  fields you list change, e.g. correcting `cooldownS` for a talent that
  shortens it.
- **add** a spell the shipped table doesn't know about — `name`, `cooldownS`,
  `durationS` and `kind` (`major` / `immunity` / `minor`) are all required.
- **ignore** an id — drops it from the effective table and from the audit's
  "not in table" list.

`bmpl defensives <Class> <Spec>` prints the effective table (shipped +
override, override entries marked); `bmpl defensives --check` validates the
override file without printing anything else.

Once at least `confidence.deepdiveMinRuns` (2 by default) of a character's
shown runs have been analyzed, the **Survival** axis in `bmpl lookup` /
`bmpl evaluate` picks up two more sub-signals: `defensiveUsage` (median major/
immunity usage across analyzed runs) and `avoidableDeaths` (share of deaths
where a defensive was available and not used).

## Requirements

- [Bun](https://bun.sh/) 1.3+ (for running from source / building)
- A Warcraft Logs v2 API client — free, see below
- `just` (optional but recommended) — https://github.com/casey/just
- For building from source: the web front builds with Vite (`just web-install`
  once, then `just build`). Node is not required — Bun runs Vite.

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

## Usage

### Vet one player

```bash
# auto-detect target from the level they actually play (median of best runs)
just l Biwaadrood-Nerzhul

# force a specific target level
just l Biwaadrood-Nerzhul --level 18

# only consider runs on one spec
just l Biwaadrood-Nerzhul --spec Restoration

# JSON output (for scripts/pipelines)
just l Biwaadrood-Nerzhul --json
```

Both forms work — combined `Name-Realm` (what you get from WoW's in-game copy)
or `Name Realm` as two args.

### Graphical UI (easiest for non-technical users)

```bash
just serve                    # starts http://localhost:3000 and opens your browser
just serve --port 4000        # custom port
just serve --no-open          # don't auto-launch browser
```

On first run, the browser lands on a setup page that walks you through creating
a Warcraft Logs API client and saves the creds to `.env` automatically — no
manual file editing required.

After that, four screens:

- **Home** — a big search box: paste a `Name-Realm`, hit **Look up**.
- **Detail** — the verdict badge and 0–100 score, the six axes (Survival,
  Utility, Throughput, Consistency, Preparation, Experience) each with a
  confidence dot and its evidence, a radar chart, signal tiles, the best run
  per dungeon with that run's own signals, and a collapsed Raider.IO section.
- **Compare** — 2–3 characters side by side: their radars overlaid in their
  class colors, and a pivoted table (one row per stat, one column per
  character) with verdict badges in the header and the best value in each row
  highlighted.
- **Setup** — the first-run flow above, also reachable any time via the
  **Re-configure** button.

**Deep-dive a run.** Any run with signals in the Detail screen's per-dungeon
list has an **Analyze · ~3 pts** button, plus an **Analyze all shown** button
that runs through every not-yet-analyzed run one at a time (same "stop before
spending on the next one" budget check as a single run). The panel that opens
shows, per defensive cooldown, usage vs. capacity, every death with what was
available and unused, and an audit of self-cast buffs not yet in the
defensives table. Corrections you make there — add / ignore / edit cooldown /
remove — are saved to a `defensives.json` next to your `.env` and applied to
every open tab immediately, at 0 pts.

The header also has a **Your key** stepper (`− +18 + · auto`): the key you are
filling, remembered by your browser and applied to every lookup and to the
clipboard watcher. If a profile was evaluated for another level, its hero shows
a **re-evaluate for +N** link that re-runs it for your key and replaces the tab
(cached data, no extra API cost). Profiles show as compact chips that wrap onto
as many rows as needed. There is also a **Clipboard watch** toggle (the
hands-free flow below, without needing a terminal) and a **Quit** button to
shut down the server. No terminal knowledge needed.

This is the intended "share with friends" mode — ship them `bmpl.exe` (see the
Windows section below), they double-click, the browser opens, they're set up
in 30 seconds.

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
just m Biwaadrood-Nerzhul     # full M+ summary, per-key-level breakdown
just c Biwaadrood-Nerzhul     # basic character info
just ping                     # auth + rate-limit budget
just zones                    # list WCL zones (M+ filter: `just zones`)
just evaluate saved.json      # re-run the evaluation model on a saved lookup
just test                     # run the test suite
just --list                   # all recipes
```

### Web front development

The UI is a Vite + React app in `web/`, embedded into the binary at build time.

- `just web-install` — install its dependencies (once)
- `just serve --no-open` in one terminal, `just web-dev` in another →
  http://localhost:5173 with hot reload; `/api` is proxied to the Bun server
  on :3000
- `just web-build` — produce `web/dist/` (fixed names: `index.html`,
  `assets/app.js`, `assets/app.css`)
- `just build` — builds the front, then the binary (`bun build --compile`
  embeds `web/dist`)
- `just check` — typechecks both trees; `bun test` runs the front's
  pure-module tests too

Rules: `web/` imports **types only** from `src/` (plus `src/wow/classes.ts`),
and all rendering logic lives in tested pure modules under `web/src/lib/`.
Without `web/dist`, `bmpl serve` answers 503 on `/` ("web UI not built") while
the API keeps working.

### Flags (shared across `lookup`, `mplus`, `watch`)

| Flag | Meaning |
|---|---|
| `--level N` | Target key level. Default: auto (median of the best run per dungeon) |
| `--spec <name>` | Filter to one spec (`Augmentation`, `Restoration`, …). Case-insensitive |
| `--metric dps \| hps` | Override the auto-selected metric |
| `--json` | Structured output (lookup / mplus only) |
| `--no-stats` | Skip per-run WCL enrichment (timed state, deaths, DTPS, avoidable, kicks, dispels). Saves ~90 pts on an uncached lookup; Raider.IO is still fetched |
| `--interval <ms>` | Clipboard poll rate for `watch` (default 750ms) |

## Windows

Cross-compile a standalone `.exe` (no Bun install needed on the target):

```bash
just build-windows             # cross-compile from Linux / WSL
# OR on a Windows host with Bun installed:
just build-windows-native      # adds --windows-hide-console: no console flash on double-click
# → bmpl.exe (~115 MB, bundles Bun)
```

### Easiest path: double-click for the web UI

1. Drop `bmpl.exe` in a folder of its own, e.g. `C:\Users\<you>\bmpl\`.
2. Double-click it. A brief console window opens (hidden entirely if you built
   with `build-windows-native`), then your browser opens to
   `http://localhost:3000`. On first run it lands on the setup page — follow
   the 4 steps to create a WCL client and paste the creds. `.env` is written
   for you alongside the `.exe`.
3. After that, double-click → type a `Name-Realm` → see the result. Click
   **Quit** in the header (or close via Task Manager) to stop the server.

This is the non-technical-friendly mode.

### CLI mode on Windows

For the terminal commands (`bmpl lookup`, `bmpl watch`, etc.), open
**PowerShell** / **Windows Terminal**:

```powershell
cd C:\Users\<you>\bmpl
.\bmpl.exe watch
.\bmpl.exe lookup Biwaadrood-Nerzhul
```

To run `bmpl` from anywhere, add the folder to your PATH and either keep an
`.env` next to where you `cd`, or set Windows user env vars:

```powershell
[Environment]::SetEnvironmentVariable("WCL_CLIENT_ID", "…", "User")
[Environment]::SetEnvironmentVariable("WCL_CLIENT_SECRET", "…", "User")
```
(Restart the terminal after setting.)

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
- `lookup` with stats enrichment (default), fully uncached: ~100 pts per
  character (≈10 pts per displayed run's `report.table` queries, up to 9
  displayed runs, + ~10 pts for the rankings query). Raider.IO enrichment is
  a separate, free API and doesn't count against this budget.
- `lookup` where the displayed runs are already cached in `bmpl.db`: ~10 pts
  (just the rankings query — per-run enrichment is a cache hit)
- `lookup --no-stats`: ~10 pts per character (rankings query only; Raider.IO
  is still fetched)
- `mplus`: ~10 pts per character (no enrichment; unchanged)
- `analyze`: ~3 pts per run, once ever (cached forever); re-opening tabs or
  correcting the table costs 0
- 3600 pts/hr → ~36 fully-uncached lookups/hr, or ~360/hr once runs are cached

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
test/
  *.test.ts, signals/*.test.ts, fixtures/   bun:test suite + fixture data
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
