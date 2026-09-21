# Region per lookup and the spec picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vet a character on EU, US, KR or TW — the region chosen per lookup from a chip in the search field and remembered per user — and replace the free-text spec filter with a picker fed by the specs seen on the loaded character.

**Architecture:** A `Region` type (`src/wow/regions.ts`) replaces the `EU` constant; the region travels with every lookup request (WCL `$serverRegion`, Raider.IO `region=`, history key, payload `character.region`), defaults to the instance's `BMPL_REGION` (default `eu`), and is remembered like "your key" (`localStorage` locally, `user_settings.region` hosted). The payload gains `specsSeen` so the front can offer a menu. Two chips inside the search field (canvas option B) open small menus; local mode is otherwise pixel-identical.

**Tech Stack:** Bun + TypeScript strict, `bun test` with fake `gql`/`fetch`; Vite 8 + React 19; SQLite via `bun:sqlite`.

**Spec:** `docs/superpowers/specs/2026-09-21-region-and-spec-picker-design.md`. Design: canvas https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s page "Hosted", board "Region per lookup (A/B/C) and the spec picker" — **option B** (source `docs/design/canvas/RegionSpec.dc.html`).

## Global Constraints

- **Regions**: exactly `"eu" | "us" | "kr" | "tw"` in that order, lower-case internally, upper-case in the UI; labels `Europe`, `Americas & Oceania`, `Korea`, `Taiwan`. No `cn`. WCL receives `serverRegion` upper-case (`region.toUpperCase()`), Raider.IO lower-case.
- **Instance default** `BMPL_REGION` (env, case-insensitive, default `eu`; an invalid value warns once on stderr and falls back to `eu`); exposed as `region` on `GET /api/status` (both modes); it is the CLI default and the default of a user with no saved setting.
- **Compatibility**: `POST /api/lookup` / `POST /api/watch/start` accept `region` optionally (default = instance default); persisted history rows whose `request` lacks `region` read as the instance default; `cacheKey` includes the region (so a stored key from before this change is a different key — acceptable, the tab is simply re-fetched).
- **A Raider.IO URL's region wins** for that lookup and is reported back in `request.region`.
- **Never spend WCL points**: every test uses fake `gql` / `fetch` / `performLookup`; server tests pin dummy `WCL_CLIENT_ID`/`WCL_CLIENT_SECRET` as the existing ones do (`bun test` loads the real `.env`).
- **Front**: models pure and tested in `web/src/lib/*.ts`; components thin; colours only from `web/src/styles/tokens.css`; types-only imports from `src/` via `web/src/types.ts` (`Region` and `REGIONS` are re-declared in the front as a typed list like `AUDIT_KIND_OF` — `Record<Region, string>` keeps it in sync); `just check && bun test` green with `web/dist` absent at the end of every task; explicit `git add`; never `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env*` (except the two `.example` files), `bmpl.db*`, `web/dist`, `bmpl`; commit trailers as the session provides; English everywhere.

## File map

| File | Responsibility |
|---|---|
| `src/wow/regions.ts` (new) + `test/regions.test.ts` | `Region`, `REGIONS`, `REGION_LABELS`, `isRegion`, `parseRegion` |
| `src/config.ts` | `config.region` from `BMPL_REGION` |
| `src/mplus.ts`, `src/lookup.ts`, `src/signals/rio-client.ts` (signature unchanged), `src/server-history.ts`, `src/server/{validate,http,lookup,watcher,routes-local,routes-shared}.ts` | the region through the pipeline; `specsSeen` |
| `src/cli.ts` | `--region` on lookup/mplus/analyze/watch; help text |
| `src/hosted/{schema,db}.ts`, `src/server/{validate,routes-user}.ts` | `user_settings.region` |
| `web/src/lib/{regions,settings,history,header}.ts` (+tests), `web/src/components/Header.tsx`, `web/src/App.tsx`, `web/src/types.ts`, `web/src/api.ts`, `web/src/styles/app.css` | chips, menus, request region, tab label |
| `src/evaluation/docs.ts`, `README.md`, `docs/cli.md`, `docs/hosted.md`, `docs/operator.md`, `docs/agents/{architecture,web-front}.md`, `.env.example`, `.env.hosted.example` | docs |

---

### Task 1: `Region` type, `BMPL_REGION`, `/api/status.region`

**Files:**
- Create: `src/wow/regions.ts`, `test/regions.test.ts`
- Modify: `src/config.ts`, `src/server/routes-shared.ts` (the `/api/status` handler, both branches), `test/server.test.ts` (status assertion), `.env.example`, `.env.hosted.example`

**Interfaces:**
- Produces:
  ```ts
  export type Region = "eu" | "us" | "kr" | "tw";
  export const REGIONS: readonly Region[] = ["eu", "us", "kr", "tw"];
  export const REGION_LABELS: Record<Region, string> = { eu: "Europe", us: "Americas & Oceania", kr: "Korea", tw: "Taiwan" };
  export const isRegion = (v: unknown): v is Region => typeof v === "string" && (REGIONS as readonly string[]).includes(v);
  /** Case-insensitive; null when not a region. */
  export const parseRegion = (v: string | undefined | null): Region | null => { const s = (v ?? "").trim().toLowerCase(); return isRegion(s) ? s : null; };
  ```
  `config.region: Region` (getter: `parseRegion(process.env.BMPL_REGION) ?? "eu"`, warning once on stderr `bmpl: ignoring BMPL_REGION="<v>": expected one of eu, us, kr, tw` when set and invalid). `GET /api/status` → `region: config.region` in both the local and the hosted body.

- [ ] **Step 1: Failing tests** — `test/regions.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/config.ts";
import { REGIONS, REGION_LABELS, isRegion, parseRegion } from "../src/wow/regions.ts";

const saved = process.env.BMPL_REGION;
afterEach(() => { if (saved === undefined) delete process.env.BMPL_REGION; else process.env.BMPL_REGION = saved; });

describe("regions", () => {
  test("the four WCL regions, in order, with labels", () => {
    expect(REGIONS).toEqual(["eu", "us", "kr", "tw"]);
    expect(Object.keys(REGION_LABELS)).toEqual(["eu", "us", "kr", "tw"]);
    expect(isRegion("us")).toBe(true);
    expect(isRegion("cn")).toBe(false);
    expect(isRegion("US")).toBe(false);
  });
  test("parseRegion is case-insensitive and null otherwise", () => {
    expect(parseRegion(" KR ")).toBe("kr");
    expect(parseRegion("cn")).toBeNull();
    expect(parseRegion(undefined)).toBeNull();
  });
  test("config.region follows BMPL_REGION, defaults to eu, ignores junk", () => {
    delete process.env.BMPL_REGION;
    expect(config.region).toBe("eu");
    process.env.BMPL_REGION = "US";
    expect(config.region).toBe("us");
    process.env.BMPL_REGION = "mars";
    expect(config.region).toBe("eu");
  });
});
```
  In `test/server.test.ts`, the `/api/status` test asserts `region: "eu"` in the body (the suite runs with `BMPL_REGION` unset; if your `.env` sets it, the test pins `process.env.BMPL_REGION = "eu"` in `beforeAll` and restores it).

- [ ] **Step 2: Run** `bun test test/regions.test.ts` → fails (module not found).
- [ ] **Step 3: Implement** `src/wow/regions.ts` as above; `src/config.ts`: replace `region: "EU" as const` by a getter `get region(): Region` (import type from `./wow/regions.ts`); the warning is printed once per process (module-level `let warned = false`). Every current use of `config.region` that feeds WCL (`serverRegion: config.region` in `src/mplus.ts` ×3, `src/cli.ts` ×4) becomes `config.region.toUpperCase()` for now — Task 2 replaces them with the request's region. `buildLookupPayload` (`src/lookup.ts`) `character.region: config.region` stays lower-case (the front upper-cases it: check `VerdictHero.tsx` prints `c.region.toUpperCase()` — it does). `/api/status`: add `region: config.region` to both `jsonResponse` bodies. `.env.example` and `.env.hosted.example`: `# Optional: the default region for lookups — eu (default), us, kr or tw.` + `BMPL_REGION=`.
- [ ] **Step 4:** `just check && bun test` green.
- [ ] **Step 5: Commit** — `git add src/wow/regions.ts test/regions.test.ts src/config.ts src/mplus.ts src/cli.ts src/lookup.ts src/server/routes-shared.ts test/server.test.ts .env.example .env.hosted.example` · `feat(region): Region type, BMPL_REGION instance default, /api/status.region`

---

### Task 2: The region through the lookup pipeline; `specsSeen`

**Files:**
- Modify: `src/mplus.ts` (`fetchMplusData` opts + the three `serverRegion:` sites + `MPlusData`), `src/lookup.ts` (`LookupOptions.region`, `fetchRioProfile(opts.region, …)`, payload `character.region`, `specsSeen`), `src/server-history.ts` (`HistoryRequest.region`, `cacheKey`), `src/server/validate.ts` (`LOOKUP_BODY.region`, `WATCH_BODY.region`), `src/server/http.ts` (`parseCharacterInput` returns `region`), `src/server/lookup.ts` (`runLookupWithCache` opts + request), `src/server/watcher.ts` (opts), `src/server/routes-local.ts` (watch start), `src/hosted/history.ts` (reading a stored `request` without region), `src/cli.ts` (the `performLookup`/`fetchMplusData` call sites pass `config.region` — flags come in Task 3)
- Tests: `test/server-history.test.ts`, `test/lookup.test.ts`, `test/server-lookup.test.ts`, `test/mplus.test.ts` (if it builds `fetchMplusData` with a fake `gql`), `test/hosted/history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/server-history.ts
  export interface HistoryRequest { character: string; level: number | null; spec: string | null; metric: Metric | null; region: Region }
  export const cacheKey = (r) => JSON.stringify([character, level ?? "auto", spec, metric ?? "", r.region]);
  /** A stored request (JSON) may predate the region: default it. */
  export const requestFromJson = (json: string, fallbackRegion: Region): HistoryRequest;
  // src/lookup.ts
  export interface LookupOptions { …; region: Region }
  export interface SpecSeen { spec: string; runs: number; metric: Metric }
  export const specsSeen = (runs: MPlusRun[]): SpecSeen[];   // all indexed runs before the spec filter, sorted by runs desc then name
  // payload: character.region = opts.region; specsSeen: SpecSeen[]
  // src/mplus.ts
  fetchMplusData(name, realm, { …, region: Region })          // serverRegion: opts.region.toUpperCase() on the probe, multi and any other character query
  // src/server/http.ts
  parseCharacterInput(raw): { name; realm; region: Region | null } | null   // region only from a Raider.IO URL (parseRegion of its segment; a URL with an unknown region segment → null region, name/realm still parsed)
  // src/server/lookup.ts
  runLookupWithCache({ character, level, spec, metric, refresh, region: Region }, history, deps)
  // LookupSuccess gains `request: HistoryRequest` (the effective one — region possibly overridden by the URL)
  // src/server/validate.ts
  LOOKUP_BODY += region: opt(oneOf(REGIONS)); WATCH_BODY += region: opt(oneOf(REGIONS))   // error text "region must be one of eu, us, kr, tw" — check obj()/oneOf()'s wording and assert whatever it produces
  ```
  Handlers default `region: body.region ?? config.region`. The watcher stores `region` in its opts and passes it to `runLookupWithCache`. `POST /api/lookup`'s success body gains `request` (the effective request; the front reads `request.region`). `historySummary` already returns `request` — it now carries the region.

- [ ] **Step 1: Failing tests** (add to the existing files, same fixtures/styles):

```ts
// test/server-history.test.ts
test("cacheKey carries the region; two regions are two tabs", () => {
  expect(cacheKey({ ...req("Biwaasham-Hyjal", 18), region: "eu" })).toBe(JSON.stringify(["biwaasham-hyjal", 18, "", "", "eu"]));
  expect(cacheKey({ ...req("Biwaasham-Hyjal", 18), region: "us" })).not.toBe(cacheKey({ ...req("Biwaasham-Hyjal", 18), region: "eu" }));
});
test("requestFromJson defaults a stored request without region", () => {
  expect(requestFromJson(JSON.stringify({ character: "A-B", level: null, spec: null, metric: null }), "eu").region).toBe("eu");
  expect(requestFromJson(JSON.stringify({ character: "A-B", level: 2, spec: null, metric: null, region: "kr" }), "eu").region).toBe("kr");
});
// (every existing `req()` helper in this file and in test/hosted/history.test.ts gains `region: "eu"`)

// test/lookup.test.ts — the fetchMplus fake records its opts
test("the region reaches WCL and Raider.IO", async () => {
  const x = fixture();
  const seen: unknown[] = []; const urls: string[] = [];
  const fetchMplus = async (_n: string, _r: string, o: unknown) => { seen.push(o); return x.data; };
  const fetchFn = (async (u: string) => { urls.push(String(u)); return new Response("nope", { status: 404 }); }) as unknown as typeof fetch;
  const o = await performLookup({ ...opts(x.name), region: "us" }, { store: x.store, gql: x.gql, fetchFn, fetchMplus });
  expect(o.ok).toBe(true);
  expect((seen[0] as { region: string }).region).toBe("us");
  expect(urls[0]).toContain("region=us");
  expect(buildLookupPayload(o as never, "Hyjal").character.region).toBe("us");
});
test("specsSeen counts every indexed run before the spec filter", () => {
  const runs = [{ spec: "Restoration" }, { spec: "Elemental" }, { spec: "Elemental" }] as never;
  expect(specsSeen(runs)).toEqual([{ spec: "Elemental", runs: 2, metric: "dps" }, { spec: "Restoration", runs: 1, metric: "hps" }]);
});
// test/mplus.test.ts (only if a fetchMplusData-with-fake-gql test exists there): assert vars.serverRegion === "US" for region "us"

// test/server-lookup.test.ts
test("a Raider.IO URL overrides the requested region and the effective request is returned", async () => {
  const seen: LookupOptions[] = [];
  const performLookup = (async (o: LookupOptions) => { seen.push(o); return OK_OUTCOME; }) as never;   // reuse the file's fake outcome
  const r = await runLookupWithCache({ character: "https://raider.io/characters/us/hyjal/Biwaasham", level: null, spec: null, metric: null, refresh: false, region: "eu" }, new History(5), { performLookup });
  expect(r.ok && r.request.region).toBe("us");
  expect(seen[0]!.region).toBe("us");
});
test("POST /api/lookup: region validated, defaults to the instance region, stored on the history item", …)   // via the file's server fixture: body { character, region: "cn" } → 400 mentioning "region"; body without region → history item request.region === "eu"; body { region: "kr" } → the fake performLookup receives "kr"
```

- [ ] **Step 2: Run** the four test files → fail (types/keys).
- [ ] **Step 3: Implement** per the Interfaces block. Details: `parseCharacterInput` — `const rio = parseRaiderIOUrl(s); if (rio) return { name: rio.name, realm: rio.realm, region: parseRegion(rio.region) }`; other branches `region: null`. `runLookupWithCache`: `const region = target.region ?? opts.region; const request = { …, region }`; pass `region` to `performLookup`; return `request` in the success. `src/hosted/history.ts` and `src/server-history.ts`'s `History` store the request object as given; where a stored JSON `request` is parsed (`hosted/history.ts` `JSON.parse(e.request)`, the `forget` alias, `list()` items), use `requestFromJson(json, config.region)`. `watcher.ts`: `opts: { level, spec, metric, region }`, default `config.region` when the body omits it. `src/cli.ts`: pass `region: config.region` explicitly to `performLookup`/`fetchMplusData` (the 4 `serverRegion:` sites in the CLI become `config.region.toUpperCase()` if they call `gql` directly — keep behaviour). `specsSeen`: `Map<spec, count>` over `data.runs` **before** `filterBySpec` (compute in `performLookup` from the unfiltered `data.runs` and carry it in the outcome, or compute inside `fetchMplusData` on `runs` before returning — pick the former: `LookupOutcome` gains `specsSeen`); `metric: metricForSpec(spec)` (`src/roles.ts`).
- [ ] **Step 4:** `just check && bun test` green. `grep -rn "config.region" src` — the remaining uses are the defaults (handlers, CLI, watcher) and the `character.region` fallback; none feeds a WCL query without going through a request.
- [ ] **Step 5: Commit** — `feat(region): the region travels with every lookup — WCL, Raider.IO, history key, payload; specsSeen in the payload`

---

### Task 3: CLI `--region`

**Files:** Modify `src/cli.ts` (help text lines ~45–70; `lookup`/`l`, `mplus`, `analyze`, `watch` flag parsing: `stripFlags` lists, `parseFlag(rest, "--region")`), `test/cli-select.test.ts` or a new `test/cli-region.test.ts` if the flag parsing is not exported — in that case export a small pure `parseRegionFlag(rest: string[]): Region | null | "invalid"` from `src/cli.ts`? No: `src/cli.ts` runs the dispatcher at import. Put the helper in `src/wow/regions.ts`: `export function regionFlag(args: string[], flag = "--region"): { region: Region | null; invalid: string | null }` (null when absent; `invalid` = the raw value when present but not a region) and test it in `test/regions.test.ts`.

- [ ] **Step 1: Failing test** (append to `test/regions.test.ts`):
```ts
test("regionFlag reads --region, case-insensitive, and reports junk", () => {
  expect(regionFlag(["Biwaasham-Hyjal", "--region", "US"])).toEqual({ region: "us", invalid: null });
  expect(regionFlag(["Biwaasham-Hyjal"])).toEqual({ region: null, invalid: null });
  expect(regionFlag(["--region", "cn"])).toEqual({ region: null, invalid: "cn" });
  expect(regionFlag(["--region"])).toEqual({ region: null, invalid: "" });
});
```
- [ ] **Step 2: Implement** `regionFlag`; in `src/cli.ts` for each of the four commands: `const rf = regionFlag(rest); if (rf.invalid !== null) { console.error(err(\`Invalid --region value: ${rf.invalid} (eu, us, kr, tw)\`)); process.exit(2); } const region = rf.region ?? config.region;` and pass `region` to `performLookup` / `fetchMplusData` / the watcher; add `--region` to the `stripFlags` value-flag lists and to the usage strings; help text: `[--region eu|us|kr|tw]` on the four commands and one line under the flags description: `--region     WCL/Raider.IO region (default: BMPL_REGION or eu)`.
- [ ] **Step 3:** `bun src/cli.ts help | grep -c region` ≥ 4; `just check && bun test` green.
- [ ] **Step 4: Commit** — `feat(cli): --region on lookup, mplus, analyze and watch`

---

### Task 4: The remembered region (hosted column + front settings)

**Files:**
- Modify: `src/hosted/schema.ts` (`user_settings.region TEXT` — add to the `CREATE TABLE` and to an in-place migration like `USER_COLUMNS`: `SETTINGS_COLUMNS = [["region", "TEXT"]]` applied to `user_settings`), `src/hosted/db.ts` (`UserSettings.region: Region | null`, `DEFAULT_USER_SETTINGS.region = null`, `settingsGet`/`settingsUpsert` read/write `region`), `src/server/validate.ts` (`SETTINGS_BODY += region: opt(nullable(oneOf(REGIONS)))`), `src/server/routes-user.ts` (nothing else if the patch merge is generic — check the "Nothing to update" rule includes `region`), `web/src/lib/settings.ts` (+test), `web/src/lib/regions.ts` (new, +test), `web/src/types.ts`
- Tests: `test/server-user-state.test.ts` (`PUT /api/settings { region: "kr" }` round trip; `"cn"` → 400; an existing DB created before the column — open a temp DB with the old `CREATE TABLE` statement minus `region`, then `openHosted` → the column exists), `web/src/lib/settings.test.ts`, `web/src/lib/regions.test.ts`

**Interfaces:**
```ts
// web/src/lib/regions.ts (front copy — types from @shared, values re-declared)
import type { Region } from "../types.ts";            // types.ts: export type { Region } from "@shared/wow/regions.ts";
export const REGIONS: readonly Region[] = ["eu", "us", "kr", "tw"];
export const REGION_LABELS: Record<Region, string> = { eu: "Europe", us: "Americas & Oceania", kr: "Korea", tw: "Taiwan" };
export const isRegion = (v: unknown): v is Region => …;
export const regionLabel = (r: Region): string => r.toUpperCase();
/** The region a lookup uses: the saved one, else the instance default. */
export const effectiveRegion = (saved: Region | null, instanceDefault: Region): Region => saved ?? instanceDefault;
// web/src/lib/settings.ts
export interface Settings { yourKey: number | null; legendOpen: boolean; region: Region | null }
export const REGION_STORAGE_KEY = "bmpl.region";      // readLocalSettings: isRegion(value) ? value : null; writeLocalSettings: remove on null
// parseServerSettings: region: isRegion(o.region) ? o.region : null
// web/src/lib/hostedMode.ts: StatusInfo.region: Region (App reads s.region, LOCAL_STATUS.region = "eu")
```

- [ ] **Step 1: Failing tests**
```ts
// web/src/lib/settings.test.ts (extend the existing store fake)
test("region is remembered in the browser and parsed from the server, junk → null", () => {
  const store = fakeStore({ "bmpl.region": "us" });
  expect(readLocalSettings(store).region).toBe("us");
  writeLocalSettings(store, { region: "kr" }); expect(store.getItem("bmpl.region")).toBe("kr");
  writeLocalSettings(store, { region: null }); expect(store.getItem("bmpl.region")).toBeNull();
  expect(readLocalSettings(fakeStore({ "bmpl.region": "cn" })).region).toBeNull();
  expect(parseServerSettings({ region: "tw" }).region).toBe("tw");
  expect(parseServerSettings({ region: "cn" }).region).toBeNull();
  expect(parseServerSettings({}).region).toBeNull();
});
// web/src/lib/regions.test.ts
test("labels and effective region", () => {
  expect(REGIONS).toEqual(["eu", "us", "kr", "tw"]);
  expect(regionLabel("us")).toBe("US");
  expect(effectiveRegion(null, "eu")).toBe("eu");
  expect(effectiveRegion("kr", "eu")).toBe("kr");
});
// test/server-user-state.test.ts
test("PUT /api/settings remembers the region; junk is refused; an old database gains the column", async () => {
  expect(await (await put(a, { region: "kr" })).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: true, region: "kr" } });
  expect((await put(a, { region: "cn" })).status).toBe(400);
  expect(await (await put(a, { region: null })).json()).toMatchObject({ settings: { region: null } });
});
```
  (adjust the first expectation to the fixture's existing yourKey/legendOpen state.) Migration test: in `test/hosted/db.test.ts` or the schema test, create a DB, run the pre-change `CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, your_key INTEGER, legend_open INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`, then `openHosted(db)` and assert `PRAGMA table_info(user_settings)` includes `region`.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** `App.tsx` boot: `region: isRegion(s.region) ? s.region : "eu"` into `StatusInfo`; every existing `Settings` literal in tests gains `region: null`.
- [ ] **Step 4:** `just check && bun test` green. **Step 5: Commit** — `feat(settings): the region is remembered per user (localStorage locally, user_settings.region hosted)`

---

### Task 5: Front — region chip, spec picker, request region, tab label

**Files:**
- Create: `web/src/lib/header.ts` (+ `header.test.ts`), `web/src/components/ChipMenu.tsx`
- Modify: `web/src/components/Header.tsx`, `web/src/App.tsx` (`formToRequest`, the RIO-override flip, watch start, `LookupForm` no longer holds the region — it comes from settings), `web/src/lib/history.ts` (+test: `tabSubtitle`), `web/src/components/Tabs.tsx` (uses the subtitle — check what it renders), `web/src/types.ts` (`LookupRequest.region`, `WatchOpts.region`, `HistoryItem.request.region`, `SpecSeen`, `LookupPayload.specsSeen` if the payload type is re-exported from `@shared`), `web/src/api.ts` (lookup response type includes `request`), `web/src/styles/app.css`

**Interfaces:**
```ts
// web/src/lib/header.ts
export interface MenuItem { value: string; label: string; hint: string | null; on: boolean }
/** The region menu: four rows; `on` = the effective region. */
export function regionMenu(effective: Region): MenuItem[];                       // label "EU", hint "Europe" …
/** The spec menu for the loaded payload (null before any tab): "any" (+ total runs), one row per specsSeen ("31 runs · hps"), then "other" (free text). */
export function specMenu(payload: Pick<LookupPayload, "specsSeen" | "runsIndexed"> | null, current: string): MenuItem[];
export const specChipLabel = (spec: string): string => spec ? `spec ${spec} ▾` : "spec any ▾";
export const regionChipLabel = (r: Region): string => `${r.toUpperCase()} ▾`;
// web/src/lib/history.ts
export const tabSubtitle = (item: HistoryItem, instanceRegion: Region): string;   // "US · +18 auto · Restoration" when item.request.region !== instanceRegion, else as today
```
`ChipMenu` = a `<button className="chip">` + an absolutely positioned `<div className="menu" role="menu">` with `menu-item` rows (existing classes from the user menu), closed on outside click / Escape, `onPick(value)`. Header: the search field (`.search` wrapper — check the current markup: the input and the `spec` chip live in the same bordered box) gets `<ChipMenu items={regionMenu(region)} label={regionChipLabel(region)} onPick={r => update({ region: r })} className={region !== status.region ? "chip chip-on" : "chip"} />` then the spec `ChipMenu` (`onPick("other")` reveals the existing free-text input inline; any other value sets `form.spec`). `App.tsx`: `formToRequest(form, yourKey, region)` adds `region`; after a successful lookup, if `r.request.region !== region` → `update({ region: r.request.region })` (the chip flips); `api.watchStart({ …, region })`. Tabs: `tabSubtitle(t, status.region)`.

- [ ] **Step 1: Failing model tests** (`header.test.ts`, `history.test.ts`):
```ts
test("regionMenu marks the effective region", () => {
  expect(regionMenu("kr").map((i) => [i.value, i.label, i.hint, i.on])).toEqual([["eu", "EU", "Europe", false], ["us", "US", "Americas & Oceania", false], ["kr", "KR", "Korea", true], ["tw", "TW", "Taiwan", false]]);
});
test("specMenu before a lookup: any + other; after: the specs seen with counts and metric", () => {
  expect(specMenu(null, "").map((i) => i.value)).toEqual(["", "other"]);
  const p = { runsIndexed: 83, specsSeen: [{ spec: "Elemental", runs: 52, metric: "dps" }, { spec: "Restoration", runs: 31, metric: "hps" }] };
  expect(specMenu(p, "Restoration")).toEqual([
    { value: "", label: "any", hint: "83 runs", on: false },
    { value: "Elemental", label: "Elemental", hint: "52 runs · dps", on: false },
    { value: "Restoration", label: "Restoration", hint: "31 runs · hps", on: true },
    { value: "other", label: "Other…", hint: "type a name", on: false },
  ]);
  expect(specChipLabel("")).toBe("spec any ▾"); expect(specChipLabel("Restoration")).toBe("spec Restoration ▾");
});
test("tabSubtitle names the region only when it is not the instance default", () => {
  const item = { targetLevel: 18, targetAutoDetected: true, spec: null, request: { character: "Biwaasham-Hyjal", level: null, spec: null, metric: null, region: "us" } } as never;
  expect(tabSubtitle(item, "eu")).toBe("US · +18 auto");
  expect(tabSubtitle(item, "us")).toBe("+18 auto");
});
```
- [ ] **Step 2: Run** → fail. **Step 3: Implement** models, `ChipMenu`, Header, App, Tabs, CSS (`.search .chip` spacing as today; `.chip-menu { position: relative; } .chip-menu .menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; min-width: 200px; }` — reuse `.menu`/`.menu-item`/`.menu-head` from the user menu; check their current selectors and scope if needed; `.menu-item .n { margin-left: auto; font-size: 11px; color: var(--muted); }`).
- [ ] **Step 4:** `just check && bun test`; visual check: `just build`, `bun src/cli.ts serve --no-open --port 3011`, open `/` — the header shows `EU ▾` and `spec any ▾` chips; open each menu (screenshot vs the canvas board, option B); pick `US` → chip reads `US ▾` and `chip-on`; reload → still `US` (localStorage). Do NOT run a lookup (WCL points) unless the controller allowed one; the loaded-payload spec menu is covered by the model test. Kill the server, `rm -rf web/dist`.
- [ ] **Step 5: Commit** — `feat(web): region chip (remembered) and spec picker in the search field; region on tabs`

---

### Task 6: Docs and the help registry

**Files:** Modify `src/evaluation/docs.ts` (`sources[0].text` gains: "One region per lookup (EU, US, KR, TW) — the chip in the search field remembers your last choice; a pasted Raider.IO link brings its own region."), `README.md` (§Command line: `--region`; §What you get or Quick start: one clause "any WCL region"), `docs/cli.md` (flag table row `--region <eu|us|kr|tw>`; `BMPL_REGION` in the env/config notes), `docs/hosted.md` (§Environment table: `BMPL_REGION`; §Per-account state: region remembered; §Routes: `/api/settings` body mentions region), `docs/operator.md` (§8 Tuning: `BMPL_REGION` one line), `docs/agents/architecture.md` (config precedence line: `BMPL_REGION`; the lookup flow mentions the request region), `docs/agents/web-front.md` (models list: `header.ts`, `regions.ts`; components: `ChipMenu`), the spec status line ("implemented 2026-09-21").

- [ ] **Step 1:** Edits; `bun test test/docs-links.test.ts test/evaluation/docs.test.ts` green; `just check && bun test`.
- [ ] **Step 2: Commit** — `docs: region per lookup and the spec picker`

## Self-review

- Spec Decisions → tasks: Region type/default/status (T1); pipeline, history key, RIO override, watcher (T2); CLI (T3); setting local+hosted (T4); UI option B, tabs, request region, flip on RIO URL (T5); help registry + docs (T6). Errors section: 400 wording (T2/T4), junk setting → default (T4 `isRegion` guards). Testing section: each bullet has a test in T1–T5; docs in T6.
- Names consistent: `Region`, `REGIONS`, `parseRegion`, `isRegion`, `regionFlag` (T1/T3), `HistoryRequest.region` + `requestFromJson` (T2, consumed by T5's `HistoryItem.request.region`), `specsSeen`/`SpecSeen` (T2 → T5 `specMenu`), `Settings.region` (T4 → T5), `StatusInfo.region` (T4 → T5 `tabSubtitle`), `LookupSuccess.request` (T2 → T5 flip).
- No placeholders: signatures, test bodies, CSS and copy are given; the one open wording (the validator's exact 400 text) is resolved by asserting what `oneOf` produces.
