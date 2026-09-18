# Hardening (rate limiting, origin checks, validation, audit log) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted instance safe to expose to the Internet: one validator for every `/api/*` body, in-app rate limiting with `Retry-After`, Origin / Sec-Fetch-Site checks on state-changing routes, an `audit_log` table fed by logins, admin actions, quota refusals, security rejections and WCL/server errors, an admin page "Audit log" section (canvas variant **A**), secrets hygiene (weak session secret refused at startup, hosted 5xx never leak messages or paths) and a dependency check recipe.

**Architecture:** Cross-cutting pieces are small pure modules under `src/hosted/` (`audit.ts`, `ratelimit.ts`, `origin.ts`) and `src/server/validate.ts`, wired in `src/server.ts`'s request pipeline in this order: static → route → Origin check (hosted, non-GET) → auth gate → rate limit (hosted) → audit scope + meter → handler. The audit log is a SQLite table behind `HostedDb.audit`, written through `AuditLog` (an AsyncLocalStorage scope gives every row the request's user, ip and target, so the WCL client can report errors without knowing about requests). The front adds `api.admin.audit`, pure models in `web/src/lib/admin.ts` and a thin `Audit.tsx` section (layout A of the canvas: table, kind chips, "Load 50 more").

**Tech Stack:** Bun + `bun:sqlite`, TypeScript strict, `bun test`; Vite 8 + React 19 in `web/`.

**Spec:** GitHub issue #9 (`gh issue view 9`), parent #1. Design: canvas https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s page "Hosted", artboard `AdminAudit.dc.html` — variant **A · audit table** chosen (sub-nav "Audit" anchor with the 24 h error count; sources in `docs/design/canvas/`, uncommitted). Builds on #3 (auth, admin routes), #5 (meter / quota), #6 (proposals), #8 (admin page).

## Global Constraints

- **Never spend WCL points**: nothing here calls WCL; tests use fake bodies (400s) and the hosted test server (`test/server-admin.test.ts` pattern); any test that could reach `gql` pins dummy `WCL_CLIENT_ID`/`WCL_CLIENT_SECRET`.
- **Local mode untouched in behaviour**: the validator applies in both modes (same 400 messages), everything else (Origin, rate limits, audit, 5xx sanitising) is hosted-only; local error responses keep their messages; the front's `/` stays pixel-identical (new CSS classes only: `.admin-row-audit`, `.audit-*`).
- **Every `/api/admin/*` route stays `auth: "admin"`.** Audit rows never store secrets, cookies or full WCL response bodies (messages truncated to 300 chars); `detail` is a small JSON object.
- **Error responses in hosted mode never contain stack traces, file paths or `Error.message` of unknown errors** — only `"Internal error"`; WCL errors pass through as `WCL: <status/message ≤ 200 chars>`.
- **Validator**: unknown fields are refused (`400 {"ok":false,"error":"Unexpected field \`x\`"}`), numbers are finite, integers where integers are expected (`fightID` accepts neither `NaN` nor `1.5` nor `"1"`), strings are bounded.
- **Rate limits** (hosted): `/auth/*` 10 per minute per IP; `POST /api/lookup` 30 per minute per user; `POST /api/deepdive` 60 per minute per user; a refusal is `429 {"ok":false,"error":"Too many requests — try again in N s"}` with `Retry-After: N` (integer seconds, ≥ 1) and an audit row `rate_limited`.
- **Origin check** (hosted, every non-GET route): refuse when `Origin` is present and ≠ `BMPL_BASE_URL`, or when `Sec-Fetch-Site` is `cross-site` or `same-site`; `403 {"ok":false,"error":"Cross-site request refused"}` and an audit row `origin_rejected`. Requests with neither header (CLI, tests) pass. The SSE endpoint is GET-only and per user (unchanged; tested).
- **Audit retention 90 days**; purge at start and hourly with the session purge.
- **English everywhere**; front strings from the canvas: "Audit log", "logins, admin actions, quota refusals, security rejections, WCL errors · kept 90 days", chips "All · N", "Logins · N", "Admin · N", "Quota · N", "Security · N", "Errors · N", columns "time / who / action / target / detail", "Load 50 more", "showing X of N · newest first", "Nothing logged yet.", sub-nav "Audit" with a red chip "N errors" (24 h) when N > 0.
- **Style**: 2 spaces, double quotes, trailing commas, `.ts`/`.tsx` extensions; `just check && bun test` green with `web/dist` absent at the end of every task.
- **Git**: `main` in place, explicit `git add` paths, never `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`, `web/dist`. Commit trailers as the session provides.

## File map

| File | Responsibility |
|---|---|
| `src/server/validate.ts` (new) + `test/server/validate.test.ts` | tiny schema combinators (`obj`, `str`, `int`, `num`, `bool`, `oneOf`, `opt`, `nullable`, `any`) → `{ ok, value } \| { ok: false, error }`, unknown fields refused; the request schemas (`LOOKUP_BODY`, `DEEPDIVE_BODY`, `DEFENSIVES_BODY`, `SETTINGS_BODY`, `INVITE_BODY`, `NOTE_BODY`, `ROLE_BODY`, `SETUP_BODY`, `WATCH_BODY`) and `parseBody(req, schema)` |
| `src/server/lookup.ts`, `deepdive.ts`, `routes-user.ts`, `routes-admin.ts`, `routes-local.ts` | bodies go through `parseBody`; hosted 5xx sanitised; audit hooks (quota refusals, server errors, proposal decisions, invites, roles, revocations) |
| `src/hosted/schema.ts`, `src/hosted/db.ts` | `audit_log` table + `HostedDb.audit` repo |
| `src/hosted/audit.ts` (new) + `test/hosted/audit.test.ts` | `AuditAction`, `AuditKind`, `kindOf`, `AuditLog` (ALS scope, `record`, `setTarget`), `clip` |
| `src/wcl/client.ts` | `WclError` (status, kind, `publicMessage`), `setWclErrorObserver` |
| `src/hosted/ratelimit.ts` (new) + `test/hosted/ratelimit.test.ts` | `RateLimiter` sliding window |
| `src/hosted/origin.ts` (new) + `test/hosted/origin.test.ts` | `checkOrigin(req, baseUrl)` |
| `src/hosted/config.ts` + `test/hosted/config.test.ts` | weak-secret refusal |
| `src/hosted/runtime.ts`, `src/server.ts` | `audit`, `limits` on the runtime; pipeline wiring; `ServeOptions.rateLimits` test hook |
| `src/server/routes-auth.ts` | audit `login`, `login_denied`, `logout` |
| `src/server/routes-admin.ts` | `GET /api/admin/audit` |
| `test/server-hardening.test.ts` (new) | Origin, rate limits, `.env` never served, `POST /api/events` 404, 5xx sanitising, audit rows, `GET /api/admin/audit` |
| `web/src/types.ts`, `web/src/api.ts`, `web/src/lib/admin.ts` (+ test), `web/src/components/admin/Audit.tsx` (new), `AdminPage.tsx`, `web/src/styles/app.css` | the Audit section |
| `justfile`, `.tool-versions` (new), `README.md`, `docs/agents/architecture.md`, `docs/agents/web-front.md`, `docs/agents/testing.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-16-web-front-design.md`, `docs/design/canvas/AdminAudit.dc.html`, `canvas.json` | deps check, docs, canvas sources |

---

### Task 1: The validator and every `/api/*` body

**Files:**
- Create: `src/server/validate.ts`, `test/server/validate.test.ts`
- Modify: `src/server/lookup.ts`, `src/server/deepdive.ts`, `src/server/routes-user.ts`, `src/server/routes-admin.ts`, `src/server/routes-local.ts`, `src/server/http.ts` (remove `readJson` if unused after this — check `grep -rn readJson src/`; `parseMetric` stays for query strings and the watcher)

**Interfaces:**
- Produces:
  - `type Result<T> = { ok: true; value: T } | { ok: false; error: string }`
  - `type Schema<T> = { parse(v: unknown, path: string): Result<T> }`
  - `str(o?: { max?: number; min?: number; pattern?: RegExp; trim?: boolean; label?: string })`, `int(o?: { min?: number; max?: number })`, `num(o?)`, `bool()`, `oneOf<T extends string>(values: readonly T[])`, `opt<T>(s): Schema<T | undefined>`, `nullable<T>(s): Schema<T | null>`, `any()`, `obj<T>(fields: { [K in keyof T]: Schema<T[K]> }): Schema<T>` — unknown keys → `Unexpected field \`k\``; a required field missing → `\`k\` is required`; wrong type → `\`k\` must be a string` / `an integer` / `a number` / `a boolean` / `one of a, b` / `at most N characters` / `at least N` / `at most N` / `an object`.
  - `parseBody<T>(req: Request, schema: Schema<T>): Promise<Result<T>>` — invalid JSON → `Invalid JSON body`; non-object → `Body must be a JSON object`.
  - Schemas (exported, used by the routes and the tests):
    - `WOW_NAME = /^\p{L}{2,32}$/u`, `WOW_REALM = /^[\p{L}\d' -]{2,32}$/u` (checked after `parseCharacterInput` in `runLookupWithCache`: name/realm not matching → 400 `Could not parse character. Use \`Name-Realm\` or \`Name Realm\`.`).
    - `LOOKUP_BODY = obj({ character: str({ min: 1, max: 200, trim: true }), level: opt(nullable(int({ min: 2, max: 50 }))), spec: opt(nullable(str({ max: 32, trim: true }))), metric: opt(nullable(oneOf(["dps", "hps"]))), refresh: opt(bool()) })` — `level` was `number | string`: the front already sends `number | null` (`App.tsx` `formToRequest`), so narrow `LookupRequest.level` to `number | null` in `web/src/types.ts` (and `metric` to `"dps" | "hps" | null` — `form.metric || null` already yields that).
    - `DEEPDIVE_BODY = obj({ reportCode: str({ min: 1, max: 32, pattern: /^[A-Za-z0-9]+$/ }), fightID: int({ min: 1, max: 100000 }), character: str({ min: 1, max: 64, trim: true }), force: opt(bool()) })`.
    - `DEFENSIVES_BODY = obj({ className: str({ min: 1, max: 32, trim: true }), spec: str({ min: 1, max: 32, trim: true }), patch: obj({ id: int({ min: 1 }), name: opt(str({ min: 1, max: 64 })), cooldownS: opt(num({ min: 0 })), durationS: opt(num({ min: 0 })), kind: opt(oneOf(["major", "immunity", "minor"])), ignore: opt(bool()) }) })` — `validateOverride` still runs after (it owns the cross-field rules).
    - `SETTINGS_BODY = obj({ yourKey: opt(nullable(int({ min: KEY_MIN, max: KEY_MAX }))), legendOpen: opt(bool()) })` plus the existing "Nothing to update" check when both are absent.
    - `INVITE_BODY = obj({ discordId: str({ pattern: DISCORD_ID }), note: opt(nullable(str({ max: 200, trim: true }))) })`, `NOTE_BODY = obj({ note: opt(nullable(str({ max: 500, trim: true }))) })`, `ROLE_BODY = obj({ role: oneOf(["member", "admin"]) })`.
    - `SETUP_BODY = obj({ clientId: str({ min: 1, max: 200, trim: true }), clientSecret: str({ min: 1, max: 200, trim: true }) })`, `WATCH_BODY = obj({ level: opt(nullable(int({ min: 2, max: 50 }))), spec: opt(nullable(str({ max: 32 }))), metric: opt(nullable(oneOf(["dps", "hps"]))) })` (the watcher accepted an empty body `{}` → keep: `parseBody` on an empty body (no content) yields `{}`; a body of `""` is invalid JSON → treat "empty body" as `{}` for `WATCH_BODY` only by reading the text first).

- [ ] **Step 1: Failing tests** — `test/server/validate.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { DEEPDIVE_BODY, LOOKUP_BODY, bool, int, num, nullable, obj, oneOf, opt, parseBody, str } from "../../src/server/validate.ts";

const body = (v: unknown, raw = false) => new Request("http://x/api", { method: "POST", body: raw ? (v as string) : JSON.stringify(v), headers: { "Content-Type": "application/json" } });

describe("combinators", () => {
  test("str: type, bounds, pattern, trim", () => {
    expect(str().parse("a", "x")).toEqual({ ok: true, value: "a" });
    expect(str({ trim: true }).parse("  a ", "x")).toEqual({ ok: true, value: "a" });
    expect(str().parse(1, "x")).toEqual({ ok: false, error: "`x` must be a string" });
    expect(str({ min: 2 }).parse("a", "x")).toEqual({ ok: false, error: "`x` must be at least 2 characters" });
    expect(str({ max: 2 }).parse("abc", "x")).toEqual({ ok: false, error: "`x` must be at most 2 characters" });
    expect(str({ pattern: /^\d+$/ }).parse("a1", "x")).toEqual({ ok: false, error: "`x` is not valid" });
  });
  test("int/num: finite, integer, bounds; bool; oneOf", () => {
    expect(int().parse(3, "x")).toEqual({ ok: true, value: 3 });
    expect(int().parse(1.5, "x")).toEqual({ ok: false, error: "`x` must be an integer" });
    expect(int().parse(Number.NaN, "x")).toEqual({ ok: false, error: "`x` must be an integer" });
    expect(int().parse("3", "x")).toEqual({ ok: false, error: "`x` must be an integer" });
    expect(int({ min: 2, max: 4 }).parse(5, "x")).toEqual({ ok: false, error: "`x` must be at most 4" });
    expect(int({ min: 2 }).parse(1, "x")).toEqual({ ok: false, error: "`x` must be at least 2" });
    expect(num().parse(Number.POSITIVE_INFINITY, "x")).toEqual({ ok: false, error: "`x` must be a number" });
    expect(bool().parse("true", "x")).toEqual({ ok: false, error: "`x` must be a boolean" });
    expect(oneOf(["dps", "hps"]).parse("tank", "x")).toEqual({ ok: false, error: "`x` must be one of dps, hps" });
  });
  test("obj: required, optional, nullable, unknown fields", () => {
    const s = obj({ a: int(), b: opt(str()), c: nullable(int()) });
    expect(s.parse({ a: 1, c: null }, "")).toEqual({ ok: true, value: { a: 1, c: null } });
    expect(s.parse({ a: 1, b: undefined, c: 2 }, "")).toEqual({ ok: true, value: { a: 1, c: 2 } });
    expect(s.parse({ c: 1 }, "")).toEqual({ ok: false, error: "`a` is required" });
    expect(s.parse({ a: 1, c: 1, zzz: 1 }, "")).toEqual({ ok: false, error: "Unexpected field `zzz`" });
    expect(s.parse([], "")).toEqual({ ok: false, error: "Body must be a JSON object" });
    expect(obj({ n: obj({ k: int() }) }).parse({ n: { k: "1" } }, "")).toEqual({ ok: false, error: "`n.k` must be an integer" });
  });
});

describe("request schemas", () => {
  test("lookup: the front's shapes pass, junk is refused", async () => {
    expect((await parseBody(body({ character: " Biwaadrood-Nerzhul ", level: 18, spec: null, metric: "dps", refresh: false }), LOOKUP_BODY))).toEqual({ ok: true, value: { character: "Biwaadrood-Nerzhul", level: 18, spec: null, metric: "dps", refresh: false } });
    expect((await parseBody(body({ character: "x".repeat(201) }), LOOKUP_BODY)).ok).toBe(false);
    expect(await parseBody(body({ character: "a", level: "18" }), LOOKUP_BODY)).toEqual({ ok: false, error: "`level` must be an integer" });
    expect(await parseBody(body({ character: "a", evil: 1 }), LOOKUP_BODY)).toEqual({ ok: false, error: "Unexpected field `evil`" });
    expect(await parseBody(body("{not json", true), LOOKUP_BODY)).toEqual({ ok: false, error: "Invalid JSON body" });
    expect(await parseBody(body([1]), LOOKUP_BODY)).toEqual({ ok: false, error: "Body must be a JSON object" });
  });
  test("deepdive: fightID must be a positive integer, reportCode alphanumeric", async () => {
    expect(await parseBody(body({ reportCode: "ab12CD", fightID: 7, character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: true, value: { reportCode: "ab12CD", fightID: 7, character: "Biwa" } });
    expect(await parseBody(body({ reportCode: "ab12CD", fightID: 1.5, character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: false, error: "`fightID` must be an integer" });
    expect(await parseBody(body({ reportCode: "ab12CD", fightID: "7", character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: false, error: "`fightID` must be an integer" });
    expect(await parseBody(body({ reportCode: "../x", fightID: 7, character: "Biwa" }), DEEPDIVE_BODY)).toEqual({ ok: false, error: "`reportCode` is not valid" });
  });
});
```

`JSON.stringify(NaN)` is `null` — the NaN case is covered by the combinator test; the route-level NaN guard is `int()` refusing anything but a finite integer.

- [ ] **Step 2: Run, expect failures** — `bun test test/server/validate.test.ts` → module not found.

- [ ] **Step 3: Implement `src/server/validate.ts`**

```ts
// One validator for every JSON body the server accepts (issue #9): explicit shapes, unknown fields refused,
// numbers finite, integers where the domain is integer. Pure; the routes call parseBody().
import { DISCORD_ID } from "../hosted/config.ts";
import { KEY_MAX, KEY_MIN } from "../hosted/settings-limits.ts"; // moved out of routes-user.ts (which now imports them from here too) — no validate ↔ routes cycle

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Schema<T> { parse(v: unknown, path: string): Result<T> }

const fail = (error: string): Result<never> => ({ ok: false, error });
const label = (path: string) => `\`${path}\``;

export const str = (o: { min?: number; max?: number; pattern?: RegExp; trim?: boolean } = {}): Schema<string> => ({
  parse(v, path) {
    if (typeof v !== "string") return fail(`${label(path)} must be a string`);
    const s = o.trim ? v.trim() : v;
    if (o.min !== undefined && s.length < o.min) return fail(`${label(path)} must be at least ${o.min} characters`);
    if (o.max !== undefined && s.length > o.max) return fail(`${label(path)} must be at most ${o.max} characters`);
    if (o.pattern && !o.pattern.test(s)) return fail(`${label(path)} is not valid`);
    return { ok: true, value: s };
  },
});
const bounded = (v: number, path: string, o: { min?: number; max?: number }): Result<number> => {
  if (o.min !== undefined && v < o.min) return fail(`${label(path)} must be at least ${o.min}`);
  if (o.max !== undefined && v > o.max) return fail(`${label(path)} must be at most ${o.max}`);
  return { ok: true, value: v };
};
export const int = (o: { min?: number; max?: number } = {}): Schema<number> => ({
  parse: (v, path) => (typeof v === "number" && Number.isInteger(v) ? bounded(v, path, o) : fail(`${label(path)} must be an integer`)),
});
export const num = (o: { min?: number; max?: number } = {}): Schema<number> => ({
  parse: (v, path) => (typeof v === "number" && Number.isFinite(v) ? bounded(v, path, o) : fail(`${label(path)} must be a number`)),
});
export const bool = (): Schema<boolean> => ({ parse: (v, path) => (typeof v === "boolean" ? { ok: true, value: v } : fail(`${label(path)} must be a boolean`)) });
export const oneOf = <T extends string>(values: readonly T[]): Schema<T> => ({
  parse: (v, path) => (typeof v === "string" && (values as readonly string[]).includes(v) ? { ok: true, value: v as T } : fail(`${label(path)} must be one of ${values.join(", ")}`)),
});
/** Absent or `undefined` is fine; the key is then left out of the value. */
export const opt = <T>(s: Schema<T>): Schema<T | undefined> & { optional: true } => ({ optional: true, parse: (v, path) => (v === undefined ? { ok: true, value: undefined } : s.parse(v, path)) });
export const nullable = <T>(s: Schema<T>): Schema<T | null> => ({ parse: (v, path) => (v === null ? { ok: true, value: null } : s.parse(v, path)) });
export const any = (): Schema<unknown> => ({ parse: (v) => ({ ok: true, value: v }) });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const obj = <T extends object>(fields: { [K in keyof T]: Schema<T[K]> }): Schema<T> => ({
  parse(v, path) {
    if (!isObj(v)) return fail(path ? `${label(path)} must be an object` : "Body must be a JSON object");
    for (const k of Object.keys(v)) if (!(k in fields)) return fail(`Unexpected field \`${path ? `${path}.` : ""}${k}\``);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(fields) as Array<keyof T & string>) {
      const schema = fields[k] as Schema<unknown> & { optional?: true };
      const sub = path ? `${path}.${k}` : k;
      if (!(k in v) || v[k] === undefined) {
        if (schema.optional) continue;
        return fail(`${label(sub)} is required`);
      }
      const r = schema.parse(v[k], sub);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return { ok: true, value: out as T };
  },
});

/** Reads and validates a JSON body. `emptyAs` turns an empty body into that value first (the watcher's `{}`). */
export async function parseBody<T>(req: Request, schema: Schema<T>, emptyAs?: unknown): Promise<Result<T>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() === "" && emptyAs !== undefined ? emptyAs : JSON.parse(text);
  } catch {
    return fail("Invalid JSON body");
  }
  return schema.parse(raw, "");
}

export const WOW_NAME = /^\p{L}{2,32}$/u;
export const WOW_REALM = /^[\p{L}\d' -]{2,32}$/u;
const METRIC = ["dps", "hps"] as const;
export const LOOKUP_BODY = obj({ character: str({ min: 1, max: 200, trim: true }), level: opt(nullable(int({ min: 2, max: 50 }))), spec: opt(nullable(str({ max: 32, trim: true }))), metric: opt(nullable(oneOf(METRIC))), refresh: opt(bool()) });
export const DEEPDIVE_BODY = obj({ reportCode: str({ min: 1, max: 32, pattern: /^[A-Za-z0-9]+$/ }), fightID: int({ min: 1, max: 100_000 }), character: str({ min: 1, max: 64, trim: true }), force: opt(bool()) });
export const DEFENSIVES_BODY = obj({ className: str({ min: 1, max: 32, trim: true }), spec: str({ min: 1, max: 32, trim: true }), patch: obj({ id: int({ min: 1 }), name: opt(str({ min: 1, max: 64 })), cooldownS: opt(num({ min: 0 })), durationS: opt(num({ min: 0 })), kind: opt(oneOf(["major", "immunity", "minor"] as const)), ignore: opt(bool()) }) });
export const SETTINGS_BODY = obj({ yourKey: opt(nullable(int({ min: KEY_MIN, max: KEY_MAX }))), legendOpen: opt(bool()) });
export const INVITE_BODY = obj({ discordId: str({ pattern: DISCORD_ID }), note: opt(nullable(str({ max: 200, trim: true }))) });
export const NOTE_BODY = obj({ note: opt(nullable(str({ max: 500, trim: true }))) });
export const ROLE_BODY = obj({ role: oneOf(["member", "admin"] as const) });
export const SETUP_BODY = obj({ clientId: str({ min: 1, max: 200, trim: true }), clientSecret: str({ min: 1, max: 200, trim: true }) });
export const WATCH_BODY = obj({ level: opt(nullable(int({ min: 2, max: 50 }))), spec: opt(nullable(str({ max: 32, trim: true }))), metric: opt(nullable(oneOf(METRIC))) });
```

(The `opt` marker: `obj` reads `schema.optional` to know a missing key is fine; `nullable(opt(...))` is never needed — always `opt(nullable(...))`.)

- [ ] **Step 4: Wire the routes** — each handler becomes `const b = await parseBody(req, X_BODY); if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400); const body = b.value;` and drops its hand-written checks:
  - `handleLookup`: `level` is `number | null | undefined` now (no `parseInt`); keep the `hasCredentials()` check; in `runLookupWithCache`, after `parseCharacterInput`, refuse `!WOW_NAME.test(target.name) || !WOW_REALM.test(target.realm)` with the same "Could not parse character" 400. `web/src/api.ts` `lookup(...)`: make sure `level` is sent as a number or `null` (check the current call site; coerce with `Number.parseInt` in the front's form model if it is a string today — `web/src/lib/keyLevel.ts` may already own this).
  - `handleDeepdive`: `DEEPDIVE_BODY` (drop the `typeof body.fightID !== "number"` line).
  - `handleDefensivesPost`: `DEFENSIVES_BODY`; `validateOverride` still runs on the patch (keep the try/catch → 400).
  - `routes-user.ts`: `parseSettingsPatch(body: unknown)` becomes `parseSettingsPatch(value: { yourKey?: number | null; legendOpen?: boolean })` keeping only the "Nothing to update" rule; the route does `parseBody(req, SETTINGS_BODY)` first. Move `KEY_MIN`/`KEY_MAX` from `routes-user.ts` to `src/hosted/settings-limits.ts` (keep the "Mirrors web/src/lib/keyLevel.ts" comment); `routes-user.ts` and `validate.ts` import them from there.
  - `routes-admin.ts`: `INVITE_BODY`, `NOTE_BODY`, `ROLE_BODY` (the role route's "role is set by BMPL_ADMIN_DISCORD_IDS" and self/404 rules stay).
  - `routes-local.ts`: `SETUP_BODY`, `WATCH_BODY` with `emptyAs = {}`.
  - Existing tests that assert old messages: run `bun test` and update only the assertions whose message changed to the validator's wording (list them in the report).

- [ ] **Step 5: Verify and commit** — `bun test test/server` then `just check && bun test` → green.

```bash
git add src/server/validate.ts test/server/validate.test.ts src/server/lookup.ts src/server/deepdive.ts src/server/routes-user.ts src/server/routes-admin.ts src/server/routes-local.ts src/server/http.ts src/hosted/settings-limits.ts web/src/types.ts <any test file whose assertion changed>
git commit -m "feat(server): one validator for every JSON body — explicit shapes, unknown fields refused, integer fight ids"
```

---

### Task 2: Audit log — table, `AuditLog`, WCL error observer, hooks, `GET /api/admin/audit`, secrets hygiene

**Files:**
- Create: `src/hosted/audit.ts`, `test/hosted/audit.test.ts`
- Modify: `src/hosted/schema.ts`, `src/hosted/db.ts`, `src/hosted/runtime.ts`, `src/hosted/config.ts`, `test/hosted/config.test.ts`, `src/wcl/client.ts`, `src/server.ts`, `src/server/routes-auth.ts`, `src/server/routes-admin.ts`, `src/server/lookup.ts`, `src/server/deepdive.ts`, `src/deepdive/run.ts`, `test/server-admin.test.ts` (audit route tests appended), `test/hosted/db.test.ts` (repo tests appended)

**Interfaces:**
- Schema: `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT); CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at); CREATE INDEX IF NOT EXISTS audit_log_action_at ON audit_log(action, at);`
- `src/hosted/audit.ts`:
  ```ts
  export type AuditAction = "login" | "login_denied" | "logout" | "invite_add" | "invite_remove" | "role_change" | "sessions_revoke" | "proposal_approve" | "proposal_reject" | "quota_refused" | "rate_limited" | "origin_rejected" | "wcl_error" | "server_error";
  export type AuditKind = "login" | "admin" | "quota" | "security" | "error";
  export const AUDIT_KINDS: readonly AuditKind[]; export const ACTION_KIND: Record<AuditAction, AuditKind>; export const kindOf = (a: AuditAction) => ACTION_KIND[a]; export const actionsOf = (k: AuditKind): AuditAction[];
  export interface AuditRow { id: number; at: number; userId: number | null; username: string | null; action: AuditAction; target: string | null; detail: Record<string, unknown> | null; ip: string | null }
  export interface AuditEntry { userId?: number | null; target?: string | null; detail?: Record<string, unknown> | null; ip?: string | null; at?: number }
  export const AUDIT_RETENTION_MS = 90 * 24 * 3600_000; export const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  export class AuditLog { constructor(repo: HostedDb["audit"]); scope<T>(s: { userId: number | null; ip: string; target: string }, fn: () => Promise<T>): Promise<T>; setTarget(target: string): void; current(): { userId: number | null; ip: string; target: string } | undefined; record(action: AuditAction, e?: AuditEntry): void; }
  ```
  `record` fills `userId`/`ip`/`target` from the scope when the entry does not give them (an explicit `null` wins over the scope), `at` defaults to `Date.now()`, `detail` is stored as JSON (strings inside clipped to 300 chars by the caller).
- `HostedDb.audit`: `add(row: { at, userId, action, target, detail: string | null, ip }): number` (id); `list(o: { actions: AuditAction[] | null; before: number | null; limit: number }): AuditRow[]` (joined with users for `username`, `id DESC`); `counts(sinceAt: number | null): Record<AuditKind | "all", number>` (SUM over `actionsOf`); `purgeBefore(at: number): number`.
- `src/wcl/client.ts`: `export class WclError extends Error { kind: "http" | "graphql" | "nodata"; status: number | null; publicMessage: string }` thrown instead of the three `new Error(...)` (HTTP body clipped to 200 chars in both `message` and `publicMessage`: `WCL HTTP 502` / `WCL GraphQL error: <msg ≤ 200>` / `WCL GraphQL: no data returned`); `export const setWclErrorObserver = (fn: ((e: WclError) => void) | null) => void` called right before each throw. Local mode and the CLI never install one.
- `src/hosted/runtime.ts`: `HostedRuntime.audit: AuditLog`; `createHostedRuntime` installs `setWclErrorObserver((e) => audit.record("wcl_error", { detail: { kind: e.kind, status: e.status, message: clip(e.publicMessage, 300) } }))`, purges `audit.purgeBefore(now - AUDIT_RETENTION_MS)` at start and in the hourly interval.
- `src/server.ts` (hosted only): the handler runs inside `runtime.audit.scope({ userId: ctx.user?.id ?? null, ip: ctx.ip, target: \`${req.method} ${url.pathname}\` }, () => runtime.meter.run(...))`; the `catch (e)` records `server_error` `{ detail: { message: clip(String(e instanceof Error ? e.message : e)) } }` before answering `Internal error`.
- Hooks: `routes-auth.ts` callback → `login` (`target: \`discord ${discordId}\``, `detail: { userAgent: clip(ua, 120) }`) / `login_denied` (`userId: null`, `target: \`discord ${discordId}\``, `detail: { reason: "not invited" }`); `/auth/logout` → `logout`. `routes-admin.ts`: `invite_add` (`target: discordId`, `detail: { note }`), `invite_remove` (`target: discordId`, `detail: { sessionsEnded }`), `role_change` (`target: \`${username} → ${role}\``, `detail: { userId, role }`), `sessions_revoke` (`target: username`, `detail: { userId, sessionsEnded }`), `proposal_approve` / `proposal_reject` (`target: \`${name ?? "spell " + spellId} · ${key}\``, `detail: { proposalId, patch, note }`). `lookup.ts` / `deepdive.ts` (hosted, `runtime` non-null): `audit.setTarget(\`lookup ${character}\`)` / `setTarget(\`deepdive ${reportCode}:${fightID}\`)` before running; a `429` with `quota` → `quota_refused` `{ detail: { used, limit, resetInS, error } }`; a `status >= 500` → `server_error` `{ detail: { message: clip(error) } }` and the response body becomes `{ ok: false, error: "Internal error" }` **unless** the outcome is a WCL error (see next) — then `{ ok: false, error: \`WCL: ${publicMessage}\` }` with the outcome's status.
  - `runLookupWithCache`'s `catch` and `src/deepdive/run.ts`'s `catch`: return `{ ok: false, status, error, wcl?: string }` with `wcl = e.publicMessage` when `e instanceof WclError` (status 502 for both). The hosted sanitising rule in the handlers: `wcl ? \`WCL: ${wcl}\` : status >= 500 ? "Internal error" : error`. Local mode keeps `error` as is.
- `GET /api/admin/audit?kind=<all|login|admin|quota|security|error>&before=<id>&limit=<1..200>` (`auth: "admin"`) → `{ ok, rows: AuditRow[], counts: Record<AuditKind | "all", number>, errors24h: number, nextBefore: number | null }` — `nextBefore` is the last row's id when `rows.length === limit`, else null; bad `kind`/`limit`/`before` → 400. Default `limit` 50.
- `src/hosted/config.ts`: `export const weakSecret = (s: string): string | null` → `"fewer than 8 distinct characters"` when `new Set(s).size < 8`, `"looks like a placeholder"` when `/changeme|secret|password|example/i.test(s)`, else null; `validateHostedEnv` adds `BMPL_SESSION_SECRET: <reason> — generate one with \`openssl rand -base64 48\`` to `invalid`. (`TEST_HOSTED_CONFIG`'s secret `0123456789abcdef…` has 16 distinct characters and passes.)

- [ ] **Step 1: Failing tests**

`test/hosted/audit.test.ts` (open a `:memory:` `Database`, `openHosted`, `new AuditLog(db.audit)`):

```ts
test("record fills user/ip/target from the scope; explicit null wins; detail round-trips", async () => {
  const log = new AuditLog(db.audit);
  await log.scope({ userId: user.id, ip: "203.0.113.9", target: "POST /api/lookup" }, async () => {
    log.setTarget("lookup Biwa-Nerzhul");
    log.record("wcl_error", { detail: { kind: "http", status: 502, message: "WCL HTTP 502" }, at: 1_000 });
    log.record("login_denied", { userId: null, target: "discord 5", at: 2_000 });
  });
  log.record("logout", { at: 3_000 }); // outside any scope
  const rows = db.audit.list({ actions: null, before: null, limit: 10 });
  expect(rows.map((r) => [r.action, r.userId, r.ip, r.target])).toEqual([["logout", null, null, null], ["login_denied", null, "203.0.113.9", "discord 5"], ["wcl_error", user.id, "203.0.113.9", "lookup Biwa-Nerzhul"]]);
  expect(rows[2]!.detail).toEqual({ kind: "http", status: 502, message: "WCL HTTP 502" });
  expect(rows[2]!.username).toBe(user.username);
});
test("list filters by actions and pages by id; counts per kind; purge", () => { /* add 5 rows of mixed actions at known times; list({actions: actionsOf("security")}) → only those; before: <id> → older only; counts(null) → { all: 5, login: …, … }; counts(sinceAt) excludes older; purgeBefore(at) returns the number removed */ });
test("kindOf covers every action", () => { for (const a of ALL_ACTIONS) expect(AUDIT_KINDS).toContain(kindOf(a)); });
```

`test/hosted/config.test.ts` (append): a 40-char secret of `"a"` → invalid contains `BMPL_SESSION_SECRET: fewer than 8 distinct characters …`; `"changeme-changeme-changeme-changeme-1234"` → `looks like a placeholder`; the existing valid config still passes.

`test/server-admin.test.ts` (append, uses the file's server/admin/member):

```ts
describe("audit log", () => {
  test("admin actions are logged and listed newest first with counts; members get 403", async () => {
    await fetch(u("/api/admin/invites"), json("POST", { discordId: "888888888888888888", note: "audit" }, admin.cookie));
    await fetch(u("/api/admin/invites/888888888888888888"), { method: "DELETE", headers: { cookie: admin.cookie } });
    expect((await fetch(u("/api/admin/audit"), { headers: { cookie: member.cookie } })).status).toBe(403);
    const r = await (await fetch(u("/api/admin/audit?kind=admin&limit=2"), { headers: { cookie: admin.cookie } })).json();
    expect(r.rows.map((x: { action: string }) => x.action)).toEqual(["invite_remove", "invite_add"]);
    expect(r.rows[1]).toMatchObject({ userId: admin.user.id, username: "boss", target: "888888888888888888", detail: { note: "audit" } });
    expect(r.counts.admin).toBeGreaterThanOrEqual(2);
    expect(r.counts.all).toBeGreaterThanOrEqual(r.counts.admin);
    expect(typeof r.errors24h).toBe("number");
    expect((await fetch(u("/api/admin/audit?kind=nope"), { headers: { cookie: admin.cookie } })).status).toBe(400);
  });
  test("pagination: before + limit walk the log", async () => { /* limit=1 twice with nextBefore → two different ids, descending */ });
  test("a WCL error thrown inside a request lands in the log with the request's user and target", async () => {
    // Do not reach WCL: trigger the observer directly through the runtime hook the server exposes for tests —
    // runServer resolves with `server`; the hosted runtime is reachable via `getHostedRuntime()` exported from src/server.ts for tests (add it: module-level `let lastRuntime`).
    // Inside audit.scope({...member...}) call the observer path: import { WclError, __notifyWclError } — or simply `runtime.audit.scope(..., async () => runtime.audit.record("wcl_error", …))` is not the point; the point is the observer wiring:
    // const rt = getHostedRuntime()!; await rt.audit.scope({ userId: member.user.id, ip: "1.2.3.4", target: "POST /api/lookup" }, async () => { setWclErrorObserverForTest?…
  });
});
```

Make the third test concrete and cheap: export from `src/wcl/client.ts` a `notifyWclError(e: WclError)` used by `gql` right before throwing (the observer call lives there), and in the test: `await rt.audit.scope({ userId: member.user.id, ip: "1.2.3.4", target: "lookup X-Y" }, async () => notifyWclError(new WclError("graphql", null, "Report ab12CD is private")))` then `GET /api/admin/audit?kind=error` → first row `{ action: "wcl_error", userId: member.user.id, target: "lookup X-Y", detail: { kind: "graphql", status: null, message: "Report ab12CD is private" } }`. `getHostedRuntime()` in `src/server.ts`: `let current: HostedRuntime | null = null; export const getHostedRuntime = () => current;` set in `runServer` (test hook, documented as such).

`test/hosted/db.test.ts` (append): `audit.add/list/counts/purgeBefore` round trip with two users (username join, `ON DELETE SET NULL` when a user is deleted — insert then `DELETE FROM users` → row's `userId` null, `username` null).

- [ ] **Step 2: Run, expect failures** — `bun test test/hosted/audit.test.ts test/hosted/config.test.ts test/hosted/db.test.ts test/server-admin.test.ts`.

- [ ] **Step 3: Implement** in this order: schema + repo (`db.ts`: prepared statements `auditInsert`, `auditList` built per call with `action IN (?, …)` when filtering, `auditCounts` = `SELECT action, COUNT(*) AS n FROM audit_log WHERE at >= ? GROUP BY action` folded into kinds, `auditPurge`), `audit.ts` (`AsyncLocalStorage<{ userId; ip; target }>`; `record` never throws — wrap the insert in try/catch and `console.error` once), `client.ts` (`WclError`, observer, `notifyWclError`), `config.ts`, `runtime.ts`, `server.ts` (scope + catch + `getHostedRuntime`), hooks in the routes and handlers, the `wcl` field on the two outcomes, the admin route. `AuditRow.detail` parsing: `JSON.parse` guarded → `null` on failure.

- [ ] **Step 4: Verify and commit** — `just check && bun test` green.

```bash
git add src/hosted/audit.ts test/hosted/audit.test.ts src/hosted/schema.ts src/hosted/db.ts test/hosted/db.test.ts src/hosted/runtime.ts src/hosted/config.ts test/hosted/config.test.ts src/wcl/client.ts src/server.ts src/server/routes-auth.ts src/server/routes-admin.ts src/server/lookup.ts src/server/deepdive.ts src/deepdive/run.ts test/server-admin.test.ts
git commit -m "feat(hosted): audit log — table, request-scoped recorder, WCL error observer, admin/login/quota hooks, GET /api/admin/audit; refuse weak session secrets; hosted 5xx never leak messages"
```

---

### Task 3: Rate limiting and Origin checks in the pipeline

**Files:**
- Create: `src/hosted/ratelimit.ts`, `test/hosted/ratelimit.test.ts`, `src/hosted/origin.ts`, `test/hosted/origin.test.ts`, `test/server-hardening.test.ts`
- Modify: `src/hosted/runtime.ts`, `src/server.ts`

**Interfaces:**
- `src/hosted/ratelimit.ts`:
  ```ts
  export interface RateLimitRule { limit: number; windowMs: number }
  export class RateLimiter {
    constructor(rule: RateLimitRule);
    /** Records a hit for `key` at `now`; refuses when the window already holds `limit` hits. */
    hit(key: string, now: number): { ok: true; remaining: number } | { ok: false; retryAfterS: number };
    /** Drops keys with no hit inside the window (call from the hourly sweep). */
    sweep(now: number): void;
    readonly rule: RateLimitRule;
  }
  export const DEFAULT_RATE_LIMITS = { auth: { limit: 10, windowMs: 60_000 }, lookup: { limit: 30, windowMs: 60_000 }, deepdive: { limit: 60, windowMs: 60_000 } } as const;
  export type RateLimits = { [K in keyof typeof DEFAULT_RATE_LIMITS]: RateLimitRule };
  ```
  Sliding window on a `Map<string, number[]>` of hit timestamps (prune ≤ `now - windowMs` on each hit); `retryAfterS = max(1, ceil((oldest + windowMs - now) / 1000))`.
- `src/hosted/origin.ts`: `export function checkOrigin(headers: Headers, baseUrl: string): null | "origin" | "fetch-site"` — `Origin` present and `!== baseUrl` → `"origin"` (compare origins: `new URL(origin).origin === baseUrl`, an unparsable Origin → `"origin"`; the literal `"null"` Origin → `"origin"`); else `Sec-Fetch-Site` in `{ "cross-site", "same-site" }` → `"fetch-site"`; else `null`.
- `HostedRuntime.limits: { auth: RateLimiter; lookup: RateLimiter; deepdive: RateLimiter }`; `createHostedRuntime(config, db, fetchFn, rateLimits: RateLimits = DEFAULT_RATE_LIMITS)`; sweep in the hourly interval. `ServeOptions.rateLimits?: Partial<RateLimits>` (test hook) merged over the defaults.
- `src/server.ts` `respond`, hosted only, after `findRoute` and before `authGate`: `if (req.method !== "GET" && req.method !== "HEAD") { const why = checkOrigin(req.headers, runtime.config.baseUrl); if (why) { runtime.audit.record("origin_rejected", { userId: null, ip, target: \`${req.method} ${url.pathname}\`, detail: { origin: clip(req.headers.get("origin") ?? "", 200), fetchSite: req.headers.get("sec-fetch-site"), why } }); return jsonResponse({ ok: false, error: "Cross-site request refused" }, 403); } }`. After the auth gate: `const rl = url.pathname.startsWith("/auth/") ? { limiter: runtime.limits.auth, key: \`ip:${ip}\` } : req.method === "POST" && url.pathname === "/api/lookup" ? { limiter: runtime.limits.lookup, key: \`user:${ctx.user!.id}\` } : req.method === "POST" && url.pathname === "/api/deepdive" ? { limiter: runtime.limits.deepdive, key: \`user:${ctx.user!.id}\` } : null;` → on refusal record `rate_limited` (`detail: { limit, windowS, retryAfterS }`, `target: \`${req.method} ${url.pathname}\``) and answer `jsonResponse({ ok: false, error: \`Too many requests — try again in ${retryAfterS} s\` }, 429)` with `Retry-After` set. Rate-limited and origin-rejected responses still get the security headers (they go through `fetch`'s wrapper).

- [ ] **Step 1: Failing tests**

`test/hosted/ratelimit.test.ts`:

```ts
test("allows `limit` hits per window, then refuses with the seconds until the oldest hit leaves the window", () => {
  const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
  expect(rl.hit("a", 0)).toEqual({ ok: true, remaining: 2 });
  expect(rl.hit("a", 10_000)).toEqual({ ok: true, remaining: 1 });
  expect(rl.hit("a", 20_000)).toEqual({ ok: true, remaining: 0 });
  expect(rl.hit("a", 30_000)).toEqual({ ok: false, retryAfterS: 30 });
  expect(rl.hit("b", 30_000)).toEqual({ ok: true, remaining: 2 }); // keys are independent
  expect(rl.hit("a", 60_001)).toEqual({ ok: true, remaining: 0 }); // the hit at 0 left the window
  expect(rl.hit("a", 60_002)).toEqual({ ok: false, retryAfterS: 9 }); // next to leave: 10_000 + 60_000 − 60_002 → ceil(9.998) = 10? → assert 10
});
test("retryAfterS is never below 1; sweep forgets idle keys", () => { const rl = new RateLimiter({ limit: 1, windowMs: 1_000 }); rl.hit("a", 0); expect(rl.hit("a", 999)).toEqual({ ok: false, retryAfterS: 1 }); rl.sweep(5_000); expect(rl.hit("a", 5_000)).toEqual({ ok: true, remaining: 0 }); });
```

(Fix the arithmetic in the second-to-last assertion when writing it: at `60_002` the window holds `[10_000, 20_000, 60_001]` → refuse, oldest 10_000 leaves at 70_000 → `retryAfterS = ceil(9_998 / 1000) = 10`.)

`test/hosted/origin.test.ts`: `checkOrigin(new Headers(), base)` → null; `Origin: base` → null; `Origin: https://evil.example` → "origin"; `Origin: null` → "origin"; `Sec-Fetch-Site: same-origin` / `none` → null; `cross-site` → "fetch-site"; `same-site` → "fetch-site"; Origin matching but `Sec-Fetch-Site: cross-site` → "fetch-site" (belt and braces); `Origin: http://localhost:3000` vs base `http://localhost` → "origin".

`test/server-hardening.test.ts` — hosted server like `server-admin.test.ts` (own temp dir, `rateLimits: { auth: { limit: 3, windowMs: 60_000 }, lookup: { limit: 2, windowMs: 60_000 } }`), `admin`/`member` via `loginAs`, and pinned dummy WCL creds (`process.env.WCL_CLIENT_ID = "test"; process.env.WCL_CLIENT_SECRET = "test"` in `beforeAll`, restored in `afterAll`):

```ts
describe("origin check", () => {
  test("cross-site POSTs are refused before auth, same-origin and header-less ones pass", async () => {
    const evil = await fetch(u("/api/settings"), { method: "PUT", headers: { cookie: member.cookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ ok: false, error: "Cross-site request refused" });
    expect((await fetch(u("/api/settings"), { method: "PUT", headers: { cookie: member.cookie, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body: "{}" })).status).toBe(403);
    expect((await fetch(u("/api/settings"), { method: "PUT", headers: { cookie: member.cookie, "Content-Type": "application/json", Origin: TEST_HOSTED_CONFIG.baseUrl }, body: JSON.stringify({ legendOpen: false }) })).status).toBe(200);
    expect((await fetch(u("/auth/logout"), { method: "POST", headers: { Origin: "https://evil.example" } })).status).toBe(403); // public routes too
    const r = await (await fetch(u("/api/admin/audit?kind=security"), { headers: { cookie: admin.cookie } })).json();
    expect(r.rows[0]).toMatchObject({ action: "origin_rejected", userId: null, target: "POST /auth/logout", detail: { origin: "https://evil.example", why: "origin" } });
  });
  test("GET is never origin-checked", async () => { expect((await fetch(u("/api/me"), { headers: { cookie: member.cookie, Origin: "https://evil.example" } })).status).toBe(200); });
});
describe("rate limits", () => {
  test("/auth/* per IP: the 4th hit in a minute is 429 with Retry-After and an audit row", async () => {
    for (let i = 0; i < 3; i++) expect((await fetch(u("/auth/discord"), { redirect: "manual" })).status).toBe(302);
    const r = await fetch(u("/auth/discord"), { redirect: "manual" });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect((await r.json()).error).toMatch(/^Too many requests — try again in \d+ s$/);
    const a = await (await fetch(u("/api/admin/audit?kind=security&limit=1"), { headers: { cookie: admin.cookie } })).json();
    expect(a.rows[0]).toMatchObject({ action: "rate_limited", target: "GET /auth/discord", detail: { limit: 3, windowS: 60 } });
  });
  test("/api/lookup per user: invalid bodies count, the 3rd is 429, another user is unaffected", async () => {
    const bad = () => fetch(u("/api/lookup"), json("POST", { nope: 1 }, member.cookie));
    expect((await bad()).status).toBe(400);
    expect((await bad()).status).toBe(400);
    expect((await bad()).status).toBe(429);
    expect((await fetch(u("/api/lookup"), json("POST", { nope: 1 }, admin.cookie))).status).toBe(400);
  });
});
describe("secrets hygiene", () => {
  test(".env and dotfiles are never served", async () => { for (const p of ["/.env", "/../.env", "/.git/config", "/bmpl.db"]) expect((await fetch(u(p))).status).toBe(404); });
  test("the SSE endpoint is GET-only", async () => { expect((await fetch(u("/api/events"), { method: "POST", headers: { cookie: member.cookie } })).status).toBe(404); });
  test("a handler that throws answers a bare Internal error and logs server_error", async () => {
    // GET /api/history/<key> with a key whose stored payload is corrupted throws inside the handler: insert a row with payload "not json" for the member via db.history.forUser(member.user.id) internals → simplest: db._db.run("INSERT INTO user_history (…) VALUES (…)") with payload 'x' — if that does not throw on read, pick another deterministic throw the plan's implementer can name (document it). Expected: status 500, body { ok: false, error: "Internal error" }, audit kind=error first row action "server_error" with detail.message defined and NOT containing the temp dir path.
  });
});
```

If no deterministic in-handler throw is reachable through public routes, replace the last test with a unit-level one: call `respond`'s logic through a `ServeOptions.routesForTest?: Route[]` hook? No — keep it simple: export nothing new; instead assert the sanitising in `handleLookup` directly with a `performLookup` fake that throws `new Error("/tmp/secret/path")` (`runLookupWithCache(opts, history, { performLookup: async () => { throw new Error("ENOENT /tmp/secret") } })` returns `status 500` with the raw message — then the hosted `handleLookup` maps it). Ruling for the implementer: test `handleLookup` through the server with `LookupDeps` injected via `ServeOptions.lookupDeps?: LookupDeps` (exists? check `test/server-lookup.test.ts` for how it fakes `performLookup` today and reuse that hook).

- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement** `ratelimit.ts`, `origin.ts`, runtime `limits`, `server.ts` wiring (order: static → route → Origin (hosted, non-GET) → auth gate → rate limit → audit scope + meter → handler), `ServeOptions.rateLimits`.
- [ ] **Step 4: Verify and commit** — `just check && bun test` green.

```bash
git add src/hosted/ratelimit.ts test/hosted/ratelimit.test.ts src/hosted/origin.ts test/hosted/origin.test.ts src/hosted/runtime.ts src/server.ts test/server-hardening.test.ts
git commit -m "feat(hosted): in-app rate limits with Retry-After and Origin / Sec-Fetch-Site checks on state-changing routes, both audited"
```

---

### Task 4: Front — the Audit log section (canvas A)

**Files:**
- Create: `web/src/components/admin/Audit.tsx`
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/lib/admin.ts`, `web/src/lib/admin.test.ts`, `web/src/components/admin/AdminPage.tsx`, `web/src/styles/app.css`

**Interfaces:**
- `types.ts`: `export type { AuditAction, AuditKind, AuditRow } from "@shared/hosted/audit.ts";` (type-only; `audit.ts` imports `node:async_hooks` at runtime — erased by `verbatimModuleSyntax`; verify with `cd web && bunx vite build && rm -rf dist`), `export interface AdminAudit { rows: AuditRow[]; counts: Record<AuditKind | "all", number>; errors24h: number; nextBefore: number | null }`.
- `api.ts`: `admin.audit: (o: { kind: AuditKind | "all"; before?: number | null; limit?: number }) => call<AdminAudit>(\`/api/admin/audit?kind=${o.kind}${o.before ? \`&before=${o.before}\` : ""}&limit=${o.limit ?? 50}\`)`.
- `lib/admin.ts`:
  ```ts
  export const AUDIT_CHIPS: ReadonlyArray<{ kind: AuditKind | "all"; label: string }> = [{ kind: "all", label: "All" }, { kind: "login", label: "Logins" }, { kind: "admin", label: "Admin" }, { kind: "quota", label: "Quota" }, { kind: "security", label: "Security" }, { kind: "error", label: "Errors" }];
  export interface AuditRowModel { id: number; time: string; who: string; whoFaint: boolean; dot: "dot-login" | "dot-admin" | "dot-quota" | "dot-sec" | "dot-error"; action: string; target: string; detail: string }
  export function auditRow(r: AuditRow, now = Date.now()): AuditRowModel
  export function auditDetail(action: AuditAction, detail: Record<string, unknown> | null): string
  export const auditShowing = (shown: number, total: number) => `showing ${shown} of ${fmtPts(total)} · newest first`;
  ```
  `time`: `HH:MM` when `r.at` is today (local time), `yesterday HH:MM`, else `fmtAge`; `who`: `r.username ?? "—"` (`whoFaint` when null); `dot` from `kindOf(r.action)` mapped `login→dot-login, admin→dot-admin, quota→dot-quota, security→dot-sec, error→dot-error`; `target: r.target ?? ""`; `detail` by action: `wcl_error` → `detail.message`; `server_error` → `detail.message`; `quota_refused` → `\`${detail.error === "budget" ? "instance budget" : "quota"} · ${used}/${limit} pts used, resets in ${Math.max(1, Math.ceil(resetInS / 60))} min\``; `rate_limited` → `\`${limit} per ${windowS} s · retry in ${retryAfterS} s\``; `origin_rejected` → `\`Origin ${origin || "—"}${fetchSite ? \` · Sec-Fetch-Site ${fetchSite}\` : ""}\``; `login` → `detail.userAgent`; `login_denied` → `detail.reason`; `invite_add` → `note ? \`note: “${note}”\` : ""`; `invite_remove` → `\`${sessionsEnded} session(s) ended\``; `role_change` → `""`; `sessions_revoke` → `\`${sessionsEnded} session(s) ended\``; `proposal_approve`/`reject` → `\`${patchText(patch)}${note ? \` · note: “${note}”\` : ""}\``; unknown/null detail → `""`.
  `kindOf` and `patchText` are needed at runtime: **`kindOf` must not be imported from `src/`** (types only) — duplicate the small `ACTION_KIND` map in `lib/admin.ts` as `AUDIT_KIND_OF: Record<AuditAction, AuditKind>` with a test asserting it covers every `AuditAction` (compile-time exhaustiveness via `Record`).
- `Audit.tsx` props: `{ initialKind?: AuditKind | "all" }`; owns its data (kind chips → refetch with `before: null`; "Load 50 more" appends with `nextBefore`; `counts` from the latest response); header per the canvas (title, muted description, chips right-aligned with counts, the Errors chip red `style={{ color: "var(--red)" }}` when `counts.error > 0`); header row `label-caps` (time · who · action · target · detail); rows `.inset.admin-row.admin-row-audit`: `mono faint` time, who (faint when `whoFaint`), `<span className={\`dot ${dot}\`} />` + `mono` action (12 px), `text-soft` target, `faint` detail; footer `btn btn-sm` "Load 50 more" (hidden when `nextBefore === null`) + faint `auditShowing(rows.length, counts[kind])`; empty → faint "Nothing logged yet.". Errors via the page's toast? The section is self-contained: keep a local `error` string rendered as a faint line (no second `Toast`).
- `AdminPage.tsx`: sub-nav gains `<a href="#audit">Audit{errors24h > 0 && <span className="chip" style={{ marginLeft: 4, color: "var(--red)" }}>{errors24h} errors</span>}</a>`; `errors24h` comes from a cheap `api.admin.audit({ kind: "error", limit: 1 })` in `reload` (its `errors24h`), stored in `AdminData.errors24h`; `<Audit initialKind={location.hash === "#audit-errors" ? "error" : "all"} />` rendered last (section `id="audit"`); the sub-nav error chip links to `#audit` and passes the "errors" preselection through the `Audit` component's own state (`onClick` handler sets kind `error` via a ref/callback — simplest: `Audit` exposes nothing; the chip is an `<a href="#audit" onClick={() => setAuditKind("error")}>` and `AdminPage` holds `auditKind` state passed as a controlled `kind`/`onKind` pair).
- CSS (append): `.admin-row-audit { grid-template-columns: 74px 130px 150px 220px 1fr; } .admin-row-audit > span:last-child { white-space: normal; } .dot-login { background: var(--green); } .dot-admin { background: var(--link); } .dot-quota { background: var(--yellow); } .dot-sec { background: var(--orange); } .dot-error { background: var(--red); }` — check which of `.dot-*` already exist in `app.css` (`dot-shared/pending/rejected/approved` do) and only add the new ones.

- [ ] **Step 1: Failing tests** — append to `web/src/lib/admin.test.ts`:

```ts
describe("audit rows", () => {
  const NOW = new Date(2026, 8, 18, 14, 30).getTime(); // local time
  const row = (over: Partial<AuditRow>): AuditRow => ({ id: 1, at: NOW - 28 * 60_000, userId: 2, username: "tom", action: "wcl_error", target: "lookup Biwaadrood-Nerzhul", detail: { kind: "http", status: 502, message: "WCL HTTP 502" }, ip: "1.2.3.4", ...over });
  test("time: today HH:MM, yesterday, older via fmtAge", () => {
    expect(auditRow(row({}), NOW).time).toBe("14:02");
    expect(auditRow(row({ at: NOW - 24 * 3600_000 }), NOW).time).toBe("yesterday 14:30");
    expect(auditRow(row({ at: NOW - 5 * 24 * 3600_000 }), NOW).time).toBe("5d ago");
  });
  test("who, dot, action, target, detail per action", () => {
    expect(auditRow(row({}), NOW)).toMatchObject({ who: "tom", whoFaint: false, dot: "dot-error", action: "wcl_error", target: "lookup Biwaadrood-Nerzhul", detail: "WCL HTTP 502" });
    expect(auditRow(row({ userId: null, username: null, action: "login_denied", target: "discord 5", detail: { reason: "not invited" } }), NOW)).toMatchObject({ who: "—", whoFaint: true, dot: "dot-login", detail: "not invited" });
    expect(auditDetail("quota_refused", { error: "quota", used: 287, limit: 300, resetInS: 1300 })).toBe("quota · 287/300 pts used, resets in 22 min");
    expect(auditDetail("rate_limited", { limit: 10, windowS: 60, retryAfterS: 41 })).toBe("10 per 60 s · retry in 41 s");
    expect(auditDetail("origin_rejected", { origin: "https://evil.example", fetchSite: "cross-site", why: "origin" })).toBe("Origin https://evil.example · Sec-Fetch-Site cross-site");
    expect(auditDetail("invite_add", { note: "alt of tom" })).toBe("note: “alt of tom”");
    expect(auditDetail("invite_add", { note: null })).toBe("");
    expect(auditDetail("proposal_approve", { proposalId: 7, patch: { id: 642, cooldownS: 240 }, note: "Matches the tooltip." })).toBe("cd 240 s · note: “Matches the tooltip.”");
    expect(auditDetail("sessions_revoke", { userId: 2, sessionsEnded: 2 })).toBe("2 session(s) ended");
    expect(auditDetail("role_change", { userId: 2, role: "admin" })).toBe("");
    expect(auditDetail("logout", null)).toBe("");
  });
  test("every action has a kind and chips cover every kind", () => {
    const kinds = new Set(Object.values(AUDIT_KIND_OF));
    for (const c of AUDIT_CHIPS) if (c.kind !== "all") expect(kinds.has(c.kind)).toBe(true);
    expect(auditShowing(10, 1280)).toBe("showing 10 of 1 280 · newest first");
  });
});
```

- [ ] **Step 2: Run, expect failures.** `bun test web/src/lib/admin.test.ts`.
- [ ] **Step 3: Implement** types, api, models, `Audit.tsx`, `AdminPage` wiring, CSS.
- [ ] **Step 4: Verify** — `just check && bun test` green; `cd web && bunx vite build && rm -rf dist` clean (no `node:async_hooks` in the bundle: `grep -c async_hooks web/dist/assets/app.js` → 0 before removing dist). Live check optional (same procedure as #8: hosted scratch server with dummy WCL creds; trigger a login_denied by visiting `/auth/discord/callback?code=x&state=y` → "Invalid OAuth state" is not audited — instead insert rows through `getHostedRuntime().audit.record(...)` from a scratch script; verify chips, Load more, the red sub-nav chip).

```bash
git add web/src/types.ts web/src/api.ts web/src/lib/admin.ts web/src/lib/admin.test.ts web/src/components/admin/Audit.tsx web/src/components/admin/AdminPage.tsx web/src/styles/app.css
git commit -m "feat(web): admin audit log section — kind chips with counts, paged rows, error count in the sub-nav (canvas A)"
```

---

### Task 5: Dependency check, toolchain pin, docs, canvas sources

**Files:** `justfile`, `.tool-versions` (new), `README.md`, `docs/agents/architecture.md`, `docs/agents/web-front.md`, `docs/agents/testing.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-16-web-front-design.md`, `.env.hosted.example`, `docs/design/canvas/AdminAudit.dc.html`, `docs/design/canvas/canvas.json`.

- [ ] **Step 1: `just check-deps`** — recipe `check-deps: bun audit && bun audit --cwd web` with the comment `# known-vulnerability check of both lockfiles (bun audit); run before a release`. Verify `bun audit` exists on the pinned Bun (1.3.4: `bun audit --help`); if the flag `--cwd` is not accepted, use `cd web && bun audit`. `.tool-versions`: `bun 1.3.4`. README "Requirements": "Bun ≥ 1.3 (pinned in `.tool-versions` for asdf/mise users)". AGENTS.md Commands: add `just check-deps`.
- [ ] **Step 2: README** — "Hosted mode": the intro sentence "today it only disables the local-only routes …" → describe what hosted mode does now (login, per-user state, quotas, shared table, admin page, and the hardening: "state-changing requests must come from `BMPL_BASE_URL` (Origin / Sec-Fetch-Site), `/auth/*` is limited to 10 requests per minute per IP, lookups to 30 and analyses to 60 per minute per member (429 with `Retry-After`), every JSON body is validated against an explicit shape (unknown fields are refused), server errors never carry messages or paths, and the audit log (`GET /api/admin/audit?kind=&before=&limit=`, the admin page's Audit section) keeps 90 days of logins, admin actions, quota refusals, security rejections and WCL/server errors"); the "Instance info" paragraph: replace "The WCL error list of the issue waits for the audit log (issue #9)." with "WCL errors are in the audit log (Errors chip)."; env table: `BMPL_SESSION_SECRET` row adds "placeholders and low-variety strings are refused". "Security" section: add a bullet "Hosted mode: see the hardening paragraph of *Hosted mode* — the app rate-limits and origin-checks on its own; the reverse proxy adds TLS, HSTS and a coarse per-IP layer (issue #10)."
- [ ] **Step 3: `docs/agents/architecture.md`** — hosted section: the pipeline order (static → route → Origin → auth gate → rate limit → audit scope + meter → handler), `src/hosted/{audit,ratelimit,origin}.ts`, `src/server/validate.ts` ("every JSON body goes through `parseBody`; add a schema there, never `req.json()` in a route"), the `WclError` observer, the sanitising rule for hosted 5xx, the audit retention. `docs/agents/testing.md`: `test/server-hardening.test.ts` and the `ServeOptions.rateLimits` / `getHostedRuntime()` test hooks. `docs/agents/web-front.md`: `Audit` in the components map, `auditRow`/`auditDetail` in the view models list, `AUDIT_KIND_OF` duplicated on purpose (types-only rule). `AGENTS.md` roadmap: "#2–#9 (…, hardening) are shipped, next is #10 (deploy)". Spec status line: "audit section 2026-09-18 — issue #9, canvas AdminAudit (A)". `.env.hosted.example`: the secret comment gains "(no placeholders — the server refuses them)".
- [ ] **Step 4: Verify and commit** — `just check && bun test` green; `git status --short` shows only these files.

```bash
git add justfile .tool-versions README.md docs/agents/architecture.md docs/agents/web-front.md docs/agents/testing.md AGENTS.md docs/superpowers/specs/2026-09-16-web-front-design.md .env.hosted.example docs/design/canvas/AdminAudit.dc.html docs/design/canvas/canvas.json docs/superpowers/plans/2026-09-18-hardening.md
git commit -m "docs: hardening (validator, rate limits, origin checks, audit log), just check-deps, Bun pin, the AdminAudit canvas artboard"
```

---

## Self-review

- **Spec coverage** (issue #9): rate limiting per IP on `/auth/*` (10/min), per user on `/api/lookup` (30/min) and `/api/deepdive` (60/min), 429 + `Retry-After` ✓ (Task 3); CSRF via `Origin`/`Sec-Fetch-Site` against `BMPL_BASE_URL` on every state-changing route, SSE GET-only per user (tested) ✓ (Task 3); one validator with explicit shapes, unknown fields refused, `fightID` NaN/float fixed, names/realms charset, integer ids, enum metrics, bounded levels ✓ (Task 1 — at `src/server/validate.ts`, not `src/hosted/`: it serves both modes; ruling); audit log table with the listed columns and events (logins, invites, role changes, proposal decisions, quota refusals, WCL errors) + `GET /api/admin/audit` ✓ (Task 2) + the admin page section ✓ (Task 4); secrets hygiene: `.env` never served (tested), `/api/status` hosted has no paths (pre-existing, tested in `server-hosted.test.ts`), hosted error responses without messages/paths ✓, startup refuses weak secrets ✓ (Task 2); dependencies: `just check-deps` + Bun pin ✓ (Task 5); tests for windows, Origin rejection, validator edges, audit rows ✓.
- **Decisions to flag**: validator lives in `src/server/`; requests with neither `Origin` nor `Sec-Fetch-Site` pass the origin check (non-browser clients; browsers always send at least one on cross-site requests); invalid bodies count toward the rate limit (the limiter runs before the handler — simpler and stricter); WCL error messages pass through to the member (`WCL: …`, ≤ 200 chars) because "report is private" is actionable, every other 5xx is `Internal error`; `AUDIT_KIND_OF` is duplicated in the front (types-only import rule); `login`'s user agent is stored clipped to 120 chars (no IP beyond the `ip` column); logout of an anonymous request is not audited.
- **Placeholder scan**: Task 3's last test has an explicit fallback instruction (reuse the existing `performLookup` fake hook of `test/server-lookup.test.ts`) — the implementer must pick one of the two named options and say which.
- **Type consistency**: `AuditRow`/`AuditAction`/`AuditKind` (T2 ↔ T4 `types.ts`); `counts: Record<AuditKind | "all", number>` and `errors24h` (T2 route ↔ T4 `AdminAudit`); `rate_limited` detail `{ limit, windowS, retryAfterS }` (T3 ↔ T4 `auditDetail`); `origin_rejected` detail `{ origin, fetchSite, why }` (T3 ↔ T4); `quota_refused` detail `{ error, used, limit, resetInS }` (T2 ↔ T4); `LOOKUP_BODY.level` integer or null (T1 ↔ front `api.lookup`).
