# Observability — design

Status: implemented 2026-10-15 (approved the same day: "ok go"). Amended while implementing: decisions 4, 8, 9, 10 and 12, marked.

## Goal

Follow both the activity and the errors of the hosted instance in one place, with exact timestamps and data that can be
filtered and counted, instead of the admin page's relative times ("il y a 1 jours") and an error list that empties at
every restart.

## Non-goals

- No log or metric leaves the VPS (no SaaS).
- No change to what members see.
- No import of past logs (user, 2026-10-15: the history does not matter).
- No metrics database (Prometheus, VictoriaMetrics) in this step: the charts are computed from the logs.

## Decisions (user answers of 2026-10-15)

1. **Grafana + VictoriaLogs + Grafana Alloy, on the VPS.** VictoriaLogs reached v1.0.0 on 2024-11-12 and its FAQ states
   it is production-ready from that version; it is young, so the setup is built to be replaceable by Loki without
   touching bmpl (decision 6).
2. **Retention: 90 days**, the same as the audit log (`-retentionPeriod=90d`).
3. **Grafana on its own subdomain, `logs.bmpl.riat.dev`**, behind Caddy (TLS), with Grafana's own login.

## Proposed (to confirm)

4. **bmpl writes structured logs.** One JSON object per line on stdout (journald keeps it), from one small module
   (`src/log.ts`): `ts` (ISO 8601, UTC, milliseconds), `level` (`info` | `warn` | `error`), `event`, then the event's
   fields. Events:
   - `http_request`: `method`, `route` (the route template, never the raw path with a character name), `status`,
     `ms`, `user` (`user#<id>` or null), `wcl_points` (the meter's charge for that request), `req` (a request id, also
     in the response header `X-Request-Id` and in the error ring, so a member's report can be traced).
   - `server_error`: `route`, `req`, `message`, `stack`.
   - `audit`: every audit row as it is written (`action`, `user`, `target`, `detail`), so Grafana shows logins, bans,
     quota refusals next to the requests.
   - `wcl_error`, `bnet_check`, `discord_login_failed`, … : today's `console.error` lines, each with its fields.
   - `calibration_hour` / `calibration_fit`: the recalibration's summary lines (sampled, failed, pages, stop reason,
     points this hour).
   No IP and no Discord id in bmpl's own lines: `user#<id>` only, as in the ops API. The startup banner stays human text
   in local mode; hosted mode logs it as one `startup` event. Amended: every line also carries `msg` (the event and its
   most telling field), which VictoriaLogs takes as the message; `wcl_error` (kind, status) and an hourly `health` line
   (backup age, members, sessions) feed the Errors dashboard and the alerts; `calibration_hour` carries the window's
   total. The audit mirror carries the action, its kind and the member only (a target can name a Discord account).
5. **Alloy collects two sources**: the journal of `bmpl.service` and of the two `bmpl-calibrate-*` units (JSON parsed
   into fields), and Caddy's access log (`/var/log/caddy/bmpl.log`, already JSON: client IP, status, duration, size).
   It pushes to VictoriaLogs through the Loki push API (`/insert/loki/api/v1/push`), which VictoriaLogs accepts.
6. **Replaceable by Loki.** Alloy speaks the Loki protocol, so moving to Loki means: install Loki, change one URL in
   Alloy, switch the Grafana data source, rewrite the dashboards' queries (LogsQL → LogQL). bmpl does not change. To keep
   that rewrite small, the dashboards and alert rules live in the repository (`deploy/grafana/`, provisioned files, no
   hand edits on the server) and stay few.
7. **Dashboards** (provisioned, read-only in the UI):
   - *Activity*: requests per hour by route, lookups and deep-dives per day, active members per day, WCL points per hour
     (members vs recalibration), logins.
   - *Errors*: server errors with their stack and request id, WCL errors by kind, 4xx/5xx rate, the slowest routes (p95).
   - *Recalibration*: characters sampled per hour, the window's total vs the 2,000 target, stop reasons, the last fit.
   - *Security*: rate-limited, origin-rejected and ops-denied events, top client IPs from Caddy.
8. **Alerts to a Discord channel** (a webhook URL, a secret in Grafana's environment file): a server error, more than
   5 WCL errors in 15 minutes, bmpl silent (no `health` line for over 2 hours; amended from "no request for 30 minutes
   during the day", which a 16-member instance would trip every quiet afternoon, and Caddy does not log its own health
   checks), the backup older than 2 hours, a recalibration run that failed. Grafana refuses to start with an empty
   webhook URL, so the rules are installed only once it is set.
9. **Resource limits.** Each new service runs under systemd with `MemoryMax` (VictoriaLogs 512 MB, Grafana 768 MB,
   Alloy 384 MB; amended after measuring locally ~20 MB for VictoriaLogs and ~400 MB for Grafana with its plugin; to be
   checked against real use in the first week) so none can starve bmpl (4 GB in all). Every port
   binds to `127.0.0.1` (VictoriaLogs 9428, Grafana 3001, Alloy 12345); only Caddy is public.
10. **Installation.** Grafana and Alloy from Grafana's apt repository (`apt.grafana.com`), VictoriaLogs as the pinned
    release binary (v1.53.0, checksum verified) under its own system user, the Grafana plugin pinned (0.32.0), all from
    `deploy/bootstrap.sh`, idempotent like the rest. Settings as `GF_*` variables in a systemd drop-in; secrets in
    `/etc/grafana/grafana.env`, created once with a random admin password. The user adds the DNS record `logs.bmpl.riat.dev` before running it (Caddy obtains the certificate).
11. **Grafana hardening.** Sign-up off, anonymous access off, the admin password set from `/etc/grafana/grafana.env`
    (never in the repository), the VictoriaLogs data source and the dashboards provisioned. Grafana's own brute-force
    protection is on by default (`disable_brute_force_login_protection = false`, 5 attempts), so no fail2ban jail.
12. **The admin page.** The audit table shows the exact date and time (`2026-10-14 21:03:12`, local time), the relative
    age as a tooltip; amended: the members' last visit too, the proposal queue and invites keep their age (a text
    format change in two cells, done without a canvas round). The technical sections (Instance, Usage gauges)
    stay until the dashboards are live; what moves out is decided then. Visible change: the Claude Design canvas first.
13. **Retention fixes found on the way.** `usage_hourly` and `usage_hourly_own` get the 90-day purge they lack today.
14. **Privacy page.** `/privacy` says that requests are logged for 90 days with the client IP (Caddy) and the member
    number, for operations and security only.

## Data flow

```
bmpl serve (JSON lines) ──┐
bmpl calibrate (JSON)  ───┼─ journald ─┐
Caddy access log (JSON) ──────────────┴─ Alloy ── Loki push API ── VictoriaLogs (90 d, /var/lib/victorialogs)
                                                                        │
                       logs.bmpl.riat.dev ── Caddy ── Grafana ─────────┘  (dashboards, alerts → Discord)
```

## Error handling

- VictoriaLogs or Alloy down: bmpl is unaffected (it only writes to stdout); journald keeps the lines and Alloy resumes
  from its saved position.
- Grafana down: no dashboards, no alerts; the admin page and `/api/ops/*` still work.
- A service over its `MemoryMax`: systemd kills and restarts it; bmpl keeps running.

## Tests

- `src/log.ts`: one valid JSON object per line, ISO timestamp, no field named `ip` or `discordId`, long values clipped.
- The request log: route template instead of the path, status, duration, `user#id`, request id in the header and the
  line; a 500 logs `server_error` with the same id.
- The admin time format: exact date and time, tooltip with the age.
- `test/deploy.test.ts`: the new units bind to loopback, carry `MemoryMax`, the retention is `90d`, the Caddyfile serves
  `logs.bmpl.riat.dev` to `127.0.0.1:3001`, no secret in the provisioning files.
- The dashboards and alert rules: valid JSON/YAML, every query names the VictoriaLogs data source by uid.

## Out of scope

- A metrics database and a `/metrics` endpoint (later, if the log-based charts are not enough).
- Login to Grafana with Discord.
- Moving the admin page's technical sections out (decided once the dashboards are live).
