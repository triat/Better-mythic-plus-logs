# bmpl — command line reference

Detailed reference; the README has the short version.

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
just serve --hosted           # multi-user mode, see "Hosted mode"
just serve --hosted --host 127.0.0.1   # bind address (hosted default; BMPL_HOST env)
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
| `--region <eu\|us\|kr\|tw>` | WoW region for this lookup. Default: the `BMPL_REGION` env var, else `eu`; an invalid value warns and falls back to `eu`. A pasted Raider.IO URL carries its own region and wins for that lookup |
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
