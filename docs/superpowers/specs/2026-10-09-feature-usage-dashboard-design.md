# Feature usage tracking and admin dashboard — design

Status: draft 2026-10-09, awaiting review (canvas variants on the "usage" page of the design canvas).

## Goal

Tell the operator which features members actually use and which they never touch, so work goes where
it pays. Today the hosted instance knows WCL points per member and hour (`usage_hourly`), the audit log
and `users.last_seen_at`; nothing says whether anyone opens Compare, expands an axis, uses the Live
panel or reads the help page.

## Non-goals

- No third-party analytics (no script, no cookie, no external request). Everything stays in `bmpl.db`.
- No tracking in local mode or in the CLI: like the points meter, the usage recorder exists only in
  hosted mode.
- No per-event timeline, no session replay, no click coordinates, no free-text property. A row is a
  counter: (day, feature, member) → count.
- No change to scoring, quotas or the audit log.
- Not counting signed-out visitors (sign-in page, public help, privacy): there is no member to attach
  them to and no consent model for anonymous visitors.

## Decisions

1. **Granularity: per member, per UTC day, kept 90 days** (user's choice, 2026-10-09). One table:

   ```sql
   CREATE TABLE IF NOT EXISTS usage_events (
     day     INTEGER NOT NULL,   -- UTC midnight, epoch ms
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     event   TEXT    NOT NULL,
     n       INTEGER NOT NULL,
     last_at INTEGER NOT NULL,
     PRIMARY KEY (event, day, user_id)
   );
   CREATE INDEX IF NOT EXISTS usage_events_day ON usage_events(day);
   ```

   Upsert `n = n + ?`, `last_at = max(last_at, ?)`. Purged with the audit log in the runtime's daily
   housekeeping (`src/hosted/runtime.ts`): `day < now - 90 days`. Account deletion cascades.

2. **Two sources, one closed catalogue** (user's choice: API + UI events). `src/hosted/usage-catalog.ts`
   is the single source of truth: every event name, its source (`api` or `ui`), its category and the
   modes it exists in. The front imports the UI names as a type only (`import type { UiEvent }`), as
   the `web/` import rule requires.
   - **API events** are recorded by the server after a successful handler, so they cannot be lost to an
     ad blocker or a closed tab. They are the authority for anything that calls an API.
   - **UI events** cover what never reaches the server (expanding an axis, opening Compare, the radar
     legend, help links). The front sends them in batches to `POST /api/usage/events`.
   - An action that calls an API is never also a UI event (no double count). Exception: the trigger of
     a lookup that has its own meaning (`live_check`, `reevaluate`) is a UI event, the lookup itself the
     API event.

3. **Catalogue v1** (names are final once shipped: renaming one splits its history).

   | Category | API events | UI events |
   |---|---|---|
   | Lookup | `lookup` (fetched from WCL), `lookup_cached` (served from history), `lookup_refresh` | `reevaluate`, `key_level_change`, `region_change`, `spec_pick`, `metric_pick` |
   | Result | | `page_main_result` (a result rendered), `axis_expand`, `legend_toggle`, `runs_toggle`, `rio_toggle`, `external_log`, `external_rio` |
   | Deep-dive | `deepdive`, `deepdive_reanalyze`, `defensives_correction` | `deepdive_panel_open`, `analyze_all` |
   | History & compare | `history_open`, `history_close`, `history_clear` | `compare_open` |
   | Live | `live_roster` (`POST /api/live/cached`) | `live_connect`, `live_check`, `live_auto_toggle`, `live_filter` |
   | Help | | `page_help`, `help_link` |
   | Account | `wcl_client_set`, `wcl_client_verify`, `wcl_client_remove`, `settings_save` | `page_settings`, `page_privacy`, `locale_switch`, `toast_own_client` |
   | Admin | | `page_admin` |

   `login` is not an event: the audit log already has it.

4. **`POST /api/usage/events`** (hosted, signed-in member, Origin check as any POST). Body
   `{ events: Record<UiEvent, number> }`: at most 40 names, each count an integer 1..50. Unknown names
   are dropped silently (a tab opened before a deploy may send an old name), invalid shapes are a 400.
   Rate-limited with a new `usage` limiter: 30 requests per minute per member. Answers
   `{ ok: true }`. Counts 0 WCL points.

5. **Front batching** (`web/src/lib/usage.ts`, pure and tested; `api.usage()` in `api.ts`). `track(name)`
   adds to an in-memory map; a flush sends the map when it holds 20 events, every 15 s, and on
   `visibilitychange` → hidden (with `fetch(..., { keepalive: true })`, which keeps the same Origin as
   any other POST; `sendBeacon` is not used). A failed flush drops the batch: losing a few UI counts
   beats retry logic. `track` is a no-op in local mode and when signed out.

6. **Admins are counted but filtered by default.** The operator is the heaviest user; the dashboard has
   an "Include admins" toggle, off by default.

7. **Admin API.** `GET /api/admin/features?days=7|30|90&admins=0|1` returns:
   - `active`: distinct members with at least one event, for the last 1, 7 and 30 days, plus
     `members` (all non-banned accounts);
   - `daily`: per day, distinct active members;
   - `features`: one entry per catalogue name (also the unused ones, with zeros) with `category`,
     `source`, `uses`, `users`, `share` (users / active members of the period), `lastAt`, `daily`
     (counts per day for the sparkline) and `top` (the 5 members with the most uses: id, username,
     uses, lastAt).
   One query per call over at most 90 days × catalogue × members; fine at this instance's size.

8. **Ops API.** `GET /api/ops/features?days=` returns the same `features` without `top` and without
   any user id (same privacy rule as the other `/api/ops/*` routes): an agent can analyse usage
   without seeing who.

9. **Dashboard.** A new "Usage" section on the admin page, anchored `#usage` in the sub-nav, between
   Budget and Proposals. Layout and wording come from the variant chosen on the canvas (page "usage":
   A table with sparklines, B cards by category, C feature × day heatmap, plus shared details).

10. **Privacy.** `/privacy` and `docs/hosted.md` gain one line: "Which features you use: a count per
    feature and day, kept 90 days, deleted with your account." `DELETE /api/me` already cascades.

## Data flow

```
UI action ──track()──► lib/usage.ts queue ──POST /api/usage/events──► usage recorder ─┐
API handler success ────────────────────────────────────────────────► usage recorder ─┤
                                                                                       ▼
                                                                         usage_events (bmpl.db)
admin page ◄── GET /api/admin/features ◄────────────────────────────────── aggregate query
agent      ◄── GET /api/ops/features (no user ids) ◄───────────────────── aggregate query
```

## Error handling

- Recording never fails a request: the recorder catches and logs once to stderr, like `AuditLog.record`.
- A 429 or a network error on a flush is ignored by the front.
- Unknown event names in a batch are ignored; a malformed body is a 400 with a reason.

## Tests

- `test/hosted/usage.test.ts`: repo upsert, day bucketing in UTC, purge at 90 days, cascade on user
  delete, aggregate (users, uses, share, zeros for unused, admin filter, top 5).
- `test/server-usage.test.ts`: `POST /api/usage/events` validation, unknown names dropped, rate limit,
  local mode 404, signed-out 401; API events recorded on success only (`lookup` vs `lookup_cached`);
  `GET /api/admin/features` admin-only; `GET /api/ops/features` without user ids.
- `web/src/lib/usage.test.ts`: batching thresholds, flush on hidden, no-op in local mode.
- `web/src/lib/admin.test.ts`: the dashboard view model (sorting, unused group, share formatting).

## Out of scope

- Funnels and retention cohorts (week-over-week return rate). The table allows them later.
- Per-feature timing (how long a panel stays open).
- An email or Discord digest.
