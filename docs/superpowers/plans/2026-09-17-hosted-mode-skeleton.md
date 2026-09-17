# Hosted Mode Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "hosted" a first-class server mode (`bmpl serve --hosted` / `BMPL_MODE=hosted`) with validated config, a split route table where local-only routes are not registered, a `/api/health` endpoint and security headers — without any user feature yet and without changing local mode.

**Architecture:** `src/server.ts` (600 lines, one `fetch` switch) is split into `src/server/*` modules: HTTP helpers, SSE fan-out, the clipboard watcher, lookup+history handlers, deep-dive handlers, a tiny route table, `routes-shared.ts` (both modes) and `routes-local.ts` (local only), plus `security.ts` (headers/CSP). `runServer` composes `shared + (hosted ? [] : local)` and wraps every response with security headers in hosted mode. Hosted env validation lives in `src/hosted/config.ts` and runs in the CLI before the server starts; `runServer` itself only receives `hosted: boolean` so tests can start both modes in one process. The front learns `hosted` from `/api/status` and hides Setup/Quit/clipboard controls through a tested view model.

**Tech Stack:** Bun 1.3 (`Bun.serve`, `bun:test`, `bun:sqlite`), TypeScript strict, Vite 8 + React 19 (types-only imports from `src/`).

**Spec:** GitHub issue #2 "Hosted mode skeleton: mode flag, route split, health endpoint, security headers" (parent #1 — the architecture). Read both with `gh issue view 2` / `gh issue view 1`. Repo rules: `AGENTS.md`, `docs/agents/architecture.md`, `docs/agents/web-front.md`, `docs/agents/testing.md`.

## Global Constraints

- Local mode (`bmpl serve` without `--hosted`) behaves exactly as today: every existing test in `test/server*.test.ts` stays unchanged except for the asset-loader shape change in Task 6 (a fourth file), and passes.
- Hosted-only env vars, validated at startup in the CLI (exit code 2 listing what is missing/invalid): `BMPL_BASE_URL` (http(s) origin, no path), `BMPL_SESSION_SECRET` (≥ 32 bytes), `BMPL_DISCORD_CLIENT_ID`, `BMPL_DISCORD_CLIENT_SECRET`, `BMPL_ADMIN_DISCORD_IDS` (comma-separated, ≥ 1 id), `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`.
- Mode resolution: flag `--hosted` wins over `BMPL_MODE=hosted`; any other `BMPL_MODE` value is an error (exit 2).
- In hosted mode `/api/setup`, `/api/quit`, `/api/watch/start|stop|status` are **not registered** (plain 404 "Not found"), `open` is forced to `false`, and `/api/status` returns `{ ok: true, hosted: true, hasCredentials }` with **no** `envPath`. In local mode `/api/status` returns `{ ok: true, hosted: false, hasCredentials, envPath }`.
- `GET /api/health` (both modes, no auth) → `200 { ok: true, version, uptimeS, db: "ok" }`; `503 { ok: false, version, uptimeS, db: "error" }` when `SELECT 1` fails.
- Security headers on **every** response in hosted mode, none in local mode: `Content-Security-Policy` (exact value in Task 4), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: clipboard-read=()`, `X-Frame-Options: DENY`. HSTS is Caddy's job (issue #10), not the app's.
- No inline `<script>` in `web/index.html` (the CSP has no `'unsafe-inline'` for scripts): the Wowhead config moves to `/wh-config.js`, served and embedded like the other assets.
- Web front: types-only imports from `src/` (`@shared/*`), except runtime `src/wow/classes.ts`; new logic in pure tested view models under `web/src/lib/`; all UI strings English; tokens from `tokens.css` only.
- No new runtime dependencies (root or `web/`).
- `just check` (tsc for CLI + web) and `bun test` must pass at the end of every task, with `web/dist` absent.
- Commits on `main` in place; messages end (after a blank line) with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`. Stage paths explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`. Never rewrite history.

## File structure

| File | Responsibility |
|---|---|
| `src/hosted/config.ts` (new) | `resolveMode`, `validateHostedEnv`, `HostedConfig`, `HOSTED_ENV_VARS` — pure, env passed in |
| `src/server/http.ts` (new) | `jsonResponse`, `readJson`, `parseMetric`, `parseCharacterInput` |
| `src/server/sse.ts` (new) | SSE client set, `broadcast`, heartbeat, `eventsResponse(initial)` |
| `src/server/watcher.ts` (new) | clipboard watcher state machine (`startWatcher`, `stopWatcher`, `watcherStatus`) |
| `src/server/lookup.ts` (new) | `history` singleton, `historySummary`, `runLookupWithCache`, `handleLookup` |
| `src/server/deepdive.ts` (new) | `refreshHistoryDeepdive`, `handleDeepdive`, `handleDefensivesGet`, `handleDefensivesPost` |
| `src/server/routes.ts` (new) | `Route`, `route()`, `prefixRoute()`, `dispatch()` |
| `src/server/routes-shared.ts` (new) | lookup, deepdive, defensives, history, events, status, health |
| `src/server/routes-local.ts` (new) | setup, watch/*, quit |
| `src/server/security.ts` (new) | `CSP`, `SECURITY_HEADERS`, `withSecurityHeaders` |
| `src/server.ts` (modify) | `ServeOptions.hosted`, `runServer` composition only |
| `src/web-static.ts`, `src/web-assets.ts`, `src/web-assets-types.d.ts` (modify) | fourth asset `/wh-config.js` |
| `web/public/wh-config.js` (new), `web/index.html` (modify) | Wowhead config as an external script |
| `src/cli.ts` (modify) | `serve --hosted`, `planServe()` exported and tested |
| `web/src/lib/hostedMode.ts` (new) + test | `StatusInfo`, `uiControls`, `initialScreen` |
| `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/Header.tsx`, `web/src/components/Home.tsx` (modify) | hosted-aware UI |
| `test/hosted/config.test.ts`, `test/server-hosted.test.ts`, `test/cli-serve.test.ts` (new); `test/server.test.ts`, `test/server-deepdive.test.ts` (modify) | tests |
| `README.md`, `docs/agents/architecture.md`, `AGENTS.md` (modify) | docs |

---

### Task 1: Hosted config resolution (`src/hosted/config.ts`)

**Files:**
- Create: `src/hosted/config.ts`
- Test: `test/hosted/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Mode = "local" | "hosted";
  export const HOSTED_ENV_VARS: readonly string[];
  export interface HostedConfig { baseUrl: string; sessionSecret: string; discordClientId: string; discordClientSecret: string; adminDiscordIds: string[] }
  export function resolveMode(flagHosted: boolean, env: Record<string, string | undefined>): { ok: true; mode: Mode } | { ok: false; error: string };
  export function validateHostedEnv(env: Record<string, string | undefined>): { ok: true; config: HostedConfig } | { ok: false; missing: string[]; invalid: string[] };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/hosted/config.test.ts
import { describe, expect, test } from "bun:test";
import { HOSTED_ENV_VARS, resolveMode, validateHostedEnv } from "../../src/hosted/config.ts";

const FULL: Record<string, string> = {
  BMPL_BASE_URL: "https://bmpl.example.com",
  BMPL_SESSION_SECRET: "0123456789abcdef0123456789abcdef", // 32 bytes
  BMPL_DISCORD_CLIENT_ID: "123",
  BMPL_DISCORD_CLIENT_SECRET: "abc",
  BMPL_ADMIN_DISCORD_IDS: "111, 222",
  WCL_CLIENT_ID: "wcl-id",
  WCL_CLIENT_SECRET: "wcl-secret",
};

describe("resolveMode", () => {
  test("defaults to local", () => {
    expect(resolveMode(false, {})).toEqual({ ok: true, mode: "local" });
  });
  test("--hosted wins", () => {
    expect(resolveMode(true, {})).toEqual({ ok: true, mode: "hosted" });
    expect(resolveMode(true, { BMPL_MODE: "local" })).toEqual({ ok: true, mode: "hosted" });
  });
  test("BMPL_MODE=hosted", () => {
    expect(resolveMode(false, { BMPL_MODE: "hosted" })).toEqual({ ok: true, mode: "hosted" });
    expect(resolveMode(false, { BMPL_MODE: " Hosted " })).toEqual({ ok: true, mode: "hosted" });
    expect(resolveMode(false, { BMPL_MODE: "local" })).toEqual({ ok: true, mode: "local" });
    expect(resolveMode(false, { BMPL_MODE: "" })).toEqual({ ok: true, mode: "local" });
  });
  test("unknown BMPL_MODE is an error", () => {
    const r = resolveMode(false, { BMPL_MODE: "cloud" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cloud");
  });
});

describe("validateHostedEnv", () => {
  test("lists the seven variables", () => {
    expect([...HOSTED_ENV_VARS]).toEqual([
      "BMPL_BASE_URL", "BMPL_SESSION_SECRET", "BMPL_DISCORD_CLIENT_ID", "BMPL_DISCORD_CLIENT_SECRET",
      "BMPL_ADMIN_DISCORD_IDS", "WCL_CLIENT_ID", "WCL_CLIENT_SECRET",
    ]);
  });
  test("full env is ok and parsed", () => {
    const r = validateHostedEnv(FULL);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.baseUrl).toBe("https://bmpl.example.com");
      expect(r.config.adminDiscordIds).toEqual(["111", "222"]);
      expect(r.config.sessionSecret).toBe(FULL.BMPL_SESSION_SECRET);
    }
  });
  test("missing and blank variables are reported in declaration order", () => {
    const env = { ...FULL, BMPL_DISCORD_CLIENT_ID: "  ", WCL_CLIENT_SECRET: undefined };
    delete (env as Record<string, unknown>).BMPL_BASE_URL;
    const r = validateHostedEnv(env);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual(["BMPL_BASE_URL", "BMPL_DISCORD_CLIENT_ID", "WCL_CLIENT_SECRET"]);
      expect(r.invalid).toEqual([]);
    }
  });
  test("short secret, non-origin base url and empty admin list are invalid", () => {
    const r = validateHostedEnv({
      ...FULL,
      BMPL_SESSION_SECRET: "too-short",
      BMPL_BASE_URL: "https://bmpl.example.com/app",
      BMPL_ADMIN_DISCORD_IDS: " , ",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual([]);
      expect(r.invalid.map((s) => s.split(":")[0])).toEqual(["BMPL_BASE_URL", "BMPL_SESSION_SECRET", "BMPL_ADMIN_DISCORD_IDS"]);
    }
  });
  test("base url: trailing slash is accepted and stripped, http allowed, ftp rejected", () => {
    const ok = validateHostedEnv({ ...FULL, BMPL_BASE_URL: "http://localhost:3000/" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.baseUrl).toBe("http://localhost:3000");
    expect(validateHostedEnv({ ...FULL, BMPL_BASE_URL: "ftp://x" }).ok).toBe(false);
    expect(validateHostedEnv({ ...FULL, BMPL_BASE_URL: "not a url" }).ok).toBe(false);
  });
  test("secret length is measured in bytes", () => {
    // 16 two-byte characters = 32 bytes.
    expect(validateHostedEnv({ ...FULL, BMPL_SESSION_SECRET: "éééééééééééééééé" }).ok).toBe(true);
    expect(validateHostedEnv({ ...FULL, BMPL_SESSION_SECRET: "ééééééééééééééé" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/hosted/config.test.ts`
Expected: FAIL — `Cannot find module "../../src/hosted/config.ts"`.

- [ ] **Step 3: Implement `src/hosted/config.ts`**

```ts
// src/hosted/config.ts
// Hosted-mode configuration: pure functions over an env record so the CLI can validate
// before starting the server and tests never touch process.env.

export type Mode = "local" | "hosted";

export const HOSTED_ENV_VARS = [
  "BMPL_BASE_URL",
  "BMPL_SESSION_SECRET",
  "BMPL_DISCORD_CLIENT_ID",
  "BMPL_DISCORD_CLIENT_SECRET",
  "BMPL_ADMIN_DISCORD_IDS",
  "WCL_CLIENT_ID",
  "WCL_CLIENT_SECRET",
] as const;

export interface HostedConfig {
  /** Public origin, no trailing slash (e.g. https://bmpl.example.com). */
  baseUrl: string;
  sessionSecret: string;
  discordClientId: string;
  discordClientSecret: string;
  adminDiscordIds: string[];
}

export const MIN_SESSION_SECRET_BYTES = 32;

type Env = Record<string, string | undefined>;

const read = (env: Env, key: string): string => (env[key] ?? "").trim();

/** `--hosted` beats `BMPL_MODE`; an unknown BMPL_MODE is refused rather than silently local. */
export function resolveMode(flagHosted: boolean, env: Env): { ok: true; mode: Mode } | { ok: false; error: string } {
  if (flagHosted) return { ok: true, mode: "hosted" };
  const raw = read(env, "BMPL_MODE").toLowerCase();
  if (raw === "" || raw === "local") return { ok: true, mode: "local" };
  if (raw === "hosted") return { ok: true, mode: "hosted" };
  return { ok: false, error: `Unknown BMPL_MODE "${raw}" — expected "local" or "hosted"` };
}

/** Origin only: http(s), no path/query/hash. Returns the normalised origin or null. */
const parseOrigin = (raw: string): string | null => {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
  return u.origin;
};

export function validateHostedEnv(env: Env): { ok: true; config: HostedConfig } | { ok: false; missing: string[]; invalid: string[] } {
  const missing = HOSTED_ENV_VARS.filter((k) => read(env, k) === "");
  const invalid: string[] = [];

  const baseUrl = missing.includes("BMPL_BASE_URL") ? null : parseOrigin(read(env, "BMPL_BASE_URL"));
  if (baseUrl === null && !missing.includes("BMPL_BASE_URL")) invalid.push("BMPL_BASE_URL: must be an http(s) origin without a path, e.g. https://bmpl.example.com");

  const secret = read(env, "BMPL_SESSION_SECRET");
  if (secret !== "" && Buffer.byteLength(secret, "utf8") < MIN_SESSION_SECRET_BYTES) invalid.push(`BMPL_SESSION_SECRET: at least ${MIN_SESSION_SECRET_BYTES} bytes (got ${Buffer.byteLength(secret, "utf8")})`);

  const adminDiscordIds = read(env, "BMPL_ADMIN_DISCORD_IDS").split(",").map((s) => s.trim()).filter(Boolean);
  if (!missing.includes("BMPL_ADMIN_DISCORD_IDS") && adminDiscordIds.length === 0) invalid.push("BMPL_ADMIN_DISCORD_IDS: at least one Discord user id, comma-separated");

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      baseUrl: baseUrl!,
      sessionSecret: secret,
      discordClientId: read(env, "BMPL_DISCORD_CLIENT_ID"),
      discordClientSecret: read(env, "BMPL_DISCORD_CLIENT_SECRET"),
      adminDiscordIds,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test test/hosted/config.test.ts`
Expected: PASS (8 tests). Then `just check` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hosted/config.ts test/hosted/config.test.ts
git commit -m "feat(hosted): mode resolution and env validation for hosted mode"
```

---

### Task 2: Extract server modules (helpers, SSE, watcher, lookup, deep-dive)

Pure refactor: `src/server.ts` keeps its `fetch` switch but imports everything from `src/server/*`. No behaviour change; the existing suite is the test.

**Files:**
- Create: `src/server/http.ts`, `src/server/sse.ts`, `src/server/watcher.ts`, `src/server/lookup.ts`, `src/server/deepdive.ts`
- Modify: `src/server.ts` (delete the moved code, import it)
- Test: existing `test/server.test.ts`, `test/server-deepdive.test.ts`, `test/server-history.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–5):
  ```ts
  // src/server/http.ts
  export const jsonResponse: (data: unknown, status?: number) => Response;
  export async function readJson<T>(req: Request): Promise<T | null>;   // null on invalid JSON
  export const parseMetric: (raw: string | null | undefined) => Metric | undefined;
  export function parseCharacterInput(raw: string): { name: string; realm: string } | null;
  // src/server/sse.ts
  export const broadcast: (event: string, data: unknown) => void;
  export function eventsResponse(initial: { event: string; data: unknown }): Response;
  // src/server/watcher.ts
  export type WatcherOpts = { level: number | null; spec: string | null; metric: Metric | null };
  export async function startWatcher(opts: WatcherOpts): Promise<void>;
  export function stopWatcher(): void;
  export function watcherStatus(): { active: boolean; opts: WatcherOpts; backend: string | null };
  // src/server/lookup.ts
  export const history: History;
  export const historySummary: (entry: HistoryEntry) => {...};   // unchanged shape
  export type LookupError / LookupSuccess; export async function runLookupWithCache(opts): Promise<LookupSuccess | LookupError>;
  export async function handleLookup(req: Request): Promise<Response>;
  // src/server/deepdive.ts
  export async function refreshHistoryDeepdive(): Promise<void>;
  export async function handleDeepdive(req: Request): Promise<Response>;
  export async function handleDefensivesGet(url: URL): Promise<Response>;
  export async function handleDefensivesPost(req: Request): Promise<Response>;
  ```

- [ ] **Step 1: Baseline — run the suite**

Run: `bun test`
Expected: 283 pass (275 + 8 from Task 1), 0 fail. Note the number.

- [ ] **Step 2: Create `src/server/http.ts`**

Move `jsonResponse`, `parseMetric`, `parseCharacterInput` from `src/server.ts` (lines 60–86 today) and add `readJson`:

```ts
// src/server/http.ts
import type { Metric } from "../roles.ts";
import { parseNameRealm, parseRaiderIOUrl } from "../util.ts";

export const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Parses a JSON body; null when the body is not valid JSON (callers answer 400). */
export async function readJson<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

export const parseMetric = (raw: string | null | undefined): Metric | undefined => {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return v === "dps" || v === "hps" ? v : undefined;
};

export function parseCharacterInput(raw: string): { name: string; realm: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const rio = parseRaiderIOUrl(s);
  if (rio) return { name: rio.name, realm: rio.realm };
  const fromDash = parseNameRealm(s);
  if (fromDash) return fromDash;
  const bits = s.split(/\s+/);
  return bits.length >= 2 ? { name: bits[0]!, realm: bits.slice(1).join(" ") } : null;
}
```

- [ ] **Step 3: Create `src/server/sse.ts`**

Move the "SSE fan-out" block (`sseClients`, `sseEncoder`, `broadcast`, `HEARTBEAT_BYTES`, the unref'd `setInterval`) verbatim, and extract the `/api/events` stream construction into `eventsResponse`:

```ts
// src/server/sse.ts
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseEncoder = new TextEncoder();

export const broadcast = (event: string, data: unknown): void => { /* verbatim */ };

// heartbeat block verbatim (keep the comments and the .unref())

/** One SSE stream per browser tab; `initial` is sent immediately (the watcher status today). */
export function eventsResponse(initial: { event: string; data: unknown }): Response {
  let selfController: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      selfController = controller;
      sseClients.add(controller);
      controller.enqueue(sseEncoder.encode(`event: ${initial.event}\ndata: ${JSON.stringify(initial.data)}\n\n`));
    },
    cancel() { sseClients.delete(selfController); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 4: Create `src/server/watcher.ts`**

Move `WatcherState`, `watcher`, `watcherTick`, `startWatcher`, `stopWatcher` verbatim; import `broadcast` from `./sse.ts`, `runLookupWithCache` from `./lookup.ts`, clipboard helpers from `../clipboard.ts`. Add:

```ts
export type WatcherOpts = WatcherState["opts"];
export function watcherStatus(): { active: boolean; opts: WatcherOpts; backend: string | null } {
  return { active: watcher.active, opts: watcher.opts, backend: watcher.backend?.label ?? null };
}
```

- [ ] **Step 5: Create `src/server/lookup.ts`**

Move `LookupRequest`, `history` (`new History(20)`), `historySummary`, `LookupError`, `LookupSuccess`, `runLookupWithCache`, `handleLookup` verbatim (imports adjusted: `../config.ts`, `../lookup.ts`, `../server-history.ts`, `./http.ts`). Replace the `try { body = await req.json() } catch { return 400 }` block in `handleLookup` with:

```ts
const body = await readJson<LookupRequest>(req);
if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
```

- [ ] **Step 6: Create `src/server/deepdive.ts`**

Move `refreshHistoryDeepdive`, `DeepdiveBody`, `handleDeepdive`, `DefensivesPatchBody`, `handleDefensivesGet`, `handleDefensivesPost` verbatim (imports: `../deepdive/*`, `../evaluation/config.ts`, `../signals/store.ts`, `../config.ts`, `./http.ts`, `history` from `./lookup.ts`). Use `readJson` for the two body parses exactly like Step 5.

- [ ] **Step 7: Slim `src/server.ts`**

Delete everything moved. `src/server.ts` keeps: imports, `ServeOptions`, `SetupRequest` + `handleSetup` (moves in Task 3), `openBrowser`, `runServer`. Inside `fetch`, replace the moved bodies:
- `/api/events` → `return eventsResponse({ event: "status", data: watcherStatus() });`
- `/api/watch/status` → `return jsonResponse({ ok: true, ...watcherStatus() });`
- `/api/watch/start` keeps its parsing but calls the imported `startWatcher`; `/api/watch/stop` and `/api/quit` call the imported `stopWatcher`.
- history routes use `history`/`historySummary` from `./server/lookup.ts`.

`runLookupWithCache`, `LookupError`, `LookupSuccess` are no longer exported from `src/server.ts` — grep for importers first: `grep -rn "runLookupWithCache\|from \"../src/server.ts\"\|from \"./server.ts\"" src test scripts`. Only `runServer` is imported elsewhere today (`src/cli.ts`, tests); if anything imports the moved names, point it at `src/server/lookup.ts`.

- [ ] **Step 8: Run the suite and typecheck**

Run: `just check && bun test`
Expected: same pass count as Step 1, 0 fail. `wc -l src/server.ts` should be ≈ 200 lines.

- [ ] **Step 9: Commit**

```bash
git add src/server.ts src/server/http.ts src/server/sse.ts src/server/watcher.ts src/server/lookup.ts src/server/deepdive.ts
git commit -m "refactor(server): split server.ts into src/server/* modules (no behaviour change)"
```

---

### Task 3: Route table, `routes-shared.ts`, `routes-local.ts`

Replace the `fetch` if-chain with a declarative route list so hosted mode can simply omit the local routes.

**Files:**
- Create: `src/server/routes.ts`, `src/server/routes-shared.ts`, `src/server/routes-local.ts`
- Modify: `src/server.ts`, `docs/agents/architecture.md` (Server section)
- Test: existing `test/server*.test.ts` (unchanged)

**Interfaces:**
- Produces:
  ```ts
  // src/server/routes.ts
  export type Handler = (req: Request, url: URL) => Response | Promise<Response>;
  export interface Route { method: "GET" | "POST" | "DELETE"; match: (path: string) => boolean; handle: Handler }
  export const route: (method: Route["method"], path: string, handle: Handler) => Route;          // exact path
  export const prefixRoute: (method: Route["method"], prefix: string, handle: Handler) => Route; // path.startsWith(prefix)
  export function dispatch(routes: Route[], req: Request, url: URL): Response | Promise<Response> | null; // null = no route
  // src/server/routes-shared.ts
  export interface SharedContext { hosted: boolean; envPath: string }
  export function sharedRoutes(ctx: SharedContext): Route[];
  // src/server/routes-local.ts
  export function localRoutes(): Route[];
  ```

- [ ] **Step 1: Create `src/server/routes.ts`**

```ts
// src/server/routes.ts
// Minimal route table: first match wins, in registration order (prefix routes go after exact ones).
export type Handler = (req: Request, url: URL) => Response | Promise<Response>;
export interface Route { method: "GET" | "POST" | "DELETE"; match: (path: string) => boolean; handle: Handler }

export const route = (method: Route["method"], path: string, handle: Handler): Route =>
  ({ method, match: (p) => p === path, handle });

export const prefixRoute = (method: Route["method"], prefix: string, handle: Handler): Route =>
  ({ method, match: (p) => p.startsWith(prefix), handle });

export function dispatch(routes: Route[], req: Request, url: URL): Response | Promise<Response> | null {
  for (const r of routes) if (r.method === req.method && r.match(url.pathname)) return r.handle(req, url);
  return null;
}
```

- [ ] **Step 2: Create `src/server/routes-shared.ts`**

```ts
// src/server/routes-shared.ts
// Routes that exist in both modes. Local-only routes live in routes-local.ts.
import { hasCredentials } from "../config.ts";
import { handleDeepdive, handleDefensivesGet, handleDefensivesPost } from "./deepdive.ts";
import { jsonResponse } from "./http.ts";
import { handleLookup, history, historySummary } from "./lookup.ts";
import { prefixRoute, route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { eventsResponse } from "./sse.ts";
import { watcherStatus } from "./watcher.ts";

export interface SharedContext { hosted: boolean; envPath: string }

const historyKey = (url: URL) => decodeURIComponent(url.pathname.slice("/api/history/".length));

export function sharedRoutes(ctx: SharedContext): Route[] {
  return [
    route("POST", "/api/lookup", (req) => handleLookup(req)),
    route("POST", "/api/deepdive", (req) => handleDeepdive(req)),
    route("GET", "/api/defensives", (_req, url) => handleDefensivesGet(url)),
    route("POST", "/api/defensives", (req) => handleDefensivesPost(req)),
    route("GET", "/api/history", () => jsonResponse({ ok: true, items: history.list().map(historySummary) })),
    route("DELETE", "/api/history", () => { history.clear(); return jsonResponse({ ok: true }); }),
    prefixRoute("GET", "/api/history/", (_req, url) => {
      const key = historyKey(url);
      const entry = history.get(key);
      if (!entry) return jsonResponse({ ok: false, error: "Not in history" }, 404);
      return jsonResponse({ ok: true, result: entry.result, key, fromCache: true });
    }),
    prefixRoute("DELETE", "/api/history/", (_req, url) => jsonResponse({ ok: history.remove(historyKey(url)) })),
    // In hosted mode the watcher never runs; the initial status is simply "inactive".
    route("GET", "/api/events", () => eventsResponse({ event: "status", data: watcherStatus() })),
    route("GET", "/api/status", () =>
      ctx.hosted
        ? jsonResponse({ ok: true, hosted: true, hasCredentials: hasCredentials() })
        : jsonResponse({ ok: true, hosted: false, hasCredentials: hasCredentials(), envPath: ctx.envPath })),
  ];
}
```

- [ ] **Step 3: Create `src/server/routes-local.ts`**

Move `SetupRequest` + `handleSetup` here (from `src/server.ts`, using `readJson`), and the watch/quit handlers:

```ts
// src/server/routes-local.ts
// Local single-user routes: they touch the machine (write .env, read the clipboard, exit the
// process) and are therefore never registered in hosted mode.
import { closeStore } from "../signals/store.ts";
import { writeCredentials } from "../setup.ts";
import { resetAuthCache } from "../wcl/auth.ts";
import { jsonResponse, parseMetric, readJson } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { startWatcher, stopWatcher, watcherStatus } from "./watcher.ts";

interface SetupRequest { clientId?: string; clientSecret?: string }
interface WatchStartBody { level?: number | string | null; spec?: string | null; metric?: string | null }

async function handleSetup(req: Request): Promise<Response> {
  const body = await readJson<SetupRequest>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  if (!body.clientId || !body.clientSecret) return jsonResponse({ ok: false, error: "Both clientId and clientSecret are required." }, 400);
  try {
    const envPath = await writeCredentials(body.clientId, body.clientSecret);
    resetAuthCache();
    return jsonResponse({ ok: true, envPath });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleWatchStart(req: Request): Promise<Response> {
  const body = (await readJson<WatchStartBody>(req)) ?? {};
  let level: number | null = null;
  if (body.level !== undefined && body.level !== null && body.level !== "") {
    const n = Number.parseInt(String(body.level), 10);
    if (Number.isFinite(n) && n >= 2) level = n;
  }
  const opts = { level, spec: body.spec && body.spec.trim() ? body.spec.trim() : null, metric: parseMetric(body.metric ?? null) ?? null };
  try {
    await startWatcher(opts);
    return jsonResponse({ ok: true, active: true, opts });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export function localRoutes(): Route[] {
  return [
    route("POST", "/api/setup", handleSetup),
    route("POST", "/api/watch/start", handleWatchStart),
    route("POST", "/api/watch/stop", () => { stopWatcher(); return jsonResponse({ ok: true, active: false }); }),
    route("GET", "/api/watch/status", () => jsonResponse({ ok: true, ...watcherStatus() })),
    route("POST", "/api/quit", () => {
      stopWatcher();
      queueMicrotask(() => setTimeout(() => { closeStore(); process.exit(0); }, 120));
      return jsonResponse({ ok: true });
    }),
  ];
}
```

Keep the watch-start body parsing identical to today's (today an invalid JSON body falls back to `{}` — preserved by `?? {}`).

- [ ] **Step 4: Rewrite `runServer` in `src/server.ts`**

```ts
export interface ServeOptions {
  port: number;
  open: boolean;
  /** Multi-user deployment: local-only routes are not registered, security headers on. Default false. */
  hosted?: boolean;
  /** Test hook: where the built front lives. Default: embedded web/dist. */
  assets?: AssetLoader;
}

export async function runServer(opts: ServeOptions): Promise<Server<undefined>> {
  if (process.listenerCount("SIGINT") === 0) {
    process.on("SIGINT", () => { closeStore(); process.exit(0); });
  }
  const hosted = opts.hosted ?? false;
  const envPathHint = await resolveEnvPath();
  const serveStatic = createStaticHandler(opts.assets ?? defaultAssetLoader);
  const routes: Route[] = [...sharedRoutes({ hosted, envPath: envPathHint }), ...(hosted ? [] : localRoutes())];

  const server = Bun.serve({
    port: opts.port,
    idleTimeout: 0, // long-lived SSE streams and slow enrichment lookups
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET") {
        const staticRes = await serveStatic(url.pathname);
        if (staticRes) return staticRes;
      }
      const routed = dispatch(routes, req, url);
      return routed ?? new Response("Not found", { status: 404 });
    },
  });

  const url = `http://localhost:${server.port}`;
  console.log(`${heading("bmpl serve")}  ${ok(url)}${hosted ? dim("  (hosted mode)") : ""}`);
  if (hosted) console.log(dim(`  credentials: ${hasCredentials() ? "loaded" : "NOT SET"}  ·  local routes disabled`));
  else console.log(dim(`  env path: ${envPathHint}  ·  credentials: ${hasCredentials() ? "loaded" : "not set (setup page will open)"}`));
  console.log(dim("  Ctrl+C to stop."));
  if (opts.open && !hosted) setTimeout(() => openBrowser(url), 80);
  return server;
}
```

Remove every import that is no longer used; `src/server.ts` should now import only `Server`, picocolors/format helpers, `hasCredentials`, `closeStore`, `resolveEnvPath`, `createStaticHandler`/`defaultAssetLoader`/`AssetLoader`, `dispatch`/`Route`, `sharedRoutes`, `localRoutes`. (Security headers are added in Task 4.)

- [ ] **Step 5: Run the suite and typecheck**

Run: `just check && bun test`
Expected: same pass count as Task 2 Step 1, 0 fail.

- [ ] **Step 6: Update `docs/agents/architecture.md` — "Server" section**

Replace the paragraph starting with "`Bun.serve` on `:3000`:" by:

```markdown
`Bun.serve` on `:3000`, composed in `src/server.ts` from `src/server/*`: `routes.ts` (route table, first match wins), `routes-shared.ts` (both modes: `/api/lookup`, `/api/deepdive`, `/api/defensives` GET/POST, `/api/history[/…]`, `/api/events` SSE, `/api/status`, `/api/health`), `routes-local.ts` (local mode only: `/api/setup` writes `.env`, `/api/watch/{start,stop,status}` clipboard watcher, `/api/quit`), `lookup.ts` (in-memory `History(20)` + `runLookupWithCache`), `deepdive.ts` (analysis + table handlers, history refresh), `sse.ts` (fan-out + heartbeat), `watcher.ts`, `http.ts` (`jsonResponse`, `readJson`), `security.ts` (hosted headers/CSP). Everything not routed serves the embedded `web/dist` (`src/web-static.ts`, `src/web-assets.ts` — guarded dynamic import, 503 when not built). Responses are `jsonResponse({ ok, … })`; errors carry `{ ok: false, error }` with 4xx/5xx. `runServer({ port, open, hosted, assets })`: in hosted mode the local routes are not registered, `open` is ignored and every response gets the security headers.
```

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/server/routes.ts src/server/routes-shared.ts src/server/routes-local.ts docs/agents/architecture.md
git commit -m "refactor(server): declarative route table split into shared and local routes"
```

---

### Task 4: Hosted mode in `runServer` + security headers

**Files:**
- Create: `src/server/security.ts`, `test/server-hosted.test.ts`
- Modify: `src/server.ts`
- Test: `test/server-hosted.test.ts`, `test/server.test.ts` (one added assertion)

**Interfaces:**
- Produces:
  ```ts
  // src/server/security.ts
  export const CSP: string;
  export const SECURITY_HEADERS: Readonly<Record<string, string>>;
  export function withSecurityHeaders(res: Response): Response;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/server-hosted.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runServer } from "../src/server.ts";
import { SECURITY_HEADERS } from "../src/server/security.ts";
import { closeStore } from "../src/signals/store.ts";

let dir: string;
let hosted: Awaited<ReturnType<typeof runServer>>;
let local: Awaited<ReturnType<typeof runServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-hosted-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "");
  writeFileSync(join(dir, "assets", "app.css"), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  const assets = async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets", "app.js"), appCss: join(dir, "assets", "app.css") });
  hosted = await runServer({ port: 0, open: true, hosted: true, assets });
  local = await runServer({ port: 0, open: false, hosted: false, assets });
});
afterAll(() => {
  hosted.stop(true);
  local.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const h = (p: string) => `http://localhost:${hosted.port}${p}`;
const l = (p: string) => `http://localhost:${local.port}${p}`;

describe("hosted mode routes", () => {
  test("local-only routes are not registered", async () => {
    expect((await fetch(h("/api/setup"), { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(h("/api/quit"), { method: "POST" })).status).toBe(404);
    expect((await fetch(h("/api/watch/start"), { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(h("/api/watch/stop"), { method: "POST" })).status).toBe(404);
    expect((await fetch(h("/api/watch/status"))).status).toBe(404);
  });
  test("shared routes still answer", async () => {
    expect((await fetch(h("/api/history"))).status).toBe(200);
    expect((await fetch(h("/api/defensives?class=Shaman&spec=Elemental"))).status).toBe(200);
    const bad = await fetch(h("/api/lookup"), { method: "POST", body: "not json" });
    expect(bad.status).toBe(400);
  });
  test("/api/status has no envPath in hosted mode, and has one locally", async () => {
    const hs = await (await fetch(h("/api/status"))).json();
    expect(hs.ok).toBe(true);
    expect(hs.hosted).toBe(true);
    expect(typeof hs.hasCredentials).toBe("boolean");
    expect("envPath" in hs).toBe(false);
    const ls = await (await fetch(l("/api/status"))).json();
    expect(ls.hosted).toBe(false);
    expect(typeof ls.envPath).toBe("string");
  });
  test("the local server still registers the local routes", async () => {
    expect((await fetch(l("/api/watch/status"))).status).toBe(200);
  });
});

describe("security headers", () => {
  test("every hosted response carries them (static, api, 404, SSE)", async () => {
    const responses = [
      await fetch(h("/")),
      await fetch(h("/api/status")),
      await fetch(h("/nope")),
      await fetch(h("/api/watch/status")),
    ];
    for (const res of responses) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    }
    const ctrl = new AbortController();
    const sse = await fetch(h("/api/events"), { signal: ctrl.signal });
    expect(sse.headers.get("content-type")).toBe("text/event-stream");
    expect(sse.headers.get("content-security-policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
    ctrl.abort();
  });
  test("CSP allows only self plus the Wowhead hosts for scripts and has no unsafe-inline for scripts", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy"]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://wow.zamimg.com https://nether.wowhead.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp.match(/script-src[^;]*/)?.[0]).not.toContain("unsafe-inline");
  });
  test("local mode sends none of them", async () => {
    const res = await fetch(l("/api/status"));
    for (const k of Object.keys(SECURITY_HEADERS)) expect(res.headers.get(k)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/server-hosted.test.ts`
Expected: FAIL — `Cannot find module "../src/server/security.ts"` (and, once created, header/404 assertions fail).

- [ ] **Step 3: Create `src/server/security.ts`**

```ts
// src/server/security.ts
// Response headers for hosted mode. HSTS is set by the reverse proxy (Caddy), not here.
// Script hosts: Wowhead tooltips (web/index.html) load tooltips.js from wow.zamimg.com and
// fetch tooltip data as JSONP from nether.wowhead.com; icons come from wow.zamimg.com.
// Discord avatars (issue #3) come from cdn.discordapp.com.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://wow.zamimg.com https://nether.wowhead.com",
  "style-src 'self' 'unsafe-inline'", // React style props + Wowhead-injected tooltip styles
  "img-src 'self' data: https://wow.zamimg.com https://cdn.discordapp.com",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "clipboard-read=()",
  "X-Frame-Options": "DENY",
});

/** Returns a response carrying the hosted security headers; the body (file or stream) is passed through untouched. */
export function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
```

- [ ] **Step 4: Apply the headers in `runServer`**

In `src/server.ts` `fetch`, wrap the final result:

```ts
async fetch(req) {
  const url = new URL(req.url);
  const res = await respond(req, url);
  return hosted ? withSecurityHeaders(res) : res;
},
```

with, above `Bun.serve`:

```ts
const respond = async (req: Request, url: URL): Promise<Response> => {
  if (req.method === "GET") {
    const staticRes = await serveStatic(url.pathname);
    if (staticRes) return staticRes;
  }
  return (await dispatch(routes, req, url)) ?? new Response("Not found", { status: 404 });
};
```

- [ ] **Step 5: Add one local-mode assertion to `test/server.test.ts`**

In the existing test `"unknown path is 404; API still answers"`, after `expect((await st.json()).ok).toBe(true);` add:

```ts
    expect((await fetch(url("/api/status"))).headers.get("content-security-policy")).toBeNull();
```

- [ ] **Step 6: Run the tests**

Run: `bun test test/server-hosted.test.ts test/server.test.ts && just check`
Expected: PASS. If the SSE assertion fails because `new Response(stream)` changed the content type, keep the original headers by building `new Headers(res.headers)` first (already the case) — do not special-case SSE.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/server/security.ts test/server-hosted.test.ts test/server.test.ts
git commit -m "feat(server): hosted mode — local routes off, no browser open, security headers and CSP"
```

---

### Task 5: `GET /api/health`

**Files:**
- Modify: `src/server/routes-shared.ts`, `test/server-hosted.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/server-hosted.test.ts`)

```ts
describe("/api/health", () => {
  test("answers in both modes with version, uptime and db", async () => {
    for (const u of [h("/api/health"), l("/api/health")]) {
      const res = await fetch(u);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof body.uptimeS).toBe("number");
      expect(body.db).toBe("ok");
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/server-hosted.test.ts -t health`
Expected: FAIL — status 404.

- [ ] **Step 3: Implement the route** in `src/server/routes-shared.ts`

```ts
import pkg from "../../package.json";
import { getStore } from "../signals/store.ts";

async function handleHealth(): Promise<Response> {
  const base = { version: pkg.version as string, uptimeS: Math.round(process.uptime()) };
  try {
    (await getStore())._db.query("SELECT 1").get();
    return jsonResponse({ ok: true, ...base, db: "ok" });
  } catch {
    return jsonResponse({ ok: false, ...base, db: "error" }, 503);
  }
}
```

and add `route("GET", "/api/health", handleHealth)` to the `sharedRoutes` array (before `/api/status`).

`resolveJsonModule` is on in `tsconfig.json`; `bun build --compile` inlines the JSON, so the binary reports its own version.

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun test test/server-hosted.test.ts && just check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes-shared.ts test/server-hosted.test.ts
git commit -m "feat(server): GET /api/health with version, uptime and a SQLite probe"
```

---

### Task 6: CSP-compatible Wowhead config (`/wh-config.js`)

The inline `<script>` in `web/index.html` would be blocked by the hosted CSP. Move it to a static file that Vite copies to `dist/` and the binary embeds.

**Files:**
- Create: `web/public/wh-config.js`
- Modify: `web/index.html`, `src/web-static.ts`, `src/web-assets.ts`, `src/web-assets-types.d.ts`, `test/server.test.ts`, `test/server-deepdive.test.ts`, `test/server-hosted.test.ts`

**Interfaces:**
- `WebAssets` gains `whConfigJs: string`; `ROUTES["/wh-config.js"]` served as `text/javascript; charset=utf-8`.

- [ ] **Step 1: Write the failing test** (in `test/server.test.ts`, `describe("static routes")`)

```ts
  test("/wh-config.js is served as JavaScript", async () => {
    const res = await fetch(url("/wh-config.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toContain("whTooltips");
  });
```

and in the `beforeAll` of that file add `writeFileSync(join(dir, "wh-config.js"), "const whTooltips = {};");` and `whConfigJs: join(dir, "wh-config.js")` to the returned assets object. Do the same two additions in `test/server-deepdive.test.ts` and `test/server-hosted.test.ts` (their loaders must return the new field or tsc fails).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/server.test.ts -t wh-config`
Expected: FAIL — 404 (and `just check` fails on the missing `whConfigJs` field until Step 3).

- [ ] **Step 3: Implement**

`web/public/wh-config.js`:
```js
// Wowhead tooltip options, read by https://wow.zamimg.com/js/tooltips.js (loaded after this file).
// Kept out of index.html so the hosted Content-Security-Policy needs no inline scripts.
const whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };
```

`web/index.html`: replace the inline `<script>const whTooltips = …</script>` line with `<script src="/wh-config.js"></script>` (keep it before the `tooltips.js` line; no `defer` on it so it runs first).

`src/web-static.ts`: add `whConfigJs: string` to `WebAssets` and the route `"/wh-config.js": { pick: (a) => a.whConfigJs, type: "text/javascript; charset=utf-8" }`.

`src/web-assets.ts`: add `import whConfigJs from "../web/dist/wh-config.js" with { type: "file" };` and `whConfigJs` to `WEB_ASSETS`; update the top comment to "four files".

`src/web-assets-types.d.ts`: add `declare module "*/web/dist/wh-config.js" { const path: string; export default path; }`.

- [ ] **Step 4: Build the front and verify**

Run: `just web-build && ls web/dist/wh-config.js && bun test && just check`
Expected: the file exists in `dist/`, all tests pass, tsc clean. Then `bun test` again after `rm -rf web/dist` — still green (the loader is dynamic).

- [ ] **Step 5: Manual check of the tooltips under the CSP**

Run `just build` and `./bmpl serve --hosted` with a full hosted env (see Task 7 for the variables; until Task 7 lands, temporarily run a hosted server from a scratch script: `bun -e 'import {runServer} from "./src/server.ts"; runServer({port:3000, open:false, hosted:true})'`). Open a looked-up character, expand a run's Defensives panel, hover a spell: the tooltip must render, and the browser console must show no CSP violation. If a violation names another host, add it to `CSP` in `src/server/security.ts` and to the `script-src` assertion in `test/server-hosted.test.ts`; record the host in the file's comment.

- [ ] **Step 6: Commit**

```bash
git add web/public/wh-config.js web/index.html src/web-static.ts src/web-assets.ts src/web-assets-types.d.ts test/server.test.ts test/server-deepdive.test.ts test/server-hosted.test.ts
git commit -m "feat(web): Wowhead config as an external script so the hosted CSP needs no inline scripts"
```

---

### Task 7: CLI `serve --hosted` + docs

**Files:**
- Modify: `src/cli.ts`, `README.md`, `AGENTS.md`
- Create: `test/cli-serve.test.ts`, `.env.hosted.example`

**Interfaces:**
- Produces (exported from `src/cli.ts`):
  ```ts
  export function planServe(args: string[], env: Record<string, string | undefined>):
    | { ok: true; port: number; open: boolean; hosted: boolean }
    | { ok: false; error: string };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/cli-serve.test.ts
import { describe, expect, test } from "bun:test";
import { planServe } from "../src/cli.ts";

const FULL = {
  BMPL_BASE_URL: "https://bmpl.example.com",
  BMPL_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  BMPL_DISCORD_CLIENT_ID: "1",
  BMPL_DISCORD_CLIENT_SECRET: "s",
  BMPL_ADMIN_DISCORD_IDS: "42",
  WCL_CLIENT_ID: "w",
  WCL_CLIENT_SECRET: "x",
};

describe("planServe", () => {
  test("defaults: local, port 3000, opens the browser", () => {
    expect(planServe([], {})).toEqual({ ok: true, port: 3000, open: true, hosted: false });
  });
  test("--port and --no-open", () => {
    expect(planServe(["--port", "4000", "--no-open"], {})).toEqual({ ok: true, port: 4000, open: false, hosted: false });
    expect(planServe(["--port", "0"], {}).ok).toBe(false);
    expect(planServe(["--port", "abc"], {}).ok).toBe(false);
  });
  test("--hosted with a full env: hosted, never opens the browser", () => {
    expect(planServe(["--hosted"], FULL)).toEqual({ ok: true, port: 3000, open: false, hosted: true });
  });
  test("BMPL_MODE=hosted is equivalent; a bad BMPL_MODE is an error", () => {
    expect(planServe([], { ...FULL, BMPL_MODE: "hosted" })).toEqual({ ok: true, port: 3000, open: false, hosted: true });
    const r = planServe([], { BMPL_MODE: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("BMPL_MODE");
  });
  test("--hosted with missing variables lists them", () => {
    const r = planServe(["--hosted"], { BMPL_BASE_URL: "https://x.example", BMPL_SESSION_SECRET: "short" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("missing: BMPL_DISCORD_CLIENT_ID, BMPL_DISCORD_CLIENT_SECRET, BMPL_ADMIN_DISCORD_IDS, WCL_CLIENT_ID, WCL_CLIENT_SECRET");
      expect(r.error).toContain("invalid: BMPL_SESSION_SECRET");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/cli-serve.test.ts`
Expected: FAIL — `planServe` is not exported.

- [ ] **Step 3: Implement in `src/cli.ts`**

Add near `parseFlag`/`hasFlag` (they are module-level functions, so `planServe` can use them):

```ts
import { resolveMode, validateHostedEnv } from "./hosted/config.ts";

/** Pure `serve` argument/env resolution — the command prints `error` and exits 2 on failure. */
export function planServe(args: string[], env: Record<string, string | undefined>):
  | { ok: true; port: number; open: boolean; hosted: boolean }
  | { ok: false; error: string } {
  const portStr = parseFlag(args, "--port");
  const port = portStr ? Number.parseInt(portStr, 10) : 3000;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return { ok: false, error: `Invalid --port value: ${portStr}` };
  const mode = resolveMode(hasFlag(args, "--hosted"), env);
  if (!mode.ok) return { ok: false, error: mode.error };
  if (mode.mode === "hosted") {
    const v = validateHostedEnv(env);
    if (!v.ok) {
      const parts = [
        v.missing.length ? `missing: ${v.missing.join(", ")}` : "",
        v.invalid.length ? `invalid: ${v.invalid.join("; ")}` : "",
      ].filter(Boolean);
      return { ok: false, error: `Hosted mode needs a complete environment — ${parts.join(" — ")}. See .env.hosted.example.` };
    }
    return { ok: true, port, open: false, hosted: true };
  }
  return { ok: true, port, open: !hasFlag(args, "--no-open"), hosted: false };
}
```

Replace the `case "serve"` body with:

```ts
      case "serve": {
        const plan = planServe(rest, process.env);
        if (!plan.ok) {
          console.error(err(plan.error));
          process.exit(2);
        }
        await runServer({ port: plan.port, open: plan.open, hosted: plan.hosted });
        // Bun.serve keeps the process alive; do not return.
        return;
      }
```

Update the `USAGE` block:

```
  bmpl serve  [--port <N>] [--no-open] [--hosted]
                                     Start the web UI at http://localhost:<port>
                                     (default 3000) and auto-open your browser.
                                     First run shows a setup page for creds.
                                     --hosted (or BMPL_MODE=hosted): multi-user
                                     deployment behind a reverse proxy — needs the
                                     BMPL_* variables from .env.hosted.example.
```

- [ ] **Step 4: Create `.env.hosted.example`**

```
# bmpl hosted mode — copy to .env on the server. All seven variables are required.
BMPL_MODE=hosted
# Public origin (scheme + host, no path) — used for OAuth redirects and origin checks.
BMPL_BASE_URL=https://bmpl.example.com
# ≥ 32 random bytes; generate with: openssl rand -base64 48
BMPL_SESSION_SECRET=
# Discord application (https://discord.com/developers/applications) — OAuth2 tab.
BMPL_DISCORD_CLIENT_ID=
BMPL_DISCORD_CLIENT_SECRET=
# Comma-separated Discord user ids that are admins (auto-invited).
BMPL_ADMIN_DISCORD_IDS=
# Shared Warcraft Logs API client (https://www.warcraftlogs.com/api/clients).
WCL_CLIENT_ID=
WCL_CLIENT_SECRET=
# Optional: BMPL_DB_PATH, BMPL_EVAL_CONFIG, BMPL_DEFENSIVES (default: next to this file).
```

`.gitignore` already ignores `.env.*` except `.env.example`; add `!.env.hosted.example` under that line.

- [ ] **Step 5: README — "Hosted mode" section**

Insert after the "## Security" section:

```markdown
## Hosted mode (multi-user, work in progress)

`bmpl serve --hosted` (or `BMPL_MODE=hosted`) runs one instance for several
people behind a reverse proxy. It is being built in issues #1–#11; today it
only disables the local-only routes (`/api/setup`, `/api/quit`, clipboard
watch), never opens a browser, adds security headers (CSP, nosniff,
frame-ancestors none, …) and exposes `GET /api/health`
(`{ ok, version, uptimeS, db }`) for the proxy's health check. Login, quotas
and the admin page come with the following issues.

Required environment (copy `.env.hosted.example`):

| Variable | Meaning |
|---|---|
| `BMPL_BASE_URL` | Public origin, no path (`https://bmpl.example.com`) |
| `BMPL_SESSION_SECRET` | ≥ 32 random bytes (`openssl rand -base64 48`) |
| `BMPL_DISCORD_CLIENT_ID` / `BMPL_DISCORD_CLIENT_SECRET` | Discord OAuth application |
| `BMPL_ADMIN_DISCORD_IDS` | Comma-separated Discord user ids of the admins |
| `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` | The shared Warcraft Logs client |

Missing or invalid variables make `bmpl serve --hosted` exit with code 2 and
the list of what to fix. Local mode (`bmpl serve`) is unchanged.
```

Also add `--hosted` to the `just serve` examples in "Graphical UI" (`just serve --hosted   # multi-user mode, see "Hosted mode"`).

`AGENTS.md`: in the Commands block add `just serve --hosted                 # hosted mode (needs .env.hosted.example variables)`.

- [ ] **Step 6: Run everything**

Run: `bun test && just check && bun src/cli.ts serve --hosted; echo "exit=$?"`
Expected: tests green; the last command prints the missing-variable list and `exit=2`.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts test/cli-serve.test.ts .env.hosted.example .gitignore README.md AGENTS.md
git commit -m "feat(cli): bmpl serve --hosted with validated environment; hosted-mode docs"
```

---

### Task 8: Front — hosted-aware status, controls hidden

**Files:**
- Create: `web/src/lib/hostedMode.ts`, `web/src/lib/hostedMode.test.ts`
- Modify: `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/Header.tsx`, `web/src/components/Home.tsx`

**Interfaces:**
- Produces:
  ```ts
  // web/src/lib/hostedMode.ts
  export interface StatusInfo { hosted: boolean; hasCredentials: boolean; envPath: string | null }
  export interface UiControls { setup: boolean; quit: boolean; watch: boolean; envPath: boolean }
  export function uiControls(status: StatusInfo): UiControls;
  export function initialScreen(status: StatusInfo, pathname: string): "setup" | "main";
  export const LOCAL_STATUS: StatusInfo; // fallback when /api/status fails: hosted false, hasCredentials true, envPath null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/lib/hostedMode.test.ts
import { describe, expect, test } from "bun:test";
import { LOCAL_STATUS, initialScreen, uiControls } from "./hostedMode.ts";

const local = { hosted: false, hasCredentials: true, envPath: "/x/.env" };
const hosted = { hosted: true, hasCredentials: true, envPath: null };

describe("uiControls", () => {
  test("local mode shows every control", () => {
    expect(uiControls(local)).toEqual({ setup: true, quit: true, watch: true, envPath: true });
  });
  test("hosted mode hides setup, quit, clipboard watch and the env path", () => {
    expect(uiControls(hosted)).toEqual({ setup: false, quit: false, watch: false, envPath: false });
  });
});

describe("initialScreen", () => {
  test("local: setup when credentials are missing or on /setup", () => {
    expect(initialScreen({ ...local, hasCredentials: false }, "/")).toBe("setup");
    expect(initialScreen(local, "/setup")).toBe("setup");
    expect(initialScreen(local, "/")).toBe("main");
  });
  test("hosted: never the setup screen, even on /setup or without credentials", () => {
    expect(initialScreen(hosted, "/setup")).toBe("main");
    expect(initialScreen({ ...hosted, hasCredentials: false }, "/")).toBe("main");
  });
  test("fallback status is local with everything on", () => {
    expect(LOCAL_STATUS).toEqual({ hosted: false, hasCredentials: true, envPath: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test web/src/lib/hostedMode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/lib/hostedMode.ts`**

```ts
// web/src/lib/hostedMode.ts
// What the UI may show depending on the server mode (GET /api/status).
export interface StatusInfo { hosted: boolean; hasCredentials: boolean; envPath: string | null }
export interface UiControls { setup: boolean; quit: boolean; watch: boolean; envPath: boolean }

/** Used when /api/status itself fails: behave like today's local UI. */
export const LOCAL_STATUS: StatusInfo = { hosted: false, hasCredentials: true, envPath: null };

export function uiControls(status: StatusInfo): UiControls {
  const local = !status.hosted;
  return { setup: local, quit: local, watch: local, envPath: local };
}

/** Hosted credentials are a deployment concern, never a browser one: the setup screen is local-only. */
export function initialScreen(status: StatusInfo, pathname: string): "setup" | "main" {
  if (status.hosted) return "main";
  return !status.hasCredentials || pathname === "/setup" ? "setup" : "main";
}
```

- [ ] **Step 4: Wire the front**

`web/src/api.ts`: `status: () => call<{ hosted: boolean; hasCredentials: boolean; envPath?: string }>("/api/status"),`.

`web/src/App.tsx`:
```ts
import { LOCAL_STATUS, initialScreen, uiControls } from "./lib/hostedMode.ts";
import type { StatusInfo } from "./lib/hostedMode.ts";

type Screen =
  | { kind: "loading" }
  | { kind: "setup"; status: StatusInfo }
  | { kind: "main"; status: StatusInfo };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  useEffect(() => {
    api.status().then((s) => {
      const status: StatusInfo = s.ok ? { hosted: s.hosted, hasCredentials: s.hasCredentials, envPath: s.envPath ?? null } : LOCAL_STATUS;
      setScreen({ kind: initialScreen(status, location.pathname), status });
    });
  }, []);
  if (screen.kind === "loading") return <div className="muted" style={{ padding: 24 }}><span className="spinner" /> loading…</div>;
  if (screen.kind === "setup") {
    return <Setup envPath={screen.status.envPath ?? ""} hasCredentials={screen.status.hasCredentials} onDone={() => { history.replaceState({}, "", "/"); setScreen({ kind: "main", status: { ...screen.status, hasCredentials: true } }); }} />;
  }
  return <Main status={screen.status} onSetup={() => { history.pushState({}, "", "/setup"); setScreen({ kind: "setup", status: { ...screen.status, hasCredentials: true } }); }} />;
}
```
`Main` signature becomes `function Main({ status, onSetup }: { status: StatusInfo; onSetup: () => void })`, computes `const controls = uiControls(status);`, passes `controls={controls}` to `Header` and `envPath={controls.envPath ? status.envPath : null}` to `Home`.

`web/src/components/Header.tsx`: add `controls: UiControls` to `Props` (import type from `../lib/hostedMode.ts`) and render conditionally:
```tsx
{p.controls.watch && (<label className={"watch" + (p.watchActive ? " on" : "")} …>…</label>)}
{!p.sseConnected && …}
{p.controls.setup && <button className="btn" onClick={p.onSetup}>Re-configure</button>}
{p.controls.quit && <button className="btn" onClick={p.onQuit}>Quit</button>}
```

`web/src/components/Home.tsx`:
```tsx
interface Props { envPath: string | null }
export function Home({ envPath }: Props) {
  return (
    <div className="home">
      <p className="muted">{envPath === null ? "Paste a Raider.IO URL or a Name-Realm above." : "Paste a Raider.IO URL or a Name-Realm above, or turn on clipboard watch and copy one from anywhere."}</p>
      {envPath !== null && <p className="faint">Credentials: <span className="mono">{envPath || "unknown"}</span></p>}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests, typecheck, build, look at it**

Run: `bun test && just check && just build`
Expected: green. Then start a hosted server (`./bmpl serve --hosted` with the variables from `.env.hosted.example` exported in the shell, or `BMPL_MODE=hosted`) and open http://localhost:3000: no "Clipboard watch", no "Re-configure", no "Quit", no credentials path on the empty state; `/setup` shows the main screen. Then `./bmpl serve` (local): everything present as before. Take one screenshot of each header for the report.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/hostedMode.ts web/src/lib/hostedMode.test.ts web/src/api.ts web/src/App.tsx web/src/components/Header.tsx web/src/components/Home.tsx
git commit -m "feat(web): hosted-aware status — hide setup, quit and clipboard watch in hosted mode"
```

---

## Self-review

- **Spec coverage (issue #2):** mode flag + env validation with exit 2 → Tasks 1, 7. Route split into `routes-local.ts`/`routes-shared.ts`, local routes not registered, `open` forced false, `/api/status` without `envPath` → Tasks 3, 4. `/api/health` → Task 5. Security headers + CSP with the Wowhead config moved out of inline → Tasks 4, 6. Front hides Setup/Quit/watch when hosted → Task 8. SSE fan-out and deep-dive handlers in their own files → Task 2. README "Hosted mode" stub with env table → Task 7. Acceptance "existing `test/server*.test.ts` unchanged and green": only the asset-loader shape changes (Task 6) and one null-header assertion (Task 4) are added; nothing existing is modified.
- **Deviation from the issue text, ruled here:** the issue says `src/config.ts` exposes `config.hosted`; this plan passes `hosted` explicitly (`runServer({ hosted })`, `sharedRoutes({ hosted })`) and keeps env validation in `src/hosted/config.ts`. Reason: a process-wide flag would leak between the hosted and local servers that `test/server-hosted.test.ts` runs in one process; later issues that need the parsed `HostedConfig` (OAuth, sessions) receive it from `planServe` → `runServer` the same explicit way (extend `ServeOptions` then).
- **Placeholders:** none; every code step carries the code. The two "verbatim" moves in Task 2 refer to concrete line ranges in the current `src/server.ts`.
- **Type consistency:** `watcherStatus()` shape `{ active, opts, backend }` is used identically in `routes-shared.ts` (`/api/events`) and `routes-local.ts` (`/api/watch/status`); `WebAssets.whConfigJs` is added in Task 6 and all three test loaders are updated there; `planServe` return shape matches `ServeOptions` (`port, open, hosted`); `StatusInfo.envPath: string | null` while the API sends `envPath?: string` — converted with `?? null` in `App.tsx`.
