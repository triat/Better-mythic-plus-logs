# Umami on pgrust: page and event analytics for bmpl

Status: draft, 2026-10-28, for the user's review.

## Goal

Run a self-hosted [Umami](https://umami.is) at `analytics.riat.dev` on the bmpl VPS, backed by
[pgrust](https://github.com/malisper/pgrust) instead of stock PostgreSQL, and send it bmpl's page views and a short
list of named events. The admin page's feature usage (`usage_events`, spec
`docs/superpowers/specs/2026-10-09-feature-usage-dashboard-design.md`, catalogue `src/hosted/usage-catalog.ts`) stays as it is: it counts per member and
signed in only; Umami adds what it cannot see, the signed-out visitors (landing, help, privacy), referrers, countries,
devices and the funnel from the landing to the first lookup.

## Non-goals

- **bmpl does not move to pgrust (decided 2026-10-28).** pgrust's README says "We don't recommend running pgrust in
  production (yet)" and "pgrust still has a lot of bugs", and asks to keep stock Postgres "as the source of truth for
  data you can't afford to lose". bmpl's data stays in SQLite (`bun:sqlite`, synchronous everywhere, litestream
  backups). Umami's data is the test bed: losing it costs statistics, nothing else. Revisit with its own spec once
  pgrust leaves beta.
- No Umami for local mode: the script is never loaded there.
- No session replay, heatmaps or Umami's other recorders (`recorder.js`): page views and events only.
- No change to the admin page (no Umami embed, no link). The operator opens `analytics.riat.dev` directly.

## Decisions

1. **pgrust native, Umami in Docker** (user's choice). pgrust runs from its official binary tarball under systemd,
   like VictoriaLogs and litestream; Umami runs from its official image under a systemd unit that wraps
   `docker run`.
2. **Pinned versions with checksums.** pgrust `v0.4-beta`, `pgrust-0.4-beta-linux-x86_64.tar.gz`, SHA-256
   `9a53fdc039ca338808702641369b0ac7d6c163124f76f2bfd21860b0be9fb7bb` (from pgrust.com's `MANIFEST.txt`, checked
   against the download on 2026-10-28). Umami `ghcr.io/umami-software/umami:3.4.1` pinned by digest (the digest is
   read at implementation time with `docker buildx imagetools inspect` and written in `bootstrap.sh`). Bumping either
   is a one-line change in `bootstrap.sh`, applied by the next release.
3. **Opt-in by domain.** The whole stack (pgrust, Docker, Umami, the Caddy block, the backup timer) is installed only
   when `/etc/bmpl/provision.conf` holds `ANALYTICS_DOMAIN=…`, set once with
   `bmpl-provision vX.Y.Z --analytics-domain analytics.riat.dev`. It is not derived from `DOMAIN`: `analytics.riat.dev`
   is not under `bmpl.riat.dev`. Without it, `bootstrap.sh` behaves exactly as today. Nothing is removed when the
   value is later emptied; § "Uninstall" in `deploy/README.md` does that by hand.
4. **Loopback only.** pgrust listens on `127.0.0.1:5432`, Umami on `127.0.0.1:3002` (`--network host`, `HOSTNAME`
   and `PORT` set): no Docker-published port, so Docker's own iptables rules never open anything past ufw. Caddy
   serves `analytics.<…>` → `127.0.0.1:3002` with the same headers as the other blocks.
5. **Memory caps** on a 4 GB VPS already holding bmpl and the logs stack (512 + 384 + 768 MB): pgrust
   `MemoryMax=512M` (it reads its cgroup limit: its log says "memory watchdog: armed: limit=… (source=cgroup v2
   memory.max)"); Umami `--memory 384m`. Measured locally on 2026-10-28, idle after migrations and a few events:
   pgrust 215 MB RSS, Umami 174 MiB.
6. **Secrets created once, never printed in logs.** `/etc/umami/umami.env` (root:root, 600): `DATABASE_URL` with a
   random password for the `umami` role, `APP_SECRET` (random), `DISABLE_TELEMETRY=1`, `HOSTNAME=127.0.0.1`,
   `PORT=3002`. The database, the role and its password are created by `bootstrap.sh` through pgrust's `psql` on the
   first run.
7. **Umami's default account is closed by the bootstrap.** Umami creates `admin` / `umami` at its first start. Right
   after Umami answers `/api/heartbeat`, `bootstrap.sh` logs in with those credentials; when that succeeds it sets a
   random password through Umami's API and writes it to `/etc/umami/admin-password` (root:root, 600), printing only
   the path. The operator changes it at first sign-in. A later run finds the default refused and does nothing.
8. **Backups: a daily `pg_dump`.** pgrust's tarball has no `pg_dump` (`bin/{postgres,initdb,psql}`), so
   `postgresql-client-18` comes from the PGDG apt repository. A timer runs
   `pg_dump -Fc` to `/var/backups/umami/umami-YYYY-MM-DD.dump` and keeps 7. They protect against a pgrust bug that
   corrupts the data, the main risk here, not against losing the VPS (no off-site copy: the data can be lost). Tested
   locally on 2026-10-28: `pg_dump` 18 against pgrust 0.4-beta, then `pg_restore` into stock PostgreSQL 18, 5 of 5
   events back. That dump is also the way out: if pgrust misbehaves, install `postgresql-18`, restore the latest dump,
   point `DATABASE_URL` at it.
9. **bmpl loads the tracker only when configured.** Two optional variables in `/opt/bmpl/.env`, hosted mode only:
   `BMPL_ANALYTICS_URL` (`https://analytics.riat.dev`) and `BMPL_ANALYTICS_WEBSITE_ID` (the UUID Umami gives the
   website). Both set → `GET /api/status` carries `analytics: { url, websiteId }`, the CSP adds the origin to
   `script-src` and `connect-src`; otherwise `analytics: null` and nothing changes.
10. **No personal data leaves for Umami.** The tracker is added by `web/src/analytics.ts` (not in `index.html`, so
    the CSP stays without inline scripts) with `data-auto-track="false"`, `data-exclude-search="true"`,
    `data-exclude-hash="true"`, `data-do-not-track="true"` and `data-domains` set to bmpl's host. Page views are sent
    by hand once per page load with the page's kind as URL (`/`, `/candidate`, `/compare`, `/live`, `/me`, `/help`,
    `/settings`, `/privacy`, `/admin`, the landing as `/`): never a query (`?open=`, `?q=`, `?pick=` hold character
    names), never a character, never a Discord id. Event properties are from a closed list (below), checked by a
    test. Umami itself sets no cookie and keeps no IP address (it derives a session from a salted hash that rotates).
11. **Events: eight, fired by the front after the action succeeds.** One `analytics.event(name, props?)` call per
    place, a no-op when Umami is not loaded:

    | Event | When | Properties |
    |---|---|---|
    | `sign_in_click` | the landing's Discord button | none |
    | `lookup` | a lookup answered | `source`: `fetched` \| `cached` |
    | `compare` | the compare page shows 2+ profiles | `count`: 2–5 |
    | `deepdive` | a run analysed | none |
    | `season_sync` | a sync finished | none |
    | `live_connect` | the Live capture connected | none |
    | `wcl_client_set` | a member saved their own WCL client | none |
    | `bnet_link` | the Battle.net round trip came back linked | none |

12. **Privacy page and changelog.** `/privacy` gains one paragraph (from the dictionaries): what Umami receives (page
    kind, referrer, browser, OS, device, country, screen size, language, the events above), that it sets no cookie,
    is hosted on the same VPS, and that the browser's Do Not Track turns it off. One changelog line under `"next"`
    (en/fr), since a player can notice the privacy change. The landing gets no banner: no cookie, no identifier
    stored in the browser. (I am not a lawyer: the operator decides whether that reading fits their jurisdiction.)

## Data flow

```
browser ──GET /api/status──▶ bmpl ──analytics: {url, websiteId}──▶ browser
browser ──<script src=https://analytics.riat.dev/script.js>──▶ Caddy ──▶ Umami :3002
browser ──POST /api/send {page kind | event}──▶ Caddy ──▶ Umami ──▶ pgrust :5432 (127.0.0.1)
timer (daily) ──pg_dump -Fc──▶ /var/backups/umami (7 kept)
```

## VPS files (`deploy/`)

| File | Role |
|---|---|
| `bootstrap.sh` § 4d | when `ANALYTICS_DOMAIN` is set: pgrust tarball (checksum) into `/opt/pgrust/<version>`, user `pgrust`, `initdb -E UTF8 --auth=scram-sha-256` once into `/var/lib/pgrust`, the role and database, `docker.io` and `postgresql-client-18`, the image pull by digest, `/etc/umami/umami.env`, the default-account step, the backup timer |
| `pgrust.service` | `postgres -D /var/lib/pgrust -h 127.0.0.1 -p 5432`, user `pgrust`, `KillSignal=SIGINT` (Postgres' fast shutdown, which pgrust's README calls safe), `MemoryMax=512M`, `Restart=on-failure` |
| `umami.service` | `Requires=docker.service pgrust.service`, `ExecStart=docker run --rm --name umami --network host --memory 384m --env-file /etc/umami/umami.env ghcr.io/…@sha256:…`, `ExecStop=docker stop umami` |
| `umami-backup.service` / `.timer` | daily 04:30 Europe/Paris, `pg_dump -Fc`, keep 7, one JSON log line (`event: "umami_backup"`) for Grafana |
| `Caddyfile.analytics` | the `analytics.example.com` block, rewritten to `ANALYTICS_DOMAIN` and appended to the Caddyfile only when set |
| `provision.sh` | `--analytics-domain <domain>` writes `ANALYTICS_DOMAIN=` into `provision.conf` once; passes it to `bootstrap.sh` |

## bmpl files

| File | Change |
|---|---|
| `src/hosted/config.ts` | `analytics: { url, websiteId } \| null` from the two variables; a URL that is not `https://` or a website id that is not a UUID is a startup error |
| `src/server/security.ts` | the CSP takes the analytics origin when configured |
| `src/server/routes-shared.ts` | `GET /api/status` → `analytics` |
| `web/src/lib/analytics.ts` | pure: `pageKind(pathname)`, `ANALYTICS_EVENTS` and their allowed properties, `analyticsAttributes(cfg, host)` |
| `web/src/analytics.ts` | loads the script once, `pageview()`, `event(name, props)`; no-op until loaded and in local mode |
| components | the eight `event` calls of decision 11 |
| `web/src/i18n/{en,fr}.ts`, `PrivacyPage` | the privacy paragraph |
| `web/src/changelog/{en,fr}.ts` | one line under `"next"` |
| `.env.hosted.example`, `docs/hosted.md`, `docs/operator.md`, `deploy/README.md` | the two variables, the install steps (DNS `A` record for `analytics.riat.dev` first), backups, uninstall |

## Error handling

- Umami down or blocked by an extension: the script fails to load or `/api/send` fails; bmpl never waits on it and
  never reports it (it is not in `clientErrors`' own-scripts list).
- pgrust down: Umami answers 500 to `/api/send`; same as above for bmpl. `pgrust.service` restarts on failure; the
  Grafana "Errors" view gets the unit's journal through Alloy like the other units.
- The bootstrap's default-account step fails (Umami slow to start): the run reports it and goes on; the next run
  retries. The operator can also change the password by hand at first sign-in.
- A pgrust upgrade: `pg_dump` first, then the version bump; restore into a fresh data directory if the new version
  refuses the old one.

## Tests

- `test/hosted/config.test.ts`: the two variables, both or neither, the URL and UUID checks.
- `test/server/security.test.ts`: the CSP with and without analytics.
- `web/src/lib/analytics.test.ts`: `pageKind` for every page and for paths with queries; every event of the table and
  no other; a property outside the allowed list is refused; the attributes.
- `bootstrap.sh`: `shellcheck`, and a run in a scratch container with `ANALYTICS_DOMAIN` set and unset (unset: no
  pgrust, no Docker, no change to the Caddyfile).
- Already checked by hand on 2026-10-28 in a scratch container: pgrust 0.4-beta starts, Umami 3.4.1 applies its 26
  migrations on it ("All migrations have been successfully applied."), login, website creation, `/api/send` for page
  views and a named event, the stats, path, event and time-series endpoints all answer; `pg_dump` 18 → `pg_restore`
  into PostgreSQL 18 works.

## Out of scope

- bmpl on pgrust (non-goal above).
- An off-site copy of the Umami dumps.
- Umami for other sites of `riat.dev` (possible later: one more website in Umami, nothing in this repo).

## Sources

- pgrust README: https://github.com/malisper/pgrust
- pgrust downloads and manifest: https://pgrust.com/downloads/v0.4-beta/
- Umami: https://github.com/umami-software/umami (image `ghcr.io/umami-software/umami`, 3.4.1 on 2026-10-28)
