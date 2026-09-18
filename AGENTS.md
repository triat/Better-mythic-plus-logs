# bmpl — agent guide

bmpl ("Better Mythic+ Logs") vets a World of Warcraft Mythic+ applicant from Warcraft Logs (WCL) + Raider.IO: a Bun CLI, a local web UI served by the same binary, and a SQLite cache. One repo, two TypeScript projects: the Bun backend/CLI in `src/` and a Vite + React front in `web/`.

This file is the entry point. Detail lives in `docs/agents/`:

| Read when… | File |
|---|---|
| touching `src/` (data flow, caches, WCL costs, invariants) | `docs/agents/architecture.md` |
| touching `web/` (import rules, view models, tokens, design canvas) | `docs/agents/web-front.md` |
| writing or running tests, capturing fixtures | `docs/agents/testing.md` |
| planning a feature, committing, using subagents, asking the user | `docs/agents/workflow.md` |

Design specs and plans: `docs/superpowers/specs/*.md` (what and why) and `docs/superpowers/plans/*.md` (how, task by task). Read the spec of the area you touch before changing behaviour. The README is the user manual — keep it true when behaviour changes.

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
```

`just dev <cmd>` runs the CLI in watch mode. `bmpl help` lists every command; `src/cli.ts` is the dispatcher.

## Hard rules

- **Never spend WCL points automatically.** Every WCL call costs budget (3600 pts/h per API client). Only `lookup`/`mplus` (rankings + run enrichment) and the explicit `analyze` / `POST /api/deepdive` fetch; anything else reads the SQLite cache. Raw WCL results are immutable → cached forever; analysis is always recomputed from raw.
- **`just check` and `bun test` green at the end of every task**, with `web/dist` absent (server answers 503 for static routes then).
- **English everywhere in code, UI strings, docs, commits.** The user writes French in chat; answer in French, write the product in English.
- **`web/` imports from `src/` are types only** (`import type … from "@shared/…"`), single runtime exception `src/wow/classes.ts`. `verbatimModuleSyntax` enforces it.
- **Front colours/radii/fonts come from `web/src/styles/tokens.css`**; never invent a value. Any visible UI change goes through the Claude Design canvas first (see `docs/agents/workflow.md`).
- **Git:** work on `main` in place, no history rewriting, no force push, push only when asked. Never stage the user's local files at the repo root: `biwaasham.json` (saved payload), `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`.
- **Config precedence:** flag > env var > file next to `.env` (`bmpl.db`, `evaluation.json`, `defensives.json` all resolve next to the `.env` found by `resolveEnvPath()` in `src/setup.ts`).
- **Class/spec keys** are WCL's spacing-free names: `DeathKnight:Blood`, `DemonHunter:Havoc`, `Class:*` wildcard. Source of truth: `src/wow/classes.ts` and `src/signals/kick-cooldowns.ts`.
- **Season data is versioned by file** (`src/signals/avoidable/season-mn-2.json`, `src/deepdive/defensives.json` `version: "mn-2.x"`). Bump the version when the content changes; the deep-dive audit script is the way to validate spell tables, not memory.

## Toolchain

Bun ≥ 1.3 (runtime, test runner, bundler, SQLite via `bun:sqlite`), TypeScript strict, `just` for recipes, Vite 8 + React 19 in `web/` (no router, no state lib, no CSS framework, no component lib). No linter/formatter is configured: match the surrounding style (2 spaces, double quotes, trailing commas, ≤ ~120 cols, `.ts` extensions in imports).

## Where things are

```
src/cli.ts            command dispatch            src/server.ts         Bun.serve: /api/* + embedded web/dist
src/lookup.ts         rankings → analysis → enrich (WCL ‖ Raider.IO) → payload
src/wcl/              OAuth2 + gql() + queries + meter     src/signals/          per-run signals, peers, RIO, SQLite store
src/evaluation/       axes → verdict (rules in default-config.json)
src/deepdive/         defensive-cooldown analysis  scripts/              dev-only tools (audit, fixtures, introspect)
src/hosted/           hosted-mode config, schema/repos (users, sessions, invites), per-user history/settings, quota gate, cookie/state/Discord helpers, auth gate
src/server/           route table, shared/local routes, handlers, SSE, security headers
web/src/lib/          pure tested view models      web/src/components/   thin React components
test/                 bun:test + fixtures/         docs/superpowers/     specs and plans
```

Current state and roadmap: sub-projects 1–4 (signals, evaluation, web front, deep-dive) are shipped. Sub-project 5 (hosted multi-user service) is filed as GitHub issues #1–#11; #2–#5 (hosted skeleton, Discord login, per-user state, WCL budget / per-member quotas) are shipped, next is #6 (shared defensives table).
