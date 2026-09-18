# Per-User State in SQLite (History, "Your Key", Settings, Per-User SSE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In hosted mode every signed-in member gets their own lookup history (20 tabs, durable across restarts), their own "your key" and legend settings on the server, and an SSE stream that only carries their own events; two members vetting the same applicant cost one WCL fetch. Local mode keeps its in-memory history and browser-stored settings, unchanged.

**Architecture:** `History` is extracted into a `HistoryStore` interface with two implementations: the existing in-memory `History` (local, one per process, now in `src/server/local-history.ts`) and a SQLite-backed per-user store (`src/hosted/history.ts`, tables `user_history` + `user_history_auto`) with the same semantics plus one hosted-only rule — another user's fresh entry for the same key is a cache hit copied into the caller's history. `RequestContext` gains `now` and `history` (the caller's store, resolved once per request), and every shared handler reads the history from `ctx` instead of a global. Deep-dive analyses are attached **on read** in hosted mode (`withCachedAnalyses`, 0 pts) instead of rewriting every user's payloads; local mode keeps its in-place refresh. `GET/PUT /api/settings` (hosted only) back a small `SettingsProvider` in the front that falls back to localStorage locally. SSE clients are keyed by user id: `broadcast` stays local-only, `broadcastTo(userId, …)` is the hosted fan-out.

**Tech Stack:** Bun 1.3 (`Bun.serve`, `bun:sqlite`, `bun:test`), TypeScript strict, Vite 8 + React 19 (types-only imports from `src/`, React context — no state lib).

**Spec:** GitHub issue #4 (`gh issue view 4`), parent #1 (`gh issue view 1`). Repo rules: `AGENTS.md`, `docs/agents/{architecture,web-front,testing,workflow}.md`. Builds on the #3 plan (`docs/superpowers/plans/2026-09-18-discord-login.md`) — its carry-overs are exactly this plan: `now` on the context, `ctx` through the shared handlers, per-user `history` and SSE.

## Global Constraints

- Local mode (`bmpl serve` without `--hosted`) is unchanged in behaviour: one in-memory `History(20)` per process, "your key" and the legend state in localStorage under `bmpl.yourKey` / `bmpl.legendOpen` (same values as today so existing browsers keep their state), `refresh` of deep-dive analyses in place after `POST /api/deepdive` and `POST /api/defensives`. `test/server.test.ts`, `test/server-deepdive.test.ts`, `test/server-history.test.ts` stay green; `test/server-history.test.ts` is not edited.
- Schema (`src/hosted/schema.ts`, `CREATE TABLE IF NOT EXISTS`, timestamps are epoch milliseconds, JSON columns are `TEXT`): `user_history(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, request TEXT NOT NULL, payload TEXT NOT NULL, label TEXT NOT NULL, char_class INTEGER NOT NULL, spec TEXT, target_level INTEGER NOT NULL, target_auto INTEGER NOT NULL, fetched_at INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (user_id, key))` with index `user_history_key ON user_history(key, fetched_at)`; `user_history_auto(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, alias_key TEXT NOT NULL, level INTEGER NOT NULL, set_at INTEGER NOT NULL, PRIMARY KEY (user_id, alias_key))`; `user_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, your_key INTEGER, legend_open INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`.
- History semantics, identical in both implementations: key = `cacheKey({ character, level: <effective level>, spec, metric })` (`src/server-history.ts`); an auto request (`level: null`) remembers the level it resolved to (alias) so the next auto request is a hit; a cache hit moves the entry to the newest position; `list()` is newest first; `record` past the cap (`HISTORY_MAX_PER_USER = 20`) evicts the oldest; an auto re-evaluation landing on a new level drops the stale auto entry but never an explicit one; `remove`/`clear` forget the alias; `updateResult` replaces the payload in place, no-op for unknown keys.
- Hosted-only sharing rule: when the caller's own history misses, the newest entry of **another** user with the same effective key and `fetched_at >= now − SHARED_HISTORY_TTL_MS` (`6 * 60 * 60 * 1000`) is copied into the caller's history (keeping its `fetchedAt`) and returned as a cache hit (`fromCache: true`). For an auto request the effective level is the newest alias any user set within the same window. `refresh: true` skips both the own and the shared lookup.
- Hosted reads return today's analyses: `GET /api/history/:key` and a cache-hit `POST /api/lookup` pass the stored payload through `withCachedAnalyses` (`attachDeepdive` over the raw cache, 0 pts) before answering. Nothing iterates other users' rows after a deep-dive or a table change in hosted mode. Local mode keeps `refreshLocalHistory()` (the renamed `refreshHistoryDeepdive`).
- `RequestContext` is `{ hosted, user, sessionId, ip, now: number, history: HistoryStore | null }`; `history` is the process-wide `localHistory` locally, the user's own store when hosted and signed in, `null` for an anonymous hosted request (which `authGate` stops before any handler). Handlers get the history through `historyOf(ctx)` and never through a module-level singleton (the watcher, local-only, is the one direct user of `localHistory`).
- Settings routes, hosted only (`src/server/routes-user.ts`, `auth: "user"`): `GET /api/settings` → `200 { ok: true, settings: { yourKey: number | null, legendOpen: boolean } }` (defaults `{ yourKey: null, legendOpen: true }` before any write); `PUT /api/settings` with a JSON body holding `yourKey` (null or an integer 2…40) and/or `legendOpen` (boolean) → `200 { ok: true, settings }` with the merged result; anything else → `400 { ok: false, error }`. `Route["method"]` gains `"PUT"`. Local mode answers 404 on both (not registered).
- SSE: `eventsResponse(initial, userId: number | null)`; `broadcast(event, data)` reaches only clients registered with `userId === null` (local mode); `broadcastTo(userId, event, data)` reaches only that user's clients. `/api/events` registers `ctx.user?.id ?? null`. The watcher (local only) keeps calling `broadcast`.
- Front: no visible UI change (same header stepper, same legend) — the Claude Design canvas is not involved; a `SettingsProvider` (React context in `web/src/settings.tsx`) owns `{ yourKey, legendOpen }`; hosted → `GET /api/settings` at boot (after `/api/me` succeeds) and `PUT /api/settings` on change; local → localStorage. Logic lives in pure tested `web/src/lib/settings.ts`. `api.settings()` / `api.putSettings(patch)` in `web/src/api.ts`. Types-only imports from `src/`.
- No new runtime dependencies (root or `web/`). TypeScript strict; English everywhere; 2 spaces, double quotes, trailing commas, `.ts` extensions in imports; `just check` and `bun test` green with `web/dist` absent. Never spend WCL points in tests: the only `POST /api/lookup` calls in new tests are guaranteed cache hits, made with dummy `WCL_CLIENT_ID`/`WCL_CLIENT_SECRET` set for the file's duration so a miss fails at OAuth instead of spending.
- Commits on `main` in place; messages end (after a blank line) with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`. Stage paths explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`. Never rewrite history.

## File structure

| File | Responsibility |
|---|---|
| `src/server-history.ts` (modify) | `HistoryStore` interface, `HistoryListItem` type; `History implements HistoryStore` (unchanged behaviour) |
| `src/hosted/schema.ts` (modify) | `user_history`, `user_history_auto`, `user_settings` tables |
| `src/hosted/history.ts` (new) | `openUserHistory(db, max)` → `UserHistoryRepo { forUser(userId, now) }`: SQLite `HistoryStore` per user, shared-entry rule |
| `src/hosted/db.ts` (modify) | `HostedDb.history` (Task 1) and `HostedDb.settings` + `UserSettings` (Task 3) |
| `src/hosted/auth.ts` (modify) | `RequestContext.now`, `RequestContext.history`; `LOCAL_CONTEXT(ip, history)`; `resolveRequest` binds the user's store |
| `src/server/local-history.ts` (new) | `localHistory = new History(20)` — the local-mode singleton |
| `src/server/lookup.ts` (modify) | `runLookupWithCache(opts, history)`, `handleLookup(req, ctx)`, `historyOf(ctx)`; hosted cache hits re-attach analyses |
| `src/server/deepdive.ts` (modify) | `withCachedAnalyses(payload)`, `refreshLocalHistory()` (local only), handlers take `ctx` / `hosted` |
| `src/server/routes-shared.ts` (modify) | history routes over `historyOf(ctx)`, hosted attach-on-read, `/api/events` per user |
| `src/server/routes.ts` (modify) | `"PUT"` method |
| `src/server/routes-user.ts` (new) | `userRoutes(runtime)`: `GET/PUT /api/settings`, `parseSettingsPatch` |
| `src/server/sse.ts` (modify) | clients keyed by user id, `broadcastTo`, `eventsResponse(initial, userId)` |
| `src/server/watcher.ts`, `src/server.ts` (modify) | pass `localHistory`; register `userRoutes` in hosted mode |
| `web/src/lib/settings.ts` (new) | pure: `Settings`, `DEFAULT_SETTINGS`, `readLocalSettings`, `writeLocalSettings`, `parseServerSettings` |
| `web/src/settings.tsx` (new) | `SettingsProvider`, `useSettings()` |
| `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/AxisLegend.tsx` (modify) | settings API, provider wiring, legend reads the context |
| `test/hosted/history.test.ts` (new) | SQLite history mirror of `test/server-history.test.ts` + isolation, sharing, persistence |
| `test/hosted/settings.test.ts` (new) | settings repository |
| `test/server-user-state.test.ts` (new) | hosted server with two users: history isolation, attach-on-read, shared cache hit, settings routes |
| `test/server-sse.test.ts` (new) | per-user fan-out |
| `web/src/lib/settings.test.ts` (new) | settings view model |
| `README.md`, `docs/agents/{architecture,web-front,workflow,testing}.md`, `AGENTS.md` (modify) | user manual + agent guide |

---

### Task 1: `HistoryStore` interface, hosted history tables and the SQLite per-user store

**Files:**
- Modify: `src/server-history.ts`
- Modify: `src/hosted/schema.ts`
- Create: `src/hosted/history.ts`
- Modify: `src/hosted/db.ts`
- Test: `test/hosted/history.test.ts`

**Interfaces:**
- Consumes: `cacheKey`, `HistoryRequest`, `HistoryEntry`, `HistoryRecord` from `src/server-history.ts`; `openHosted(db)` from `src/hosted/db.ts` (Task 1 extends it).
- Produces: `HistoryStore` and `HistoryListItem` (`src/server-history.ts`); `openUserHistory(db: Database, max = HISTORY_MAX_PER_USER): UserHistoryRepo`, `UserHistoryRepo { forUser(userId: number, now?: () => number): HistoryStore }`, `HISTORY_MAX_PER_USER = 20`, `SHARED_HISTORY_TTL_MS` (`src/hosted/history.ts`); `HostedDb.history: UserHistoryRepo`.

- [ ] **Step 1: Extract the interface in `src/server-history.ts`**

Insert after the `HistoryRecord` type (keep everything else, including the `cacheKey` export and the class body, byte-identical):

```ts
/** A history entry without its payload — what the tab strip needs. */
export type HistoryListItem = Omit<HistoryEntry, "result">;

/**
 * One caller's lookup history. Local mode: `History` below (in memory, one per process).
 * Hosted mode: `src/hosted/history.ts` (SQLite, one per user).
 */
export interface HistoryStore {
  readonly size: number;
  /** Cache hit (moved to the newest position) or null. */
  cached(r: HistoryRequest): HistoryEntry | null;
  /** Store a fresh result; returns the entry (its key uses the effective level). */
  record(r: HistoryRequest, rec: HistoryRecord): HistoryEntry;
  get(key: string): HistoryEntry | undefined;
  /** Newest first, without payloads. */
  list(): HistoryListItem[];
  remove(key: string): boolean;
  clear(): void;
  /** Replace the stored payload of an entry (e.g. after a deep-dive changed its analyses); no-op for unknown keys. */
  updateResult(key: string, result: unknown): void;
}
```

and change the class line to `export class History implements HistoryStore {`. `History.list()` keeps returning `HistoryEntry[]` (a subtype of `HistoryListItem[]`; `refreshLocalHistory` in Task 2 relies on the payloads being there).

- [ ] **Step 2: Add the tables to `src/hosted/schema.ts`**

Append inside the `HOSTED_SCHEMA` template string, after the `invites` table (the `user_settings` table is used from Task 3 on but belongs to the same migration):

```sql
CREATE TABLE IF NOT EXISTS user_history (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          TEXT    NOT NULL,
  request      TEXT    NOT NULL,
  payload      TEXT    NOT NULL,
  label        TEXT    NOT NULL,
  char_class   INTEGER NOT NULL,
  spec         TEXT,
  target_level INTEGER NOT NULL,
  target_auto  INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS user_history_key ON user_history(key, fetched_at);
CREATE TABLE IF NOT EXISTS user_history_auto (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_key TEXT    NOT NULL,
  level     INTEGER NOT NULL,
  set_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, alias_key)
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  your_key    INTEGER,
  legend_open INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);
```

Update the file's header comment to `// Hosted-mode tables (users, sessions, invites, per-user history and settings). Additive only: …`.

- [ ] **Step 3: Write the failing tests `test/hosted/history.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../../src/hosted/db.ts";
import { HISTORY_MAX_PER_USER, SHARED_HISTORY_TTL_MS, openUserHistory } from "../../src/hosted/history.ts";
import { cacheKey } from "../../src/server-history.ts";
import type { HistoryRecord } from "../../src/server-history.ts";

const req = (character: string, level: number | null = null) => ({ character, level, spec: null, metric: null });
const entry = (over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  result: { any: "payload" },
  label: "Muleyoxo-Silvermoon",
  charClass: 7,
  spec: "Holy",
  targetLevel: 21,
  targetAutoDetected: true,
  ...over,
});

/** Fresh DB with users A and B; `max` caps entries per user, `now` is the clock of both stores. */
function setup(max = HISTORY_MAX_PER_USER, now: () => number = () => 1000, file = ":memory:") {
  const db = new Database(file);
  const hosted = openHosted(db);
  const ua = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "a", globalName: null, avatarHash: null }, null, 0);
  const ub = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "b", globalName: null, avatarHash: null }, null, 0);
  const repo = openUserHistory(db, max);
  return { db, hosted, a: repo.forUser(ua.id, now), b: repo.forUser(ub.id, now), ua, ub };
}

describe("SQLite history — same semantics as the in-memory History", () => {
  test("an auto lookup that resolves to +21 merges with an explicit +21 entry", () => {
    const { a: h } = setup();
    const explicit = h.record(req("Muleyoxo-Silvermoon", 21), entry({ targetAutoDetected: false }));
    const auto = h.record(req("Muleyoxo-Silvermoon", null), entry({ targetAutoDetected: true }));
    expect(auto.key).toBe(explicit.key);
    expect(h.size).toBe(1);
    expect(h.get(auto.key)!.targetAutoDetected).toBe(true); // newest wins
  });

  test("an auto request hits the cache once its effective level is known", () => {
    const { a: h } = setup();
    expect(h.cached(req("Muleyoxo-Silvermoon", null))).toBeNull();
    const e = h.record(req("Muleyoxo-Silvermoon", null), entry());
    expect(h.cached(req("Muleyoxo-Silvermoon", null))?.key).toBe(e.key);
    expect(h.cached(req("muleyoxo-silvermoon", 21))?.key).toBe(e.key);
    expect(h.cached(req("Muleyoxo-Silvermoon", 18))).toBeNull();
  });

  test("a cache hit moves the entry to the newest position", () => {
    const { a: h } = setup();
    h.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false }));
    h.record(req("B-X", 18), entry({ label: "B-X", targetLevel: 18, targetAutoDetected: false }));
    h.cached(req("A-X", 18));
    expect(h.list().map((e) => e.label)).toEqual(["A-X", "B-X"]); // newest first
  });

  test("an auto re-evaluation that lands on a new level replaces the old auto entry, not an explicit one", () => {
    const { a: h } = setup();
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 20, targetAutoDetected: true }));
    h.record(req("Muleyoxo-Silvermoon", 18), entry({ targetLevel: 18, targetAutoDetected: false }));
    h.record(req("Muleyoxo-Silvermoon", null), entry({ targetLevel: 21, targetAutoDetected: true }));
    expect(h.list().map((e) => [e.targetLevel, e.targetAutoDetected])).toEqual([[21, true], [18, false]]);
  });

  test("evicts the oldest past the cap; remove/clear also forget auto levels", () => {
    const { a: h } = setup(2);
    h.record(req("A-X", 18), entry({ label: "A-X" }));
    h.record(req("B-X", 18), entry({ label: "B-X" }));
    h.record(req("C-X", null), entry({ label: "C-X", targetLevel: 19 }));
    expect(h.list().map((e) => e.label)).toEqual(["C-X", "B-X"]);
    expect(h.remove(cacheKey(req("C-X", 19)))).toBe(true);
    expect(h.cached(req("C-X", null))).toBeNull();
    expect(h.remove("nope")).toBe(false);
    h.clear();
    expect(h.size).toBe(0);
  });

  test("updateResult replaces the payload in place and keeps the key", () => {
    const { a: h } = setup();
    const e = h.record(req("A-B", 10), entry({ label: "A-B", targetLevel: 10, result: { v: 1 } }));
    h.updateResult(e.key, { v: 2 });
    expect(h.get(e.key)!.result).toEqual({ v: 2 });
    h.updateResult("nope", { v: 3 });
    expect(h.size).toBe(1);
  });

  test("list() carries the summary fields and the request but no payload; get() has the payload", () => {
    const { a: h } = setup(20, () => 4242);
    const e = h.record(req("A-B", 10), entry({ label: "A-B", targetLevel: 10, targetAutoDetected: false, result: { v: 1 } }));
    const [item] = h.list();
    expect(item).toEqual({ key: e.key, request: req("A-B", 10), fetchedAt: 4242, label: "A-B", charClass: 7, spec: "Holy", targetLevel: 10, targetAutoDetected: false });
    expect("result" in item!).toBe(false);
    expect(h.get(e.key)).toEqual({ ...item!, result: { v: 1 } });
  });
});

describe("SQLite history — per user", () => {
  test("two users never see each other's entries (list/get/remove/clear)", () => {
    const { a, b } = setup();
    const ea = a.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18 }));
    expect(b.list()).toEqual([]);
    expect(b.get(ea.key)).toBeUndefined();
    expect(b.remove(ea.key)).toBe(false);
    b.clear();
    expect(a.list().map((e) => e.key)).toEqual([ea.key]);
    b.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, result: { who: "b" } }));
    expect(a.get(ea.key)!.result).toEqual({ any: "payload" });
  });

  test("another user's fresh entry is a cache hit copied into the caller's history, a stale one is not", () => {
    let t = 10_000;
    const { a, b } = setup(20, () => t);
    const ea = a.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false, result: { from: "a" } }));
    t += SHARED_HISTORY_TTL_MS - 1;
    const hit = b.cached(req("A-X", 18));
    expect(hit?.key).toBe(ea.key);
    expect(hit?.result).toEqual({ from: "a" });
    expect(hit?.fetchedAt).toBe(10_000); // the copy keeps the original fetch time
    expect(b.list().map((e) => e.key)).toEqual([ea.key]);
    expect(a.list().map((e) => e.key)).toEqual([ea.key]); // a's row untouched
    a.record(req("B-X", 18), entry({ label: "B-X", targetLevel: 18, targetAutoDetected: false }));
    t += 2; // now the B-X row is exactly TTL + 1 old
    expect(b.cached(req("B-X", 18))).toBeNull();
    expect(b.list().length).toBe(1);
  });

  test("an auto request follows the newest alias any user set within the window", () => {
    let t = 10_000;
    const { a, b } = setup(20, () => t);
    a.record(req("A-X", null), entry({ label: "A-X", targetLevel: 20, targetAutoDetected: true }));
    t = 10_000 + SHARED_HISTORY_TTL_MS + 1;
    expect(b.cached(req("A-X", null))).toBeNull(); // too old to share
    t = 10_001;
    expect(b.cached(req("A-X", null))?.targetLevel).toBe(20); // shared through a's alias
    expect(b.cached(req("A-X", null))?.targetLevel).toBe(20); // now b's own hit
  });

  test("own entries win over a fresher shared one: sharing only fills a miss (the user can hit refresh)", () => {
    let t = 10_000;
    const { a, b } = setup(20, () => t);
    b.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false, result: { from: "b-old" } }));
    t += SHARED_HISTORY_TTL_MS * 2;
    a.record(req("A-X", 18), entry({ label: "A-X", targetLevel: 18, targetAutoDetected: false, result: { from: "a-new" } }));
    expect(b.cached(req("A-X", 18))?.result).toEqual({ from: "b-old" });
  });

  test("history survives reopening the database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-uh-"));
    const file = join(dir, "bmpl.db");
    try {
      const first = setup(20, () => 1000, file);
      const e = first.a.record(req("A-X", null), entry({ label: "A-X", targetLevel: 18 }));
      first.db.close();
      const db = new Database(file);
      const hosted = openHosted(db);
      const again = hosted.history.forUser(first.ua.id, () => 2000);
      expect(again.list().map((x) => x.key)).toEqual([e.key]);
      expect(again.cached(req("A-X", null))?.key).toBe(e.key); // the auto alias survived too
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("openHosted exposes the repo and deleting a user cascades", () => {
    const { db, hosted, ua } = setup();
    const h = hosted.history.forUser(ua.id, () => 1000);
    h.record(req("A-X", null), entry({ label: "A-X", targetLevel: 18 }));
    db.run("DELETE FROM users WHERE id = ?", [ua.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM user_history").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM user_history_auto").get()).toEqual({ n: 0 });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test test/hosted/history.test.ts`
Expected: FAIL — `Cannot find module '../../src/hosted/history.ts'`.

- [ ] **Step 5: Create `src/hosted/history.ts`**

```ts
// Per-user lookup history in SQLite (hosted mode). Same semantics as the in-memory `History`
// (src/server-history.ts): keys use the effective level, an auto request remembers the level it
// resolved to, a cache hit moves the entry to the newest position, the oldest is evicted past the
// cap. Plus one hosted-only rule: a fresh entry of *another* user for the same key counts as a
// cache hit (copied into the caller's history), so two members vetting the same applicant cost
// one WCL fetch.
import type { Database } from "bun:sqlite";
import { cacheKey } from "../server-history.ts";
import type { HistoryEntry, HistoryListItem, HistoryRecord, HistoryRequest, HistoryStore } from "../server-history.ts";

export const HISTORY_MAX_PER_USER = 20;
/** Another user's entry is reused only while younger than this. */
export const SHARED_HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

export interface UserHistoryRepo {
  /** A `HistoryStore` bound to one user. `now` is injectable for tests. */
  forUser(userId: number, now?: () => number): HistoryStore;
}

interface ItemRaw { key: string; request: string; label: string; char_class: number; spec: string | null; target_level: number; target_auto: number; fetched_at: number }
interface EntryRaw extends ItemRaw { payload: string }

const ITEM_COLUMNS = "key, request, label, char_class, spec, target_level, target_auto, fetched_at";

const item = (r: ItemRaw): HistoryListItem => ({
  key: r.key,
  request: JSON.parse(r.request) as HistoryRequest,
  fetchedAt: r.fetched_at,
  label: r.label,
  charClass: r.char_class,
  spec: r.spec,
  targetLevel: r.target_level,
  targetAutoDetected: r.target_auto === 1,
});
const entry = (r: EntryRaw): HistoryEntry => ({ ...item(r), result: JSON.parse(r.payload) as unknown });
const asRecord = (e: HistoryEntry): HistoryRecord =>
  ({ result: e.result, label: e.label, charClass: e.charClass, spec: e.spec, targetLevel: e.targetLevel, targetAutoDetected: e.targetAutoDetected });

export function openUserHistory(db: Database, max = HISTORY_MAX_PER_USER): UserHistoryRepo {
  const getOne = db.query<EntryRaw, [number, string]>(`SELECT ${ITEM_COLUMNS}, payload FROM user_history WHERE user_id = ? AND key = ?`);
  const listAll = db.query<ItemRaw, [number]>(`SELECT ${ITEM_COLUMNS} FROM user_history WHERE user_id = ? ORDER BY seq DESC`);
  const count = db.query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM user_history WHERE user_id = ?");
  const nextSeq = db.query<{ n: number }, [number]>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM user_history WHERE user_id = ?");
  const oldest = db.query<ItemRaw, [number]>(`SELECT ${ITEM_COLUMNS} FROM user_history WHERE user_id = ? ORDER BY seq ASC LIMIT 1`);
  const touch = db.query("UPDATE user_history SET seq = ? WHERE user_id = ? AND key = ?");
  const upsert = db.query(
    `INSERT INTO user_history (user_id, key, request, payload, label, char_class, spec, target_level, target_auto, fetched_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET request = excluded.request, payload = excluded.payload, label = excluded.label,
       char_class = excluded.char_class, spec = excluded.spec, target_level = excluded.target_level,
       target_auto = excluded.target_auto, fetched_at = excluded.fetched_at, seq = excluded.seq`,
  );
  const setPayload = db.query("UPDATE user_history SET payload = ? WHERE user_id = ? AND key = ?");
  const deleteOne = db.query("DELETE FROM user_history WHERE user_id = ? AND key = ?");
  const deleteAll = db.query("DELETE FROM user_history WHERE user_id = ?");
  const sharedNewest = db.query<EntryRaw, [string, number, number]>(
    `SELECT ${ITEM_COLUMNS}, payload FROM user_history WHERE key = ? AND fetched_at >= ? AND user_id <> ? ORDER BY fetched_at DESC LIMIT 1`,
  );

  const autoGet = db.query<{ level: number }, [number, string]>("SELECT level FROM user_history_auto WHERE user_id = ? AND alias_key = ?");
  const autoNewest = db.query<{ level: number }, [string, number]>("SELECT level FROM user_history_auto WHERE alias_key = ? AND set_at >= ? ORDER BY set_at DESC LIMIT 1");
  const autoSet = db.query("INSERT INTO user_history_auto (user_id, alias_key, level, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, alias_key) DO UPDATE SET level = excluded.level, set_at = excluded.set_at");
  const autoDeleteIf = db.query("DELETE FROM user_history_auto WHERE user_id = ? AND alias_key = ? AND level = ?");
  const autoDeleteAll = db.query("DELETE FROM user_history_auto WHERE user_id = ?");

  return {
    forUser(userId, now = Date.now) {
      // Drop the auto alias only if it pointed at this entry (mirrors History.forget).
      const forget = (e: ItemRaw): void => {
        deleteOne.run(userId, e.key);
        autoDeleteIf.run(userId, cacheKey({ ...(JSON.parse(e.request) as HistoryRequest), level: null }), e.target_level);
      };

      const write = (r: HistoryRequest, rec: HistoryRecord, fetchedAt: number): HistoryEntry => {
        const key = cacheKey({ ...r, level: rec.targetLevel });
        if (r.level === null) {
          const aliasKey = cacheKey(r);
          const previous = autoGet.get(userId, aliasKey)?.level;
          // The auto-detected level moved: drop the stale auto entry (never an explicit one).
          if (previous !== undefined && previous !== rec.targetLevel) {
            const old = getOne.get(userId, cacheKey({ ...r, level: previous }));
            if (old && old.target_auto === 1) deleteOne.run(userId, old.key);
          }
          autoSet.run(userId, aliasKey, rec.targetLevel, fetchedAt);
        }
        upsert.run(userId, key, JSON.stringify(r), JSON.stringify(rec.result), rec.label, rec.charClass, rec.spec, rec.targetLevel, rec.targetAutoDetected ? 1 : 0, fetchedAt, nextSeq.get(userId)!.n);
        while (count.get(userId)!.n > max) {
          const o = oldest.get(userId);
          if (!o) break;
          forget(o);
        }
        return { key, request: r, fetchedAt, ...rec };
      };
      const record = db.transaction((r: HistoryRequest, rec: HistoryRecord, fetchedAt: number) => write(r, rec, fetchedAt));

      /** Effective key for a request, or null when an auto request has not been resolved yet. */
      const resolveKey = (r: HistoryRequest): string | null => {
        if (r.level !== null) return cacheKey(r);
        const level = autoGet.get(userId, cacheKey(r))?.level;
        return level === undefined ? null : cacheKey({ ...r, level });
      };

      /** Another user's fresh entry for the same request, or null. Auto requests follow the newest alias any user set. */
      const shared = (r: HistoryRequest): HistoryEntry | null => {
        const since = now() - SHARED_HISTORY_TTL_MS;
        const level = r.level ?? autoNewest.get(cacheKey(r), since)?.level;
        if (level === undefined) return null;
        const row = sharedNewest.get(cacheKey({ ...r, level }), since, userId);
        return row ? entry(row) : null;
      };

      return {
        get size() { return count.get(userId)!.n; },
        cached(r) {
          const key = resolveKey(r);
          const own = key === null ? null : getOne.get(userId, key);
          if (own) {
            touch.run(nextSeq.get(userId)!.n, userId, key!);
            return entry(own);
          }
          const other = shared(r);
          return other ? record(r, asRecord(other), other.fetchedAt) : null;
        },
        record: (r, rec) => record(r, rec, now()),
        get(key) {
          const row = getOne.get(userId, key);
          return row ? entry(row) : undefined;
        },
        list: () => listAll.all(userId).map(item),
        remove(key) {
          const row = getOne.get(userId, key);
          if (!row) return false;
          forget(row);
          return true;
        },
        clear() {
          deleteAll.run(userId);
          autoDeleteAll.run(userId);
        },
        updateResult(key, result) { setPayload.run(JSON.stringify(result), userId, key); },
      };
    },
  };
}
```

- [ ] **Step 6: Expose the repo on `HostedDb` (`src/hosted/db.ts`)**

Add the import `import { openUserHistory } from "./history.ts";` and `import type { UserHistoryRepo } from "./history.ts";`, add `history: UserHistoryRepo;` as the last member of the `HostedDb` interface, and in `openHosted`'s returned object add `history: openUserHistory(db),` after `invites: { … }`. Update the header comment to `// Repositories over the hosted tables. Everything takes \`now\` explicitly so tests control time; the per-user history lives in history.ts.`.

- [ ] **Step 7: Run the tests, the whole suite and the type check**

Run: `bun test test/hosted/history.test.ts` → Expected: PASS (13 tests).
Run: `bun test` and `just check` → Expected: green (the `History` class still satisfies every existing test; `test/hosted/db.test.ts` and the auth tests build the DB through `openHosted` so the new tables are created silently).

- [ ] **Step 8: Commit**

```bash
git add src/server-history.ts src/hosted/schema.ts src/hosted/history.ts src/hosted/db.ts test/hosted/history.test.ts
git commit -m "feat(hosted): HistoryStore interface and SQLite per-user history with shared cache hits"
```

---

### Task 2: Per-request history — context plumbing, handlers over `ctx`, attach-on-read in hosted mode

**Files:**
- Modify: `src/hosted/auth.ts`
- Create: `src/server/local-history.ts`
- Modify: `src/server/lookup.ts`, `src/server/deepdive.ts`, `src/server/routes-shared.ts`, `src/server/watcher.ts`, `src/server.ts`
- Modify: `test/hosted/auth.test.ts` (two literals)
- Test: `test/server-user-state.test.ts` (new)

**Interfaces:**
- Consumes: `HistoryStore`, `HistoryListItem` (Task 1); `HostedDb.history.forUser(userId)` (Task 1); `attachDeepdive` (`src/deepdive/attach.ts`); `TEST_HOSTED_CONFIG`, `loginAs` (`test/hosted/helpers.ts`); `payloadWith` (`test/evaluation/helpers.ts`).
- Produces: `RequestContext { hosted, user, sessionId, ip, now: number, history: HistoryStore | null }`; `LOCAL_CONTEXT(ip: string, history: HistoryStore, now?: number)`; `localHistory` (`src/server/local-history.ts`); `historyOf(ctx): HistoryStore`, `runLookupWithCache(opts, history: HistoryStore)`, `handleLookup(req, ctx)` (`src/server/lookup.ts`); `withCachedAnalyses(payload: LookupPayload): Promise<LookupPayload>`, `refreshLocalHistory()`, `handleDeepdive(req, ctx)` (`src/server/deepdive.ts`).

- [ ] **Step 1: Extend the request context (`src/hosted/auth.ts`)**

Add `import type { HistoryStore } from "../server-history.ts";` and replace the `RequestContext` / `LOCAL_CONTEXT` block with:

```ts
export interface RequestContext {
  hosted: boolean;
  user: SessionUser | null;
  sessionId: string | null;
  ip: string;
  /** Epoch ms when the request was resolved — handlers stamp writes with it instead of calling Date.now(). */
  now: number;
  /** The caller's lookup history: the process-wide one locally, the user's own when hosted, null for an anonymous hosted request. */
  history: HistoryStore | null;
}

export const LOCAL_CONTEXT = (ip: string, history: HistoryStore, now = Date.now()): RequestContext =>
  ({ hosted: false, user: null, sessionId: null, ip, now, history });
```

In `resolveRequest`, the `anonymous` literal becomes `{ hosted: true, user: null, sessionId: null, ip: deps.ip, now: deps.now, history: null }` and the returned context gains `now: deps.now,` and `history: deps.db.history.forUser(u.id),`.

- [ ] **Step 2: Update the two context literals in `test/hosted/auth.test.ts`**

Line 40: `const anon = { hosted: true, user: null, sessionId: null, ip: "", now: 0, history: null };`.
Line 55: `expect(authGate({ auth: "admin" }, LOCAL_CONTEXT("127.0.0.1", new History(1)))).toBeNull();` with `import { History } from "../../src/server-history.ts";` added to the imports. Add one assertion to the `resolveRequest` test that gets a valid session (the `ok` context around line 24): `expect(ok.now).toBe(2000); expect(ok.history?.size).toBe(0);` and, for the anonymous case (line 31), `expect(resolveRequest(req(), { db, secret: SECRET, now: 2000, ip: "" }).history).toBeNull();`.

- [ ] **Step 3: Create `src/server/local-history.ts`**

```ts
// The single process-wide history of local mode (one person, one browser). Hosted mode never
// uses it: every request there carries the user's own SQLite-backed store in `ctx.history`.
import { History } from "../server-history.ts";

export const localHistory = new History(20);
```

- [ ] **Step 4: Rewrite the history plumbing in `src/server/lookup.ts`**

Replace the imports and the singleton with:

```ts
import { hasCredentials } from "../config.ts";
import type { RequestContext } from "../hosted/auth.ts";
import { buildLookupPayload, performLookup } from "../lookup.ts";
import type { LookupPayload } from "../lookup.ts";
import type { Metric } from "../roles.ts";
import type { HistoryListItem, HistoryStore } from "../server-history.ts";
import { withCachedAnalyses } from "./deepdive.ts";
import { jsonResponse, parseCharacterInput, parseMetric, readJson } from "./http.ts";
```

Delete `export const history = new History(20);`. `historySummary` now takes a `HistoryListItem` (same body). Add:

```ts
/** The history a gated handler may use; anonymous hosted requests never reach a handler (authGate), so this is a bug guard. */
export const historyOf = (ctx: RequestContext): HistoryStore => {
  if (!ctx.history) throw new Error("no history for an anonymous request");
  return ctx.history;
};
```

`runLookupWithCache` gains a second parameter `history: HistoryStore` and uses it for `history.cached(request)` and `history.record(request, …)` (bodies unchanged). `handleLookup` becomes `handleLookup(req: Request, ctx: RequestContext)`, calls `runLookupWithCache({ … }, historyOf(ctx))`, and its success response becomes:

```ts
  // Hosted payloads are stored raw: attach today's cached analyses on the way out (0 pts).
  const payload = result.fromCache && ctx.hosted ? await withCachedAnalyses(result.result as LookupPayload) : result.result;
  return jsonResponse({ ok: true, result: payload, key: result.key, fromCache: result.fromCache });
```

- [ ] **Step 5: Split the deep-dive refresh in `src/server/deepdive.ts`**

Replace `import { history } from "./lookup.ts";` with `import type { RequestContext } from "../hosted/auth.ts";` and `import { localHistory } from "./local-history.ts";`. Replace `refreshHistoryDeepdive` with:

```ts
/** The payload with today's cached analyses attached and a re-run evaluation. 0 pts. Hosted reads go through this. */
export async function withCachedAnalyses(payload: LookupPayload): Promise<LookupPayload> {
  const [store, tables, cfg] = await Promise.all([getStore(), getDefensives(), getEvalConfig()]);
  return attachDeepdive(payload, store, tables, cfg);
}

/** Local mode: re-attach on every entry of the process-wide history after an analysis or a table change. 0 pts. */
export async function refreshLocalHistory(): Promise<void> {
  const [store, tables, cfg] = await Promise.all([getStore(), getDefensives(), getEvalConfig()]);
  for (const e of localHistory.list()) localHistory.updateResult(e.key, attachDeepdive(e.result as LookupPayload, store, tables, cfg));
}
```

`handleDeepdive(req: Request, ctx: RequestContext)` replaces `await refreshHistoryDeepdive();` with `if (!ctx.hosted) await refreshLocalHistory();`. `handleDefensivesPost(req, hosted)` replaces its `await refreshHistoryDeepdive();` with `if (!hosted) await refreshLocalHistory();` (hosted entries pick the new table up on their next read).

- [ ] **Step 6: Route the history through `ctx` in `src/server/routes-shared.ts`**

Imports: replace `import { handleLookup, history, historySummary } from "./lookup.ts";` with `import { handleLookup, historyOf, historySummary } from "./lookup.ts";`, add `import { withCachedAnalyses } from "./deepdive.ts";` (extend the existing `./deepdive.ts` import) and `import type { LookupPayload } from "../lookup.ts";`. The routes become:

```ts
    route("POST", "/api/lookup", (req, _url, ctx) => handleLookup(req, ctx)),
    route("POST", "/api/deepdive", (req, _url, ctx) => handleDeepdive(req, ctx)),
    route("GET", "/api/defensives", (_req, url) => handleDefensivesGet(url, ctx.hosted)),
    route("POST", "/api/defensives", (req) => handleDefensivesPost(req, ctx.hosted)),
    route("GET", "/api/history", (_req, _url, rc) => jsonResponse({ ok: true, items: historyOf(rc).list().map(historySummary) })),
    route("DELETE", "/api/history", (_req, _url, rc) => { historyOf(rc).clear(); return jsonResponse({ ok: true }); }),
    prefixRoute("GET", "/api/history/", async (_req, url, rc) => {
      const key = historyKey(url);
      if (key === null) return jsonResponse({ ok: false, error: "Invalid history key" }, 400);
      const entry = historyOf(rc).get(key);
      if (!entry) return jsonResponse({ ok: false, error: "Not in history" }, 404);
      // Hosted payloads are stored raw: attach today's cached analyses on the way out (0 pts).
      const result = rc.hosted ? await withCachedAnalyses(entry.result as LookupPayload) : entry.result;
      return jsonResponse({ ok: true, result, key, fromCache: true });
    }),
    prefixRoute("DELETE", "/api/history/", (_req, url, rc) => {
      const key = historyKey(url);
      if (key === null) return jsonResponse({ ok: false, error: "Invalid history key" }, 400);
      return jsonResponse({ ok: historyOf(rc).remove(key) });
    }),
```

(`ctx` is the `SharedContext` closure argument; the per-request context is named `rc` in these handlers to avoid shadowing.)

- [ ] **Step 7: Watcher and server**

`src/server/watcher.ts`: add `import { localHistory } from "./local-history.ts";` and pass it: `const result = await runLookupWithCache({ … }, localHistory);`.

`src/server.ts`: add `import { localHistory } from "./server/local-history.ts";` and change the context line to
`const ctx = runtime ? resolveRequest(req, { db: runtime.db, secret: runtime.config.sessionSecret, now: Date.now(), ip }) : LOCAL_CONTEXT(ip, localHistory);`.

- [ ] **Step 8: Type-check and run the existing suites**

Run: `just check` → Expected: clean (grep for any leftover `history.` global use: `grep -rn "from \"./lookup.ts\"" src/server | grep history` must show nothing).
Run: `bun test test/server.test.ts test/server-deepdive.test.ts test/server-hosted.test.ts test/hosted` → Expected: PASS.

- [ ] **Step 9: Write the failing integration tests `test/server-user-state.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { cacheKey } from "../src/server-history.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { payloadWith } from "./evaluation/helpers.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let hosted: Awaited<ReturnType<typeof runServer>>;
let local: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let a: ReturnType<typeof loginAs>;
let b: ReturnType<typeof loginAs>;
const savedCreds = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-user-state-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app.js"), "");
  writeFileSync(join(dir, "assets", "app.css"), "");
  writeFileSync(join(dir, "wh-config.js"), "const whTooltips = {};");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  // Dummy credentials: hasCredentials() must pass for /api/lookup, and a cache miss (a bug in this
  // plan) then fails at WCL OAuth instead of spending points.
  process.env.WCL_CLIENT_ID = "bmpl-test";
  process.env.WCL_CLIENT_SECRET = "bmpl-test";
  const assets = async () => ({
    index: join(dir, "index.html"),
    appJs: join(dir, "assets", "app.js"),
    appCss: join(dir, "assets", "app.css"),
    whConfigJs: join(dir, "wh-config.js"),
  });
  hosted = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets });
  local = await runServer({ port: 0, open: false, hosted: false, assets });
  db = openHosted((await getStore())._db);
  a = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "200000000000000001", role: "member" });
  b = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "200000000000000002", role: "member" });
});
afterAll(() => {
  hosted.stop(true);
  local.stop(true);
  closeStore();
  delete process.env.BMPL_DB_PATH;
  if (savedCreds.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = savedCreds.id;
  if (savedCreds.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = savedCreds.secret;
  rmSync(dir, { recursive: true, force: true });
});

const h = (p: string) => `http://localhost:${hosted.port}${p}`;
const l = (p: string) => `http://localhost:${local.port}${p}`;
const as = (who: { cookie: string }, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), cookie: who.cookie, "Content-Type": "application/json" } });

/** A payload attachDeepdive accepts: no runs, so it only re-runs the evaluation and yields `deepdive: []`. */
const seedPayload = (name: string) => ({ ...payloadWith([]), character: { name, classID: 7, spec: "Holy" }, deepdive: [] });
const request = (character: string, level: number | null) => ({ character, level, spec: null, metric: null });

describe("per-user history (hosted)", () => {
  test("a user's entries are invisible to another user; lists, reads, deletes and clears are scoped", async () => {
    const key = db.history.forUser(a.user.id).record(request("Muleyoxo-Silvermoon", 21), {
      result: seedPayload("Muleyoxo"), label: "Muleyoxo-Silvermoon", charClass: 7, spec: "Holy", targetLevel: 21, targetAutoDetected: false,
    }).key;
    expect(key).toBe(cacheKey(request("Muleyoxo-Silvermoon", 21)));
    const mine = await (await fetch(h("/api/history"), as(a))).json();
    expect(mine.items.map((i: { key: string }) => i.key)).toEqual([key]);
    const theirs = await (await fetch(h("/api/history"), as(b))).json();
    expect(theirs.items).toEqual([]);
    expect((await fetch(h(`/api/history/${encodeURIComponent(key)}`), as(b))).status).toBe(404);
    expect((await (await fetch(h(`/api/history/${encodeURIComponent(key)}`), as(b, { method: "DELETE" }))).json()).ok).toBe(false);
    expect((await fetch(h("/api/history"), as(b, { method: "DELETE" }))).status).toBe(200);
    expect((await (await fetch(h("/api/history"), as(a))).json()).items.length).toBe(1);
  });

  test("a hosted read attaches today's analyses (0 pts) — stored payloads stay raw", async () => {
    const key = cacheKey(request("Muleyoxo-Silvermoon", 21));
    const res = await fetch(h(`/api/history/${encodeURIComponent(key)}`), as(a));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(true);
    expect(body.result.deepdive).toEqual([]);
    expect(body.result.deepdiveSummary.analyzedRuns).toBe(0);
    expect(typeof body.result.evaluation.verdict).toBe("string");
  });

  test("the same character costs one WCL fetch: A's own hit, then B inherits it as a cache hit", async () => {
    const own = await (await fetch(h("/api/lookup"), as(a, { method: "POST", body: JSON.stringify({ character: "Muleyoxo-Silvermoon", level: 21 }) }))).json();
    expect(own.ok).toBe(true);
    expect(own.fromCache).toBe(true);
    expect(own.result.deepdive).toEqual([]);
    const inherited = await (await fetch(h("/api/lookup"), as(b, { method: "POST", body: JSON.stringify({ character: "Muleyoxo-Silvermoon", level: 21 }) }))).json();
    expect(inherited.ok).toBe(true);
    expect(inherited.fromCache).toBe(true);
    expect(inherited.key).toBe(own.key);
    const theirs = await (await fetch(h("/api/history"), as(b))).json();
    expect(theirs.items.map((i: { key: string }) => i.key)).toEqual([own.key]);
  });

  test("history survives a server restart", async () => {
    hosted.stop(true);
    const assets = async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets", "app.js"), appCss: join(dir, "assets", "app.css"), whConfigJs: join(dir, "wh-config.js") });
    hosted = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets });
    const mine = await (await fetch(h("/api/history"), as(a))).json();
    expect(mine.items.length).toBe(1);
  });

  test("local mode still serves the process-wide history without a session", async () => {
    expect((await fetch(l("/api/history"))).status).toBe(200);
    expect((await (await fetch(l("/api/history"))).json()).items).toEqual([]);
  });
});
```

- [ ] **Step 10: Run the new file**

Run: `bun test test/server-user-state.test.ts`
Expected: PASS (5 tests). If the "one WCL fetch" test fails with a 500 mentioning OAuth or `401`, the cache path is broken — fix the code, never the credentials. If `evaluation.verdict` is not a string, check `evaluate()`'s field name in `src/evaluation/types.ts` and assert on the field it actually exposes (`expect(body.result.evaluation).toBeDefined()` is the fallback).

- [ ] **Step 11: Full check and commit**

Run: `just check && bun test` → Expected: green.

```bash
git add src/hosted/auth.ts src/server/local-history.ts src/server/lookup.ts src/server/deepdive.ts src/server/routes-shared.ts src/server/watcher.ts src/server.ts test/hosted/auth.test.ts test/server-user-state.test.ts
git commit -m "feat(server): per-request history via RequestContext, hosted attach-on-read and shared cache hits"
```

---

### Task 3: User settings — repository, `GET/PUT /api/settings`

**Files:**
- Modify: `src/hosted/db.ts`
- Modify: `src/server/routes.ts`
- Create: `src/server/routes-user.ts`
- Modify: `src/server.ts`
- Test: `test/hosted/settings.test.ts` (new), `test/server-user-state.test.ts` (extend)

**Interfaces:**
- Consumes: `user_settings` table (Task 1), `RequestContext.now` (Task 2), `HostedRuntime` (`src/hosted/runtime.ts`), `jsonResponse`/`readJson` (`src/server/http.ts`).
- Produces: `UserSettings { yourKey: number | null; legendOpen: boolean }`, `DEFAULT_USER_SETTINGS`, `HostedDb.settings { get(userId): UserSettings; update(userId, patch: Partial<UserSettings>, now: number): UserSettings }`; `parseSettingsPatch(body: unknown)`, `userRoutes(runtime): Route[]`, `KEY_MIN = 2`, `KEY_MAX = 40` (`src/server/routes-user.ts`); `Route["method"]` includes `"PUT"`.

- [ ] **Step 1: Write the failing repository tests `test/hosted/settings.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { DEFAULT_USER_SETTINGS, openHosted } from "../../src/hosted/db.ts";

function setup() {
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const ua = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "a", globalName: null, avatarHash: null }, null, 0);
  const ub = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "b", globalName: null, avatarHash: null }, null, 0);
  return { db, s: hosted.settings, ua, ub };
}

describe("user settings repository", () => {
  test("defaults before any write", () => {
    const { s, ua } = setup();
    expect(s.get(ua.id)).toEqual({ yourKey: null, legendOpen: true });
    expect(DEFAULT_USER_SETTINGS).toEqual({ yourKey: null, legendOpen: true });
  });

  test("update merges a partial patch and returns the whole row; users are independent", () => {
    const { s, ua, ub, db } = setup();
    expect(s.update(ua.id, { yourKey: 18 }, 1000)).toEqual({ yourKey: 18, legendOpen: true });
    expect(s.update(ua.id, { legendOpen: false }, 2000)).toEqual({ yourKey: 18, legendOpen: false });
    expect(s.update(ua.id, { yourKey: null }, 3000)).toEqual({ yourKey: null, legendOpen: false });
    expect(s.get(ub.id)).toEqual({ yourKey: null, legendOpen: true });
    expect(db.query("SELECT updated_at FROM user_settings WHERE user_id = ?").get(ua.id)).toEqual({ updated_at: 3000 });
  });

  test("deleting the user cascades", () => {
    const { s, ua, db } = setup();
    s.update(ua.id, { yourKey: 20 }, 1);
    db.run("DELETE FROM users WHERE id = ?", [ua.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM user_settings").get()).toEqual({ n: 0 });
  });
});
```

Run: `bun test test/hosted/settings.test.ts` → Expected: FAIL (`hosted.settings` is undefined / `DEFAULT_USER_SETTINGS` not exported).

- [ ] **Step 2: Add the repository to `src/hosted/db.ts`**

After the `DiscordIdentity` interface:

```ts
export interface UserSettings { yourKey: number | null; legendOpen: boolean }
export const DEFAULT_USER_SETTINGS: UserSettings = { yourKey: null, legendOpen: true };
```

In the `HostedDb` interface, before `history`:

```ts
  settings: {
    get(userId: number): UserSettings;
    /** Merges `patch` over the stored (or default) row and returns the result. */
    update(userId: number, patch: Partial<UserSettings>, now: number): UserSettings;
  };
```

Prepared statements (next to the invite ones):

```ts
  const settingsGet = db.query<{ your_key: number | null; legend_open: number }, [number]>("SELECT your_key, legend_open FROM user_settings WHERE user_id = ?");
  const settingsUpsert = db.query("INSERT INTO user_settings (user_id, your_key, legend_open, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET your_key = excluded.your_key, legend_open = excluded.legend_open, updated_at = excluded.updated_at");
  const settings = (userId: number): UserSettings => {
    const r = settingsGet.get(userId);
    return r ? { yourKey: r.your_key, legendOpen: r.legend_open === 1 } : { ...DEFAULT_USER_SETTINGS };
  };
```

Returned object member:

```ts
    settings: {
      get: settings,
      update(userId, patch, now) {
        const next = { ...settings(userId), ...patch };
        settingsUpsert.run(userId, next.yourKey, next.legendOpen ? 1 : 0, now);
        return next;
      },
    },
```

Run: `bun test test/hosted/settings.test.ts` → Expected: PASS (3 tests).

- [ ] **Step 3: Allow `PUT` in the route table (`src/server/routes.ts`)**

`method: "GET" | "POST" | "DELETE" | "PUT"` in `Route`, and the `route`/`prefixRoute` signatures already use `Route["method"]`.

- [ ] **Step 4: Create `src/server/routes-user.ts`**

```ts
// src/server/routes-user.ts
// Per-user settings ("your key", legend state). Only registered in hosted mode: local mode keeps
// them in the browser (web/src/lib/settings.ts).
import type { UserSettings } from "../hosted/db.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import { jsonResponse, readJson } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";

// Mirrors KEY_MIN / KEY_MAX in web/src/lib/keyLevel.ts.
export const KEY_MIN = 2;
export const KEY_MAX = 40;

/** Validated partial settings from a PUT body. Unknown fields are ignored; an empty patch is an error. */
export function parseSettingsPatch(body: unknown): { ok: true; patch: Partial<UserSettings> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid JSON body" };
  const b = body as Record<string, unknown>;
  const patch: Partial<UserSettings> = {};
  if ("yourKey" in b) {
    const v = b.yourKey;
    if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= KEY_MIN && v <= KEY_MAX)) {
      return { ok: false, error: `\`yourKey\` must be null or an integer between ${KEY_MIN} and ${KEY_MAX}` };
    }
    patch.yourKey = v as number | null;
  }
  if ("legendOpen" in b) {
    if (typeof b.legendOpen !== "boolean") return { ok: false, error: "`legendOpen` must be a boolean" };
    patch.legendOpen = b.legendOpen;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update: send `yourKey` and/or `legendOpen`" };
  return { ok: true, patch };
}

export function userRoutes(rt: HostedRuntime): Route[] {
  return [
    route("GET", "/api/settings", (_req, _url, ctx) => jsonResponse({ ok: true, settings: rt.db.settings.get(ctx.user!.id) })),
    route("PUT", "/api/settings", async (req, _url, ctx) => {
      const parsed = parseSettingsPatch(await readJson<unknown>(req));
      if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 400);
      return jsonResponse({ ok: true, settings: rt.db.settings.update(ctx.user!.id, parsed.patch, ctx.now) });
    }),
  ];
}
```

- [ ] **Step 5: Register the routes in `src/server.ts`**

Add `import { userRoutes } from "./server/routes-user.ts";` and extend the hosted branch: `...(runtime ? [...authRoutes(runtime), ...adminRoutes(runtime), ...userRoutes(runtime)] : localRoutes())`.

- [ ] **Step 6: Extend `test/server-user-state.test.ts` with the route tests**

Append:

```ts
describe("/api/settings (hosted)", () => {
  const put = (who: { cookie: string }, body: unknown) => fetch(h("/api/settings"), as(who, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }));

  test("401 without a session; defaults for a fresh user", async () => {
    expect((await fetch(h("/api/settings"))).status).toBe(401);
    expect((await fetch(h("/api/settings"), { method: "PUT", body: "{}" })).status).toBe(401);
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: true } });
  });

  test("PUT merges partial patches per user", async () => {
    expect(await (await put(a, { yourKey: 22 })).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: true } });
    expect(await (await put(a, { legendOpen: false })).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: false } });
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: 22, legendOpen: false } });
    expect(await (await fetch(h("/api/settings"), as(b))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: true } });
    expect(await (await put(a, { yourKey: null })).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: false } });
  });

  test("PUT validates its body", async () => {
    for (const body of ["not json", {}, { yourKey: 1 }, { yourKey: 41 }, { yourKey: "18" }, { yourKey: 18.5 }, { legendOpen: "yes" }, { other: 1 }]) {
      const res = await put(a, body);
      expect(res.status).toBe(400);
      expect((await res.json()).ok).toBe(false);
    }
    expect(await (await fetch(h("/api/settings"), as(a))).json()).toEqual({ ok: true, settings: { yourKey: null, legendOpen: false } });
  });

  test("local mode does not register the settings routes", async () => {
    expect((await fetch(l("/api/settings"))).status).toBe(404);
    expect((await fetch(l("/api/settings"), { method: "PUT", body: "{}" })).status).toBe(404);
  });
});
```

Run: `bun test test/server-user-state.test.ts` → Expected: PASS (9 tests).

- [ ] **Step 7: Full check and commit**

Run: `just check && bun test` → Expected: green.

```bash
git add src/hosted/db.ts src/server/routes.ts src/server/routes-user.ts src/server.ts test/hosted/settings.test.ts test/server-user-state.test.ts
git commit -m "feat(hosted): per-user settings repository and GET/PUT /api/settings"
```

---

### Task 4: SSE fan-out per user

**Files:**
- Modify: `src/server/sse.ts`
- Modify: `src/server/routes-shared.ts` (one line)
- Test: `test/server-sse.test.ts` (new)

**Interfaces:**
- Consumes: `RequestContext.user` (Task 2).
- Produces: `broadcast(event, data)` (local clients only), `broadcastTo(userId: number, event, data)`, `eventsResponse(initial, userId: number | null)`.

- [ ] **Step 1: Write the failing test `test/server-sse.test.ts`**

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { broadcast, broadcastTo, eventsResponse } from "../src/server/sse.ts";

const decoder = new TextDecoder();
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];

/** Opens a stream and returns a `next(ms)` that resolves with the next chunk or null when nothing arrives in time. */
function open(userId: number | null) {
  const reader = eventsResponse({ event: "status", data: { active: false } }, userId).body!.getReader();
  readers.push(reader);
  let pending: Promise<string | null> | null = null;
  const next = (ms = 80): Promise<string | null> => {
    pending ??= reader.read().then((x) => { pending = null; return x.done ? null : decoder.decode(x.value); });
    return Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  };
  return { next };
}

afterAll(() => { for (const r of readers) void r.cancel(); });

describe("SSE fan-out", () => {
  test("every stream starts with the initial event", async () => {
    const c = open(null);
    expect(await c.next()).toBe('event: status\ndata: {"active":false}\n\n');
  });

  test("broadcastTo reaches only that user's clients; broadcast reaches only local (user-less) clients", async () => {
    const local = open(null);
    const u1a = open(1);
    const u1b = open(1);
    const u2 = open(2);
    for (const c of [local, u1a, u1b, u2]) expect(await c.next()).toContain("event: status");

    broadcastTo(1, "result", { key: "k" });
    expect(await u1a.next()).toBe('event: result\ndata: {"key":"k"}\n\n');
    expect(await u1b.next()).toBe('event: result\ndata: {"key":"k"}\n\n');
    expect(await u2.next()).toBeNull();
    expect(await local.next()).toBeNull();

    broadcast("status", { active: true });
    expect(await local.next()).toBe('event: status\ndata: {"active":true}\n\n');
    expect(await u1a.next()).toBeNull();
    expect(await u2.next()).toBeNull();
  });
});
```

Run: `bun test test/server-sse.test.ts` → Expected: FAIL (`broadcastTo` is not exported; `eventsResponse` ignores the second argument so the user-2 client would also receive the broadcast).

- [ ] **Step 2: Rewrite `src/server/sse.ts`**

```ts
// --- SSE fan-out ------------------------------------------------------------
// Clients are keyed by user id: `null` is a local-mode tab (one person, one process), a number is a
// hosted member's tab. Local broadcasts never reach hosted tabs and a member never sees another's events.

const sseClients = new Map<ReadableStreamDefaultController<Uint8Array>, number | null>();
const sseEncoder = new TextEncoder();

const encode = (event: string, data: unknown): Uint8Array => sseEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const send = (c: ReadableStreamDefaultController<Uint8Array>, bytes: Uint8Array): void => {
  try {
    c.enqueue(bytes);
  } catch {
    /* client closed */
  }
};

/** Local-mode fan-out: every user-less client (the clipboard watcher's audience). */
export const broadcast = (event: string, data: unknown): void => {
  const bytes = encode(event, data);
  for (const [c, userId] of sseClients) if (userId === null) send(c, bytes);
};

/** Hosted fan-out: every tab of one member. */
export const broadcastTo = (userId: number, event: string, data: unknown): void => {
  const bytes = encode(event, data);
  for (const [c, uid] of sseClients) if (uid === userId) send(c, bytes);
};

// Periodic heartbeat so SSE connections are never fully idle, even without
// a watcher event. A `:` line is an SSE comment — the browser ignores it
// but it keeps the socket live through any reverse proxies.
const HEARTBEAT_BYTES = sseEncoder.encode(`: ping\n\n`);
// unref: this module is imported by cli.ts for every command (not just `serve`),
// so this timer must not keep the process alive when no server is running.
setInterval(() => {
  for (const c of sseClients.keys()) send(c, HEARTBEAT_BYTES);
}, 20_000).unref();

/** One SSE stream per browser tab; `initial` is sent immediately (the watcher status today). `userId` is null in local mode. */
export function eventsResponse(initial: { event: string; data: unknown }, userId: number | null): Response {
  let selfController: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      selfController = controller;
      sseClients.set(controller, userId);
      controller.enqueue(encode(initial.event, initial.data));
    },
    cancel() { sseClients.delete(selfController); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 3: Register the user on `/api/events` (`src/server/routes-shared.ts`)**

```ts
    // In hosted mode the watcher never runs; the initial status is simply "inactive" and the stream is the member's own.
    route("GET", "/api/events", (_req, _url, rc) => eventsResponse({ event: "status", data: watcherStatus() }, rc.user?.id ?? null)),
```

- [ ] **Step 4: Run, check, commit**

Run: `bun test test/server-sse.test.ts test/server.test.ts test/server-hosted.test.ts` → Expected: PASS. Run: `just check` → clean.

```bash
git add src/server/sse.ts src/server/routes-shared.ts test/server-sse.test.ts
git commit -m "feat(server): SSE clients keyed by user, broadcastTo for hosted fan-out"
```

---

### Task 5: Front — `SettingsProvider` over `/api/settings` (hosted) or localStorage (local)

**Files:**
- Create: `web/src/lib/settings.ts`, `web/src/lib/settings.test.ts`, `web/src/settings.tsx`
- Modify: `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/AxisLegend.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/settings` (Task 3); `STORAGE_KEY`, `parseStoredKey` (`web/src/lib/keyLevel.ts`); `api.me()` boot flow in `App.tsx`.
- Produces: `Settings`, `DEFAULT_SETTINGS`, `LEGEND_STORAGE_KEY`, `readLocalSettings(store)`, `writeLocalSettings(store, patch)`, `parseServerSettings(raw)` (`web/src/lib/settings.ts`); `SettingsProvider({ hosted, initial, children })`, `useSettings(): { settings, update }` (`web/src/settings.tsx`); `api.settings()`, `api.putSettings(patch)`.

No visible change: the header stepper and the legend look and behave as today; only where the values live changes. The design canvas is therefore not involved (see `docs/agents/workflow.md`, "Visual work").

- [ ] **Step 1: Write the failing view-model tests `web/src/lib/settings.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, LEGEND_STORAGE_KEY, parseServerSettings, readLocalSettings, writeLocalSettings } from "./settings.ts";
import { STORAGE_KEY } from "./keyLevel.ts";

const fakeStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, dump: () => Object.fromEntries(m) };
};

describe("readLocalSettings", () => {
  test("defaults without storage or with empty storage", () => {
    expect(readLocalSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readLocalSettings(fakeStore())).toEqual({ yourKey: null, legendOpen: true });
  });
  test("reads the legacy keys: bmpl.yourKey (validated) and bmpl.legendOpen ('0' = closed)", () => {
    expect(readLocalSettings(fakeStore({ [STORAGE_KEY]: "18", [LEGEND_STORAGE_KEY]: "0" }))).toEqual({ yourKey: 18, legendOpen: false });
    expect(readLocalSettings(fakeStore({ [STORAGE_KEY]: "99", [LEGEND_STORAGE_KEY]: "1" }))).toEqual({ yourKey: null, legendOpen: true });
  });
  test("a throwing storage (private mode) yields the defaults", () => {
    const boom = { getItem: () => { throw new Error("denied"); }, setItem: () => {}, removeItem: () => {} };
    expect(readLocalSettings(boom)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("writeLocalSettings", () => {
  test("writes only the patched keys; null removes the key", () => {
    const s = fakeStore({ [STORAGE_KEY]: "18" });
    writeLocalSettings(s, { legendOpen: false });
    expect(s.dump()).toEqual({ [STORAGE_KEY]: "18", [LEGEND_STORAGE_KEY]: "0" });
    writeLocalSettings(s, { yourKey: null });
    expect(s.dump()).toEqual({ [LEGEND_STORAGE_KEY]: "0" });
    writeLocalSettings(s, { yourKey: 21, legendOpen: true });
    expect(s.dump()).toEqual({ [STORAGE_KEY]: "21", [LEGEND_STORAGE_KEY]: "1" });
  });
  test("no storage or a throwing storage is a no-op", () => {
    writeLocalSettings(null, { yourKey: 1 });
    writeLocalSettings({ getItem: () => null, setItem: () => { throw new Error("denied"); }, removeItem: () => {} }, { legendOpen: true });
  });
});

describe("parseServerSettings", () => {
  test("accepts the server shape and clamps garbage to the defaults", () => {
    expect(parseServerSettings({ yourKey: 18, legendOpen: false })).toEqual({ yourKey: 18, legendOpen: false });
    expect(parseServerSettings({ yourKey: null, legendOpen: true })).toEqual({ yourKey: null, legendOpen: true });
    expect(parseServerSettings({ yourKey: 99 })).toEqual({ yourKey: null, legendOpen: true });
    expect(parseServerSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseServerSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });
});
```

Run: `bun test web/src/lib/settings.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: Create `web/src/lib/settings.ts`**

```ts
// Per-user settings: "your key" and the legend state. Hosted mode keeps them on the server
// (GET/PUT /api/settings); local mode keeps them in the browser under the same keys as before.
import { STORAGE_KEY, parseStoredKey } from "./keyLevel.ts";

export interface Settings { yourKey: number | null; legendOpen: boolean }
export const DEFAULT_SETTINGS: Settings = { yourKey: null, legendOpen: true };
export const LEGEND_STORAGE_KEY = "bmpl.legendOpen";

/** The subset of the Web Storage API we use; null when storage is unavailable. */
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** Settings from the browser; defaults when storage is unavailable (private mode) or empty. */
export function readLocalSettings(store: KeyValueStore | null): Settings {
  if (!store) return DEFAULT_SETTINGS;
  try {
    return { yourKey: parseStoredKey(store.getItem(STORAGE_KEY)), legendOpen: store.getItem(LEGEND_STORAGE_KEY) !== "0" };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Persist a patch in the browser; a no-op when storage is unavailable. */
export function writeLocalSettings(store: KeyValueStore | null, patch: Partial<Settings>): void {
  if (!store) return;
  try {
    if ("yourKey" in patch) {
      if (patch.yourKey === null || patch.yourKey === undefined) store.removeItem(STORAGE_KEY);
      else store.setItem(STORAGE_KEY, String(patch.yourKey));
    }
    if (patch.legendOpen !== undefined) store.setItem(LEGEND_STORAGE_KEY, patch.legendOpen ? "1" : "0");
  } catch {
    /* private mode etc. */
  }
}

/** `GET /api/settings` → Settings; anything malformed falls back to the defaults field by field. */
export function parseServerSettings(raw: unknown): Settings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { yourKey: typeof o.yourKey === "number" ? parseStoredKey(String(o.yourKey)) : null, legendOpen: o.legendOpen !== false };
}
```

Run: `bun test web/src/lib/settings.test.ts` → Expected: PASS (7 tests).

- [ ] **Step 3: API client (`web/src/api.ts`)**

Add `import type { Settings } from "./lib/settings.ts";` and two members to `api` (after `patchDefensives`):

```ts
  settings: () => call<{ settings: Settings }>("/api/settings"),
  putSettings: (patch: Partial<Settings>) =>
    call<{ settings: Settings }>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
```

- [ ] **Step 4: Create `web/src/settings.tsx`**

```tsx
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api.ts";
import { DEFAULT_SETTINGS, readLocalSettings, writeLocalSettings } from "./lib/settings.ts";
import type { KeyValueStore, Settings } from "./lib/settings.ts";

interface SettingsContext { settings: Settings; update: (patch: Partial<Settings>) => void }
const Ctx = createContext<SettingsContext>({ settings: DEFAULT_SETTINGS, update: () => {} });

const browserStore = (): KeyValueStore | null => {
  try { return localStorage; } catch { return null; }
};

/**
 * Hosted: `initial` came from GET /api/settings at boot and every change is PUT back (fire and forget —
 * a failed write only means the old value comes back on the next boot). Local: the browser's storage.
 */
export function SettingsProvider({ hosted, initial, children }: { hosted: boolean; initial: Settings | null; children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => initial ?? (hosted ? DEFAULT_SETTINGS : readLocalSettings(browserStore())));
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (hosted) void api.putSettings(patch);
    else writeLocalSettings(browserStore(), patch);
  }, [hosted]);
  return <Ctx.Provider value={{ settings, update }}>{children}</Ctx.Provider>;
}

export const useSettings = (): SettingsContext => useContext(Ctx);
```

- [ ] **Step 5: Wire `App.tsx`**

- Imports: drop `STORAGE_KEY, parseStoredKey` from the `./lib/keyLevel.ts` import (keep `reevalHint`); add `import { parseServerSettings } from "./lib/settings.ts";`, `import type { Settings } from "./lib/settings.ts";`, `import { SettingsProvider, useSettings } from "./settings.tsx";`.
- `Screen`'s `main` variant becomes `{ kind: "main"; status: StatusInfo; me: MeUser | null; settings: Settings | null }`.
- Boot effect: after `const me = …`, add
  ```ts
      const settings = me?.kind === "ok" ? parseServerSettings((await api.settings().then((r) => (r.ok ? r.settings : null)))) : null;
  ```
  and set `settings` on the main screen: `setScreen({ kind, status, me: me?.kind === "ok" ? me.user : null, settings })`. The `Setup.onDone` transition sets `settings: null`.
- Render: `return <SettingsProvider hosted={screen.status.hosted} initial={screen.settings}><Main status={screen.status} me={screen.me} onSetup={…} /></SettingsProvider>;`.
- Delete `readStoredKey` / `writeStoredKey`. In `Main`, replace the two `yourKey` lines with:
  ```ts
  // "Your key": the level every lookup is evaluated for (null = auto). Per browser locally, per account when hosted.
  const { settings, update: updateSettings } = useSettings();
  const yourKey = settings.yourKey;
  const onKeyChange = (v: number | null) => updateSettings({ yourKey: v });
  ```
  Every other use of `yourKey` / `onKeyChange` stays as is.

- [ ] **Step 6: `AxisLegend.tsx` reads the context**

Replace the `useState`/`STORAGE_KEY`/`readOpen`/`writeOpen` lines with `import { useSettings } from "../settings.tsx";` and, in the component:

```tsx
  const { settings, update } = useSettings();
  const open = settings.legendOpen;
  const toggle = () => update({ legendOpen: !open });
```

Update the doc comment to `/** "How the verdict is built": one line per axis with its weight; open by default, remembered per browser (local) or per account (hosted). */`. Drop the now-unused `useState` import.

- [ ] **Step 7: Check, build-free sanity, commit**

Run: `just check` → clean (in particular `web/`: no unused imports; `verbatimModuleSyntax` accepts the `import type` lines). Run: `bun test` → green. Optional but recommended: `cd web && bunx vite build` to make sure the bundle compiles, then delete `web/dist` (`rm -rf web/dist`) so the server tests keep their 503 assumption.

```bash
git add web/src/lib/settings.ts web/src/lib/settings.test.ts web/src/settings.tsx web/src/api.ts web/src/App.tsx web/src/components/AxisLegend.tsx
git commit -m "feat(web): SettingsProvider — your key and legend state per account in hosted mode"
```

---

### Task 6: Docs — README, agent guide, roadmap

**Files:**
- Modify: `README.md`, `docs/agents/architecture.md`, `docs/agents/web-front.md`, `docs/agents/workflow.md`, `docs/agents/testing.md`, `AGENTS.md`

**Interfaces:** none (documentation of Tasks 1–5).

- [ ] **Step 1: README "Hosted mode" section**

In the paragraph starting `Do not expose a hosted instance to the internet before issues #4–#5 land:` (around line 433), change it to reference **#5 only** (the shared WCL budget / rate limits) and drop the "shares one lookup history" clause. Add, after the "Login." paragraph, a paragraph:

```
**Per-account state.** Each member has their own lookup history (20 tabs, kept
in `bmpl.db` across restarts), their own "your key" and legend preference
(`GET/PUT /api/settings`), and their own live-event stream. Two members looking
up the same character within 6 hours share one WCL fetch: the second lookup
reuses the first member's result (shown as cached; **Refresh** fetches again).
Deep-dive analyses are attached when a tab is opened, so an analysis run by one
member shows up for everyone who has that run in a tab. Local mode is unchanged:
history in memory, settings in the browser.
```

Also extend the API list of the README if it enumerates routes (`grep -n "/api/history" README.md`) with `GET/PUT /api/settings (hosted only)`.

- [ ] **Step 2: `docs/agents/architecture.md`**

- Cache-table list (around line 38): add rows `| user_history | (user_id, key) | hosted-mode lookup history, one row per tab, raw payload | 20 per user, oldest evicted |`, `| user_history_auto | (user_id, alias_key) | hosted-mode auto-level alias | with its entry |`, `| user_settings | user_id | hosted-mode "your key" + legend state | until removed |`.
- Server paragraph (around line 62): replace `lookup.ts (in-memory History(20) + runLookupWithCache)` with `lookup.ts (runLookupWithCache(opts, history) + historyOf(ctx))`, mention `local-history.ts` (the local singleton), `deepdive.ts` (`withCachedAnalyses` for hosted reads, `refreshLocalHistory` for local), `sse.ts` (clients keyed by user id: `broadcast` local-only, `broadcastTo(userId)` hosted), `routes-user.ts` (`GET/PUT /api/settings`, hosted only). Extend the `RequestContext` description to `{ hosted, user, sessionId, ip, now, history }` and add one sentence on the `HistoryStore` interface (`src/server-history.ts`) with its two implementations and the hosted sharing rule (`SHARED_HISTORY_TTL_MS` 6 h, `src/hosted/history.ts`).
- Invariants: add `Hosted payloads are stored raw and get today's analyses attached on read (0 pts); nothing iterates other users' rows after an analysis.`

- [ ] **Step 3: `docs/agents/web-front.md`, `workflow.md`, `testing.md`, `AGENTS.md`**

- `web-front.md` line 16: `- **Settings** ("your key", legend state) come from \`SettingsProvider\` (\`web/src/settings.tsx\`, logic in \`lib/settings.ts\`): localStorage keys \`bmpl.yourKey\` / \`bmpl.legendOpen\` locally, \`GET/PUT /api/settings\` when hosted; always with a working fallback.`
- `workflow.md` roadmap pointer: `execute #5 → #11 in order`.
- `testing.md`: if it lists server test files, add `test/server-user-state.test.ts` (hosted two-user history/settings, dummy WCL credentials, never fetches), `test/server-sse.test.ts`, `test/hosted/history.test.ts`, `test/hosted/settings.test.ts`, `web/src/lib/settings.test.ts`.
- `AGENTS.md`: "Where things are" — `src/hosted/` line adds `per-user history/settings`; roadmap line: `#2–#4 (hosted skeleton, Discord login, per-user state) are shipped, next is #5 (WCL budget / rate limits)`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/agents/architecture.md docs/agents/web-front.md docs/agents/workflow.md docs/agents/testing.md AGENTS.md
git commit -m "docs: per-user history, settings and SSE in hosted mode"
```

---

## Readiness for the next issues

- **#5 (WCL budget / rate limits):** `runLookupWithCache` is the single seam for a per-user quota — it already receives the caller's `HistoryStore`; add a `ctx`/user parameter there. `SHARED_HISTORY_TTL_MS` is the knob that trades freshness for points.
- **#7 (real sign-in / user menu design):** `useSettings()` is where a settings popover would read/write; the header stepper is unchanged.
- **#9 (hardening):** `PUT /api/settings` is a state-changing route — include it in the Origin check; `/api/events` per user is a natural place for a per-user connection cap.
- Deferred by ruling: no `history_runs` side table — attach-on-read made it unnecessary (0 pts, ms-level per read); revisit only if `GET /api/history/:key` latency becomes visible.

## Self-review

- **Spec coverage:** schema ✔ (Task 1: `user_history`, `user_history_auto`, `user_settings` — column names follow the issue with `request`/`seq` added for the alias and ordering); `History` interface with two implementations, same semantics ✔ (Task 1, mirrored tests); `refreshHistoryDeepdive` for every user's entries → replaced by attach-on-read (Task 2, documented as a ruling in "Readiness"); `/api/history*` scoped ✔ (Task 2); `GET/PUT /api/settings` ✔ (Task 3); front fallback to localStorage ✔ (Task 5); Compare within own history ✔ (follows from scoping — `Compare` reads `/api/history/:key` for the user's own tabs); SSE per user, no watcher events hosted ✔ (Task 4); acceptance "two users, one shared cache hit" ✔ (Task 1 sharing rule + Task 2 integration test); "survives restart" ✔ (Task 1 file test + Task 2 restart test); local unchanged ✔ (Global Constraints, existing suites untouched).
- **Placeholder scan:** none.
- **Type consistency:** `HistoryStore.list(): HistoryListItem[]` and `historySummary(entry: HistoryListItem)` (Task 2) agree; `forUser(userId, now?)` used identically in Tasks 1–2 tests; `RequestContext.now`/`history` (Task 2) consumed by Task 3 (`ctx.now`) and Task 4 (`rc.user?.id`); `Settings`/`UserSettings` share the shape `{ yourKey: number | null; legendOpen: boolean }` on both sides of the wire; `Route["method"]` gains `"PUT"` before `routes-user.ts` uses it.
