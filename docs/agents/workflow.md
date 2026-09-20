# Workflow

## How the user works

The user writes French in chat and expects French replies; the product — code, UI, docs, commits, issues — is English. They decide direction and pick between variants; they do not want options narrated at length. Decisions already made are not re-litigated (see the roadmap pointer below).

## Feature lifecycle

1. **Brainstorm → spec.** Non-trivial features get a design doc in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (goal, non-goals, decisions, data flow, error handling, tests, out of scope). The user reviews it before any plan. Existing specs are the authority for their area; when behaviour changes, amend the spec (and note "implemented <date>" in its status line).
2. **Plan.** `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`: header with Goal/Architecture/Spec, a **Global Constraints** block copied verbatim from the spec (numbers, names, rules), a file-responsibility table, then bite-sized TDD tasks with exact code and commands. No placeholders.
3. **Execute with subagents** (superpowers `subagent-driven-development`): work on `main` in place (the user's explicit preference — no worktree), fresh implementer per task, spec + quality review after each task, one whole-branch review at the end; findings fixed in loops, deferred minors listed in the final report. Keep the ledger in the plan's workspace; after context compaction trust the ledger and `git log`.
4. **Verify live.** Build, run, and check the actual UI/CLI (screenshots via the browser tools when it's visual). Report outcomes plainly — failing tests are reported with their output.
5. **Docs.** README is the public entry point; the reference lives in `docs/*.md`; update the doc that owns the fact. `docs/operator.md` is the operator manual; `docs/agents/*` stays the developer/agent manual. Update both in the same change as the behaviour.

Small, bounded changes skip the spec/plan but not the tests, the design canvas (if visual), or the review.

## Visual work

Anything the user will see is mocked first on the Claude Design canvas (`docs/agents/web-front.md`, "Design first"), usually as 2–3 labelled variants; the user chooses ("B + C" style answers combine variants). Then implement the chosen one exactly, matching `tokens.css` and the existing components.

## Git

- Branch: `main`, committed in place. Never rewrite history, never force-push, push only when the user says so ("commit et push").
- Conventional, imperative subjects scoped by area: `feat(web): …`, `fix(deepdive): …`, `feat(server): …`, `docs: …`, `test: …`. One logical change per commit; a plan task is typically one commit.
- Commit messages end, after a blank line, with the attribution trailers the session provides (`Co-Authored-By: Claude … <noreply@anthropic.com>` and `Claude-Session: …`).
- Stage explicitly (`git add <paths>`), never `git add -A` or `git add .`: the root holds untracked user files (`biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`) that must never enter the repo.
- Issues: GitHub `triat/Better-mythic-plus-logs`, `gh` CLI authenticated as `triat`. Sub-project 5 is issue #1 (parent) → #2–#11 (sub-issues, labels `hosted`, `phase 2`); use `gh issue create --parent N` for new sub-issues.

## Environment gotchas

- WSL2 on an NTFS mount (`/mnt/e`): file watching can be slow and symlinks are unreliable — `CLAUDE.md` uses `@AGENTS.md` imports instead of a symlink.
- `pkill -f "bmpl serve"` kills the calling shell; use `for p in $(pgrep -f '^\./bmpl'); do kill $p; done`.
- Browsers cache `assets/app.js` (fixed name): hard-reload after `just build`; an old `./bmpl serve` on :3000 silently serves the old UI.
- Commands containing raw terminal escape bytes are rejected by the tooling; write such content to a file instead.
- WCL points are a shared hourly budget: state the estimated cost before any command that fetches, and prefer cached data (`bmpl analyze` lists cached runs at 0 pts).
- `just deploy` / `deploy-status` / `deploy-logs` / `deploy-restore-test` need `BMPL_DEPLOY_HOST=user@host` exported in the shell (`just` does not read `.env`) and an SSH key for that host. They touch the production VPS: only the user runs them, from their machine — never from an agent or a subagent, not even `deploy-status`. `just build-linux` alone is safe (local cross-compile into `dist/`, git-ignored).

## Roadmap pointer

Sub-projects 1–4 shipped (signals, evaluation model, web front, run deep-dive). Next: sub-project 5, hosted multi-user service — fully specified in GitHub issue #1 and its sub-issues; #2–#10 (hosted skeleton, Discord login, per-user state, WCL budget/quotas, shared defensives table, hosted front, admin page, hardening, VPS deployment) are shipped; next is #11 (phase 2), keeping local mode green. Known follow-ups not yet scheduled: user validation of `defensives.json` cooldowns per spec; choice-node ("either/or") entries and talent-aware cooldowns via `combatantinfo`; absolute per-level references for peer signals; evaluation `expectedIlvl` values unvalidated against real profiles.
