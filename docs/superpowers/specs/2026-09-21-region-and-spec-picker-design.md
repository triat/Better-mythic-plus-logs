# Region per lookup and the spec picker — design

Status: approved design, 2026-09-21 (canvas "Hosted" page, board "Region per lookup (A/B/C) and the spec picker", option **B** chosen); implemented 2026-09-21 (plan `docs/superpowers/plans/2026-09-21-region-and-spec-picker.md`; 5 commits a90abb4..ef49499 for Tasks 1–5, plus this docs commit for Task 6).

## Goal

1. Vet a character on any Warcraft Logs region — EU, US, KR, TW — instead of the EU constant baked into `src/config.ts`. The region is chosen **per lookup** (some realm names exist in several regions) and **remembered per user**, since one person rarely changes it.
2. Turn the free-text "spec" filter into a **picker** fed by the specs actually seen on the loaded character, so nobody has to type `Restoration` from memory.

## Non-goals

- China (`cn`): Warcraft Logs has no CN API. Not offered.
- Inferring the region from the realm name (ambiguous: Hyjal exists on EU and US).
- A per-instance restriction of the allowed regions.
- Cross-region comparison rules: Compare already accepts any set of tabs; two regions in one comparison is fine.

## Decisions

- **Region type** — `src/wow/regions.ts`: `type Region = "eu" | "us" | "kr" | "tw"`, `REGIONS` (that order), `REGION_LABELS` (`Europe`, `Americas & Oceania`, `Korea`, `Taiwan`), `isRegion()`. Lower-case everywhere internally (Raider.IO wants lower-case; WCL's `serverRegion` is case-insensitive and we send upper-case as today). Displayed upper-case.
- **Instance default** — `BMPL_REGION` in `.env` (any of the four, default `eu`), read by `config.region` (`src/config.ts`) and reported by `GET /api/status` as `region`. It is the CLI default, the default for a user with no saved setting, and the region the tab label omits.
- **The region flows with the request**: `LookupOptions.region`, `fetchMplusData(name, realm, { region })` (the `$serverRegion` variable of the four WCL character queries), `fetchRioProfile(region, …)` (the `rio_profile` table is already keyed by region), `buildLookupPayload` sets `character.region` from the request. Nothing else in the pipeline is region-dependent: report codes, zones, season slugs, `expectedIlvl` keys and the deep-dive are global.
- **History and cache key** — `HistoryRequest.region: Region` and `cacheKey()` gets a fifth element; `POST /api/lookup` accepts `region` (optional, validated against `REGIONS`, default = instance default so older clients and saved requests keep working). Persisted history rows store the region inside `request` (JSON) — existing rows without one read as the instance default (`region ?? config.region` when parsing).
- **Raider.IO URL wins** — `parseCharacterInput()` returns `region` when the input is a `raider.io/characters/<region>/…` URL; the server uses it for that lookup and the response's `request.region` tells the front, whose chip flips to it (the setting is updated too: pasting a US link means the user is now looking at US).
- **Setting** — `Settings.region` next to `yourKey`/`legendOpen`: local mode `localStorage bmpl.region`, hosted `user_settings.region TEXT` (added by the in-place column migration pattern of `schema.ts`), `PUT /api/settings { region }` validated with `oneOf(REGIONS)`. `GET /api/me` / the boot payload already carry settings.
- **CLI** — `--region <eu|us|kr|tw>` on `lookup`/`l`, `analyze`, `watch`; precedence flag > `BMPL_REGION` > `eu`. `bmpl help` documents it. The clipboard watcher (local, server-side) takes the region from `POST /api/watch/start` (the front sends the current setting) or from the CLI flag.
- **Spec picker** — the payload gains `specsSeen: Array<{ spec: string; runs: number; metric: Metric }>` computed from **all** indexed runs before the spec filter (`uniqueSpecs` + counts; `metricForSpec`), sorted by runs desc. The front's spec chip opens a menu: `any (N runs)`, one line per spec with `runs · metric`, then `Other…` which reveals the free-text input (kept for the case where a spec has no run on the loaded character but the user insists — the server answers 404 with the specs seen, as today). Before any tab is loaded the menu offers only `any` and the free-text input. Selecting a spec fills `form.spec` and triggers nothing by itself: the user still presses Look up (the tab key includes the spec).
- **Tabs** — `tabLabel` adds ` · US` (upper-case) between the name and the level when `request.region !== status.region`; the hero keeps `Hyjal · US` always.
- **Help page** — `docs.sources` gains one sentence on region in the Warcraft Logs source ("one region per lookup; the chip in the search field remembers your last choice") — registry text, so no config number.

## UI (canvas option B)

Inside the search field, right-aligned chips in this order: `EU ▾` (region, `chip chip-on` when it differs from the instance default, plain otherwise) then `spec any ▾` / `spec Restoration ▾`. Each chip opens a small menu (`menu` / `menu-item` classes already used by the user menu): the region menu lists the four regions with their label; the spec menu as described above. Enter in the search input still submits. Local mode: identical.

## Data flow

```
Header form { character, spec, metric, region }  ──POST /api/lookup──►  handleLookup
   ▲ region from Settings (localStorage | user_settings)                 parseCharacterInput → RIO url region overrides
   │                                                                      performLookup({ region }) → fetchMplusData / fetchRioProfile
   └── response.request.region ──► Settings.region updated when it differs
tab key = cacheKey({ character, level, spec, metric, region })
```

## Errors

- Unknown region in the body → 400 `region must be one of eu, us, kr, tw` (the validator's wording).
- WCL "character not found" already names the region in its message; the front shows it as today.
- A saved setting with a value outside `REGIONS` (edited localStorage, old build) → treated as the instance default.

## Testing

- Pure: `regions.ts` (`isRegion`), `cacheKey` with region (two regions → two keys; missing region in a stored request → default), `parseCharacterInput` (RIO URL region), `specsSeen` computation, `tabLabel` with/without region, front `settings.ts` load/save of `region`, `specMenu(payload | null)` model, `regionMenu(setting, default)`.
- Server (fake `gql`/`fetch`, dummy WCL creds pinned, 0 WCL points): `POST /api/lookup { region: "us" }` → the fake `gql` receives `serverRegion: "US"`, the RIO URL contains `region=us`, the history item's `request.region` is `us`; a RIO URL input on another region overrides; `region: "cn"` → 400; hosted `PUT /api/settings { region: "kr" }` persists and comes back on `GET /api/settings`, `"cn"` → 400; `GET /api/status.region` equals `BMPL_REGION`.
- CLI: `planLookup`-style parsing of `--region` (whatever the existing flag tests use).
- Docs: `test/docs-links.test.ts` stays green; README "Command line" mentions `--region`; `docs/cli.md` flag table; `docs/hosted.md` environment table (`BMPL_REGION`) and settings; `docs/operator.md` §8 (tuning) one line; `.env.example` / `.env.hosted.example`.

## Out of scope / follow-ups

- Remembering the spec per character (a picker is enough).
- Region-aware realm autocomplete.
