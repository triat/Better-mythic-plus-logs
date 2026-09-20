# Documentation restructure (public README, reference docs, operator runbook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 864-line README into a ~250-line public entry point, move the detailed material into `docs/scoring.md`, `docs/deep-dive.md`, `docs/hosted.md`, `docs/cli.md` and `deploy/README.md` (moved, re-linked, corrected only where the code proves it stale), and write `docs/operator.md`, the task-oriented runbook for the person running an instance.

**Architecture:** Pure documentation, plus one test that keeps every relative Markdown link and heading anchor in the repo's docs valid (`test/docs-links.test.ts`, filesystem only). Content moves by README line ranges given below (measured on commit eb0a9df; re-check with `grep -n "^## "` before cutting). Nothing in `src/` or `web/` changes.

**Tech Stack:** Markdown, `bun:test` (`node:fs`), no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-19-documentation-and-help-design.md` §1–§2. Plan 2 (`2026-09-19-help-page.md`) builds the in-app `/help` page afterwards and will link `docs/scoring.md` from the README's verdict paragraph.

## Global Constraints

- **Move, don't rewrite**: a moved section keeps its headings and wording; only cross-references ("see *Login* above"), relative paths and stale facts are edited. Every factual correction must cite the code line that proves it in the commit message body.
- **No duplication**: the README summarises (one paragraph + link); the doc details. A claim lives in exactly one place.
- **Every relative link and `#anchor` resolves** (enforced by `test/docs-links.test.ts`, GitHub slug rules: lowercase, spaces → `-`, punctuation except `-` removed, ` ` and backticks stripped).
- **Runbook commands exist**: every command in `docs/operator.md` is a `just` recipe (`just --list`), a `bmpl` sub-command (`bun src/cli.ts help`), a `deploy/*.sh` script or a standard tool already named in `deploy/README.md`; nothing invented.
- **English only**; `README` public tone (no internal jargon like "issue #9", no agent workflow); `docs/agents/*` untouched except pointers.
- **Never run `just deploy*` or `deploy/bootstrap.sh`** while documenting them.
- `just check && bun test` green with `web/dist` absent at the end of every task; explicit `git add`; never `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`, `docs/design/canvas/Help*.dc.html` (plan 2 commits those). Commit trailers as the session provides.

## File map

| File | Responsibility |
|---|---|
| `test/docs-links.test.ts` (new) | scans `README.md`, `AGENTS.md`, `docs/**/*.md`, `deploy/README.md`, `.env.hosted.example` is skipped; every `[text] (relative/path#anchor)` must point at an existing file and, when an anchor is given, at a heading of that file |
| `docs/cli.md` (new) | README §Usage (l.226–357), §Windows (358–401), §Troubleshooting (853–864) |
| `docs/scoring.md` (new) | README §Verdict and axes (36–106) + §API cost (772–787) |
| `docs/deep-dive.md` (new) | README §Deep-dive: defensive cooldowns (107–171) |
| `docs/hosted.md` (new) | README §Hosted mode (417–608) + a route table |
| `deploy/README.md` | + README §Deploying on a VPS (609–771) |
| `README.md` | rewritten (~250 lines) |
| `docs/operator.md` (new) | the runbook |
| `AGENTS.md`, `docs/agents/workflow.md`, `docs/agents/architecture.md`, `src/cli.ts` (help text), `.env.hosted.example` | pointers to the new files |

---

### Task 1: Link checker, then `docs/cli.md`, `docs/scoring.md`, `docs/deep-dive.md`

**Files:**
- Create: `test/docs-links.test.ts`, `docs/cli.md`, `docs/scoring.md`, `docs/deep-dive.md`
- Modify: `README.md` (cut the moved ranges; leave the rest for Task 3)

**Interfaces:**
- Produces: `docs/cli.md#…`, `docs/scoring.md#…`, `docs/deep-dive.md#…` heading anchors that Tasks 3–5 and plan 2 link to: `docs/scoring.md#verdict-and-axes`, `docs/scoring.md#api-cost`, `docs/deep-dive.md#deep-dive-defensive-cooldowns`, `docs/cli.md#usage`, `docs/cli.md#windows`, `docs/cli.md#troubleshooting`.

- [ ] **Step 1: The link test** — `test/docs-links.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FILES = ["README.md", "AGENTS.md", "deploy/README.md", ...walk(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => f.slice(ROOT.length + 1))];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
/** GitHub's heading → anchor rule (the subset the docs use). */
export const slug = (heading: string): string =>
  heading.trim().toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
const headings = (md: string): Set<string> => new Set([...md.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1]!)));
/** Relative links only: skips http(s), mailto, and pure in-page anchors are checked against the same file. */
const links = (md: string): Array<{ path: string; anchor: string | null }> =>
  [...md.replace(/```[\s\S]*?```/g, "").matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((t) => !/^[a-z]+:/.test(t))
    .map((t) => { const [p, a] = t.split("#"); return { path: p ?? "", anchor: a ?? null }; });

describe("docs links", () => {
  for (const file of FILES) {
    test(file, () => {
      const md = readFileSync(join(ROOT, file), "utf8");
      const own = headings(md);
      const bad: string[] = [];
      for (const l of links(md)) {
        const target = l.path === "" ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), l.path);
        if (!existsSync(target)) { bad.push(`${l.path}#${l.anchor ?? ""} (missing file)`); continue; }
        if (l.anchor !== null && target.endsWith(".md")) {
          const h = l.path === "" ? own : headings(readFileSync(target, "utf8"));
          if (!h.has(l.anchor)) bad.push(`${l.path}#${l.anchor} (missing heading)`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
  test("slug", () => {
    expect(slug("Deep-dive: defensive cooldowns")).toBe("deep-dive-defensive-cooldowns");
    expect(slug("Getting Warcraft Logs API credentials")).toBe("getting-warcraft-logs-api-credentials");
    expect(slug("Flags (shared across `lookup`, `mplus`, `watch`)")).toBe("flags-shared-across-lookup-mplus-watch");
  });
});
```

- [ ] **Step 2: Run it on the current tree** — `bun test test/docs-links.test.ts`. It may already fail on existing dead links: fix those links (they are bugs) and note them in the report. Then it is green — the baseline for the moves.

- [ ] **Step 3: Move the three sections**

For each new file: a one-line title (`# bmpl — command line reference` / `# bmpl — scoring model` / `# bmpl — deep-dive: defensive cooldowns`), a one-sentence lead ("Detailed reference; the README has the short version."), then the README lines **verbatim** (headings kept at their level, `##`/`###`), then delete them from the README. Cross-references inside the moved text: "see *Login* above" → `see [Login] (hosted.md#login)` etc. (resolve each against where the target now lives; leave a TODO nowhere — every reference is resolved in this task, targets that move in Task 2 are linked by their future path `hosted.md#…` and the test goes green in Task 2). `docs/scoring.md` ends with the moved §API cost under its own `## API cost` heading.

- [ ] **Step 4: `just check && bun test`** — the link test may be red until Task 2 creates `docs/hosted.md`; if so, point the forward links at `../README.md#hosted-mode-multi-user` for now and re-point them in Task 2 (the test must be green at each commit).

- [ ] **Step 5: Commit** — `git add test/docs-links.test.ts docs/cli.md docs/scoring.md docs/deep-dive.md README.md` · `docs: move the CLI, scoring and deep-dive references out of the README; link checker`

---

### Task 2: `docs/hosted.md` and the deploy runbook

**Files:**
- Create: `docs/hosted.md`
- Modify: `deploy/README.md`, `README.md` (cut 417–771), `docs/cli.md`/`docs/scoring.md`/`docs/deep-dive.md` (re-point forward links from Task 1)

**Interfaces:**
- Produces: `docs/hosted.md#login`, `#wcl-budget`, `#your-own-warcraft-logs-client`, `#privacy-and-account-deletion`, `#routes`, `#environment` (exact headings below); `deploy/README.md#deploying-on-a-vps` (the moved section becomes `## Deploying on a VPS` with its nine `**N. …**` parts unchanged).

- [ ] **Step 1: `docs/hosted.md`** — title `# bmpl — hosted mode (multi-user)`, lead sentence, then README §Hosted mode verbatim, with these edits only: the bold-lead paragraphs become `##` headings so they can be linked (`## Login`, `## Per-account state`, `## WCL budget`, `## Your own Warcraft Logs client`, `## Shared defensives table`, `## Privacy and account deletion`, `## Instance info`, `## Health`, `## Environment` for the env table + optional line); the *Hardening* paragraph → `## Hardening`. Append `## Routes`: one table `| Method | Path | Auth | What |`, built by reading `src/server/routes-shared.ts`, `routes-local.ts`, `routes-auth.ts`, `routes-user.ts`, `routes-admin.ts` (every `route(`/`prefixRoute(` call; auth = `public` / `user` / `admin`; local-only routes marked "local mode only"). The table is checked against the code by the reviewer.

- [ ] **Step 2: `deploy/README.md`** — keep its file table and order of operations; replace both "See `README.md` § Deploying on a VPS" sentences with the moved section itself under `## Deploying on a VPS` (README 609–771 verbatim; its "see *Login* above" → `[Login] (../docs/hosted.md#login)`, "*Getting Warcraft Logs API credentials*" → `[the README] (../README.md#getting-warcraft-logs-api-credentials)`).

- [ ] **Step 3: README** — cut 417–771, leave a two-line stub under `## Hosted mode (multi-user)` ("One instance for several people behind a reverse proxy: Discord login, per-member quotas, shared corrections, admin page. → `docs/hosted.md`; deploying → `deploy/README.md`.") — Task 3 rewrites around it.

- [ ] **Step 4: re-point Task 1's forward links; `just check && bun test` green.**

- [ ] **Step 5: Commit** — `docs: hosted-mode reference and route table in docs/hosted.md; the VPS runbook lives in deploy/README.md`

---

### Task 3: The public README

**Files:** Modify `README.md` (full rewrite of what remains), `src/cli.ts` (help text lines that cite README sections — `grep -n "README" src/cli.ts`), `.env.hosted.example` (its "README's Hosted mode section" comment → `docs/hosted.md`).

**Interfaces:** Produces the README headings other files link to: `#getting-warcraft-logs-api-credentials`, `#setup`, `#hosted-mode-multi-user`, `#security`, `#repo-layout`.

- [ ] **Step 1: Write the README to this skeleton** (≤ 260 lines; prose from the existing README where it exists, trimmed):

```
# Better Mythic+ Logs (`bmpl`)
<one paragraph: what it does, for whom, the two data sources, local CLI/web + hosted>
<the existing screenshot lines if any>

## What you get           (≤ 15 lines: the bullet list of §What you get, each bullet one line; target auto-detect + metric auto-select in one sentence)
## The verdict            (one paragraph: INVITE/MAYBE/PASS/INSUFFICIENT DATA from six axes, evidence lines, timed/depleted not scored, tunable → docs/scoring.md; the web UI's Help page explains every number — plan 2 adds the link)
## Quick start            (Requirements ≤ 6 lines; Getting Warcraft Logs API credentials — keep the heading, ≤ 12 lines; Setup — the `bmpl setup`/`.env` block; `bmpl serve` opens the UI)
## Command line           (the six commands: lookup/l, analyze, watch, evaluate, defensives, serve — one line each + flags in one line → docs/cli.md; Windows in one line → docs/cli.md#windows)
## Deep-dive              (one paragraph → docs/deep-dive.md)
## Hosted mode (multi-user) (one paragraph → docs/hosted.md; deploying → deploy/README.md; operating → docs/operator.md)
## API cost               (the 4-line summary: lookup ≈ 10 + 10/uncached run, analyze ≈ 3, cached = 0, 3600 pts/h per client → docs/scoring.md#api-cost)
## Security               (≤ 8 lines: local binds localhost, secrets in .env, hosted hardening → docs/hosted.md#hardening)
## Repo layout            (the tree, ≤ 25 lines; docs/ listed)
## Development            (just install/check/test/build, docs/agents for the developer manual, design canvas note)
## Troubleshooting        (three most common items, one line each → docs/cli.md#troubleshooting)
```

- [ ] **Step 2: `src/cli.ts` help text and `.env.hosted.example` pointers**; `bun src/cli.ts help` output must not mention sections that no longer exist.
- [ ] **Step 3: `just check && bun test` green; `wc -l README.md` ≤ 260.**
- [ ] **Step 4: Commit** — `docs: public README rewritten as the entry point (≤ 260 lines), details linked`

---

### Task 4: `docs/operator.md`

**Files:** Create `docs/operator.md`.

**Interfaces:** Consumes the `just` recipes (`justfile` l.84–123: `build-linux`, `deploy`, `deploy-logs`, `deploy-status`, `deploy-restore-test`; `check`, `test`, `evaluate`, `audit-defensives`), the CLI (`bmpl invite`, `bmpl defensives --shared`, `bmpl evaluate`, `bmpl serve --hosted`), `deploy/README.md`, `docs/hosted.md`, `docs/scoring.md`, `docs/deep-dive.md`.

- [ ] **Step 1: Write the runbook** — title `# Operating a bmpl instance`, lead: who it is for, what it assumes (a VPS set up per `deploy/README.md`, `BMPL_DEPLOY_HOST` exported on your machine). Ten `##` sections, each: **When**, **Do** (commands in a fenced block), **Check** (what confirms it worked), **Reference** (link). Facts to get right, from the code:
  1. *Ship a change* — `just check && bun test` → `just deploy` (it runs `build-linux`, copies `dist/bmpl-linux` to `/opt/bmpl/bmpl.new`, installs it over `/opt/bmpl/bmpl`, restarts the unit, waits ≤ 30 s for `/api/health`, prints the last 30 journal lines on failure). **There is no automatic rollback and no previous binary kept**: rolling back = `git checkout <previous sha> && just deploy` (or `git revert`). `just deploy-status` / `just deploy-logs` after.
  2. *Is it healthy?* — `curl -s https://<host>/api/health | jq` fields (`ok`, `db`, `users`, `sessions`, `wcl`, `backupAgeS`, `warnings`); each warning text (`no backup marker`, `last backup N h ago` past 2 h, `shared WCL budget under 100 pts`) and the action; `just deploy-logs`; the admin page's Instance (env, backup marker) and Audit (Errors chip) sections; `journalctl -u caddy`, `-u litestream`.
  3. *People* — invites (`bmpl invite <id> [--note]`, `--list`, `--remove`, or the admin page), open signup (`BMPL_OPEN_SIGNUP=true`, restart: `ssh $BMPL_DEPLOY_HOST systemctl restart bmpl`), guild gate (`BMPL_DISCORD_GUILD_ID`; the OAuth scope becomes `identify guilds` — nothing to change in the Discord app), ban/unban (admin page → Users; effect: sessions ended, login refused, data kept), promote/demote, revoke sessions; deleting someone else's account is not a feature — document the last resort (`sqlite3 /opt/bmpl/bmpl.db "PRAGMA foreign_keys=ON; DELETE FROM users WHERE discord_id='…';"` with the service stopped, and why `PRAGMA foreign_keys=ON` matters for the cascade).
  4. *Moderate proposals* — the admin queue, approve/reject semantics, `bmpl defensives <Class> <Spec> --shared`, `just audit-defensives --shared --only Class:Spec` (~9 pts per spec), when to change `src/deepdive/defensives.json` and bump its `version` instead.
  5. *WCL budget* — the gauge, `BMPL_POINTS_PER_USER_HOUR` (default 300, admins exempt), the 100-pt floor, what members with their own client change (their spend never touches the shared client; the Users table shows "own client"), reading `quota_refused` rows.
  6. *Backups and restore* — litestream replicates continuously; `bmpl-backup-check.timer` hourly touches `/opt/bmpl/last-backup` when the newest snapshot is < 90 min old; `just deploy-restore-test` (restore into a temp dir, integrity check, user count); the manual restore procedure from `deploy/README.md#deploying-on-a-vps` part 6 (stop bmpl, `litestream restore`, chown, start); what the DB holds (members, sessions, history, settings, usage, proposals, shared table, audit, encrypted clients, the WCL cache).
  7. *Secrets and keys* — table: variable → how to rotate → what it breaks: `BMPL_SESSION_SECRET` (everyone signed out), `BMPL_DISCORD_CLIENT_SECRET` (Discord dev portal, restart), shared `WCL_CLIENT_ID/SECRET` (warcraftlogs.com/api/clients, restart), `BMPL_ENCRYPTION_KEY` (every stored member client becomes undecryptable → members see it on "Verify again" and must save again; nothing else breaks), litestream bucket keys (`/etc/litestream.yml`, restart litestream), `BMPL_DEPLOY_HOST` (your machine). File modes: `/opt/bmpl/.env` 600 owner `bmpl`.
  8. *Tuning* — `evaluation.json` next to `/opt/bmpl/.env` (deep-merge, restart, preview with `bmpl evaluate saved.json`), `defensives.json` is ignored in hosted mode (the shared layer in the DB is the override), `BMPL_OPERATOR`.
  9. *New season* — `src/signals/avoidable/season-<slug>.json` (+ the `avoidableSpellIdsFor` mapping), `src/deepdive/defensives.json` `version`, `expectedIlvl["<rio season slug>"]` in `default-config.json` (or in `evaluation.json` on the server), `just audit-defensives`, redeploy; meanwhile ilvl-vs-level falls back to the last known season's curve and the UI shows stale badges after 14 days.
  10. *Troubleshooting* — login loop / `?login=failed` (`BMPL_BASE_URL` vs Discord redirect URL), 403 "Cross-site request refused" (Origin ≠ `BMPL_BASE_URL`, proxy config), 429 (which limit: `/auth/*` 10/min/IP, lookups 30/min, analyses 60/min, signup 5/h/IP), "web UI not built" (binary built without `web/dist` → `just build-linux` runs `web-build`), WCL 401 (shared secret rotated) / 429 (budget), a member's own client failing (`WCL: OAuth failed … — check your client in Settings`), `database is locked` (litestream + a manual sqlite3 session), disk full.
- [ ] **Step 2: Verify every command** — `just --list`, `bun src/cli.ts help`, read `deploy/*.sh`; anything not found is removed or rephrased. `bun test test/docs-links.test.ts` green.
- [ ] **Step 3: Commit** — `docs: operator runbook (docs/operator.md)`

---

### Task 5: Pointers and consistency pass

**Files:** Modify `AGENTS.md` (the "Design specs and plans" paragraph gains "User docs: `README.md` (entry), `docs/{cli,scoring,deep-dive,hosted,operator}.md`, `deploy/README.md`"; the Commands table unchanged), `docs/agents/workflow.md` §Docs ("README stays the user manual" → "README is the public entry point; the reference lives in `docs/*.md`; update the doc that owns the fact"), `docs/agents/architecture.md` (references to README sections → the new files), `docs/superpowers/specs/2026-09-19-documentation-and-help-design.md` status line ("§1–§2 implemented 2026-09-19").

- [ ] **Step 1: `grep -rn "README" src/ docs/agents AGENTS.md deploy .env.hosted.example web/src` — every reference to a README section that moved is re-pointed.**
- [ ] **Step 2: Read the six docs top to bottom once** (README, cli, scoring, deep-dive, hosted, operator, deploy/README) for duplicated paragraphs and dangling "above/below"; fix.
- [ ] **Step 3: `just check && bun test` green; commit** — `docs: pointers to the restructured docs; spec status`

## Self-review

- Spec §1 table → Tasks 1–3 + 5 (every file); §2 runbook sections 1–10 → Task 4 with the facts pinned from `justfile` and the code; link integrity → Task 1's test. Open point "rollback" settled: none exists; the runbook says so.
- No placeholders: line ranges, headings, commands and messages are all given; the route table is derived from named files.
- Names used across tasks match: `docs/hosted.md#login`, `#hardening`, `deploy/README.md#deploying-on-a-vps`, `docs/scoring.md#api-cost`, `docs/cli.md#troubleshooting`, `README.md#getting-warcraft-logs-api-credentials`.
