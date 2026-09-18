# WCL Budget Accounting and Per-User Hourly Quotas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In hosted mode, every Warcraft Logs point spent through the shared API client is measured and attributed to the member who triggered it; members get an hourly quota (default 300 pts) enforced *before* spending, admins are exempt, a global floor keeps the shared client alive, and everyone can see what is left.

**Architecture:** Every WCL query now returns `rateLimitData`; the raw transport (`src/wcl/client.ts`) hands it to an installed observer. Hosted mode installs a `PointsMeter` (`src/wcl/meter.ts`) that turns the counter's deltas into charges on the running request (AsyncLocalStorage) and on its user (`usage_hourly`). A `QuotaGate` (`src/hosted/quota.ts`) answers "may this user spend an estimated N points now?" from the user's hourly usage, the admin role and the meter's last snapshot (floor). `performLookup` and `runDeepdive` get an injectable `reserve(estimate)` and refuse with a 429 outcome before any fetch; cached data never consults the gate. `runLookupWithCache` also dedupes identical in-flight lookups (the #4 carry-over). Responses and `/api/me` carry `pointsSpent` and `quota`; the front shows "N pts left this hour" and disables Analyze when it cannot afford it. Local mode: no meter, no gate, unchanged behaviour.

**Tech Stack:** Bun 1.3 (`Bun.serve`, `bun:sqlite`, `bun:test`, `node:async_hooks` AsyncLocalStorage), TypeScript strict, Vite 8 + React 19 (types-only imports from `src/`).

**Spec:** GitHub issue #5 (`gh issue view 5`), parent #1 (`gh issue view 1`). Repo rules: `AGENTS.md`, `docs/agents/{architecture,web-front,testing,workflow}.md`. Builds on #4 (`docs/superpowers/plans/2026-09-18-per-user-state.md`): `RequestContext { hosted, user, sessionId, ip, now, history }`, `HostedRuntime { config, db, states, fetchFn, secure }`, `runLookupWithCache(opts, history)`, `handleLookup(req, ctx)`, `handleDeepdive(req, ctx)`, `sharedRoutes({ hosted, envPath })`.

## Global Constraints

- Local mode (`bmpl serve` without `--hosted`, and every CLI command) is unchanged: no meter installed, no quota, `pointsSpent` on `/api/lookup` is absent locally; the deep-dive keeps its PING pre-check and `MIN_BUDGET_POINTS = 20` in both modes. Existing suites stay green and are edited only where a signature they call changed.
- Every query in `src/wcl/queries.ts` (including `buildMultiEncounterQuery` in `src/mplus.ts`) selects `rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }` as its first top-level field. The raw transport `gql()` calls `observeRateLimit(json.data)` after a successful response; `setRateLimitObserver(fn | null)` installs the observer (hosted mode only).
- `PointsMeter` (`src/wcl/meter.ts`): `run(userId, fn)` scopes attribution with AsyncLocalStorage; `observe(rl)` charges `delta` = counter minus the previous observation of the same WCL window (`windowEnd = observedAt + pointsResetIn * 1000`; an observation at or past `windowEnd` starts a new window and its whole counter is the delta; an in-window lower counter charges 0 and keeps the higher counter); the first observation only primes; charges are rounded to 0.1 pt; charges outside `run` are not attributed; `wrap(gql)` returns a `GqlFn` that observes its responses. Cost estimates: `ESTIMATE_RANKINGS = 10`, `ESTIMATE_RUN = 10`, `ESTIMATE_DEEPDIVE = 3`.
- Schema (`src/hosted/schema.ts`, `CREATE TABLE IF NOT EXISTS`): `usage_hourly(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, hour_start INTEGER NOT NULL, points REAL NOT NULL DEFAULT 0, PRIMARY KEY (user_id, hour_start))` + index `usage_hourly_hour ON usage_hourly(hour_start)`. Buckets are calendar hours: `hourStart(at) = floor(at / 3_600_000) * 3_600_000` (epoch ms); `resetInS(at)` = seconds to the next bucket.
- Config: `BMPL_POINTS_PER_USER_HOUR` optional, default `300`, must be a positive integer when set; `HostedConfig.pointsPerUserHour: number`. The required-variable list (`HOSTED_ENV_VARS`, seven entries) is unchanged.
- `QuotaGate.reserve(user, estimate)` returns `null` (go ahead) or a `QuotaRefusal { error: "quota" | "budget", message, used, limit, resetInS }`: `"quota"` when the user is not an admin and `used + estimate > pointsPerUserHour`; `"budget"` (everyone, admins included) when the meter's last snapshot is still in its window and `limitPerHour − pointsSpentThisHour − estimate < POINTS_FLOOR` (`100`). A missing or expired snapshot never refuses. Nothing is spent on a refusal. `status(user)` → `Quota { used, limit: number | null (null for admins), resetInS }`.
- Route behaviour on a refusal: `429 { ok: false, error: "quota" | "budget", message, used, limit, resetInS }`. Success responses of `POST /api/lookup` and `POST /api/deepdive` in hosted mode carry `pointsSpent` (measured for this request, 0 when nothing was fetched) and `quota` (the user's status after the call); `GET /api/me` carries `quota`. `GET /api/admin/usage` (`auth: "admin"`) → `{ ok, hourStart, resetInS, limitPerUser, instance: RateLimitSnapshot | null, users: [{ userId, discordId, username, role, points }], hours: [{ hourStart, points }] }` (users = current bucket; hours = per-bucket totals of the last 24 h, ascending).
- Cached-first: a history hit (`history.cached`), a cached run report (`store.getWclRun`) or a cached deep-dive (`store.getDeepDive`, not forced) never calls `reserve`. Lookups reserve in two phases: `ESTIMATE_RANKINGS` before the rankings fetch, then `uncachedDisplayedRuns × ESTIMATE_RUN` before enrichment (0 uncached → no second reserve). Deep-dives reserve `ESTIMATE_DEEPDIVE` after the cache check and before the PING.
- In-flight dedupe: identical concurrent lookups (same `cacheKey(request)`, `refresh: false`) share one `performLookup` promise; each caller records the result in its own history; the joiner's response has `fromCache: false` and spends nothing (attribution goes to the request that started the fetch). `refresh: true` never joins but does register its flight.
- Front: `QuotaInfo { used, limit: number | null, resetInS }`; `api.call()` surfaces `message ?? error` so 429s read as sentences in the toast; the header shows the placeholder text "N pts left this hour" (existing classes `.muted`/`.mono`, no new CSS — the design pass is issue #7); Analyze / Analyze all / Re-analyze buttons are disabled when the estimate (`POINTS_PER_RUN = 3` per run) exceeds what is left; admins (limit null) never see the label or a disabled button. Logic lives in pure tested `web/src/lib/quota.ts`; types-only imports from `src/`.
- No new runtime dependencies (root or `web/`). TypeScript strict; English everywhere; 2 spaces, double quotes, trailing commas, `.ts` extensions in imports; `just check` and `bun test` green with `web/dist` absent. **Never spend WCL points in tests**: every WCL call in tests goes through a fake `gql`/`fetchMplus`; no test starts a lookup that could reach the network.
- Commits on `main` in place; messages end (after a blank line) with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`. Stage paths explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`, `web/dist`. Never rewrite history.

## File structure

| File | Responsibility |
|---|---|
| `src/wcl/queries.ts`, `src/mplus.ts` (modify) | `RATE_LIMIT` selection in every query |
| `src/wcl/client.ts` (modify) | `RateLimit` type, `setRateLimitObserver`, `observeRateLimit` after each successful `gql()` |
| `src/wcl/meter.ts` (new) | `PointsMeter` (attribution, window logic, `wrap`), `ESTIMATE_*` constants, `RateLimitSnapshot`, `UsageSink` |
| `src/hosted/schema.ts`, `src/hosted/db.ts` (modify) | `usage_hourly` table; `HostedDb.usage { add, used, byUser, totals }`, `HOUR_MS`, `hourStart` |
| `src/hosted/config.ts` (modify) | `pointsPerUserHour` (`BMPL_POINTS_PER_USER_HOUR`, default 300) |
| `src/hosted/quota.ts` (new) | `QuotaGate`, `Quota`, `QuotaRefusal`, `Reserve`, `POINTS_FLOOR`, `resetInS` |
| `src/hosted/runtime.ts` (modify) | `HostedRuntime.meter`, `.quota`; installs the observer |
| `src/lookup.ts` (modify) | `deps.fetchMplus`, `deps.reserve`, two-phase reserve, 429 outcome |
| `src/server/lookup.ts` (modify) | `runLookupWithCache(opts, history, deps)` with in-flight dedupe + reserve; `handleLookup(req, ctx, runtime)` 429/`pointsSpent`/`quota` |
| `src/deepdive/run.ts`, `src/server/deepdive.ts` (modify) | `RunDeps.reserve`, 429 outcome; `handleDeepdive(req, ctx, runtime)` |
| `src/server/routes-shared.ts`, `src/server.ts` (modify) | `SharedContext.runtime`; `meter.run` around every handler |
| `src/server/routes-auth.ts`, `src/server/routes-admin.ts` (modify) | `/api/me` quota; `GET /api/admin/usage` |
| `web/src/lib/quota.ts` (new), `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/{Header,Detail,DungeonRuns,RunDeepDive}.tsx` (modify) | quota view model, API types, indicator, disabled Analyze |
| `test/wcl/meter.test.ts`, `test/hosted/quota.test.ts`, `test/lookup.test.ts`, `test/server-lookup.test.ts`, `web/src/lib/quota.test.ts` (new); `test/hosted/config.test.ts`, `test/hosted/helpers.ts`, `test/deepdive/run.test.ts`, `test/server-admin.test.ts`, `test/server-user-state.test.ts` (extend) | tests |
| `README.md`, `.env.hosted.example`, `docs/agents/{architecture,workflow,testing}.md`, `AGENTS.md` (modify) | manuals |

---

### Task 1: `rateLimitData` on every query, the observer hook and `PointsMeter`

**Files:**
- Modify: `src/wcl/queries.ts`, `src/mplus.ts:138-160` (`buildMultiEncounterQuery`), `src/wcl/client.ts`
- Create: `src/wcl/meter.ts`
- Test: `test/wcl/meter.test.ts` (new)

**Interfaces:**
- Consumes: `RateLimitData` (`src/wcl/types.ts`), `GqlFn` (`src/signals/enrich.ts`).
- Produces: `RateLimit` = `RateLimitData["rateLimitData"]`, `setRateLimitObserver(fn: ((rl: RateLimit) => void) | null)`, `observeRateLimit(data: unknown)` (`src/wcl/client.ts`); `PointsMeter` with `run<T>(userId: number | null, fn: () => Promise<T>): Promise<T>`, `charge(): RequestCharge | undefined`, `snapshot(): RateLimitSnapshot | null`, `observe(rl: RateLimit): void`, `wrap(gql: GqlFn): GqlFn`; types `RequestCharge { userId: number | null; spent: number }`, `RateLimitSnapshot extends RateLimit { observedAt: number; windowEnd: number }`, `UsageSink { add(userId: number, at: number, points: number): void }`; constants `ESTIMATE_RANKINGS = 10`, `ESTIMATE_RUN = 10`, `ESTIMATE_DEEPDIVE = 3` (`src/wcl/meter.ts`).

- [ ] **Step 1: Write the failing tests `test/wcl/meter.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { ESTIMATE_DEEPDIVE, ESTIMATE_RANKINGS, ESTIMATE_RUN, PointsMeter } from "../../src/wcl/meter.ts";
import type { UsageSink } from "../../src/wcl/meter.ts";

const rl = (spent: number, resetIn = 1800) => ({ limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: resetIn });

function setup(start = 1_000_000) {
  let t = start;
  const adds: Array<[number, number, number]> = [];
  const usage: UsageSink = { add: (userId, at, points) => { adds.push([userId, at, points]); } };
  const meter = new PointsMeter({ usage, now: () => t });
  return { meter, adds, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe("PointsMeter", () => {
  test("estimates are the documented constants", () => {
    expect([ESTIMATE_RANKINGS, ESTIMATE_RUN, ESTIMATE_DEEPDIVE]).toEqual([10, 10, 3]);
  });

  test("the first observation primes; later deltas are charged to the running request and its user", async () => {
    const { meter, adds, now } = setup();
    meter.observe(rl(100));
    expect(adds).toEqual([]);
    expect(meter.snapshot()?.pointsSpentThisHour).toBe(100);
    const spent = await meter.run(7, async () => {
      meter.observe(rl(110));
      meter.observe(rl(112.5));
      return meter.charge()!.spent;
    });
    expect(spent).toBe(12.5);
    expect(adds).toEqual([[7, now(), 10], [7, now(), 2.5]]);
    expect(meter.charge()).toBeUndefined();
  });

  test("an unattributed run (userId null) charges the request but not the usage sink", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    const spent = await meter.run(null, async () => { meter.observe(rl(3)); return meter.charge()!.spent; });
    expect(spent).toBe(3);
    expect(adds).toEqual([]);
  });

  test("observations outside any run update the snapshot without charging anyone", () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    meter.observe(rl(40));
    expect(adds).toEqual([]);
    expect(meter.snapshot()?.pointsSpentThisHour).toBe(40);
  });

  test("concurrent requests are attributed separately", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const a = meter.run(1, async () => { meter.observe(rl(10)); await gate; meter.observe(rl(25)); return meter.charge()!.spent; });
    const b = meter.run(2, async () => { meter.observe(rl(20)); return meter.charge()!.spent; });
    expect(await b).toBe(10);
    release();
    expect(await a).toBe(15); // 10 then 25−20
    expect(adds).toEqual([[1, 1_000_000, 10], [2, 1_000_000, 10], [1, 1_000_000, 5]]);
  });

  test("a late, lower counter in the same window charges nothing and does not lower the baseline", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(50));
    await meter.run(1, async () => {
      meter.observe(rl(45)); // response that started before the 50 one, arriving late
      meter.observe(rl(52));
    });
    expect(adds).toEqual([[1, 1_000_000, 2]]);
    expect(meter.snapshot()?.pointsSpentThisHour).toBe(52);
  });

  test("a new WCL window starts when the previous resetIn has elapsed: the whole counter is new spend", async () => {
    const { meter, adds, tick, now } = setup();
    meter.observe(rl(3000, 60));
    tick(61_000);
    await meter.run(1, async () => { meter.observe(rl(8, 3599)); });
    expect(adds).toEqual([[1, now(), 8]]);
    expect(meter.snapshot()).toEqual({ ...rl(8, 3599), observedAt: now(), windowEnd: now() + 3_599_000 });
  });

  test("charges are rounded to a tenth of a point", async () => {
    const { meter } = setup();
    meter.observe(rl(0));
    const spent = await meter.run(1, async () => { meter.observe(rl(0.1 + 0.2)); meter.observe(rl(0.6)); return meter.charge()!.spent; });
    expect(spent).toBe(0.6);
  });

  test("wrap() observes every response that carries rateLimitData and ignores the others", async () => {
    const { meter, adds } = setup();
    meter.observe(rl(0));
    const fake = async <T,>(query: string) => (query === "ping" ? ({ rateLimitData: rl(4) } as unknown as T) : ({ rateLimitData: rl(9), reportData: {} } as unknown as T));
    const gql = meter.wrap(fake);
    await meter.run(3, async () => {
      expect(await gql<{ rateLimitData: unknown }>("ping")).toEqual({ rateLimitData: rl(4) });
      await gql("deepdive");
      await meter.wrap(async <T,>() => ({ worldData: {} } as T))("zones"); // no rateLimitData → ignored
    });
    expect(adds).toEqual([[3, 1_000_000, 4], [3, 1_000_000, 5]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/wcl/meter.test.ts`
Expected: FAIL — `Cannot find module '../../src/wcl/meter.ts'`.

- [ ] **Step 3: Create `src/wcl/meter.ts`**

```ts
// Points accounting for the shared WCL client (hosted mode). Every WCL query selects
// `rateLimitData`; the meter charges the counter's delta since the previous response of the same
// window to the request that is running (AsyncLocalStorage) and to that request's user.
// Attribution is exact when calls do not overlap and approximate under concurrency (a delta lands
// on whichever request observed it); the hour's total is always exact.
import { AsyncLocalStorage } from "node:async_hooks";
import type { GqlFn } from "../signals/enrich.ts";
import type { RateLimit } from "./client.ts";

/** Estimated cost of one WCL step, checked before spending (WCL only reports after). */
export const ESTIMATE_RANKINGS = 10;
export const ESTIMATE_RUN = 10;
export const ESTIMATE_DEEPDIVE = 3;

export interface RequestCharge { userId: number | null; spent: number }
export interface RateLimitSnapshot extends RateLimit { observedAt: number; windowEnd: number }
export interface UsageSink { add(userId: number, at: number, points: number): void }

const tenths = (n: number): number => Math.round(n * 10) / 10;

export class PointsMeter {
  private readonly als = new AsyncLocalStorage<RequestCharge>();
  private last: RateLimitSnapshot | null = null;

  constructor(private readonly deps: { usage: UsageSink; now?: () => number }) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** Runs `fn` with its WCL spending attributed to `userId` (null = charged to the request only). */
  run<T>(userId: number | null, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ userId, spent: 0 }, fn);
  }

  /** The running request's charge, or undefined outside `run`. */
  charge(): RequestCharge | undefined { return this.als.getStore(); }

  /** The last rateLimitData seen, or null before the first WCL response. */
  snapshot(): RateLimitSnapshot | null { return this.last; }

  /** Feed one response's rateLimitData. The first observation only primes the baseline. */
  observe(rl: RateLimit): void {
    const at = this.now();
    const prev = this.last;
    const next: RateLimitSnapshot = { ...rl, observedAt: at, windowEnd: at + rl.pointsResetIn * 1000 };
    let delta = 0;
    if (prev && at >= prev.windowEnd) {
      delta = rl.pointsSpentThisHour; // a new WCL window: everything on the counter is new spend
    } else if (prev) {
      delta = Math.max(0, rl.pointsSpentThisHour - prev.pointsSpentThisHour);
      // A late response with a lower counter must not lower the baseline (the next one would double-charge).
      if (rl.pointsSpentThisHour < prev.pointsSpentThisHour) { this.last = { ...prev, observedAt: at }; return; }
    }
    this.last = next;
    delta = tenths(delta);
    if (delta <= 0) return;
    const c = this.als.getStore();
    if (!c) return;
    c.spent = tenths(c.spent + delta);
    if (c.userId !== null) this.deps.usage.add(c.userId, at, delta);
  }

  /** A gql function whose responses feed this meter (tests today; per-user clients later). */
  wrap(gql: GqlFn): GqlFn {
    return async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      const data = await gql<T>(query, variables);
      const rl = (data as { rateLimitData?: RateLimit } | null)?.rateLimitData;
      if (rl && typeof rl.pointsSpentThisHour === "number") this.observe(rl);
      return data;
    };
  }
}
```

- [ ] **Step 4: Observer hook in `src/wcl/client.ts`**

Add after the imports:

```ts
import type { RateLimitData } from "./types.ts";

export type RateLimit = RateLimitData["rateLimitData"];
export type RateLimitObserver = (rl: RateLimit) => void;

let observer: RateLimitObserver | null = null;

/** Hosted mode installs its PointsMeter here; local mode and the CLI never observe. */
export const setRateLimitObserver = (fn: RateLimitObserver | null): void => { observer = fn; };

/** Hands a response's `rateLimitData` (if any) to the installed observer. */
export const observeRateLimit = (data: unknown): void => {
  if (!observer) return;
  const rl = (data as { rateLimitData?: RateLimit } | null)?.rateLimitData;
  if (rl && typeof rl.pointsSpentThisHour === "number") observer(rl);
};
```

and in `gql()`, replace the final `return json.data;` with `observeRateLimit(json.data); return json.data;`.

- [ ] **Step 5: `rateLimitData` in every query**

In `src/wcl/queries.ts`, add at the top:

```ts
/** Selected by every query so the hosted meter can account for each call (src/wcl/meter.ts). */
export const RATE_LIMIT = "rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }";
```

Insert `    ${RATE_LIMIT}` as the first line inside the top-level `{` of every `query … {` block that does not already select it: `ZONES_QUERY`, `CHARACTER_ZONE_RANKINGS_QUERY`, `CHARACTER_METRIC_PROBE_QUERY`, `REPORT_RUN_SUMMARY_QUERY`, `REPORT_RUN_SUMMARY_WITH_AVOIDABLE_QUERY`, `CHARACTER_ENCOUNTER_RANKINGS_QUERY`, `CHARACTER_BASIC_QUERY` (the three that already have it — `PING_QUERY`, `REPORT_DEEPDIVE_QUERY`, `REPORT_DEEPDIVE_NO_EVENTS_QUERY` — stay as they are). In `src/mplus.ts`, `buildMultiEncounterQuery` imports `RATE_LIMIT` from `./wcl/queries.ts` and its returned template gets `      ${RATE_LIMIT}` as the first line inside the query body (before `characterData {`). Check: `grep -c "rateLimitData" src/wcl/queries.ts` prints 11 (one constant + ten queries) and `grep -n RATE_LIMIT src/mplus.ts` shows the import and the use.

- [ ] **Step 6: Run the tests, the whole suite and the type check**

Run: `bun test test/wcl/meter.test.ts` → Expected: PASS (9 tests).
Run: `just check && bun test` → Expected: green. `test/deepdive/run.test.ts` classifies a query as "ping" by `q.includes("rateLimitData") && !q.includes("reportData")` — still true. `test/mplus.test.ts` parses fixtures and does not inspect query text.

- [ ] **Step 7: Commit**

```bash
git add src/wcl/queries.ts src/mplus.ts src/wcl/client.ts src/wcl/meter.ts test/wcl/meter.test.ts
git commit -m "feat(wcl): rateLimitData on every query, observer hook and PointsMeter"
```

---

### Task 2: `usage_hourly`, `pointsPerUserHour` config and the `QuotaGate`

**Files:**
- Modify: `src/hosted/schema.ts`, `src/hosted/db.ts`, `src/hosted/config.ts`, `.env.hosted.example`
- Create: `src/hosted/quota.ts`
- Modify: `test/hosted/config.test.ts`, `test/hosted/helpers.ts`
- Test: `test/hosted/quota.test.ts` (new)

**Interfaces:**
- Consumes: `PointsMeter`, `RateLimitSnapshot` (Task 1), `openHosted` repo pattern.
- Produces: `HOUR_MS = 3_600_000`, `hourStart(at)`, `HostedDb.usage { add(userId, at, points): void; used(userId, at): number; byUser(at): Array<{ userId: number; points: number }>; totals(sinceAt: number): Array<{ hourStart: number; points: number }> }` (`src/hosted/db.ts`); `HostedConfig.pointsPerUserHour: number`, `DEFAULT_POINTS_PER_USER_HOUR = 300` (`src/hosted/config.ts`); `QuotaGate`, `Quota { used; limit: number | null; resetInS }`, `QuotaRefusal { error: "quota" | "budget"; message; used; limit; resetInS }`, `QuotaUser { id; role }`, `Reserve = (estimate: number) => QuotaRefusal | null`, `POINTS_FLOOR = 100`, `resetInS(at)` (`src/hosted/quota.ts`).

- [ ] **Step 1: Write the failing tests `test/hosted/quota.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { HOUR_MS, hourStart, openHosted } from "../../src/hosted/db.ts";
import { POINTS_FLOOR, QuotaGate, resetInS } from "../../src/hosted/quota.ts";
import { PointsMeter } from "../../src/wcl/meter.ts";

const T0 = 1_700_000_000_000; // some epoch ms
const rl = (spent: number, resetIn = 1800) => ({ limitPerHour: 3600, pointsSpentThisHour: spent, pointsResetIn: resetIn });

function setup(limit = 300) {
  let t = hourStart(T0) + 600_000; // ten minutes into a bucket
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const member = hosted.users.upsertFromDiscord({ discordId: "100000000000000001", username: "m", globalName: null, avatarHash: null }, "member", 0);
  const admin = hosted.users.upsertFromDiscord({ discordId: "100000000000000002", username: "a", globalName: null, avatarHash: null }, "admin", 0);
  const meter = new PointsMeter({ usage: hosted.usage, now: () => t });
  const gate = new QuotaGate({ usage: hosted.usage, meter, limit, now: () => t });
  return { db, hosted, meter, gate, member, admin, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe("usage repository", () => {
  test("hourStart/resetInS are calendar-hour buckets", () => {
    expect(hourStart(T0)).toBe(Math.floor(T0 / HOUR_MS) * HOUR_MS);
    expect(resetInS(hourStart(T0))).toBe(3600);
    expect(resetInS(hourStart(T0) + HOUR_MS - 1)).toBe(1);
  });
  test("add upserts into the bucket; used/byUser/totals read it back", () => {
    const { hosted, member, admin, now } = setup();
    hosted.usage.add(member.id, now(), 10);
    hosted.usage.add(member.id, now() + 1000, 2.5);
    hosted.usage.add(admin.id, now(), 1);
    hosted.usage.add(member.id, now() - HOUR_MS, 40); // previous bucket
    expect(hosted.usage.used(member.id, now())).toBe(12.5);
    expect(hosted.usage.used(member.id, now() + HOUR_MS)).toBe(0);
    expect(hosted.usage.byUser(now())).toEqual([{ userId: member.id, points: 12.5 }, { userId: admin.id, points: 1 }]);
    expect(hosted.usage.totals(now() - 2 * HOUR_MS)).toEqual([{ hourStart: hourStart(now()) - HOUR_MS, points: 40 }, { hourStart: hourStart(now()), points: 13.5 }]);
  });
  test("deleting the user cascades", () => {
    const { db, hosted, member, now } = setup();
    hosted.usage.add(member.id, now(), 5);
    db.run("DELETE FROM users WHERE id = ?", [member.id]);
    expect(db.query("SELECT COUNT(*) AS n FROM usage_hourly").get()).toEqual({ n: 0 });
  });
});

describe("QuotaGate", () => {
  test("under the limit: go ahead; status reports used/limit/resetInS", () => {
    const { gate, hosted, member, now } = setup();
    hosted.usage.add(member.id, now(), 100);
    expect(gate.reserve(member, 10)).toBeNull();
    expect(gate.status(member)).toEqual({ used: 100, limit: 300, resetInS: resetInS(now()) });
  });
  test("refuses with the quota payload when used + estimate exceeds the limit; nothing is written", () => {
    const { gate, hosted, member, now } = setup();
    hosted.usage.add(member.id, now(), 295);
    expect(gate.reserve(member, 5)).toBeNull();
    const r = gate.reserve(member, 6)!;
    expect(r).toEqual({ error: "quota", message: r.message, used: 295, limit: 300, resetInS: resetInS(now()) });
    expect(r.message).toBe("Hourly quota reached (295/300 pts) — resets in 50 min");
    expect(hosted.usage.used(member.id, now())).toBe(295);
  });
  test("admins have no quota", () => {
    const { gate, hosted, admin, now } = setup();
    hosted.usage.add(admin.id, now(), 5000);
    expect(gate.reserve(admin, 100)).toBeNull();
    expect(gate.status(admin)).toEqual({ used: 5000, limit: null, resetInS: resetInS(now()) });
  });
  test("the quota resets with the calendar hour", () => {
    const { gate, hosted, member, now, tick } = setup();
    hosted.usage.add(member.id, now(), 300);
    expect(gate.reserve(member, 1)?.error).toBe("quota");
    tick(HOUR_MS);
    expect(gate.reserve(member, 1)).toBeNull();
    expect(gate.status(member).used).toBe(0);
  });
  test("the shared floor refuses everyone, admins included, while the meter's window is current", () => {
    const { gate, meter, member, admin, now } = setup();
    meter.observe(rl(3600 - POINTS_FLOOR - 5, 900));
    expect(gate.reserve(member, 5)).toBeNull();
    const r = gate.reserve(member, 6)!;
    expect(r.error).toBe("budget");
    expect(r).toEqual({ error: "budget", message: "The shared WCL budget is nearly exhausted (105 pts left) — resets in 15 min", used: 3495, limit: 3600, resetInS: 900 });
    expect(gate.reserve(admin, 6)?.error).toBe("budget");
    expect(now()).toBeGreaterThan(0);
  });
  test("an expired snapshot never refuses; a quota refusal wins over the floor", () => {
    const { gate, meter, hosted, member, tick, now } = setup();
    meter.observe(rl(3590, 60));
    tick(61_000);
    expect(gate.reserve(member, 50)).toBeNull();
    meter.observe(rl(3590, 3000));
    hosted.usage.add(member.id, now(), 300);
    expect(gate.reserve(member, 50)?.error).toBe("quota");
  });
  test("for(user) binds a Reserve", () => {
    const { gate, hosted, member, now } = setup(20);
    const reserve = gate.for(member);
    expect(reserve(20)).toBeNull();
    hosted.usage.add(member.id, now(), 15);
    expect(reserve(6)?.error).toBe("quota");
  });
});
```

Run: `bun test test/hosted/quota.test.ts` → Expected: FAIL (module not found / `hosted.usage` undefined).

- [ ] **Step 2: Schema and repository**

`src/hosted/schema.ts` — append inside `HOSTED_SCHEMA` after the `user_settings` table:

```sql
CREATE TABLE IF NOT EXISTS usage_hourly (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hour_start INTEGER NOT NULL,
  points     REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, hour_start)
);
CREATE INDEX IF NOT EXISTS usage_hourly_hour ON usage_hourly(hour_start);
```

`src/hosted/db.ts` — add after `DEFAULT_USER_SETTINGS`:

```ts
/** WCL usage buckets are calendar hours (epoch ms). */
export const HOUR_MS = 3_600_000;
export const hourStart = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS;
```

`HostedDb` gains (after `settings`):

```ts
  usage: {
    /** Adds `points` to the user's bucket of `at`. */
    add(userId: number, at: number, points: number): void;
    used(userId: number, at: number): number;
    /** Every user's points in the bucket of `at`, largest first. */
    byUser(at: number): Array<{ userId: number; points: number }>;
    /** Per-bucket totals from the bucket of `sinceAt` on, ascending. */
    totals(sinceAt: number): Array<{ hourStart: number; points: number }>;
  };
```

Prepared statements and the member:

```ts
  const usageAdd = db.query("INSERT INTO usage_hourly (user_id, hour_start, points) VALUES (?, ?, ?) ON CONFLICT(user_id, hour_start) DO UPDATE SET points = points + excluded.points");
  const usageUsed = db.query<{ points: number } | null, [number, number]>("SELECT points FROM usage_hourly WHERE user_id = ? AND hour_start = ?");
  const usageByUser = db.query<{ user_id: number; points: number }, [number]>("SELECT user_id, points FROM usage_hourly WHERE hour_start = ? ORDER BY points DESC, user_id");
  const usageTotals = db.query<{ hour_start: number; points: number }, [number]>("SELECT hour_start, SUM(points) AS points FROM usage_hourly WHERE hour_start >= ? GROUP BY hour_start ORDER BY hour_start");
  …
    usage: {
      add(userId, at, points) { usageAdd.run(userId, hourStart(at), points); },
      used: (userId, at) => usageUsed.get(userId, hourStart(at))?.points ?? 0,
      byUser: (at) => usageByUser.all(hourStart(at)).map((r) => ({ userId: r.user_id, points: r.points })),
      totals: (sinceAt) => usageTotals.all(hourStart(sinceAt)).map((r) => ({ hourStart: r.hour_start, points: r.points })),
    },
```

- [ ] **Step 3: Config**

`src/hosted/config.ts`: add `export const DEFAULT_POINTS_PER_USER_HOUR = 300;`, the field `/** Per-member WCL points per calendar hour (admins are exempt). */ pointsPerUserHour: number;` to `HostedConfig`, and in `validateHostedEnv` before the `if (missing.length > 0 || invalid.length > 0)` line:

```ts
  const rawPoints = read(env, "BMPL_POINTS_PER_USER_HOUR");
  const pointsPerUserHour = rawPoints === "" ? DEFAULT_POINTS_PER_USER_HOUR : Number(rawPoints);
  if (!(Number.isInteger(pointsPerUserHour) && pointsPerUserHour > 0)) invalid.push(`BMPL_POINTS_PER_USER_HOUR: a positive integer (got "${rawPoints}")`);
```

and `pointsPerUserHour,` in the returned config. `.env.hosted.example`: add after the WCL lines `# Optional: WCL points each member may spend per hour (default 300; admins are exempt).` and `BMPL_POINTS_PER_USER_HOUR=300`.

`test/hosted/config.test.ts` — in "full env is ok and parsed" add `expect(r.config.pointsPerUserHour).toBe(300);`; add:

```ts
  test("BMPL_POINTS_PER_USER_HOUR overrides the default and must be a positive integer", () => {
    const ok = validateHostedEnv({ ...FULL, BMPL_POINTS_PER_USER_HOUR: "500" });
    expect(ok.ok && ok.config.pointsPerUserHour).toBe(500);
    for (const bad of ["0", "-1", "12.5", "lots"]) {
      const r = validateHostedEnv({ ...FULL, BMPL_POINTS_PER_USER_HOUR: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.invalid).toEqual([`BMPL_POINTS_PER_USER_HOUR: a positive integer (got "${bad}")`]);
    }
  });
```

`test/hosted/helpers.ts`: `TEST_HOSTED_CONFIG` gains `pointsPerUserHour: 300,`.

- [ ] **Step 4: Create `src/hosted/quota.ts`**

```ts
// Per-member hourly WCL quota plus a global floor for the shared client. Pure over the usage
// repository and the meter's last snapshot; `reserve` is consulted before spending and never writes.
import type { PointsMeter } from "../wcl/meter.ts";
import { HOUR_MS, hourStart } from "./db.ts";
import type { HostedDb, Role } from "./db.ts";

/** The shared client is never driven below this many points left, so cached lookups keep working for everyone. */
export const POINTS_FLOOR = 100;

export interface Quota { used: number; limit: number | null; resetInS: number }
export interface QuotaRefusal { error: "quota" | "budget"; message: string; used: number; limit: number; resetInS: number }
export interface QuotaUser { id: number; role: Role }
export type Reserve = (estimate: number) => QuotaRefusal | null;

export const resetInS = (at: number): number => Math.ceil((hourStart(at) + HOUR_MS - at) / 1000);
const minutes = (s: number): string => `${Math.ceil(s / 60)} min`;

export class QuotaGate {
  constructor(private readonly deps: { usage: HostedDb["usage"]; meter: PointsMeter; limit: number; now?: () => number }) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  status(user: QuotaUser): Quota {
    const at = this.now();
    return { used: this.deps.usage.used(user.id, at), limit: user.role === "admin" ? null : this.deps.limit, resetInS: resetInS(at) };
  }

  /** null = go ahead; otherwise why the estimated spend is refused. Nothing is spent either way. */
  reserve(user: QuotaUser, estimate: number): QuotaRefusal | null {
    const at = this.now();
    if (user.role !== "admin") {
      const used = this.deps.usage.used(user.id, at);
      if (used + estimate > this.deps.limit) {
        const r = resetInS(at);
        return { error: "quota", message: `Hourly quota reached (${Math.round(used)}/${this.deps.limit} pts) — resets in ${minutes(r)}`, used, limit: this.deps.limit, resetInS: r };
      }
    }
    const snap = this.deps.meter.snapshot();
    if (snap && at < snap.windowEnd) {
      const left = snap.limitPerHour - snap.pointsSpentThisHour;
      if (left - estimate < POINTS_FLOOR) {
        const r = Math.max(1, Math.ceil((snap.windowEnd - at) / 1000));
        return { error: "budget", message: `The shared WCL budget is nearly exhausted (${Math.round(left)} pts left) — resets in ${minutes(r)}`, used: snap.pointsSpentThisHour, limit: snap.limitPerHour, resetInS: r };
      }
    }
    return null;
  }

  /** Bound to one user, for the lookup and deep-dive code paths. */
  for(user: QuotaUser): Reserve { return (estimate) => this.reserve(user, estimate); }
}
```

- [ ] **Step 5: Run, check, commit**

Run: `bun test test/hosted/quota.test.ts test/hosted/config.test.ts` → Expected: PASS (quota 11 tests). Run: `just check && bun test` → green.

```bash
git add src/hosted/schema.ts src/hosted/db.ts src/hosted/config.ts src/hosted/quota.ts .env.hosted.example test/hosted/quota.test.ts test/hosted/config.test.ts test/hosted/helpers.ts
git commit -m "feat(hosted): usage_hourly, BMPL_POINTS_PER_USER_HOUR and the QuotaGate"
```

---

### Task 3: Lookups — two-phase reserve, in-flight dedupe, `pointsSpent` and `quota` on `/api/lookup`

**Files:**
- Modify: `src/lookup.ts`, `src/server/lookup.ts`, `src/hosted/runtime.ts`, `src/server/routes-shared.ts`, `src/server.ts`
- Test: `test/lookup.test.ts` (new), `test/server-lookup.test.ts` (new)

**Interfaces:**
- Consumes: `PointsMeter`, `ESTIMATE_RANKINGS`, `ESTIMATE_RUN`, `setRateLimitObserver` (Task 1); `QuotaGate`, `Reserve`, `QuotaRefusal` (Task 2); `cacheKey`, `HistoryStore` (`src/server-history.ts`); `fetchMplusData`, `MPlusData` (`src/mplus.ts`).
- Produces: `performLookup(opts, deps)` with `deps.fetchMplus?: typeof fetchMplusData` and `deps.reserve?: Reserve`; `LookupOutcome` error variant `{ ok: false; status: 404 | 429; error: string; quota?: QuotaRefusal }`; `HostedRuntime.meter: PointsMeter`, `HostedRuntime.quota: QuotaGate`; `runLookupWithCache(opts, history, deps?: LookupDeps)` with `LookupDeps { reserve?: Reserve; performLookup?: typeof performLookup }`, `LookupSuccess.joined: boolean`, `LookupError.quota?: QuotaRefusal`; `handleLookup(req, ctx, runtime: HostedRuntime | null)`; `SharedContext { hosted, envPath, runtime: HostedRuntime | null }`.

- [ ] **Step 1: Write the failing `performLookup` tests `test/lookup.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { performLookup } from "../src/lookup.ts";
import type { MPlusData, MPlusRun } from "../src/mplus.ts";
import { openStore } from "../src/signals/store.ts";
import { ESTIMATE_RANKINGS, ESTIMATE_RUN } from "../src/wcl/meter.ts";
import type { QuotaRefusal } from "../src/hosted/quota.ts";
import { loadWclFixture } from "./fixtures.ts";

const REFUSED: QuotaRefusal = { error: "quota", message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };

/** Two displayed runs (two dungeons): the fixture's, cached in the store, and a second one that is not. */
async function fixture() {
  const f = await loadWclFixture("s2-healer");
  const cached: MPlusRun = { ...f.run };
  const uncached: MPlusRun = { ...f.run, reportCode: "OTHERCODE", fightID: 7, encounterID: f.run.encounterID + 1, encounterName: "Other Dungeon" };
  const data: MPlusData = {
    zoneID: 1, zoneName: "z", partition: 1, metric: "hps", metricAutoSelected: true, alternateMetricHasData: false,
    character: { id: 1, name: f.character, classID: 6, spec: "Holy", scoreTop: null },
    runs: [cached, uncached],
    seasonDungeons: [{ id: cached.encounterID, name: cached.encounterName }, { id: uncached.encounterID, name: uncached.encounterName }],
    specFilter: null,
  };
  const store = openStore(":memory:");
  store.putWclRun(cached.reportCode, cached.fightID, f.report);
  const gqlCalls: string[] = [];
  const gql = async <T,>(_q: string, vars?: Record<string, unknown>) => { gqlCalls.push(String(vars?.code)); return { reportData: { report: f.report } } as T; };
  const fetchFn = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  let fetches = 0;
  const fetchMplus = async () => { fetches++; return data; };
  return { store, gql, gqlCalls, fetchFn, fetchMplus, fetches: () => fetches, name: f.character as string };
}

const opts = (name: string) => ({ name, realm: "Hyjal", level: null, spec: null, enrich: true });

describe("performLookup — quota reservations", () => {
  test("reserves the rankings, then one run's worth per uncached displayed run", async () => {
    const x = await fixture();
    const estimates: number[] = [];
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: (e) => { estimates.push(e); return null; } });
    expect(o.ok).toBe(true);
    expect(estimates).toEqual([ESTIMATE_RANKINGS, ESTIMATE_RUN]);
    expect(x.gqlCalls).toEqual(["OTHERCODE"]);
    x.store.close();
  });
  test("a refusal before the rankings fetches nothing", async () => {
    const x = await fixture();
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: () => REFUSED });
    expect(o).toEqual({ ok: false, status: 429, error: REFUSED.message, quota: REFUSED });
    expect(x.fetches()).toBe(0);
    expect(x.gqlCalls).toEqual([]);
    x.store.close();
  });
  test("a refusal before enrichment fails the lookup without fetching any run", async () => {
    const x = await fixture();
    let n = 0;
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: () => (++n === 2 ? REFUSED : null) });
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.status).toBe(429);
    expect(x.fetches()).toBe(1);
    expect(x.gqlCalls).toEqual([]);
    x.store.close();
  });
  test("no second reservation when every displayed run is cached; none at all without a gate", async () => {
    const x = await fixture();
    x.store.putWclRun("OTHERCODE", 7, (await loadWclFixture("s2-healer")).report);
    const estimates: number[] = [];
    await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus, reserve: (e) => { estimates.push(e); return null; } });
    expect(estimates).toEqual([ESTIMATE_RANKINGS]);
    const o = await performLookup(opts(x.name), { store: x.store, gql: x.gql, fetchFn: x.fetchFn, fetchMplus: x.fetchMplus });
    expect(o.ok).toBe(true);
    expect(x.gqlCalls).toEqual([]);
    x.store.close();
  });
});
```

Run: `bun test test/lookup.test.ts` → Expected: FAIL (type errors on `fetchMplus`/`reserve`, `quota` missing).

- [ ] **Step 2: `src/lookup.ts`**

Imports: add `import { fetchMplusData } from "./mplus.ts";` if not already imported by that name (it is used today — keep it), `import { ESTIMATE_RANKINGS, ESTIMATE_RUN } from "./wcl/meter.ts";`, `import type { QuotaRefusal, Reserve } from "./hosted/quota.ts";`. `Deps` gains:

```ts
  /** Test hook: replaces the rankings fetch (`fetchMplusData`). */
  fetchMplus?: typeof fetchMplusData;
  /** Hosted quota gate: consulted with an estimate before each WCL step; absent locally. */
  reserve?: Reserve;
```

`LookupOutcome`'s error variant becomes `| { ok: false; status: 404 | 429; error: string; quota?: QuotaRefusal }`. In `performLookup`, replace the first statement after `const store = …` with:

```ts
  const refusedRankings = deps.reserve?.(ESTIMATE_RANKINGS);
  if (refusedRankings) return { ok: false, status: 429, error: refusedRankings.message, quota: refusedRankings };
  let data = await (deps.fetchMplus ?? fetchMplusData)(opts.name, opts.realm, {
    metric: opts.metric,
    specFilter: opts.spec,
  });
```

After `const result = analyzeLookup(...)`, compute `const shown = displayedRuns(result);` once (delete the later duplicate `const shown = displayedRuns(result);`) and insert before the `Promise.all`:

```ts
  if (opts.enrich && deps.reserve) {
    const uncached = new Set(shown.filter((r) => !store.getWclRun(r.reportCode, r.fightID)).map((r) => `${r.reportCode}:${r.fightID}`)).size;
    const refusedRuns = uncached > 0 ? deps.reserve(uncached * ESTIMATE_RUN) : null;
    if (refusedRuns) return { ok: false, status: 429, error: refusedRuns.message, quota: refusedRuns };
  }
```

and pass `shown` to `enrichRuns(shown, …)`.

Run: `bun test test/lookup.test.ts` → Expected: PASS (4 tests).

- [ ] **Step 3: Runtime and server wiring**

`src/hosted/runtime.ts`:

```ts
import { setRateLimitObserver } from "../wcl/client.ts";
import { PointsMeter } from "../wcl/meter.ts";
import { QuotaGate } from "./quota.ts";

export interface HostedRuntime { config: HostedConfig; db: HostedDb; states: OAuthStates; fetchFn: typeof fetch; secure: boolean; meter: PointsMeter; quota: QuotaGate }
```

and in `createHostedRuntime`, after `db: openHosted(db)` is available:

```ts
  const hostedDb = openHosted(db);
  const meter = new PointsMeter({ usage: hostedDb.usage });
  const runtime: HostedRuntime = { config, db: hostedDb, states: new OAuthStates(), fetchFn, secure: …, meter, quota: new QuotaGate({ usage: hostedDb.usage, meter, limit: config.pointsPerUserHour }) };
  // Every WCL response of this process now feeds the meter (the CLI and local mode never install one).
  setRateLimitObserver((rl) => meter.observe(rl));
```

`src/server/routes-shared.ts`: `export interface SharedContext { hosted: boolean; envPath: string; runtime: HostedRuntime | null }` (`import type { HostedRuntime } from "../hosted/runtime.ts";`); `route("POST", "/api/lookup", (req, _url, rc) => handleLookup(req, rc, ctx.runtime))`. `src/server.ts`: `sharedRoutes({ hosted, envPath: envPathHint, runtime })` — move the `runtime` creation above the `routes` array (it already is) — and the handler call becomes:

```ts
      const gate = authGate(r, ctx);
      if (gate) return gate;
      // Hosted: every WCL point spent while this handler runs is charged to the session user.
      return runtime ? await runtime.meter.run(ctx.user?.id ?? null, () => Promise.resolve(r.handle(req, url, ctx))) : await r.handle(req, url, ctx);
```

- [ ] **Step 4: `src/server/lookup.ts`**

Replace the types and function with:

```ts
export interface LookupError { ok: false; error: string; status: number; quota?: QuotaRefusal }
export interface LookupSuccess { ok: true; key: string; result: unknown; fromCache: boolean; /** Shared another caller's in-flight fetch of the same request. */ joined: boolean }
export interface LookupDeps { reserve?: Reserve; performLookup?: typeof performLookup }

// Identical lookups that overlap share one WCL fetch (keyed like the history, "auto" level included).
const inflight = new Map<string, Promise<LookupOutcome>>();

export async function runLookupWithCache(opts: {…unchanged…}, history: HistoryStore, deps: LookupDeps = {}): Promise<LookupSuccess | LookupError> {
  …credentials / parse / cache-hit unchanged, the hit returns `{ …, joined: false }`…
  try {
    const flightKey = cacheKey(request);
    let flight = opts.refresh ? undefined : inflight.get(flightKey);
    const joined = flight !== undefined;
    if (!flight) {
      flight = (deps.performLookup ?? performLookup)({ name: target.name, realm: target.realm, level: opts.level, spec: opts.spec, metric: opts.metric ?? undefined, enrich: true, refresh: opts.refresh }, { reserve: deps.reserve });
      inflight.set(flightKey, flight);
      const started = flight;
      void started.catch(() => {}).finally(() => { if (inflight.get(flightKey) === started) inflight.delete(flightKey); });
    }
    const o = await flight;
    if (!o.ok) return { ok: false, status: o.status, error: o.error, ...(o.quota ? { quota: o.quota } : {}) };
    …buildLookupPayload + history.record unchanged…
    return { ok: true, key: entry.key, result: payload, fromCache: false, joined };
  } catch (e) { …unchanged… }
}
```

with imports `import { cacheKey } from "../server-history.ts";`, `import type { LookupOutcome } from "../lookup.ts";`, `import type { HostedRuntime } from "../hosted/runtime.ts";`, `import type { QuotaRefusal, Reserve } from "../hosted/quota.ts";`. `handleLookup` becomes:

```ts
export async function handleLookup(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  …body parsing unchanged…
  const user = runtime && ctx.user ? { id: ctx.user.id, role: ctx.user.role } : null;
  const result = await runLookupWithCache({ … }, historyOf(ctx), { reserve: runtime && user ? runtime.quota.for(user) : undefined });
  if (!result.ok) return jsonResponse(result.quota ? { ok: false, ...result.quota } : { ok: false, error: result.error }, result.status);
  const payload = result.fromCache && ctx.hosted ? await withCachedAnalyses(result.result as LookupPayload) : result.result;
  const accounting = runtime && user ? { pointsSpent: runtime.meter.charge()?.spent ?? 0, quota: runtime.quota.status(user) } : {};
  return jsonResponse({ ok: true, result: payload, key: result.key, fromCache: result.fromCache, ...accounting });
}
```

`src/server/watcher.ts` keeps `runLookupWithCache({ … }, localHistory)` (deps default).

- [ ] **Step 5: Write the failing `runLookupWithCache` tests `test/server-lookup.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LookupOutcome } from "../src/lookup.ts";
import { History } from "../src/server-history.ts";
import { runLookupWithCache } from "../src/server/lookup.ts";
import { payloadWith } from "./evaluation/helpers.ts";

const saved = { id: process.env.WCL_CLIENT_ID, secret: process.env.WCL_CLIENT_SECRET };
beforeAll(() => { process.env.WCL_CLIENT_ID = "bmpl-test"; process.env.WCL_CLIENT_SECRET = "bmpl-test"; });
afterAll(() => {
  if (saved.id === undefined) delete process.env.WCL_CLIENT_ID; else process.env.WCL_CLIENT_ID = saved.id;
  if (saved.secret === undefined) delete process.env.WCL_CLIENT_SECRET; else process.env.WCL_CLIENT_SECRET = saved.secret;
});

/** A successful outcome with the fields buildLookupPayload/history.record read. */
const outcome = (): Extract<LookupOutcome, { ok: true }> => {
  const p = payloadWith([], { targetLevel: 18 });
  return {
    ok: true,
    data: { zoneID: 1, zoneName: "z", partition: 1, metric: "dps", metricAutoSelected: true, alternateMetricHasData: false, character: { id: 1, name: "Muleyoxo", classID: 7, spec: "Holy", scoreTop: null }, runs: [], seasonDungeons: [], specFilter: null },
    result: { targetLevel: 18, targetAutoDetected: false, atOrAboveTarget: [], prevLevelBest: null, perDungeon: p.perDungeon },
    rio: null, summary: p.summary, evaluation: { role: "dps", targetLevel: 18, axes: [], global: null, verdict: "insufficient data", runsUsed: 0, analyzedRuns: 0, configVersion: "test" },
    deepdive: [], deepdiveSummary: { tableWarning: null, analyzedRuns: 0, majorUsage: null, avoidableDeathShare: null, avoidableDeaths: 0, countedDeaths: 0 },
  } as unknown as Extract<LookupOutcome, { ok: true }>;
};
const opts = (refresh = false) => ({ character: "Muleyoxo-Silvermoon", level: 18, spec: null, metric: null, refresh });

describe("runLookupWithCache — in-flight dedupe", () => {
  test("overlapping identical lookups share one fetch; each caller records its own history", async () => {
    let calls = 0;
    let release: (o: LookupOutcome) => void = () => {};
    const performLookup = (async () => { calls++; return new Promise<LookupOutcome>((r) => { release = r; }); }) as unknown as typeof import("../src/lookup.ts").performLookup;
    const a = new History(5); const b = new History(5);
    const pa = runLookupWithCache(opts(), a, { performLookup });
    const pb = runLookupWithCache(opts(), b, { performLookup });
    await Promise.resolve();
    release(outcome());
    const [ra, rb] = await Promise.all([pa, pb]);
    expect(calls).toBe(1);
    expect(ra.ok && rb.ok && ra.key === rb.key).toBe(true);
    if (ra.ok && rb.ok) { expect(ra.joined).toBe(false); expect(rb.joined).toBe(true); expect(rb.fromCache).toBe(false); }
    expect(a.size).toBe(1); expect(b.size).toBe(1);
    const again = await runLookupWithCache(opts(), new History(5), { performLookup });
    expect(calls).toBe(2); // the flight is gone once settled
    expect(again.ok).toBe(true);
  });
  test("refresh never joins a flight; a 429 outcome keeps its quota payload", async () => {
    let calls = 0;
    let release: (o: LookupOutcome) => void = () => {};
    const performLookup = (async () => { calls++; return new Promise<LookupOutcome>((r) => { release = r; }); }) as unknown as typeof import("../src/lookup.ts").performLookup;
    const h = new History(5);
    const first = runLookupWithCache(opts(), h, { performLookup });
    const second = runLookupWithCache(opts(true), h, { performLookup });
    expect(calls).toBe(2);
    const refusal = { error: "quota" as const, message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };
    release({ ok: false, status: 429, error: refusal.message, quota: refusal });
    const r = await second;
    expect(r).toEqual({ ok: false, status: 429, error: refusal.message, quota: refusal });
    void first;
  });
});
```

Run: `bun test test/server-lookup.test.ts` → Expected: PASS after Step 4 (write it before Step 4 if you prefer strict TDD; the file fails on the missing `deps` parameter until then). If the second test's `release` only resolves the *last* started flight, resolve both by capturing releases in an array — the assertion is on `second`.

- [ ] **Step 6: Run everything, commit**

Run: `just check && bun test` → green (the hosted `server-user-state` lookup tests still hit the history cache and never reach `reserve`).

```bash
git add src/lookup.ts src/server/lookup.ts src/hosted/runtime.ts src/server/routes-shared.ts src/server.ts test/lookup.test.ts test/server-lookup.test.ts
git commit -m "feat(server): quota reservations, in-flight lookup dedupe and points accounting on /api/lookup"
```

---

### Task 4: Deep-dive reservations, `/api/me` quota, `GET /api/admin/usage`

**Files:**
- Modify: `src/deepdive/run.ts`, `src/server/deepdive.ts`, `src/server/routes-shared.ts`, `src/server/routes-auth.ts`, `src/server/routes-admin.ts`
- Test: `test/deepdive/run.test.ts`, `test/server-admin.test.ts`, `test/server-user-state.test.ts` (extend)

**Interfaces:**
- Consumes: `Reserve`, `QuotaRefusal`, `QuotaGate.status`, `resetInS` (Task 2); `ESTIMATE_DEEPDIVE`, `PointsMeter.snapshot/charge` (Task 1); `HostedRuntime.meter/quota`, `SharedContext.runtime` (Task 3); `HOUR_MS`, `hourStart`, `HostedDb.usage` (Task 2).
- Produces: `RunDeps.reserve?: Reserve`; `DeepdiveOutcome` error variant `{ ok: false; status: 402 | 404 | 429 | 502; error: string; quota?: QuotaRefusal }`; `handleDeepdive(req, ctx, runtime: HostedRuntime | null)`; `/api/me` → `user` + `quota: Quota`; `GET /api/admin/usage`.

- [ ] **Step 1: Failing test in `test/deepdive/run.test.ts`**

Append inside the `describe("runDeepdive")` block:

```ts
  test("the quota gate is consulted after the cache check and before the PING; a refusal spends nothing", async () => {
    const store = openStore(":memory:");
    const f = await loadDeepdiveFixture("s2-healer");
    store.putWclRun(f.run.reportCode, f.run.fightID, f.report);
    const req = { reportCode: f.run.reportCode as string, fightID: f.run.fightID as number, character: f.character as string };
    let calls = 0;
    const gql = async <T,>() => { calls++; return ping(0) as T; };
    const refusal = { error: "quota" as const, message: "Hourly quota reached (300/300 pts) — resets in 5 min", used: 300, limit: 300, resetInS: 300 };
    const estimates: number[] = [];
    const r = await runDeepdive(req, { store, tables, gql, reserve: (e) => { estimates.push(e); return refusal; } });
    expect(r).toEqual({ ok: false, status: 429, error: refusal.message, quota: refusal });
    expect(estimates).toEqual([3]);
    expect(calls).toBe(0);
    store.putDeepDive(req.reportCode, req.fightID, req.character, f.deepdive);
    const cached = await runDeepdive(req, { store, tables, gql, reserve: () => { throw new Error("must not be consulted for a cached analysis"); } });
    expect(cached.ok && cached.fromCache).toBe(true);
    store.close();
  });
```

Run: `bun test test/deepdive/run.test.ts` → Expected: FAIL (`reserve` not a known dep; outcome has no `quota`).

- [ ] **Step 2: `src/deepdive/run.ts`**

Imports: `import { ESTIMATE_DEEPDIVE } from "../wcl/meter.ts";`, `import type { QuotaRefusal, Reserve } from "../hosted/quota.ts";`. `RunDeps` gains `/** Hosted quota gate; absent locally. */ reserve?: Reserve`. The outcome type: `| { ok: false; status: 402 | 404 | 429 | 502; error: string; quota?: QuotaRefusal }`. Between the cached-result block and `try {`:

```ts
  const refused = deps.reserve?.(ESTIMATE_DEEPDIVE);
  if (refused) return { ok: false, status: 429, error: refused.message, quota: refused };
```

Run: `bun test test/deepdive/run.test.ts` → PASS.

- [ ] **Step 3: `src/server/deepdive.ts` and the route**

```ts
export async function handleDeepdive(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  …body/credential checks unchanged…
  const user = runtime && ctx.user ? { id: ctx.user.id, role: ctx.user.role } : null;
  const [store, tables] = await Promise.all([getStore(), getDefensives()]);
  const r = await runDeepdive({ … }, { store, tables, reserve: runtime && user ? runtime.quota.for(user) : undefined });
  if (!r.ok) return jsonResponse(r.quota ? { ok: false, ...r.quota } : { ok: false, error: r.error }, r.status);
  if (!ctx.hosted) await refreshLocalHistory();
  // Hosted: the measured charge of this request replaces the PING-delta estimate.
  const accounting = runtime && user ? { pointsSpent: runtime.meter.charge()?.spent ?? 0, quota: runtime.quota.status(user) } : { pointsSpent: r.pointsSpent };
  return jsonResponse({ ok: true, result: r.result, fromCache: r.fromCache, ...accounting });
}
```

(`import type { HostedRuntime } from "../hosted/runtime.ts";`). `routes-shared.ts`: `route("POST", "/api/deepdive", (req, _url, rc) => handleDeepdive(req, rc, ctx.runtime))`.

- [ ] **Step 4: `/api/me` and `/api/admin/usage`**

`src/server/routes-auth.ts`, the `/api/me` handler: `const res = jsonResponse({ ok: true, user: meUser(ctx.user!), quota: rt.quota.status({ id: ctx.user!.id, role: ctx.user!.role }) });`.

`src/server/routes-admin.ts`: imports `import { HOUR_MS, hourStart } from "../hosted/db.ts";` and `import { resetInS } from "../hosted/quota.ts";`; add before the users route:

```ts
    // Budget gauge for the admin page (issue #8): this hour per member, the shared client's last
    // rateLimitData, and the last 24 hourly totals.
    route("GET", "/api/admin/usage", (_req, _url, ctx) => {
      const at = ctx.now;
      const users = new Map(rt.db.users.list().map((u) => [u.id, u]));
      return jsonResponse({
        ok: true,
        hourStart: hourStart(at),
        resetInS: resetInS(at),
        limitPerUser: rt.config.pointsPerUserHour,
        instance: rt.meter.snapshot(),
        users: rt.db.usage.byUser(at).map((r) => {
          const u = users.get(r.userId);
          return { userId: r.userId, discordId: u?.discordId ?? null, username: u?.username ?? null, role: u?.role ?? null, points: r.points };
        }),
        hours: rt.db.usage.totals(at - 24 * HOUR_MS),
      });
    }, "admin"),
```

- [ ] **Step 5: Route tests**

`test/server-admin.test.ts` — append a describe (the file already has `admin`, `member` logins and a `db` handle; add `import { hourStart } from "../src/hosted/db.ts";`):

```ts
describe("GET /api/admin/usage", () => {
  test("members are refused; admins get the gauge data", async () => {
    expect((await fetch(url("/api/admin/usage"), { headers: { cookie: member.cookie } })).status).toBe(403);
    db.usage.add(member.user.id, Date.now(), 12.5);
    const res = await fetch(url("/api/admin/usage"), { headers: { cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.limitPerUser).toBe(300);
    expect(body.hourStart).toBe(hourStart(Date.now()));
    expect(body.resetInS).toBeGreaterThan(0);
    expect(body.instance).toBeNull(); // no WCL call has been observed in this process
    expect(body.users).toEqual([{ userId: member.user.id, discordId: member.user.discordId, username: member.user.username, role: "member", points: 12.5 }]);
    expect(body.hours).toEqual([{ hourStart: hourStart(Date.now()), points: 12.5 }]);
  });
});
```

(`url` is whatever helper the file uses to build `http://localhost:<port>…` — reuse its name.) In the same file's `/api/me`-style coverage (or `test/server-user-state.test.ts` where users `a`/`b` exist), add:

```ts
  test("/api/me carries the quota: members have a limit, admins do not", async () => {
    const me = await (await fetch(h("/api/me"), as(a))).json();
    expect(me.quota).toEqual({ used: 0, limit: 300, resetInS: me.quota.resetInS });
    expect(me.quota.resetInS).toBeGreaterThan(0);
  });
```

in `test/server-user-state.test.ts` (member), and in `test/server-admin.test.ts`:

```ts
  test("/api/me for an admin has limit null", async () => {
    const me = await (await fetch(url("/api/me"), { headers: { cookie: admin.cookie } })).json();
    expect(me.quota.limit).toBeNull();
  });
```

Run: `bun test test/server-admin.test.ts test/server-user-state.test.ts test/deepdive` → PASS. Then `just check && bun test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/deepdive/run.ts src/server/deepdive.ts src/server/routes-shared.ts src/server/routes-auth.ts src/server/routes-admin.ts test/deepdive/run.test.ts test/server-admin.test.ts test/server-user-state.test.ts
git commit -m "feat(hosted): deep-dive quota reservation, quota on /api/me and GET /api/admin/usage"
```

---

### Task 5: Front — quota indicator, readable 429s, Analyze disabled when unaffordable

**Files:**
- Create: `web/src/lib/quota.ts`, `web/src/lib/quota.test.ts`
- Modify: `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/Header.tsx`, `web/src/components/Detail.tsx`, `web/src/components/DungeonRuns.tsx`, `web/src/components/RunDeepDive.tsx`

**Interfaces:**
- Consumes: `/api/me` `quota`, lookup/deep-dive `pointsSpent`/`quota` (Tasks 3–4); `POINTS_PER_RUN`, `unanalyzedRuns` (`web/src/lib/deepdive.ts`); `DeepdiveActions` (`web/src/components/Detail.tsx`).
- Produces: `QuotaInfo { used: number; limit: number | null; resetInS: number }` (`web/src/api.ts`); `pointsLeft(q)`, `quotaLabel(q)`, `canAfford(q, points)` (`web/src/lib/quota.ts`); `DeepdiveActions.canAfford: (runs: number) => boolean`; `Header` prop `quotaLabel: string | null`.

Visible change: one text label in the header ("N pts left this hour", `.muted.mono`) and disabled Analyze buttons with a title. Placeholder styling with existing classes only; the design pass is issue #7 (Claude Design canvas) — same approach as the #3 sign-in placeholder.

- [ ] **Step 1: Failing view-model tests `web/src/lib/quota.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { canAfford, pointsLeft, quotaLabel } from "./quota.ts";

describe("quota view model", () => {
  test("pointsLeft: limit minus used, never negative; null without a limit or a quota", () => {
    expect(pointsLeft({ used: 120, limit: 300, resetInS: 10 })).toBe(180);
    expect(pointsLeft({ used: 310, limit: 300, resetInS: 10 })).toBe(0);
    expect(pointsLeft({ used: 5, limit: null, resetInS: 10 })).toBeNull();
    expect(pointsLeft(null)).toBeNull();
  });
  test("quotaLabel rounds down and says when it resets once exhausted", () => {
    expect(quotaLabel({ used: 120.4, limit: 300, resetInS: 900 })).toBe("179 pts left this hour");
    expect(quotaLabel({ used: 300, limit: 300, resetInS: 90 })).toBe("quota reached · resets in 2 min");
    expect(quotaLabel({ used: 1, limit: null, resetInS: 900 })).toBeNull();
    expect(quotaLabel(null)).toBeNull();
  });
  test("canAfford compares the estimate with what is left; unlimited always can", () => {
    expect(canAfford({ used: 298, limit: 300, resetInS: 1 }, 3)).toBe(false);
    expect(canAfford({ used: 297, limit: 300, resetInS: 1 }, 3)).toBe(true);
    expect(canAfford({ used: 5000, limit: null, resetInS: 1 }, 30)).toBe(true);
    expect(canAfford(null, 30)).toBe(true);
  });
});
```

Run: `bun test web/src/lib/quota.test.ts` → FAIL (module not found).

- [ ] **Step 2: `web/src/lib/quota.ts` and the API types**

```ts
// "N pts left this hour": the member's share of the shared Warcraft Logs budget (hosted mode).
import type { QuotaInfo } from "../api.ts";

export function pointsLeft(q: QuotaInfo | null): number | null {
  if (!q || q.limit === null) return null;
  return Math.max(0, q.limit - q.used);
}

export function quotaLabel(q: QuotaInfo | null): string | null {
  const left = pointsLeft(q);
  if (left === null) return null;
  if (left < 1) return `quota reached · resets in ${Math.ceil(q!.resetInS / 60)} min`;
  return `${Math.floor(left)} pts left this hour`;
}

/** Whether an action estimated at `points` fits in what is left (unlimited or unknown → yes). */
export function canAfford(q: QuotaInfo | null, points: number): boolean {
  const left = pointsLeft(q);
  return left === null || points <= left;
}
```

`web/src/api.ts`: add `export interface QuotaInfo { used: number; limit: number | null; resetInS: number }`; `MeUser` unchanged but `api.me()` returns `{ kind: "ok"; user: MeUser; quota: QuotaInfo | null }` (read `data.quota ?? null`; the `MeResult` type's ok variant gains `quota`); lookup: `call<{ result: LookupPayload; key: string; fromCache: boolean; pointsSpent?: number; quota?: QuotaInfo }>`; deepdive: `call<{ result: RunDefensives; fromCache: boolean; pointsSpent: number | null; quota?: QuotaInfo }>`. In `call()`, the error line becomes `return { ok: false, error: data.message ?? data.error ?? \`HTTP ${res.status}\` };` with `message?: string` added to the parsed shape — a 429 now reads "Hourly quota reached (300/300 pts) — resets in 5 min" in the toast.

Run: `bun test web/src/lib/quota.test.ts` → PASS (3 tests).

- [ ] **Step 3: Wire `App.tsx`**

- Boot: keep `me` as is; the `main` screen gains `quota: QuotaInfo | null` from `me.kind === "ok" ? me.quota : null` (and `null` from the Setup transition). `Main` receives `initialQuota` and holds `const [quota, setQuota] = useState<QuotaInfo | null>(initialQuota);`.
- After a successful `api.lookup(...)` in `runLookup` and after `api.deepdive(...)` in `analyze`: `if (r.quota) setQuota(r.quota);`.
- `Header` gets `quotaLabel={quotaLabel(quota)}`.
- `deepdiveActions` gains `canAfford: (runs) => canAfford(quota, runs * POINTS_PER_RUN)` (`import { POINTS_PER_RUN, unanalyzedRuns } from "./lib/deepdive.ts"; import { canAfford, quotaLabel } from "./lib/quota.ts";`).

- [ ] **Step 4: Components**

`Header.tsx`: prop `quotaLabel: string | null`; in the sign-out block, before the username: `{p.quotaLabel && <span className="muted mono" title="Your share of the shared Warcraft Logs budget">{p.quotaLabel}</span>}`.

`Detail.tsx` `DeepdiveActions`: add `/** Whether analysing `runs` more runs fits in the hourly quota (always true locally). */ canAfford: (runs: number) => boolean;`.

`DungeonRuns.tsx`: "Analyze all" button → `disabled={deepdive.analyzing !== null || !deepdive.canAfford(pending)}` and `title={deepdive.canAfford(pending) ? undefined : "Hourly quota reached"}`; the per-run "Analyze" button → `disabled={anyBusy || !deepdive.canAfford(1)}` with the same title; pass `canAfford={deepdive.canAfford(1)}` into `RunDeepDive` and there: prop `canAfford: boolean`, the Re-analyze button `disabled={busy || !canAfford}` + title.

- [ ] **Step 5: Check and commit**

Run: `just check && bun test` → green. Optional: `cd web && bunx vite build && rm -rf dist` to make sure the bundle compiles.

```bash
git add web/src/lib/quota.ts web/src/lib/quota.test.ts web/src/api.ts web/src/App.tsx web/src/components/Header.tsx web/src/components/Detail.tsx web/src/components/DungeonRuns.tsx web/src/components/RunDeepDive.tsx
git commit -m "feat(web): quota indicator, readable quota errors, Analyze disabled when unaffordable"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md`, `docs/agents/architecture.md`, `docs/agents/workflow.md`, `docs/agents/testing.md`, `AGENTS.md`

- [ ] **Step 1: README "Hosted mode"**

Add a paragraph after "Per-account state.":

```
**WCL budget.** The instance shares one Warcraft Logs API client (3600 pts/h).
Every point spent is measured from the `rateLimitData` WCL returns and charged
to the member whose request spent it. Each member may spend
`BMPL_POINTS_PER_USER_HOUR` points per calendar hour (default 300; admins are
exempt); a lookup or an analysis that would exceed it is refused before any
fetch with `429 { error: "quota", message, used, limit, resetInS }`. Cached
data — a tab in your history, a run already in the cache, an analysis already
done — never counts. Whatever the quotas say, the client is never driven below
100 points left (`429 { error: "budget", … }`), so cached lookups keep working
for everyone. The header shows "N pts left this hour"; `GET /api/me` and every
lookup/analysis response carry `quota`, and admins can read
`GET /api/admin/usage` (this hour per member, the client's last
`rateLimitData`, the last 24 hourly totals). Estimates before spending:
rankings ≈ 10 pts, each uncached run ≈ 10 pts, an analysis ≈ 3 pts. Attribution
is exact when requests do not overlap and approximate when they do; the hour's
total is always exact.
```

Update the "Do not expose a hosted instance to the internet before issue #5 lands" sentence: #5 is now shipped — remove the warning or point it at #9 (hardening) if a caveat is still warranted; check `grep -n "#5" README.md`. In the environment table/list add `BMPL_POINTS_PER_USER_HOUR` (optional, default 300).

- [ ] **Step 2: `docs/agents/architecture.md`**

- Table: `| usage_hourly | (user_id, hour_start) | hosted-mode WCL points per member per calendar hour | forever (small) |`.
- WCL section: every query selects `RATE_LIMIT`; `gql()` hands `rateLimitData` to the installed observer (`setRateLimitObserver`, hosted only); `src/wcl/meter.ts` (`PointsMeter`: AsyncLocalStorage attribution, window/reset logic, `ESTIMATE_*`), `src/hosted/quota.ts` (`QuotaGate.reserve/status`, `POINTS_FLOOR = 100`, calendar-hour buckets), `deps.reserve` in `performLookup` (two phases) and `runDeepdive`, in-flight dedupe in `runLookupWithCache`, `meter.run` around every hosted handler in `server.ts`, `GET /api/admin/usage`.
- Invariants: "A quota refusal happens before any WCL call and spends nothing; cached data never consults the gate." and "The CLI and local mode never install the observer: no accounting, no quota."

- [ ] **Step 3: `workflow.md`, `testing.md`, `AGENTS.md`**

- `workflow.md` roadmap: `#2–#5 … shipped; execute #6 → #11 in order`; in "Known follow-ups" remove "a `performLookup` end-to-end test once `fetchMplusData` is injectable" and "in-flight dedupe in `enrichRuns`" (both done: `test/lookup.test.ts`, `runLookupWithCache`).
- `testing.md`: list `test/wcl/meter.test.ts`, `test/hosted/quota.test.ts`, `test/lookup.test.ts` (performLookup with `fetchMplus`/`gql` fakes — the pattern for any future lookup test), `test/server-lookup.test.ts`, `web/src/lib/quota.test.ts`; update the test count (`bun test` prints it).
- `AGENTS.md`: `src/hosted/` line adds `quota`; `src/wcl/` line adds `meter`; roadmap: `#2–#5 … shipped, next is #6 (shared defensives table)`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/agents/architecture.md docs/agents/workflow.md docs/agents/testing.md AGENTS.md
git commit -m "docs: WCL budget accounting and per-member quotas in hosted mode"
```

---

## Readiness for the next issues

- **#6 (shared defensives table):** unrelated to the meter; `handleDefensivesPost` still writes the server file in hosted mode — #6 replaces it.
- **#7 (front design pass):** the header label and the disabled-button titles are placeholders; `quotaLabel`/`canAfford` are the seams for the user menu and the quota indicator on the canvas.
- **#8 (admin page):** `GET /api/admin/usage` is the gauge's data; `instance` is null until the first WCL call of the process.
- **#9 (hardening):** the meter's `charge()` per request is where a per-request cap or an audit-log line would hang; `PUT /api/settings` and the 429 payloads are safe to expose.
- **#11 phase 2 (per-user WCL client):** `PointsMeter.wrap(gql)` + a per-user `Reserve` that returns `null` are the hooks: a request with its own client uses `meter.wrap(userGql)` for its calls and `reserve = () => null`; the shared floor stays on the shared meter only.
- Known approximation (ruling): attribution under concurrent WCL calls lands on whichever request observed the delta; totals are exact. Making it exact would mean serialising the shared client's calls — rejected for the parallel run enrichment's sake.

## Self-review

- **Spec coverage:** accounting via `rateLimitData` deltas on every query, attributed and upserted into `usage_hourly` ✔ (Tasks 1–2); quota `BMPL_POINTS_PER_USER_HOUR` default 300, estimates 10/10/3, 429 with `{ error: "quota", used, limit, resetInS }` ✔ (Tasks 2–4; `message` added for the toast); admins exempt ✔; global floor 100 ✔ (`"budget"` refusal); `/api/me` quota, `pointsSpent` + quota on lookup/deep-dive responses ✔ (Tasks 3–4); front label + disabled Analyze ✔ (Task 5); cached-first preserved ✔ (reserve placement + tests); phase-2 hook ✔ (`wrap`, `Reserve`, Readiness); tests with fake gql: attribution ✔ (meter), 429 payload ✔, admin bypass ✔, hourly reset ✔, floor ✔ (`test/hosted/quota.test.ts`); `GET /api/admin/usage` ✔ (Task 4). Extra beyond the issue: in-flight dedupe (#4 carry-over), `fetchMplus` injection (listed follow-up).
- **Placeholder scan:** none.
- **Type consistency:** `Reserve = (estimate: number) => QuotaRefusal | null` used identically in `performLookup`, `runLookupWithCache`, `runDeepdive`, `QuotaGate.for`; `QuotaRefusal` fields `{ error, message, used, limit, resetInS }` spread into 429 bodies in Tasks 3–4 and read as `message ?? error` by the front (Task 5); `Quota { used, limit: number | null, resetInS }` = front `QuotaInfo`; `HostedRuntime.meter/quota` (Task 3) consumed by Tasks 4; `SharedContext.runtime` set in `server.ts` (Task 3) and read by both routes (Tasks 3–4); `hourStart`/`HOUR_MS` exported from `db.ts` (Task 2) and used by `quota.ts`, `routes-admin.ts`, tests.
