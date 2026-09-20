# Documentation restructure and the in-app Help page — design

Status: approved design, 2026-09-19; §1–§2 implemented 2026-09-20; §3–§6 implemented 2026-09-20.

## Goal

Two audiences, one source of truth:

1. **Operator (the person running an instance)** — a public, readable README plus reference docs that hold the detail, and a task-oriented runbook (`docs/operator.md`) answering "how do I manage this?".
2. **Users of the web UI** — an in-app `/help` page explaining what bmpl looks at, how every number is computed, why a figure is shown or not, and what is deliberately not scored, so a reader can redo the analysis and validate what the page shows. Reached from the header, the user menu and small contextual "?" links next to the things it explains.

Numbers on `/help` (weights, curves, thresholds) are the **effective** evaluation config of the running instance, never copied by hand.

## Non-goals

- A `bmpl explain` CLI command (the registry makes it cheap later; not now).
- Per-player "show the math" (raw inputs → curve → score per sub-signal in the character view). The evidence lines already carry the measured value and the axis-point delta; the help page carries the curve.
- Translating the product (UI, docs) — English only, as everywhere.
- A Markdown renderer in the front (no new dependency; prose lives in a typed registry, structure in components).
- Rewriting the content that moves out of the README — it moves as is, gets re-linked, and is corrected only where the code proves it stale.

## Decisions

- **Registry over prose-in-components**: `src/evaluation/docs.ts` describes every axis and every sub-signal in English; a test enforces a one-to-one match with the sub-signal keys of `src/evaluation/default-config.json`, so a new sub-signal without documentation fails CI. The front only renders.
- **Effective config on the wire**: `GET /api/docs` returns the registry and the config the server evaluates with (defaults deep-merged with `evaluation.json`), plus the shipped defensives table version and the season slug. Public in both modes; 0 WCL points; no per-user data.
- **Anchors follow `Evidence.source`**: every evidence line already carries `"<axis>.<subSignalId>"`; the "?" link on an evidence line is `/help#<axis>.<subSignalId>`, an axis header links `/help#axis-<axis>`. No new identifiers to keep in sync.
- **README stays the entry point**, ~250 lines, public and moderately technical; everything longer than a paragraph moves to `docs/*.md` and is linked.
- **Design first**: the `/help` layout and the "?" affordance are mocked on the Claude Design canvas (page "Hosted" or a new page "Help", 2–3 labelled variants) before any front code; the user picks.

## 1. Documentation files

| File | Audience | Content (moved from the README unless noted) |
|---|---|---|
| `README.md` (rewritten, ~250 lines) | public | what bmpl is (3 sentences), screenshots (existing ones if any), quick start local (requirements, WCL API client, `.env`, `bmpl serve`), "what you get" in ten lines, the verdict in one paragraph → `docs/scoring.md` and `/help`, CLI cheat sheet (six commands) → `docs/cli.md`, hosted mode in one paragraph → `docs/hosted.md`, deployment in one paragraph → `deploy/README.md`, WCL cost summary, repo layout (short), security note, licence |
| `docs/scoring.md` | operator, curious user | "Verdict and axes" (six axes, sub-signals, n/a rules, timed/depleted not scored, `INSUFFICIENT DATA`), `evaluation.json` deep-merge and examples, `bmpl evaluate`, `levelScale` and `expectedIlvl`, the season-versioned files (`src/signals/avoidable/season-*.json`) |
| `docs/deep-dive.md` | operator | "Deep-dive: defensive cooldowns": `bmpl analyze`, the defensives table and its three entry shapes, `bmpl defensives`, `--shared`, `just audit-defensives`, the Wowhead tooltip note |
| `docs/hosted.md` | operator | the whole "Hosted mode (multi-user)" section: login and admission (invite / open signup / guild gate / bans), per-account state, WCL budget and quotas, own WCL clients, shared defensives and proposals, admin page, hardening, privacy and account deletion, instance info, `/api/health`, the env table (required + optional), plus a **route list** (method, path, auth, one line each) collected from `src/server/routes-*.ts` |
| `docs/cli.md` | CLI user | "Usage" (vet one player, flags, JSON output), "Hands-free (clipboard watcher)", "Other commands", "Windows", "Web front development", "Troubleshooting" |
| `deploy/README.md` (extended) | operator | absorbs "Deploying on a VPS" (nine parts); the README keeps one paragraph and the link |
| `docs/operator.md` (new) | the operator | task-oriented runbook, see §2 |
| `docs/agents/*` | agents/devs | unchanged; `AGENTS.md` gains the pointers to the new files |

Rules: every moved section keeps its headings so old links (`README.md#…`) can be redirected with a one-line stub in the README where it matters ("Hosted mode → docs/hosted.md"); no content is duplicated between the README and a doc — the README summarises, the doc details; `README` and the docs are re-read against the code once during the move (the review checks a sample of claims against `src/`).

## 2. `docs/operator.md` — the runbook

Structure: one section per task, each with *when*, *commands*, *where to look*, *link to the reference*. Written for the person who owns the VPS and the Discord application.

1. **Ship a change** — `just check && bun test`, `just build-linux`, `just deploy` (from your machine; what it does, what it restarts), `just deploy-status`, `just deploy-logs`; rolling back (previous binary kept by the deploy recipe — confirm in `justfile`/`deploy/README.md` and describe exactly what exists).
2. **Is it healthy?** — `curl -s https://<host>/api/health | jq`, the `warnings` list and what each means, `journalctl -u bmpl`, the admin page's Instance and Audit sections, what "backup older than 2 h" means and what to do.
3. **People** — invite (`bmpl invite`, admin page), open signup on/off (`BMPL_OPEN_SIGNUP`, restart), guild gate (`BMPL_DISCORD_GUILD_ID`, the Discord OAuth scope change), ban/unban, promote/demote, revoke sessions, delete an account on behalf of a user (not available — say so; the workaround is a ban plus a manual `DELETE FROM users` with the cascade, documented as a last resort).
4. **Moderate defensives proposals** — the queue, what approve/reject does for the author and for everyone, `bmpl defensives --shared`, `just audit-defensives --shared`, when to bump the shipped table version instead.
5. **WCL budget** — reading the gauge, `BMPL_POINTS_PER_USER_HOUR`, the 100-point floor, own clients (what changes for the instance when members bring their own, what the admin sees), what a `quota_refused` / `budget` refusal looks like for a member.
6. **Backups and restore** — litestream, the hourly check and the `last-backup` marker, `just deploy-restore-test`, the manual restore procedure (from `deploy/README.md`), what is and is not in the database (member data, cache, encrypted clients).
7. **Secrets and keys** — rotating `BMPL_SESSION_SECRET` (everyone signed out), the Discord client secret, the shared WCL client, `BMPL_ENCRYPTION_KEY` (every stored member client becomes unusable; members save theirs again; the health/verify signals), `BMPL_DEPLOY_HOST`; where each lives (`/opt/bmpl/.env`, chmod), never in git.
8. **Tuning** — `evaluation.json` next to `.env` (deep-merge, restart required, `bmpl evaluate` on a saved payload to preview), `defensives.json` locally vs the shared layer when hosted, `BMPL_OPERATOR` and the privacy page.
9. **New season** — the versioned files to update (`src/signals/avoidable/season-*.json`, `src/deepdive/defensives.json` version, `expectedIlvl` keyed by the Raider.IO season slug), the audit script, redeploy; what stale data looks like in the UI meanwhile.
10. **Troubleshooting** — login loops (`BMPL_BASE_URL` vs the Discord redirect), 403 "Cross-site request refused" (proxy / origin), 429s, "web UI not built", WCL 401/429, a member whose own client stopped working, disk full / database locked; each with the command that confirms the diagnosis.

Every command in the runbook is one that exists in the `justfile`, the CLI or the deploy scripts; the runbook is reviewed against them.

## 3. The registry — `src/evaluation/docs.ts`

```ts
export interface SubSignalDoc {
  title: string;        // "Individual deaths"
  what: string;         // what is measured, one or two sentences
  source: string;       // where the data comes from (WCL rankings / the run's log / Raider.IO / deep-dive)
  how: string;          // how the value is computed before the curve (units, scaling, peers)
  why: string;          // why it matters for vetting
  naWhen: string;       // when it is n/a (spec has no kick, fewer than N runs, not analyzed…)
  unit: string;         // what the curve's x axis is ("deaths per run, level-scaled", "% vs peers", …)
  scaledByLevel: boolean; // true when the value is multiplied by levelScale(run key) before the curve
}
export interface AxisDoc { title: string; summary: string; why: string; subSignals: Record<string, SubSignalDoc> }
export interface EvaluationDocs {
  axes: Record<AxisKey, AxisDoc>;
  verdict: { summary: string; global: string; thresholds: string; confidence: string; insufficient: string };
  levelScale: string;
  expectedIlvl: string;
  peers: string;                   // "peers" = the other players of the same run
  notScored: Array<{ title: string; text: string }>;   // timed/depleted, unranked parse, previous season (bonus only)…
  runSignals: Array<{ title: string; text: string }>;  // deaths, DTPS, avoidable damage, kicks, dispels — the per-run columns
  deepdive: { summary: string; usage: string; deaths: string; table: string; cost: string };
  sources: Array<{ title: string; text: string; freshness: string }>; // WCL rankings, run logs, Raider.IO
  faq: Array<{ q: string; a: string; hostedOnly?: boolean }>;
}
export const EVALUATION_DOCS: EvaluationDocs;
```

Content rules: every sentence is checkable against a line of `src/` (the plan's review names the file for each sub-signal: `src/evaluation/inputs.ts`, `axes/*.ts`, `src/signals/*`); numbers that live in the config (weights, curve points, thresholds, `minRuns`, `deepdiveMinRuns`, `consistencyMinRuns`) are **not** written in the prose — the front prints them from `config`; the only literals allowed in prose are structural facts (six axes, three roles, "at least N runs" phrased as "the `minRuns` setting", the 14-day stale marker, the 6-hour lookup cache, the `--no-stats` cost note).

Test `test/evaluation/docs.test.ts`: for every axis key, `Object.keys(DEFAULT_CONFIG.axes[k].subSignals)` equals `Object.keys(EVALUATION_DOCS.axes[k].subSignals)` (both directions); every doc string is non-empty; `scaledByLevel` is true for exactly the sub-signals that use `levelScale` (`individualDeaths`, `groupDeaths` — asserted by name so the test fails if a third one appears without the flag being decided).

## 4. `GET /api/docs`

Registered in `sharedRoutes`, `auth: "public"`, both modes, `Cache-Control: no-store` like every JSON route.

```ts
{
  ok: true,
  docs: EvaluationDocs,
  config: {              // the effective config: DEFAULT_CONFIG deep-merged with evaluation.json (getEvalConfig)
    version: string,     // configVersion(cfg) — the same string the evaluation carries
    levelScale: CurvePoints,
    expectedIlvl: Record<string, CurvePoints>,
    axes: Record<AxisKey, { subSignals: Record<string, { curve: CurvePoints; weights: Record<Role, number> }> }>,
    axisWeights: Record<Role, Record<AxisKey, number>>,
    verdict: { invite: number; maybe: number; minRuns: number },
    confidence: { high: number; medium: number; consistencyMinRuns: number; deepdiveMinRuns: number },
  },
  defensives: { version: string },   // SHIPPED table version (hosted: the shared layer has no version — the shipped one is shown)
  season: string | null,             // the Raider.IO season slug the instance expects ilvl for (first key of expectedIlvl) — or the store's current season if exposed
  hosted: boolean,
}
```

Tests (`test/server-docs.test.ts`): 200 anonymous in hosted mode; the registry keys match the config keys in the body; with a temporary `evaluation.json` (`BMPL_EVAL_CONFIG`) raising `verdict.invite`, the body reflects it; the body never contains `.env`-derived values.

## 5. The `/help` page

Served like `/admin`, `/settings`, `/privacy` (SPA entry point; local and hosted; anonymous hosted visitors can read it — it explains the product, nothing personal). Data: one `GET /api/docs` at mount plus `/api/status` (already loaded) for `hosted`.

Sections and anchors (the canvas decides the layout; the anchors are the contract):

- `#what` **What bmpl looks at** — the three sources (`docs.sources`), freshness (rankings re-fetched per lookup, 6-hour history cache, run logs cached forever, Raider.IO free), what is public data.
- `#verdict` **The verdict** — the formula in words *and* numbers: global = weighted mean of the scored axes with the role's `axisWeights`, rounded; `INVITE` ≥ `verdict.invite`, `MAYBE` ≥ `verdict.maybe`, else `PASS`; `INSUFFICIENT DATA` under `verdict.minRuns` enriched runs; confidence `high`/`medium`/`low` by `confidence.high`/`confidence.medium`; the role's weight table.
- `#axis-<key>` × 6 **The six axes** — per axis: `summary`, `why`, then per sub-signal `#<axis>.<sub>`: title, what/source/how/why/n-a, the weights for the three roles, the curve as a small table (`x → score`) and a minimal inline SVG polyline (points only, no library), a "scaled by key level" badge when `scaledByLevel` with a link to `#level-scale`. An axis whose weight is 0 for every role (consistency by default) says so: "informational — weight 0 in the verdict for every role".
- `#level-scale` **Key-level scaling** — `docs.levelScale` + the `levelScale` points; `#expected-ilvl` — `docs.expectedIlvl` + the curve for `season`.
- `#runs` **Per-run signals** — `docs.runSignals` (the columns of the run list) and `docs.notScored`.
- `#peers` **Peers** — one paragraph.
- `#deep-dive` **Deep-dive** — `docs.deepdive` + the shipped table version + link to the panel's own table view.
- `#reading` **Reading the page** — tiles, radar, compare, badges (stale, cached, pending review, shared) — static prose in the component (UI, not analysis; short).
- `#faq` **FAQ** — `docs.faq`; entries with `hostedOnly` render only when `status.hosted`.

Contextual links (component changes, all hosted-and-local): a small `?` (`help-link` class, faint, 12 px, title "How is this computed?") on the verdict hero (`#verdict`), each axis row header (`#axis-<key>`), each evidence line (`#<source>`), the run list header (`#runs`), the deep-dive panel header (`#deep-dive`). Header: a "Help" link next to the existing controls (local: before Re-configure; hosted: before the user menu); user menu: a "Help" item above "Settings". Local `/` is otherwise pixel-identical.

Front models (`web/src/lib/help.ts`, tested): `helpSections(docs, config, hosted)` → the ordered section list with anchors; `curveTable(points)` → rows; `curvePath(points, w, h)` → the SVG path string; `anchorOf(source)` (`"survival.individualDeaths"` → `"survival.individualDeaths"`, axis → `"axis-survival"`); `roleWeightsRow(...)`. Components in `web/src/components/help/` (`HelpPage`, `AxisSection`, `SubSignalCard`, `CurveChart`, `Faq`), a `HelpLink` component reused by the five contextual spots.

## 6. Testing and constraints

- `just check && bun test` green with `web/dist` absent; zero WCL points anywhere (the docs route reads config and constants only).
- Registry ↔ config completeness test; `/api/docs` route tests; front model tests; the docs prose is reviewed sentence by sentence against the code in the plan's review step (the reviewer gets the file map: `inputs.ts`, `axes/*.ts`, `signals/*.ts`, `deepdive/*.ts`).
- README and every `docs/*.md` claim is checked against the code once during the move; the route list in `docs/hosted.md` is generated by reading `src/server/routes-*.ts` at plan time, not from memory.
- Colours/radii via `tokens.css`; canvas first for `/help` and the `?` affordance.

## Open points settled here

- Anonymous hosted visitors can read `/help` and `/api/docs`: yes — it documents the product, not the instance's members; the effective config is not secret (it is the operator's tuning, and members see its effects anyway).
- `season` on `/api/docs`: the first key of `expectedIlvl` (the config's own notion of "current season"); if `src/signals/store.ts` exposes the active WCL season, use that instead — the plan checks.
- The `?` on evidence lines uses `Evidence.source` as is; if a future sub-signal is documented under a different key, the registry test is what catches it, not the front.
