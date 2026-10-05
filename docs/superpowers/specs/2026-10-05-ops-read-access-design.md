# Read-only ops access for agents — design

Status: draft 2026-10-05, awaiting the user's review.

## Goal

Let a Claude Code session (cloud or local) read the hosted instance's errors without SSH, so it can
diagnose and fix them. Today errors live in two places only an operator reaches: the `audit_log`
table (admin page, behind a Discord session) and `journalctl -u bmpl` on the VPS (SSH, which agents
must never use, see `docs/agents/workflow.md`).

## Non-goals

- No write access of any kind: no ban, no role change, no deploy, no config change.
- No MCP server in this iteration (see "Why not an MCP server").
- No log shipping to a third-party service.
- Not a replacement for the admin page.

## Decisions

1. **One static bearer token, `BMPL_OPS_TOKEN`.** Unset (the default) means the routes below answer
   404, as if they did not exist. When set, it must be at least 32 bytes of entropy (same check as
   `BMPL_SESSION_SECRET`); `bmpl serve --hosted` refuses to start otherwise. Compared with
   `timingSafeEqual` on SHA-256 digests. Never logged, never in an audit row; `describeConfig` shows
   only whether it is set. Rotation = change the env var and restart.
2. **Separate prefix `/api/ops/`**, GET only, outside the session/cookie auth and the Origin check
   (no cookie is involved, so there is nothing to forge). Rate-limited with the existing `security`
   limiter key; every refused token records a new `ops_denied` audit action (kind `security`).
3. **Routes**
   - `GET /api/ops/status`: version, uptime, `describeConfig` (secrets masked), last backup age,
     shared meter snapshot.
   - `GET /api/ops/errors?since=<ms>&limit=<n>`: audit rows of kind `error` (`wcl_error`,
     `server_error`), newest first, same paging as `/api/admin/audit`.
   - `GET /api/ops/logs?since=<ms>&limit=<n>`: the in-memory error ring (decision 4).
4. **An in-memory error ring with stack traces.** `server_error` rows keep a clipped message only;
   to fix a bug, the stack is what matters. `src/server.ts`'s catch-all (and every other
   `console.error` call site in hosted mode) pushes `{ at, message, stack, target }` into a ring of
   the last 500 entries. Lost on restart by design: the journal stays the durable record.
5. **Privacy: no IP, no Discord id, no username.** Ops responses drop `ip` and replace `userId` +
   `username` with an opaque `user#<id>`. `target` is kept (it is a route or a character name, which
   is public WCL data). The `/privacy` page gets one sentence: errors are readable by the operator's
   tooling, without identifying data.
6. **Agent side.** The cloud environment holds `BMPL_OPS_TOKEN` and `BMPL_URL`
   (`https://bmpl.riat.dev`) as environment variables; an agent runs
   `curl -H "Authorization: Bearer $BMPL_OPS_TOKEN" "$BMPL_URL/api/ops/errors"`. `docs/agents/`
   gets a short "Reading production errors" section; `docs/operator.md` documents the variable.

## Why not an MCP server

A remote MCP connector added on claude.ai would need its own auth flow (OAuth) in bmpl and would be
reachable from every chat, not only from coding sessions. Plain HTTP + a token stored in the
environment gives the same data with far less code. An MCP wrapper over these three routes can come
later without changing them.

## Error handling

- Missing or wrong token: 401 `{ ok: false, error: "Unauthorized" }`, audit `ops_denied`.
- Token unset: 404 (route invisible).
- Bad `since` / `limit`: 400, same messages as `/api/admin/audit`.

## Tests

- Config: weak token refused, unset token = routes 404, `describeConfig` never shows the value.
- Auth: no header / wrong token = 401 + audit row; right token = 200; POST = 405.
- Ring: capacity 500, newest first, `since` filter, stack kept, empty after a restart.
- Privacy: no `ip`, no `discordId`, no `username` anywhere in an ops response (asserted on a fixture
  that has all three).

## Out of scope

Log levels, structured logging of every request, Caddy access logs, alerting.
