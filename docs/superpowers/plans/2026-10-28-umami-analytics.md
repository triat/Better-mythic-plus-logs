# Umami on pgrust: plan

**Goal:** Umami at `analytics.riat.dev` on pgrust, fed by bmpl's page views and eight events.
**Architecture:** pgrust native under systemd, Umami in Docker under systemd, both loopback, Caddy in front; bmpl
loads Umami's tracker only when configured.
**Spec:** `docs/superpowers/specs/2026-10-28-umami-analytics-design.md`.

## Global Constraints (from the spec)

- pgrust `v0.4-beta`, `pgrust-0.4-beta-linux-x86_64.tar.gz`, SHA-256
  `9a53fdc039ca338808702641369b0ac7d6c163124f76f2bfd21860b0be9fb7bb`.
- Umami `ghcr.io/umami-software/umami:3.4.1@sha256:e69d1a7932e9dab0fc523edc7be1f3a53f3c261f57856fc2167ae74a8fc022e8`.
- pgrust `127.0.0.1:5432`, `MemoryMax=512M`; Umami `127.0.0.1:3002`, `--memory 384m`, `--network host`.
- Installed only when `/etc/bmpl/provision.conf` holds `ANALYTICS_DOMAIN`.
- Daily `pg_dump -Fc`, 7 kept, `/var/backups/umami`.
- `BMPL_ANALYTICS_URL` (https origin) + `BMPL_ANALYTICS_WEBSITE_ID` (UUID), both or neither, hosted only.
- Tracker: `data-auto-track="false"`, `data-exclude-search="true"`, `data-exclude-hash="true"`,
  `data-do-not-track="true"`, `data-domains=<host>`; one page view per page load with the page's kind.
- Events: `sign_in_click`, `lookup` (`source`), `compare` (`count` 2–5), `deepdive`, `season_sync`, `live_connect`,
  `wcl_client_set`, `bnet_link`; no other property.
- bmpl stays on SQLite.

## Files

| File | Responsibility |
|---|---|
| `src/hosted/config.ts` | `analytics` from the two variables |
| `src/server/security.ts`, `src/server.ts` | `cspFor` / `securityHeaders` with the Umami origin |
| `src/server/routes-shared.ts` | `/api/status` → `analytics` |
| `web/src/lib/analytics.ts` (+ test) | `pagePath`, `ANALYTICS_EVENTS`, `eventProps`, `scriptAttributes` |
| `web/src/analytics.ts` | `startAnalytics`, `analyticsEvent` |
| `App.tsx`, `Landing`, `ComparePage`, `WclClientCard`, `WclGuide`, `useSeason`, `CharactersPage` | the eight events, the boot page view |
| `PrivacyPage`, `i18n/{en,fr}.ts`, `changelog/{en,fr}.ts` | the privacy line, the changelog line |
| `deploy/pgrust.service`, `umami.service`, `umami-backup.{service,timer,sh}`, `Caddyfile.analytics` | the VPS pieces |
| `deploy/bootstrap.sh` § 4d and § 6, `deploy/provision.sh` | install, once-only secrets, the default account, `--analytics-domain` |
| `deploy/README.md` § 9e, `docs/hosted.md`, `docs/operator.md`, `.env.hosted.example`, `docs/agents/web-front.md` | docs |

## Tasks

1. Server: config, CSP, status; tests `test/hosted/config.test.ts`, `test/server-analytics.test.ts`,
   `test/server-hosted.test.ts`, `test/cli-serve.test.ts`. `bun test` those, `bun run typecheck`.
2. Front: `lib/analytics.ts` + test, `analytics.ts`, the boot page view, the eight events, the privacy line, the
   changelog line. `bun run --cwd web typecheck`, `bun test web/src`, `bun run lint`.
3. VPS: units, Caddy block, bootstrap § 4d / § 6, provision flag. `shellcheck`; run the analytics steps by hand in a
   scratch container against pgrust 0.4-beta and Umami 3.4.1 (initdb through `runuser`, role and database, TCP
   login, `pg_dump`, the default-account step twice).
4. Docs, full `just check`-equivalent and `bun test` with `web/dist` absent, commit, push.

Done 2026-10-28, all four in one pass (small enough for no subagents).
