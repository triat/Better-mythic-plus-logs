# bmpl — agent guide

bmpl ("Better Mythic+ Logs") vets a World of Warcraft Mythic+ applicant from Warcraft Logs (WCL) + Raider.IO: a Bun CLI, a local web UI served by the same binary, and a SQLite cache. One repo, two TypeScript projects: the Bun backend/CLI in `src/` and a Vite + React front in `web/`.

This file is the entry point. Detail lives in `docs/agents/`:

| Read when… | File |
|---|---|
| touching `src/` (data flow, caches, WCL costs, invariants) | `docs/agents/architecture.md` |
| touching `web/` (import rules, view models, tokens, design canvas) | `docs/agents/web-front.md` |
| writing or running tests, capturing fixtures | `docs/agents/testing.md` |
| planning a feature, committing, using subagents, asking the user | `docs/agents/workflow.md` |

Design specs and plans: `docs/superpowers/specs/*.md` (what and why) and `docs/superpowers/plans/*.md` (how, task by task). Read the spec of the area you touch before changing behaviour. User docs: `README.md` (entry), `docs/{cli,scoring,deep-dive,hosted,operator}.md`, `deploy/README.md` — keep them true when behaviour changes.

## Commands

```
just install && just web-install   # deps (root + web/)
just check                          # tsc for src/ AND web/ — must pass before every commit
just test [pattern]                 # bun test from the repo root (runs web/src/**/*.test.ts too)
just build                          # web/dist (Vite) then ./bmpl (bun --compile)
just serve [--no-open]              # bmpl serve: web UI on :3000
just serve --hosted                 # hosted mode (needs .env.hosted.example variables)
just web-dev                        # Vite on :5173, proxies /api to :3000 (run `just serve --no-open` too)
just l Name-Realm [--level N]       # bmpl lookup, the core flow
bun src/cli.ts analyze Name-Realm   # deep-dive (spends WCL points — read architecture.md first)
just audit-defensives [--only Class:Spec]   # ~9 WCL pts per spec per run
just build-linux                            # cross-compile dist/bmpl-linux for the VPS (local, safe)
just deploy                                 # touches the VPS by hand — only when the user asks, never from an agent (needs BMPL_DEPLOY_HOST)
gh workflow run release -f bump=patch       # the normal way to ship (patch|minor|major; or Actions → release): CI, audit, bump, tag, release, deploy — only when the user asks
just lint                                   # Biome lint (biome.json); errors fail CI, warnings are reported
just check-deps                             # bun audit on both lockfiles — run before a release
```

`just dev <cmd>` runs the CLI in watch mode. `bmpl help` lists every command; `src/cli.ts` is the dispatcher.

## Hard rules

- **Never spend WCL points automatically.** Every WCL call costs budget (3600 pts/h per API client). Only `lookup`/`mplus` (rankings + run enrichment) and the explicit `analyze` / `POST /api/deepdive` fetch; anything else reads the SQLite cache. Raw WCL results are immutable → cached forever; analysis is always recomputed from raw. One user-approved exception (2026-10-14): the weekly recalibration's `bmpl calibrate --hourly` / `--fit`, run only by their systemd timers on the VPS, on the instance's client, bounded by `src/calibration/window.ts` (`limitPerHour − BMPL_CALIBRATION_RESERVE`, 5-minute pause after a member, one lookup every 16 s, 2,000-character target) and writing only `calibration.db` (spec `docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md`). Agents never run them, nor import a `scripts/calibration/*.ts` file to "check it loads": several run their collection on import; typecheck them with `tsc` instead.
- **`just check` and `bun test` green at the end of every task**, with `web/dist` absent (server answers 503 for static routes then).
- **English everywhere in code, docs and commits; UI strings live in `web/src/i18n/` — `en.ts` is the source, `fr.ts` mirrors it key for key; never write a UI literal in a component.** The user writes French in chat; answer in French.
- **Every change a user can notice goes into the user-facing changelog**, in the same change: a line under `"next"` in
  `web/src/changelog/en.ts` and the same line in `fr.ts` (plain player language, one sentence, no internal names). That
  covers a new feature, a changed screen, a score, verdict or signal that moves, a fixed bug a player could see. Tests,
  CI, refactors and docs add none. Check it before ending every task: nobody else writes these lines. The release stamps
  `"next"` with the version and refuses to run without it (spec `docs/superpowers/specs/2026-10-14-whats-new-design.md`).
- **`web/` imports from `src/` are types only** (`import type … from "@shared/…"`), single runtime exception `src/wow/classes.ts`. `verbatimModuleSyntax` enforces it.
- **Front colours/radii/fonts come from `web/src/styles/tokens.css`**; never invent a value. Any visible UI change goes through the Claude Design canvas first (see `docs/agents/workflow.md`).
- **Git:** work on `main` in place, no history rewriting, no force push, push only when asked. Never stage the user's local files at the repo root: `biwaasham.json` (saved payload), `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`.
- **Config precedence:** flag > env var > file next to `.env` (`bmpl.db`, `evaluation.json`, `defensives.json` all resolve next to the `.env` found by `resolveEnvPath()` in `src/setup.ts`).
- **Class/spec keys** are WCL's spacing-free names: `DeathKnight:Blood`, `DemonHunter:Havoc`, `Class:*` wildcard. Source of truth: `src/wow/classes.ts` and `src/signals/kick-cooldowns.ts`.
- **Season data is versioned by file** (`src/signals/avoidable/season-mn-2.json`, `src/deepdive/defensives.json` `version: "mn-2.x"`). Bump the version when the content changes; the deep-dive audit script is the way to validate spell tables, not memory.
- **Production errors** are readable without SSH through the read-only `/api/ops/*` routes when the environment defines `BMPL_OPS_TOKEN` and `BMPL_URL` — see "Reading production errors" in `docs/agents/architecture.md`. The token is a secret like the others below.
- **Hosted secrets**: `BMPL_ENCRYPTION_KEY` is never logged, never shown, never in an audit row — only whether it is set (`src/hosted/instance.ts`'s `describeConfig`). A member's own WCL client secret is stored only as AES-256-GCM ciphertext (`src/hosted/crypto.ts`) and decrypted back to plaintext only for the duration of one request. A request that runs through a member's own client bypasses the shared meter, `usage_hourly` and the quota gate by design (its spend is only recorded in `usage_hourly_own`, for the admin page) (see `runWithWclClient` in `docs/agents/architecture.md`) — that is not a bug to "fix".

## Toolchain

Bun ≥ 1.4, pinned to 1.4.3 in `.tool-versions` and the deploy workflow (runtime, test runner, bundler, SQLite via `bun:sqlite`), TypeScript 7 strict (`tsc` is the native compiler), `just` for recipes, Vite 8 + React 19 in `web/` (no router, no state lib, no CSS framework, no component lib). Biome lints (`biome.json`: recommended rules minus `noNonNullAssertion`/`useTemplate`, a few UI rules kept as warnings; formatter off); CI (`.github/workflows/ci.yml`) runs `just check`, `just lint`, `bun test` and `just build-linux` on every push to main and every pull request. No formatter: match the surrounding style (2 spaces, double quotes, trailing commas, ≤ ~120 cols, `.ts` extensions in imports).

## Where things are

```
src/cli.ts            command dispatch            src/server.ts         Bun.serve: /api/* + embedded web/dist
src/lookup.ts         rankings → analysis → enrich (WCL ‖ Raider.IO) → payload
src/wcl/              OAuth2 + gql() + queries + meter     src/signals/          per-run signals, peers, RIO, SQLite store
src/evaluation/       axes → verdict (rules in default-config.json)
src/deepdive/         defensive-cooldown analysis  scripts/              dev-only tools (audit, fixtures, introspect)
src/self/             self-review: game weeks, season sync, season view, "My characters"
src/calibration/      weekly recalibration: discovery, sample store (calibration.db), governor, hourly collector, fit, PR candidate
src/log.ts            structured JSON logs (one line per event; deploy/grafana/ dashboards and alerts read their fields)
src/hosted/           hosted-mode config, schema/repos (users, sessions, invites), per-user history/settings, shared defensives + proposals, quota gate, feature-usage counters, cookie/state/Discord helpers, Battle.net link + 30-day check, auth gate
src/server/           route table, shared/local routes, handlers, SSE, security headers
deploy/               VPS files (Caddy, systemd, litestream, bootstrap) — source of truth for the runbook in `deploy/README.md`
addon/bmpl/            in-game addon: draws the Live panel's pixel strip, mirrors web/src/lib/live/codec.ts — addon/README.md
web/src/lib/          pure tested view models      web/src/components/   thin React components (shell/: the frame + palette)
test/                 bun:test + fixtures/         docs/superpowers/     specs and plans
```

Current state and roadmap: everything up to sub-project 6 is shipped and live on bmpl.riat.dev.
Sub-projects 1–4 (signals, evaluation, web front, deep-dive); sub-project 5, the hosted multi-user
service, as GitHub issues #1–#11 (hosted skeleton, Discord login, per-user state, WCL budget /
per-member quotas, shared defensives table, hosted front, admin page, hardening, VPS deployment, open
signup / own WCL clients / bans / privacy); and sub-project 6, the game integration, shipped in v0.4.0
— the `addon/` tree, `web/src/lib/live/`, `POST /api/live/cached`, spec
`docs/superpowers/specs/2026-09-22-game-integration-design.md`. The hosted instance runs with open
sign-up since 2026-09-24. Self-review phase 1 is implemented (spec
`docs/superpowers/specs/2026-10-09-self-review-pillars-design.md`): five pillars over the evaluation's
evidence, the `character_runs` season store filled by lookups at 0 pts, the season sync (own WCL
client when hosted), the result page's three tabs (Overview, Dungeons, Runs) and the personal page `/me`.
Self-review phase 2 is implemented (spec
`docs/superpowers/specs/2026-10-10-self-review-control-design.md`, plan
`docs/superpowers/plans/2026-10-10-self-review-phase-2.md`; crowd-control table `mn-2.2` audited, per-spec
reference collected on 894 runs across the eight dungeons, each weighing the same): crowd control in the Control pillar only (`pillarOnly`, never the verdict), `wcl_run_control`,
fetched only for the member's own characters, and the vetting view for everyone else. Battle.net linking is
implemented (spec `docs/superpowers/specs/2026-10-11-battlenet-linking-design.md`, plan
`docs/superpowers/plans/2026-10-11-battlenet-linking.md`; live check pending the release): hosted "My characters"
(up to 20) come only from the member's linked Battle.net account, re-checked with Blizzard every 30 days, manual
entries removed at launch; local mode keeps the manual list. UI redesign phase 1 is implemented (spec
`docs/superpowers/specs/2026-10-11-ui-redesign-design.md`, plan `docs/superpowers/plans/2026-10-11-ui-redesign-phase-1.md`,
mockups `docs/design/redesign/`): new tokens, self-hosted Geist fonts, the sidebar frame (search, Récents, account) and
the Ctrl K palette around every page, the pages `/candidate`, `/compare` and `/live`, the connected home page and the
hosted landing. Redesign phase 2 is implemented (plan `docs/superpowers/plans/2026-10-12-ui-redesign-phase-2.md`): the
candidate profile — compact header, Synthèse, Runs with the layered timeline, the run sheet, Donjons, Méthode — and the
Experience axis removed. Redesign phase 3 is implemented (plan `docs/superpowers/plans/2026-10-12-ui-redesign-phase-3.md`):
the owner pages — Ma forme, Donjons, Runs with filters and week groups, `as=vetting` — and Mes personnages as cards.
The weekly recalibration is implemented (spec `docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md`,
plan `docs/superpowers/plans/2026-10-14-weekly-recalibration.md`; live once the user re-runs `deploy/bootstrap.sh` after the
release and adds the repository secrets `BMPL_URL` and `BMPL_OPS_TOKEN`): `src/calibration/`, `bmpl calibrate`, the two
VPS timers, `GET /api/ops/calibration` and `.github/workflows/calibration-pr.yml`. The logs stack is implemented (spec
`docs/superpowers/specs/2026-10-15-observability-design.md`; live once the user adds the DNS record `logs.<domain>` and
re-runs `deploy/bootstrap.sh` once after the release; later releases apply `deploy/` themselves through `bmpl-provision`): `src/log.ts`, VictoriaLogs + Alloy + Grafana on the VPS, dashboards and
alert rules in `deploy/grafana/`. Redesign phase 4 is implemented (plan `docs/superpowers/plans/2026-10-12-ui-redesign-phase-4.md`): Compare 2–5 (duel /
ranking), the Live page in the frame, the old CSS and components removed — the redesign is complete. Next: self-review
phase 3 (own spec), WCL items in issue #24. Unscheduled ideas live
as GitHub issues #12–#19.
