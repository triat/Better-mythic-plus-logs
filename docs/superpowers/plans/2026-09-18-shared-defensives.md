# Shared Defensives Table with Moderated Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In hosted mode the defensives override becomes one shared, admin-approved layer in SQLite: any member proposes a correction from the panel (it applies to them immediately), an admin approves it for everyone or rejects it with a note; local mode keeps its `defensives.json` file untouched.

**Architecture:** The pure table code (`src/deepdive/table.ts`) gains an `origin` tag on override entries and a `mergeEntry` primitive; `specDefensives` is otherwise unchanged and `LoadedTables` carries a `source`. Hosted mode adds two tables (`defensives_shared`, `defensives_proposals`), a repository + service in `src/hosted/defensives.ts` (`tablesFor(userId)` = shipped ⊕ shared ⊕ the user's pending proposals; `propose`; `decide`) exposed as `HostedDb.defensives`. Every hosted handler that needs tables gets them per user through `tablesOf(ctx, runtime)`; because hosted payloads are stored raw and analyses are attached on read (issue #4), an approval is visible to everyone on their next read with no history iteration. `POST /api/defensives` creates a proposal in hosted mode (admins auto-approve); `GET /api/admin/proposals` and `POST /api/admin/proposals/:id/approve|reject` moderate. The CLI and the audit script read the shared layer with `--shared`. The front only learns the new origins ("shared", "pending review"); the panel's hosted wording and the pending chip are issue #7.

**Tech Stack:** Bun 1.3 (`bun:sqlite`, `bun:test`), TypeScript strict, Vite 8 + React 19 (types-only imports from `src/`).

**Spec:** GitHub issue #6 (`gh issue view 6`), parent #1. Repo rules: `AGENTS.md`, `docs/agents/{architecture,web-front,testing,workflow}.md`. Builds on #4 (`RequestContext { hosted, user, … }`, attach-on-read via `withCachedAnalyses`, `HostedRuntime`, `SharedContext.runtime`) and #5 (`handleLookup(req, ctx, runtime)`, `handleDeepdive(req, ctx, runtime)`, `runLookupWithCache(opts, history, deps)`, `LookupDeps`).

## Global Constraints

- Local mode is unchanged: `loadDefensives()` still reads the file next to `.env`, `POST /api/defensives` still writes it and `refreshLocalHistory()` still re-attaches the in-memory history; `bmpl defensives <Class> <Spec>` / `--check` and `just audit-defensives` keep working against the shipped table + file. Existing tests stay green; they are edited only where a type they construct changed (`LoadedTables` literals gain `source: "file"`).
- Types (`src/deepdive/types.ts`): `EntryOrigin = "shipped" | "override" | "shared" | "pending"`; `OverrideEntry.origin?: Exclude<EntryOrigin, "shipped">` is set only by loaders, never read from the file (`validateEntry` strips it); `EffectiveEntry.origin: EntryOrigin`, `DefensiveUse.origin: EntryOrigin`; `LoadedTables { shipped, override, source: "file" | "shared", overridePath: string | null, warning? }` — `overridePath` is a string iff `source === "file"`.
- `specDefensives` keeps its algorithm; an override entry's origin is `e.origin ?? "override"`. `mergeEntry(list, patch): OverrideEntry[]` is the pure list merge (`ignore` replaces any earlier patch; otherwise the patch's fields merge over the previous patch; a patch's `origin` is kept on the result); `applyPatch` = the completeness check + `mergeEntry`; `layerPatches(base, patches, origin)` applies `{ key, patch }` pairs tagged with `origin`.
- Schema (`src/hosted/schema.ts`, `CREATE TABLE IF NOT EXISTS`, ms timestamps, JSON in `TEXT`): `defensives_shared(key TEXT NOT NULL, id INTEGER NOT NULL, entry TEXT NOT NULL, approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL, approved_at INTEGER NOT NULL, PRIMARY KEY (key, id))`; `defensives_proposals(id INTEGER PRIMARY KEY, key TEXT NOT NULL, spell_id INTEGER NOT NULL, patch TEXT NOT NULL, proposed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')), decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL, decided_at INTEGER, note TEXT)`; unique partial index `defensives_proposals_pending ON defensives_proposals(proposed_by, key, spell_id) WHERE status = 'pending'`; index `defensives_proposals_status ON defensives_proposals(status, created_at)`.
- Effective table per user (hosted) = shipped ⊕ `defensives_shared` (entries tagged `"shared"`) ⊕ that user's **pending** proposals (tagged `"pending"`); `tablesFor(repo, null)` is shipped ⊕ shared only. A rejected proposal no longer applies to its author; its note stays visible through `GET /api/defensives` → `proposals` (the caller's proposals for that key, newest first, all statuses).
- `propose(repo, user, className, spec, patch, now)`: the patch is validated with `validateOverride` and checked for completeness with `applyPatch` against the *caller's* effective table (unknown ids need `name`, `cooldownS`, `durationS`, `kind`); a member's proposal is `pending` — one pending row per (user, key, spell): a second proposal for the same spell merges into the existing pending row's patch (`mergeEntry`) instead of creating a new one; an admin's proposal is stored `approved` (decided by themselves) and written to `defensives_shared` immediately.
- `decide(repo, id, admin, status, note, now)`: only a `pending` proposal can be decided (else `null`); `approved` merges the patch over the shared layer's entry for that key/id (`mergeEntry`) and upserts `defensives_shared`; `rejected` only records the decision. Nothing iterates histories: hosted analyses are attached on read.
- Routes: `GET /api/defensives?class=&spec=` → `{ ok, key, entries, ignored, tableMissing, overridePath (string locally, null hosted), warning, proposals: ProposalSummary[] }` (`[]` locally); `POST /api/defensives { className, spec, patch }` hosted → `200 { ok, key, entries, ignored, tableMissing, overridePath: null, proposal: ProposalSummary }` or `400 { ok:false, error }`; `GET /api/admin/proposals?status=pending|approved|rejected` (default `pending`, invalid → 400) → `{ ok, proposals: Array<ProposalSummary & { proposedBy: number; username: string | null; key: string }> }`; `POST /api/admin/proposals/:id/approve` and `/reject` with an optional JSON body `{ note?: string }` (trimmed, ≤ 500 chars, else null) → `{ ok, proposal }` or `404 { ok:false, error:"No pending proposal with that id" }`; all admin routes `auth: "admin"`. `ProposalSummary = { id, spellId, status, patch, note, createdAt, decidedAt }`.
- Per-user tables everywhere in hosted mode: `tablesOf(ctx, runtime)` → hosted `tablesFor(runtime.db.defensives, ctx.user.id)`, local `getDefensives()`; used by `handleDefensivesGet/Post`, `handleDeepdive`, `withCachedAnalyses(payload, tables)` (history reads and `/api/lookup` — hosted `/api/lookup` now attaches on read for fresh results too, so a dedupe joiner never sees the starter's pending layer), and passed as `deps.tables` to `performLookup`.
- CLI: `bmpl defensives <Class> <Spec> [--shared]` and `bmpl defensives --check`; `--shared` prints shipped ⊕ the DB shared layer (`openHosted(store._db).defensives`, no user pending) and labels the layer `shared (bmpl.db)`; `bun scripts/audit-defensives.ts --shared` audits against shipped ⊕ shared instead of shipped only.
- Front: no visible layout change; `originLabel(origin)` maps `"override" → "override"`, `"shared" → "shared"`, `"pending" → "pending review"`, `"shipped" → null` and replaces the two hard-coded `" · override"` spots; the "Table used" line says `N from your override` (local) or `N shared · M pending review` (hosted, when any); `DefensivesResponse.overridePath: string | null`, `proposals?: ProposalSummary[]`, `DefensivesPatchResult.proposal?`. The panel's hosted wording ("Propose: + major…", pending chip) is issue #7.
- No new runtime dependencies. TypeScript strict; English; 2 spaces, double quotes, trailing commas, `.ts` extensions; `just check` and `bun test` green with `web/dist` absent. Never spend WCL points: nothing in this plan calls WCL; tests use the shipped table and fixtures only. Any test file that could reach `gql` keeps its dummy-credential guard.
- Commits on `main` in place; messages end (after a blank line) with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013jauoHmAVWGgwtjdsiA8K3`. Stage paths explicitly; never stage `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`, `web/dist`. Never rewrite history.

## File structure

| File | Responsibility |
|---|---|
| `src/deepdive/types.ts` (modify) | `EntryOrigin`, `OverrideEntry.origin?`, `LoadedTables.source` / nullable `overridePath` |
| `src/deepdive/table.ts` (modify) | `mergeEntry`, `layerPatches`, `applyPatch` over `mergeEntry`, origin passthrough in `specDefensives`, `source: "file"` in `loadDefensives` |
| `src/hosted/schema.ts`, `src/hosted/db.ts` (modify) | the two tables; `HostedDb.defensives` |
| `src/hosted/defensives.ts` (new) | `openDefensives(db)` repo; service `tablesFor`, `propose`, `decide`, `proposalSummary` |
| `src/server/deepdive.ts` (modify) | `tablesOf(ctx, runtime)`, `withCachedAnalyses(payload, tables)`, hosted `handleDefensivesGet/Post` (proposals), `handleDeepdive` per-user tables |
| `src/server/lookup.ts`, `src/server/routes-shared.ts` (modify) | per-user tables on lookups and history reads |
| `src/server/routes-admin.ts` (modify) | proposal moderation routes |
| `src/cli.ts`, `scripts/audit-defensives.ts` (modify) | `--shared` |
| `web/src/lib/deepdive.ts`, `web/src/components/RunDeepDive.tsx`, `web/src/types.ts` (modify) | origin labels, response types |
| `test/deepdive/table.test.ts` (extend), `test/hosted/defensives.test.ts` (new), `test/server-defensives.test.ts` (new), `web/src/lib/deepdive.test.ts` (extend); `test/deepdive/{attach,run}.test.ts` (literal fix) | tests |
| `README.md`, `docs/agents/{architecture,testing,workflow}.md`, `AGENTS.md` (modify) | manuals |

---

### Task 1: Table core — origins, `mergeEntry`, `layerPatches`, `LoadedTables.source`

**Files:**
- Modify: `src/deepdive/types.ts`, `src/deepdive/table.ts`
- Modify: `test/deepdive/attach.test.ts:15`, `test/deepdive/run.test.ts:17` (add `source: "file"`), `src/cli.ts` (`cmdDefensives` prints a nullable path), `src/server/deepdive.ts` (`handleDefensivesPost` narrows on `source`)
- Test: `test/deepdive/table.test.ts` (extend)

**Interfaces:**
- Produces: `EntryOrigin`; `OverrideEntry.origin?`; `LoadedTables.source: "file" | "shared"`, `overridePath: string | null`; `mergeEntry(list: OverrideEntry[], patch: OverrideEntry): OverrideEntry[]`; `layerPatches(base: Override, patches: Array<{ key: string; patch: OverrideEntry }>, origin: "shared" | "pending"): Override`; `tagOrigin(override: Override, origin: "shared" | "pending"): Override`.

- [ ] **Step 1: Write the failing tests (append to `test/deepdive/table.test.ts`)**

Add `layerPatches, mergeEntry, tagOrigin` to the import from `../../src/deepdive/table.ts` and append:

```ts
describe("mergeEntry / layerPatches / origins", () => {
  test("mergeEntry merges fields over a previous patch, ignore replaces, origin is kept from the patch", () => {
    const a = mergeEntry([], { id: 498, cooldownS: 45 });
    expect(a).toEqual([{ id: 498, cooldownS: 45 }]);
    const b = mergeEntry(a, { id: 498, durationS: 9, origin: "pending" });
    expect(b).toEqual([{ id: 498, cooldownS: 45, durationS: 9, origin: "pending" }]);
    const c = mergeEntry(b, { id: 498, ignore: true, origin: "shared" });
    expect(c).toEqual([{ id: 498, ignore: true, origin: "shared" }]);
    const d = mergeEntry(c, { id: 498, cooldownS: 50 });
    expect(d).toEqual([{ id: 498, cooldownS: 50 }]); // a patch after ignore starts over
    expect(mergeEntry(d, { id: 1, name: "X" })).toEqual([{ id: 498, cooldownS: 50 }, { id: 1, name: "X" }]);
  });

  test("specDefensives reports the entry's origin, defaulting to override", () => {
    const override: Override = { "Paladin:Holy": [{ id: 498, cooldownS: 45, origin: "shared" }, { id: 31821, cooldownS: 170, origin: "pending" }, { id: 642, cooldownS: 250 }] };
    const d = specDefensives(SHIPPED, override, "Paladin", "Holy");
    const origin = (id: number) => d.entries.find((e) => e.id === id)?.origin;
    expect([origin(498), origin(31821), origin(642)]).toEqual(["shared", "pending", "override"]);
    expect(d.entries.find((e) => e.id === 498)?.cooldownS).toBe(45);
  });

  test("layerPatches applies key/patch pairs tagged with the layer; tagOrigin tags every entry", () => {
    const shared = tagOrigin({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] }, "shared");
    expect(shared).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45, origin: "shared" }] });
    const mine = layerPatches(shared, [
      { key: "Paladin:Holy", patch: { id: 498, durationS: 9 } },
      { key: "Paladin:*", patch: { id: 642, ignore: true } },
    ], "pending");
    expect(mine).toEqual({
      "Paladin:Holy": [{ id: 498, cooldownS: 45, durationS: 9, origin: "pending" }],
      "Paladin:*": [{ id: 642, ignore: true, origin: "pending" }],
    });
    expect(shared["Paladin:Holy"]).toEqual([{ id: 498, cooldownS: 45, origin: "shared" }]); // pure
  });

  test("validateOverride strips origin from file entries", () => {
    expect(validateOverride({ "Paladin:Holy": [{ id: 498, cooldownS: 45, origin: "shared" }] })).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] });
  });

  test("applyPatch still refuses an incomplete unknown id and keeps its merge semantics", () => {
    const eff = specDefensives(SHIPPED, {}, "Paladin", "Holy");
    expect(() => applyPatch({}, "Paladin:Holy", { id: 999999, cooldownS: 30 }, eff)).toThrow(/999999/);
    expect(applyPatch({}, "Paladin:Holy", { id: 498, cooldownS: 45 }, eff)).toEqual({ "Paladin:Holy": [{ id: 498, cooldownS: 45 }] });
  });
});
```

Run: `bun test test/deepdive/table.test.ts` → Expected: FAIL (`mergeEntry` not exported).

- [ ] **Step 2: Types**

`src/deepdive/types.ts`:

```ts
/** Where an effective entry comes from: the shipped table, the local override file, the hosted shared layer or the caller's own pending proposal. */
export type EntryOrigin = "shipped" | "override" | "shared" | "pending";
```

In `OverrideEntry` add `/** Set by the hosted loaders (never read from the file): the layer this entry came from. */ origin?: Exclude<EntryOrigin, "shipped">;`. `EffectiveEntry.origin: EntryOrigin` and `DefensiveUse.origin: EntryOrigin`. `LoadedTables` becomes:

```ts
export interface LoadedTables {
  shipped: ShippedTable;
  override: Override;
  /** "file": the local defensives.json next to .env; "shared": the hosted DB layer (+ the caller's pending proposals). */
  source: "file" | "shared";
  overridePath: string | null; // a path iff source === "file"
  warning?: string;            // override unreadable/invalid → shipped only
}
```

- [ ] **Step 3: `src/deepdive/table.ts`**

Replace `applyPatch` with:

```ts
/** Pure list merge: `ignore` replaces any earlier patch for the id; otherwise the patch's fields merge over the previous patch (a patch after an ignore starts over). A patch's `origin` is kept on the result. */
export function mergeEntry(list: OverrideEntry[], patch: OverrideEntry): OverrideEntry[] {
  const out = [...list];
  const idx = out.findIndex((e) => e.id === patch.id);
  let next: OverrideEntry;
  if (patch.ignore) next = { id: patch.id, ignore: true, ...(patch.origin ? { origin: patch.origin } : {}) };
  else {
    const prev = idx >= 0 && !out[idx]!.ignore ? out[idx]! : { id: patch.id };
    const { ignore: _i, ...fields } = patch;
    next = { ...prev, ...fields };
  }
  if (idx >= 0) out[idx] = next; else out.push(next);
  return out;
}

/** Every entry of `override` tagged with `origin` (a loader helper; pure). */
export const tagOrigin = (override: Override, origin: Exclude<EntryOrigin, "shipped">): Override =>
  Object.fromEntries(Object.entries(override).map(([k, list]) => [k, list.map((e) => ({ ...e, origin }))]));

/** `base` with each `{ key, patch }` merged in and tagged `origin` (pure). Incomplete unknown ids are kept and ignored by specDefensives. */
export function layerPatches(base: Override, patches: Array<{ key: string; patch: OverrideEntry }>, origin: Exclude<EntryOrigin, "shipped">): Override {
  const out: Override = { ...base };
  for (const { key, patch } of patches) out[key] = mergeEntry(out[key] ?? [], { ...patch, origin });
  return out;
}

/**
 * Pure: returns a new override with `patch` merged under `key`. A known id (in `effective`)
 * keeps only the patched fields; `ignore` replaces any earlier patch; an unknown id must be complete.
 */
export function applyPatch(override: Override, key: string, patch: OverrideEntry, effective: SpecDefensives): Override {
  if (!KEY_RE.test(key)) fail(`key "${key}" must look like "Class:Spec" or "Class:*"`);
  const list = mergeEntry(override[key] ?? [], patch);
  if (!patch.ignore) {
    const known = effective.entries.some((e) => e.id === patch.id) || effective.ignored.includes(patch.id);
    const next = list.find((e) => e.id === patch.id)!;
    if (!known && !complete(next)) fail(`id ${patch.id} is not in the table for ${key}: name, cooldownS, durationS and kind are required to add it`);
  }
  return { ...override, [key]: list };
}
```

(`import type { …, EntryOrigin, … }`.) In `specDefensives`, both `origin: "override"` occurrences become `origin: e.origin ?? "override"`. In `loadDefensives`, every returned object gains `source: "file"`. `validateEntry` already copies only known fields, so `origin` from a file is dropped — no change.

- [ ] **Step 4: Callers of the changed types**

- `test/deepdive/attach.test.ts:15` and `test/deepdive/run.test.ts:17`: `{ shipped: SHIPPED, override: {}, source: "file", overridePath: "/dev/null" }`.
- `src/cli.ts` `cmdDefensives`: `console.log(ok(\`✓ ${t.overridePath ?? "(no file)"}: …\`))` and the heading line uses `t.overridePath ?? "none"` — keep the wording minimal; Task 4 rewrites this command for `--shared`.
- `src/server/deepdive.ts` `handleDefensivesPost` (local branch): `saveOverride(tables.overridePath, next)` needs a string — guard with `if (tables.source !== "file" || tables.overridePath === null) return jsonResponse({ ok: false, error: "no override file in this mode" }, 400);` before the `try` (Task 3 replaces the hosted branch entirely).
- `grep -rn "origin: \"override\"\|overridePath" src web/src test` to catch anything else `tsc` flags.

- [ ] **Step 5: Run, check, commit**

Run: `bun test test/deepdive` → PASS (existing origin expectations unchanged). Run: `just check && bun test` → green.

```bash
git add src/deepdive/types.ts src/deepdive/table.ts src/cli.ts src/server/deepdive.ts test/deepdive/table.test.ts test/deepdive/attach.test.ts test/deepdive/run.test.ts
git commit -m "refactor(deepdive): entry origins, mergeEntry/layerPatches and LoadedTables.source"
```

---

### Task 2: Schema, repository and service — `src/hosted/defensives.ts`

**Files:**
- Modify: `src/hosted/schema.ts`, `src/hosted/db.ts`
- Create: `src/hosted/defensives.ts`
- Test: `test/hosted/defensives.test.ts` (new)

**Interfaces:**
- Consumes: `SHIPPED`, `specDefensives`, `specKey`, `validateOverride`, `applyPatch`, `mergeEntry`, `layerPatches`, `tagOrigin` (Task 1); `HostedDb` pattern.
- Produces (`src/hosted/defensives.ts`): `ProposalStatus`, `ProposalRow { id; key; spellId; patch: OverrideEntry; proposedBy; createdAt; status; decidedBy: number | null; decidedAt: number | null; note: string | null }`, `ProposalSummary`, `proposalSummary(p)`, `DefensivesRepo`, `openDefensives(db): DefensivesRepo`, `tablesFor(repo, userId: number | null): LoadedTables`, `propose(repo, user: { id: number; role: Role }, className, spec, patch: unknown, now): ProposeOutcome`, `decide(repo, id, admin: { id: number }, status: "approved" | "rejected", note: string | null, now): ProposalRow | null`; `HostedDb.defensives: DefensivesRepo`.

- [ ] **Step 1: Write the failing tests `test/hosted/defensives.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SHIPPED, specDefensives } from "../../src/deepdive/table.ts";
import { openHosted } from "../../src/hosted/db.ts";
import { decide, propose, tablesFor } from "../../src/hosted/defensives.ts";

const HOLY = { className: "Paladin", spec: "Holy" };
const DP = 498; // Divine Protection, shipped Paladin:Holy, cd 60

function setup() {
  const db = new Database(":memory:");
  const hosted = openHosted(db);
  const mk = (discordId: string, role: "member" | "admin") =>
    hosted.users.upsertFromDiscord({ discordId, username: "u" + discordId.slice(-2), globalName: null, avatarHash: null }, role, 0);
  const tom = mk("100000000000000001", "member");
  const bob = mk("100000000000000002", "member");
  const boss = mk("100000000000000003", "admin");
  const repo = hosted.defensives;
  const entry = (userId: number | null, id = DP) => specDefensives(SHIPPED, tablesFor(repo, userId).override, HOLY.className, HOLY.spec).entries.find((e) => e.id === id);
  return { db, hosted, repo, tom, bob, boss, entry };
}

describe("tablesFor", () => {
  test("without any layer it is the shipped table, source shared, no path", () => {
    const { repo, tom } = setup();
    const t = tablesFor(repo, tom.id);
    expect(t.source).toBe("shared");
    expect(t.overridePath).toBeNull();
    expect(t.override).toEqual({});
    expect(t.shipped).toBe(SHIPPED);
  });
});

describe("propose / decide lifecycle", () => {
  test("a member's proposal applies to the author immediately (pending) and to nobody else", () => {
    const { repo, tom, bob, entry } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal).toMatchObject({ key: "Paladin:Holy", spellId: DP, patch: { id: DP, cooldownS: 45 }, proposedBy: tom.id, status: "pending", createdAt: 1000, decidedBy: null, decidedAt: null, note: null });
    expect(entry(tom.id)).toMatchObject({ cooldownS: 45, origin: "pending" });
    expect(entry(bob.id)).toMatchObject({ cooldownS: 60, origin: "shipped" });
    expect(entry(null)).toMatchObject({ cooldownS: 60, origin: "shipped" });
  });

  test("a second proposal for the same spell merges into the pending row (dedupe)", () => {
    const { repo, tom, entry } = setup();
    const first = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    const second = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, durationS: 9 }, 2000);
    expect(first.ok && second.ok && first.proposal.id === second.proposal.id).toBe(true);
    if (second.ok) expect(second.proposal.patch).toEqual({ id: DP, cooldownS: 45, durationS: 9 });
    expect(repo.pendingOf(tom.id).length).toBe(1);
    expect(entry(tom.id)).toMatchObject({ cooldownS: 45, durationS: 9, origin: "pending" });
    const ignore = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, ignore: true }, 3000);
    if (ignore.ok) expect(ignore.proposal.patch).toEqual({ id: DP, ignore: true });
    expect(entry(tom.id)).toBeUndefined();
  });

  test("approval moves the correction to the shared layer for everyone; the author's row is no longer pending", () => {
    const { repo, tom, bob, boss, entry } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (!r.ok) throw new Error(r.error);
    const decided = decide(repo, r.proposal.id, boss, "approved", "matches the tooltip", 5000);
    expect(decided).toMatchObject({ id: r.proposal.id, status: "approved", decidedBy: boss.id, decidedAt: 5000, note: "matches the tooltip" });
    expect(entry(bob.id)).toMatchObject({ cooldownS: 45, origin: "shared" });
    expect(entry(tom.id)).toMatchObject({ cooldownS: 45, origin: "shared" });
    expect(entry(null)).toMatchObject({ cooldownS: 45, origin: "shared" });
    expect(repo.shared()).toEqual({ "Paladin:Holy": [{ id: DP, cooldownS: 45, origin: "shared" }] });
    expect(repo.pendingOf(tom.id)).toEqual([]);
    expect(decide(repo, r.proposal.id, boss, "rejected", null, 6000)).toBeNull(); // already decided
    expect(decide(repo, 9999, boss, "approved", null, 6000)).toBeNull();
  });

  test("a later approval merges over the shared entry; an approved ignore removes it", () => {
    const { repo, tom, boss, entry } = setup();
    const a = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (a.ok) decide(repo, a.proposal.id, boss, "approved", null, 2000);
    const b = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, durationS: 9 }, 3000);
    if (b.ok) decide(repo, b.proposal.id, boss, "approved", null, 4000);
    expect(repo.shared()["Paladin:Holy"]).toEqual([{ id: DP, cooldownS: 45, durationS: 9, origin: "shared" }]);
    const c = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, ignore: true }, 5000);
    if (c.ok) decide(repo, c.proposal.id, boss, "approved", null, 6000);
    expect(entry(null)).toBeUndefined();
    expect(specDefensives(SHIPPED, tablesFor(repo, null).override, "Paladin", "Holy").ignored).toEqual([DP]);
  });

  test("rejection drops the correction for the author and keeps the note in their proposals", () => {
    const { repo, tom, boss, entry } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, ignore: true }, 1000);
    if (!r.ok) throw new Error(r.error);
    expect(entry(tom.id)).toBeUndefined();
    decide(repo, r.proposal.id, boss, "rejected", "Divine Protection is a real defensive", 2000);
    expect(entry(tom.id)).toMatchObject({ cooldownS: 60, origin: "shipped" });
    expect(repo.proposalsOf(tom.id, "Paladin:Holy").map((p) => [p.status, p.note])).toEqual([["rejected", "Divine Protection is a real defensive"]]);
  });

  test("an admin's proposal is approved on the spot", () => {
    const { repo, bob, boss, entry } = setup();
    const r = propose(repo, boss, HOLY.className, HOLY.spec, { id: DP, cooldownS: 50 }, 1000);
    expect(r.ok && r.proposal.status === "approved" && r.proposal.decidedBy === boss.id && r.proposal.decidedAt === 1000).toBe(true);
    expect(entry(bob.id)).toMatchObject({ cooldownS: 50, origin: "shared" });
    expect(repo.pendingOf(boss.id)).toEqual([]);
  });

  test("invalid or incomplete patches are refused with the validator's message; nothing is stored", () => {
    const { repo, tom } = setup();
    const bad = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, kind: "huge" }, 1000);
    expect(bad).toMatchObject({ ok: false, status: 400 });
    if (!bad.ok) expect(bad.error).toMatch(/kind/);
    const incomplete = propose(repo, tom, HOLY.className, HOLY.spec, { id: 999999, cooldownS: 30 }, 1000);
    if (!incomplete.ok) expect(incomplete.error).toMatch(/999999/);
    expect(repo.pendingOf(tom.id)).toEqual([]);
    const unknownKey = propose(repo, tom, "Paladin", "Not A Spec", { id: DP, cooldownS: 30 }, 1000);
    expect(unknownKey.ok).toBe(false); // "Paladin:NotASpec" has no table: an existing id patch is still refused as unknown
  });

  test("listProposals joins the proposer's username and filters by status", () => {
    const { repo, tom, boss } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    expect(repo.listProposals("pending").map((p) => [p.id, p.username])).toEqual([[r.ok ? r.proposal.id : -1, "u01"]]);
    if (r.ok) decide(repo, r.proposal.id, boss, "approved", null, 2000);
    expect(repo.listProposals("pending")).toEqual([]);
    expect(repo.listProposals("approved").length).toBe(1);
  });

  test("deleting a proposer cascades their proposals; approvals survive an admin's deletion", () => {
    const { db, repo, tom, boss } = setup();
    const r = propose(repo, tom, HOLY.className, HOLY.spec, { id: DP, cooldownS: 45 }, 1000);
    if (r.ok) decide(repo, r.proposal.id, boss, "approved", null, 2000);
    db.run("DELETE FROM users WHERE id = ?", [boss.id]);
    expect(repo.shared()["Paladin:Holy"]?.[0]).toMatchObject({ id: DP, cooldownS: 45 });
    db.run("DELETE FROM users WHERE id = ?", [tom.id]);
    expect(repo.listProposals("approved")).toEqual([]);
  });
});
```

Note on "unknownKey": `specKey("Paladin", "Not A Spec")` is `Paladin:NotASpec`; the effective table then only has `Paladin:*` entries, so id 498 (a `Paladin:Holy` entry) is unknown and the incomplete patch is refused — that is the intended behaviour (a patch must target a spec that has the spell).

Run: `bun test test/hosted/defensives.test.ts` → FAIL (module not found).

- [ ] **Step 2: Schema**

Append inside `HOSTED_SCHEMA` after `usage_hourly`:

```sql
CREATE TABLE IF NOT EXISTS defensives_shared (
  key         TEXT    NOT NULL,
  id          INTEGER NOT NULL,
  entry       TEXT    NOT NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (key, id)
);
CREATE TABLE IF NOT EXISTS defensives_proposals (
  id          INTEGER PRIMARY KEY,
  key         TEXT    NOT NULL,
  spell_id    INTEGER NOT NULL,
  patch       TEXT    NOT NULL,
  proposed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at  INTEGER,
  note        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS defensives_proposals_pending ON defensives_proposals(proposed_by, key, spell_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS defensives_proposals_status ON defensives_proposals(status, created_at);
```

- [ ] **Step 3: Create `src/hosted/defensives.ts`**

```ts
// Hosted defensives: one shared, admin-approved override layer plus per-member pending proposals.
// Effective table for a member = shipped ⊕ defensives_shared ⊕ their own pending proposals; a
// proposal applies to its author at once and to everyone once approved. Nothing here iterates
// histories: hosted analyses are attached on read (src/server/deepdive.ts withCachedAnalyses).
import type { Database } from "bun:sqlite";
import { SHIPPED, applyPatch, layerPatches, mergeEntry, specDefensives, specKey, tagOrigin, validateOverride } from "../deepdive/table.ts";
import type { LoadedTables, Override, OverrideEntry } from "../deepdive/types.ts";
import type { Role } from "./db.ts";

export type ProposalStatus = "pending" | "approved" | "rejected";
export interface ProposalRow {
  id: number;
  key: string;
  spellId: number;
  patch: OverrideEntry;
  proposedBy: number;
  createdAt: number;
  status: ProposalStatus;
  decidedBy: number | null;
  decidedAt: number | null;
  note: string | null;
}
/** What the API shows a member about their own proposals. */
export interface ProposalSummary { id: number; spellId: number; status: ProposalStatus; patch: OverrideEntry; note: string | null; createdAt: number; decidedAt: number | null }
export const proposalSummary = (p: ProposalRow): ProposalSummary =>
  ({ id: p.id, spellId: p.spellId, status: p.status, patch: p.patch, note: p.note, createdAt: p.createdAt, decidedAt: p.decidedAt });

export interface DefensivesRepo {
  /** The approved layer, every entry tagged origin "shared". */
  shared(): Override;
  upsertShared(key: string, entry: OverrideEntry, approvedBy: number, now: number): void;
  proposalById(id: number): ProposalRow | null;
  pendingOf(userId: number): ProposalRow[];
  /** A member's proposals for one key, any status, newest first. */
  proposalsOf(userId: number, key: string): ProposalRow[];
  listProposals(status: ProposalStatus): Array<ProposalRow & { username: string | null }>;
  insertProposal(p: Omit<ProposalRow, "id">): ProposalRow;
  updatePatch(id: number, patch: OverrideEntry): void;
  /** Records a decision on a pending proposal; false when it was not pending. */
  markDecided(id: number, status: Exclude<ProposalStatus, "pending">, decidedBy: number, note: string | null, now: number): boolean;
}

interface SharedRaw { key: string; entry: string }
interface ProposalRaw { id: number; key: string; spell_id: number; patch: string; proposed_by: number; created_at: number; status: ProposalStatus; decided_by: number | null; decided_at: number | null; note: string | null }

const row = (r: ProposalRaw): ProposalRow => ({
  id: r.id, key: r.key, spellId: r.spell_id, patch: JSON.parse(r.patch) as OverrideEntry, proposedBy: r.proposed_by, createdAt: r.created_at,
  status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.note,
});
/** Stored entries never carry an origin: the loader tags them. */
const stripOrigin = ({ origin: _o, ...e }: OverrideEntry): OverrideEntry => e;

export function openDefensives(db: Database): DefensivesRepo {
  const sharedAll = db.query<SharedRaw, []>("SELECT key, entry FROM defensives_shared ORDER BY key, id");
  const sharedUpsert = db.query("INSERT INTO defensives_shared (key, id, entry, approved_by, approved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key, id) DO UPDATE SET entry = excluded.entry, approved_by = excluded.approved_by, approved_at = excluded.approved_at");
  const byId = db.query<ProposalRaw, [number]>("SELECT * FROM defensives_proposals WHERE id = ?");
  const pending = db.query<ProposalRaw, [number]>("SELECT * FROM defensives_proposals WHERE proposed_by = ? AND status = 'pending' ORDER BY created_at, id");
  const ofKey = db.query<ProposalRaw, [number, string]>("SELECT * FROM defensives_proposals WHERE proposed_by = ? AND key = ? ORDER BY created_at DESC, id DESC");
  const byStatus = db.query<ProposalRaw & { username: string | null }, [ProposalStatus]>("SELECT p.*, u.username FROM defensives_proposals p LEFT JOIN users u ON u.id = p.proposed_by WHERE p.status = ? ORDER BY p.created_at, p.id");
  const insert = db.query<{ id: number }, [string, number, string, number, number, ProposalStatus, number | null, number | null, string | null]>(
    "INSERT INTO defensives_proposals (key, spell_id, patch, proposed_by, created_at, status, decided_by, decided_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
  );
  const setPatch = db.query("UPDATE defensives_proposals SET patch = ? WHERE id = ?");
  const decideStmt = db.query("UPDATE defensives_proposals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ? AND status = 'pending'");
  const changes = (): number => Number(db.query<{ n: number }, []>("SELECT changes() AS n").get()!.n);

  return {
    shared() {
      const out: Override = {};
      for (const r of sharedAll.all()) (out[r.key] ??= []).push(JSON.parse(r.entry) as OverrideEntry);
      return tagOrigin(out, "shared");
    },
    upsertShared(key, entry, approvedBy, now) { sharedUpsert.run(key, entry.id, JSON.stringify(stripOrigin(entry)), approvedBy, now); },
    proposalById(id) { const r = byId.get(id); return r ? row(r) : null; },
    pendingOf: (userId) => pending.all(userId).map(row),
    proposalsOf: (userId, key) => ofKey.all(userId, key).map(row),
    listProposals: (status) => byStatus.all(status).map((r) => ({ ...row(r), username: r.username })),
    insertProposal(p) {
      const { id } = insert.get(p.key, p.spellId, JSON.stringify(stripOrigin(p.patch)), p.proposedBy, p.createdAt, p.status, p.decidedBy, p.decidedAt, p.note)!;
      return row(byId.get(id)!);
    },
    updatePatch(id, patch) { setPatch.run(JSON.stringify(stripOrigin(patch)), id); },
    markDecided(id, status, decidedBy, note, now) { decideStmt.run(status, decidedBy, now, note, id); return changes() === 1; },
  };
}

/** Shipped ⊕ shared ⊕ (when given) that member's pending proposals. */
export function tablesFor(repo: DefensivesRepo, userId: number | null): LoadedTables {
  const shared = repo.shared();
  const override = userId === null ? shared : layerPatches(shared, repo.pendingOf(userId).map((p) => ({ key: p.key, patch: p.patch })), "pending");
  return { shipped: SHIPPED, override, source: "shared", overridePath: null };
}

export type ProposeOutcome = { ok: true; proposal: ProposalRow; tables: LoadedTables } | { ok: false; status: 400; error: string };

/** Validates and records a correction: pending for a member (merged into an existing pending row for the same spell), approved on the spot for an admin. */
export function propose(repo: DefensivesRepo, user: { id: number; role: Role }, className: string, spec: string, patch: unknown, now: number): ProposeOutcome {
  const key = specKey(className, spec);
  let validated: OverrideEntry;
  try {
    validated = validateOverride({ [key]: [patch] })[key]![0]!;
    const mine = tablesFor(repo, user.id);
    applyPatch(mine.override, key, validated, specDefensives(mine.shipped, mine.override, className, spec)); // completeness check only
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e) };
  }
  if (user.role === "admin") {
    const shared = repo.shared();
    const entry = mergeEntry(shared[key] ?? [], validated).find((e) => e.id === validated.id)!;
    repo.upsertShared(key, entry, user.id, now);
    const proposal = repo.insertProposal({ key, spellId: validated.id, patch: validated, proposedBy: user.id, createdAt: now, status: "approved", decidedBy: user.id, decidedAt: now, note: null });
    return { ok: true, proposal, tables: tablesFor(repo, user.id) };
  }
  const existing = repo.pendingOf(user.id).find((p) => p.key === key && p.spellId === validated.id);
  let proposal: ProposalRow;
  if (existing) {
    const merged = mergeEntry([existing.patch], validated).find((e) => e.id === validated.id)!;
    repo.updatePatch(existing.id, merged);
    proposal = repo.proposalById(existing.id)!;
  } else {
    proposal = repo.insertProposal({ key, spellId: validated.id, patch: validated, proposedBy: user.id, createdAt: now, status: "pending", decidedBy: null, decidedAt: null, note: null });
  }
  return { ok: true, proposal, tables: tablesFor(repo, user.id) };
}

/** Approves (writes the shared layer) or rejects a pending proposal; null when it is not pending. */
export function decide(repo: DefensivesRepo, id: number, admin: { id: number }, status: "approved" | "rejected", note: string | null, now: number): ProposalRow | null {
  const p = repo.proposalById(id);
  if (!p || p.status !== "pending") return null;
  if (status === "approved") {
    const shared = repo.shared();
    const entry = mergeEntry(shared[p.key] ?? [], p.patch).find((e) => e.id === p.spellId)!;
    repo.upsertShared(p.key, entry, admin.id, now);
  }
  if (!repo.markDecided(id, status, admin.id, note, now)) return null;
  return repo.proposalById(id);
}
```

Note: `mergeEntry` on the tagged shared list yields an entry with `origin: "shared"`; `upsertShared` strips it before storing.

- [ ] **Step 4: Expose the repo on `HostedDb`**

`src/hosted/db.ts`: `import { openDefensives } from "./defensives.ts"; import type { DefensivesRepo } from "./defensives.ts";`, member `defensives: DefensivesRepo;` (after `usage`), and `defensives: openDefensives(db),` in the returned object. (`defensives.ts` imports only `type Role` from `db.ts` → no runtime cycle.)

- [ ] **Step 5: Run, check, commit**

Run: `bun test test/hosted/defensives.test.ts` → PASS (10 tests). Run: `just check && bun test` → green.

```bash
git add src/hosted/schema.ts src/hosted/db.ts src/hosted/defensives.ts test/hosted/defensives.test.ts
git commit -m "feat(hosted): shared defensives layer and moderated proposals (schema, repo, service)"
```

---

### Task 3: Routes — per-user tables everywhere, proposals on `/api/defensives`, admin moderation

**Files:**
- Modify: `src/server/deepdive.ts`, `src/server/lookup.ts`, `src/server/routes-shared.ts`, `src/server/routes-admin.ts`
- Test: `test/server-defensives.test.ts` (new); `test/server-user-state.test.ts` only if a signature it calls changed

**Interfaces:**
- Consumes: `tablesFor`, `propose`, `decide`, `proposalSummary`, `ProposalStatus` (Task 2); `getDefensives`, `specDefensives`, `applyPatch`, `saveOverride`, `resetDefensives`, `validateOverride`, `specKey` (Task 1); `HostedRuntime`, `RequestContext`, `SharedContext.runtime`.
- Produces: `tablesOf(ctx: RequestContext, runtime: HostedRuntime | null): Promise<LoadedTables>`, `withCachedAnalyses(payload, tables)`, `handleDefensivesGet(url, ctx, runtime)`, `handleDefensivesPost(req, ctx, runtime)`, `handleDeepdive(req, ctx, runtime)` (per-user tables); `LookupDeps.tables?: LoadedTables`; admin routes.

- [ ] **Step 1: `src/server/deepdive.ts`**

Imports: `import { propose, proposalSummary, tablesFor } from "../hosted/defensives.ts";` and `import type { LoadedTables } from "../deepdive/types.ts";` (`HostedRuntime`/`RequestContext` types are already imported). Replace the table plumbing:

```ts
/** The tables a request analyses with: the member's own layer (shared ⊕ their pending proposals) when hosted, the file otherwise. */
export async function tablesOf(ctx: RequestContext, runtime: HostedRuntime | null): Promise<LoadedTables> {
  return runtime && ctx.user ? tablesFor(runtime.db.defensives, ctx.user.id) : getDefensives();
}

/** The payload with today's cached analyses attached against `tables` and a re-run evaluation. 0 pts. Hosted reads go through this. */
export async function withCachedAnalyses(payload: LookupPayload, tables: LoadedTables): Promise<LookupPayload> {
  const [store, cfg] = await Promise.all([getStore(), getEvalConfig()]);
  return attachDeepdive(payload, store, tables, cfg);
}
```

`refreshLocalHistory()` keeps `getDefensives()` (local only). `handleDeepdive`: `const [store, tables] = await Promise.all([getStore(), tablesOf(ctx, runtime)]);` (rest unchanged). The two defensives handlers become:

```ts
const specResponse = (tables: LoadedTables, className: string, spec: string) => {
  const d = specDefensives(tables.shipped, tables.override, className, spec);
  return { key: d.key, entries: d.entries, ignored: d.ignored, tableMissing: d.tableMissing, overridePath: tables.overridePath, warning: tables.warning ?? null };
};

export async function handleDefensivesGet(url: URL, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const className = (url.searchParams.get("class") ?? "").trim();
  const spec = (url.searchParams.get("spec") ?? "").trim();
  if (!className || !spec) return jsonResponse({ ok: false, error: "`class` and `spec` are required" }, 400);
  const tables = await tablesOf(ctx, runtime);
  const base = specResponse(tables, className, spec);
  const proposals = runtime && ctx.user ? runtime.db.defensives.proposalsOf(ctx.user.id, base.key).map(proposalSummary) : [];
  return jsonResponse({ ok: true, ...base, proposals });
}

interface DefensivesPatchBody { className?: string; spec?: string; patch?: OverrideEntry }

export async function handleDefensivesPost(req: Request, ctx: RequestContext, runtime: HostedRuntime | null): Promise<Response> {
  const body = await readJson<DefensivesPatchBody>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  if (!body.className || !body.spec || !body.patch) return jsonResponse({ ok: false, error: "`className`, `spec` and `patch` are required" }, 400);
  if (runtime && ctx.user) {
    // Hosted: a correction is a proposal — it applies to its author now and to everyone once an admin approves it.
    const r = propose(runtime.db.defensives, { id: ctx.user.id, role: ctx.user.role }, body.className, body.spec, body.patch, ctx.now);
    if (!r.ok) return jsonResponse({ ok: false, error: r.error }, r.status);
    return jsonResponse({ ok: true, ...specResponse(r.tables, body.className, body.spec), proposal: proposalSummary(r.proposal) });
  }
  const tables = await getDefensives();
  if (tables.warning) return jsonResponse({ ok: false, error: `${tables.overridePath} is invalid — fix it by hand first: ${tables.warning}` }, 409);
  if (tables.source !== "file" || tables.overridePath === null) return jsonResponse({ ok: false, error: "no override file in this mode" }, 400);
  try {
    const key = specKey(body.className, body.spec);
    const effective = specDefensives(tables.shipped, tables.override, body.className, body.spec);
    const next = validateOverride(applyPatch(tables.override, key, validateOverride({ [key]: [body.patch] })[key]![0]!, effective));
    await saveOverride(tables.overridePath, next);
    resetDefensives();
    await refreshLocalHistory();
    return jsonResponse({ ok: true, ...specResponse(await getDefensives(), body.className, body.spec) });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
```

(The local 409 message no longer needs the hosted variant; `specResponse` drops the previous `overridePath: hosted ? null : …` since hosted tables carry `null` themselves.)

- [ ] **Step 2: Lookups and history reads**

`src/server/lookup.ts`: `LookupDeps` gains `tables?: LoadedTables` and `runLookupWithCache` passes `{ reserve: deps.reserve, tables: deps.tables }` to `performLookup` (both call sites — the flight and the joiner retry). `handleLookup`: 

```ts
  const tables = await tablesOf(ctx, runtime);
  const result = await runLookupWithCache({ … }, historyOf(ctx), { reserve: …, tables });
  …
  // Hosted: always attach on read against the member's own tables (a joiner never sees the starter's pending layer).
  const payload = ctx.hosted ? await withCachedAnalyses(result.result as LookupPayload, tables) : result.result;
```

(`import { tablesOf, withCachedAnalyses } from "./deepdive.ts";`.) `src/server/routes-shared.ts`: `handleDefensivesGet(url, rc, ctx.runtime)`, `handleDefensivesPost(req, rc, ctx.runtime)`, and the history read: `const result = rc.hosted ? await withCachedAnalyses(entry.result as LookupPayload, await tablesOf(rc, ctx.runtime)) : entry.result;` (import `tablesOf`).

- [ ] **Step 3: Admin routes (`src/server/routes-admin.ts`)**

Imports: `import { decide, proposalSummary } from "../hosted/defensives.ts"; import type { ProposalStatus } from "../hosted/defensives.ts";`. Add before the users routes:

```ts
    // Moderation of members' defensives corrections (issue #6); the admin page (#8) is the client.
    route("GET", "/api/admin/proposals", (_req, url) => {
      const status = (url.searchParams.get("status") ?? "pending") as ProposalStatus;
      if (!["pending", "approved", "rejected"].includes(status)) return jsonResponse({ ok: false, error: "`status` must be pending, approved or rejected" }, 400);
      const proposals = rt.db.defensives.listProposals(status).map((p) => ({ ...proposalSummary(p), key: p.key, proposedBy: p.proposedBy, username: p.username }));
      return jsonResponse({ ok: true, proposals });
    }, "admin"),
    prefixRoute("POST", "/api/admin/proposals/", async (req, url, ctx) => {
      const m = /^(\d+)\/(approve|reject)$/.exec(tail(url, "/api/admin/proposals/"));
      if (!m) return jsonResponse({ ok: false, error: "Expected /api/admin/proposals/:id/approve or /reject" }, 400);
      const body = await readJson<{ note?: unknown }>(req);
      const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
      const p = decide(rt.db.defensives, Number.parseInt(m[1]!, 10), { id: ctx.user!.id }, m[2] === "approve" ? "approved" : "rejected", note, ctx.now);
      if (!p) return jsonResponse({ ok: false, error: "No pending proposal with that id" }, 404);
      return jsonResponse({ ok: true, proposal: { ...proposalSummary(p), key: p.key, proposedBy: p.proposedBy } });
    }, "admin"),
```

`readJson` returns `null` for an empty body → `note` null (a POST without a body is fine).

- [ ] **Step 4: Write the tests `test/server-defensives.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHosted } from "../src/hosted/db.ts";
import type { HostedDb } from "../src/hosted/db.ts";
import { runServer } from "../src/server.ts";
import { closeStore, getStore } from "../src/signals/store.ts";
import { TEST_HOSTED_CONFIG, loginAs } from "./hosted/helpers.ts";

let dir: string;
let server: Awaited<ReturnType<typeof runServer>>;
let db: HostedDb;
let admin: ReturnType<typeof loginAs>;
let tom: ReturnType<typeof loginAs>;
let bob: ReturnType<typeof loginAs>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bmpl-def-hosted-"));
  mkdirSync(join(dir, "assets"));
  for (const f of ["index.html", "assets/app.js", "assets/app.css", "wh-config.js"]) writeFileSync(join(dir, f), "");
  closeStore();
  process.env.BMPL_DB_PATH = join(dir, "bmpl.db");
  server = await runServer({ port: 0, open: false, hosted: true, hostedConfig: TEST_HOSTED_CONFIG, assets: async () => ({ index: join(dir, "index.html"), appJs: join(dir, "assets/app.js"), appCss: join(dir, "assets/app.css"), whConfigJs: join(dir, "wh-config.js") }) });
  db = openHosted((await getStore())._db);
  admin = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "111111111111111111", role: "admin", username: "boss" });
  tom = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
  bob = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345679", role: "member", username: "bob" });
});
afterAll(() => { server.stop(true); closeStore(); delete process.env.BMPL_DB_PATH; rmSync(dir, { recursive: true, force: true }); });

const u = (p: string) => `http://localhost:${server.port}${p}`;
const get = (who: { cookie: string }, p: string) => fetch(u(p), { headers: { cookie: who.cookie } });
const post = (who: { cookie: string }, p: string, body?: unknown) =>
  fetch(u(p), { method: "POST", headers: { cookie: who.cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const HOLY = "/api/defensives?class=Paladin&spec=Holy";
const DP = 498;
const dp = async (who: { cookie: string }) => (await (await get(who, HOLY)).json()).entries.find((e: { id: number }) => e.id === DP);

describe("hosted defensives: proposals", () => {
  test("GET is per member: shipped entries, no path, an empty proposals list", async () => {
    const body = await (await get(tom, HOLY)).json();
    expect(body.ok).toBe(true);
    expect(body.overridePath).toBeNull();
    expect(body.proposals).toEqual([]);
    expect((await dp(tom))).toMatchObject({ cooldownS: 60, origin: "shipped" });
  });

  test("a member's POST creates a pending proposal that applies to them only", async () => {
    const r = await post(tom, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, cooldownS: 45 } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.proposal).toMatchObject({ spellId: DP, status: "pending", patch: { id: DP, cooldownS: 45 }, note: null });
    expect(body.entries.find((e: { id: number }) => e.id === DP)).toMatchObject({ cooldownS: 45, origin: "pending" });
    expect(await dp(tom)).toMatchObject({ cooldownS: 45, origin: "pending" });
    expect(await dp(bob)).toMatchObject({ cooldownS: 60, origin: "shipped" });
    const mine = await (await get(tom, HOLY)).json();
    expect(mine.proposals.map((p: { status: string }) => p.status)).toEqual(["pending"]);
  });

  test("a second POST for the same spell merges into the same proposal", async () => {
    const first = (await (await get(tom, HOLY)).json()).proposals[0].id;
    const r = await (await post(tom, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, durationS: 9 } })).json();
    expect(r.proposal.id).toBe(first);
    expect(r.proposal.patch).toEqual({ id: DP, cooldownS: 45, durationS: 9 });
  });

  test("invalid patches are 400 with the validator's message", async () => {
    const r = await post(tom, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: 999999, cooldownS: 30 } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/999999/);
  });

  test("moderation is admin-only; approval publishes the correction to everyone", async () => {
    expect((await get(tom, "/api/admin/proposals")).status).toBe(403);
    const list = await (await get(admin, "/api/admin/proposals")).json();
    expect(list.proposals).toHaveLength(1);
    expect(list.proposals[0]).toMatchObject({ key: "Paladin:Holy", spellId: DP, status: "pending", username: "tom", proposedBy: tom.user.id });
    expect((await get(admin, "/api/admin/proposals?status=nope")).status).toBe(400);
    const id = list.proposals[0].id;
    const ok = await post(admin, `/api/admin/proposals/${id}/approve`, { note: "matches the tooltip" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).proposal).toMatchObject({ id, status: "approved", note: "matches the tooltip" });
    expect(await dp(bob)).toMatchObject({ cooldownS: 45, durationS: 9, origin: "shared" });
    expect(await dp(tom)).toMatchObject({ cooldownS: 45, durationS: 9, origin: "shared" });
    expect((await post(admin, `/api/admin/proposals/${id}/approve`)).status).toBe(404);
    expect((await post(admin, "/api/admin/proposals/abc/approve")).status).toBe(400);
    expect((await (await get(admin, "/api/admin/proposals?status=approved")).json()).proposals).toHaveLength(1);
  });

  test("rejection drops the author's correction and leaves the note in their proposals", async () => {
    const r = await (await post(bob, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, ignore: true } })).json();
    expect(await dp(bob)).toBeUndefined();
    const rej = await post(admin, `/api/admin/proposals/${r.proposal.id}/reject`, { note: "Divine Protection is a real defensive" });
    expect(rej.status).toBe(200);
    expect(await dp(bob)).toMatchObject({ cooldownS: 45, origin: "shared" });
    const mine = await (await get(bob, HOLY)).json();
    expect(mine.proposals[0]).toMatchObject({ status: "rejected", note: "Divine Protection is a real defensive" });
  });

  test("an admin's POST is approved on the spot", async () => {
    const r = await (await post(admin, "/api/defensives", { className: "Paladin", spec: "Holy", patch: { id: DP, cooldownS: 50 } })).json();
    expect(r.proposal.status).toBe("approved");
    expect(await dp(tom)).toMatchObject({ cooldownS: 50, origin: "shared" });
  });
});
```

Run: `bun test test/server-defensives.test.ts` → PASS (7 tests). Run the local suites: `bun test test/server-deepdive.test.ts test/server.test.ts test/server-user-state.test.ts` → PASS (the local `/api/defensives` behaviour and responses are unchanged apart from the extra `proposals: []`).

- [ ] **Step 5: Check and commit**

Run: `just check && bun test` → green.

```bash
git add src/server/deepdive.ts src/server/lookup.ts src/server/routes-shared.ts src/server/routes-admin.ts test/server-defensives.test.ts
git commit -m "feat(server): per-member defensives tables, proposals on POST /api/defensives, admin moderation routes"
```

---

### Task 4: CLI / audit `--shared` and the front's origin labels

**Files:**
- Modify: `src/cli.ts` (`cmdDefensives`, dispatch), `scripts/audit-defensives.ts`
- Modify: `web/src/lib/deepdive.ts`, `web/src/components/RunDeepDive.tsx`, `web/src/types.ts`
- Test: `web/src/lib/deepdive.test.ts` (extend)

**Interfaces:**
- Consumes: `tablesFor`, `openHosted(store._db).defensives` (Task 2); `EntryOrigin` (Task 1); `ProposalSummary` (Task 2, type-only in the front).
- Produces: `originLabel(origin: EntryOrigin): string | null`, `tableUsedText(defensives: Array<{ origin: EntryOrigin }>, specClass: string): string` (`web/src/lib/deepdive.ts`).

- [ ] **Step 1: CLI**

`src/cli.ts` `cmdDefensives(className, spec, check, shared)`:

```ts
async function cmdDefensives(className: string | undefined, spec: string | undefined, check: boolean, shared: boolean): Promise<void> {
  // --shared: the hosted layer in bmpl.db (approved corrections, no member's pending ones); default: the file next to .env.
  const t = shared ? tablesFor(openHosted((await getStore())._db).defensives, null) : await loadDefensives();
  const layer = shared ? "shared (bmpl.db)" : `override: ${t.overridePath}${t.warning ? "  (ignored: invalid)" : ""}`;
  if (check) {
    if (t.warning) { console.error(err(`✗ ${t.warning}`)); process.exit(1); }
    console.log(ok(`✓ ${shared ? "shared layer" : t.overridePath}: ${Object.keys(t.override).length} spec key(s)`));
    if (shared) closeStore();
    return;
  }
  if (!className || !spec) { console.error(err("Usage: bmpl defensives <Class> <Spec> [--shared] | --check [--shared]")); process.exit(2); }
  const d = specDefensives(t.shipped, t.override, className, spec);
  console.log(heading(`${d.key}`) + dim(`  ${layer}`));
  if (d.tableMissing) console.log(pc.yellow("  no table for this spec — add entries to your defensives.json"));
  for (const e of d.entries) console.log(`  ${String(e.id).padStart(8)}  ${e.name.padEnd(28)} ${e.kind.padEnd(8)} cd ${String(e.cooldownS).padStart(3)}s  dur ${String(e.durationS).padStart(3)}s  ${e.origin === "shipped" ? dim("shipped") : pc.cyan(e.origin)}`);
  if (d.ignored.length > 0) console.log(dim(`  ignored: ${d.ignored.join(", ")}`));
  if (shared) closeStore();
}
```

Dispatch: `const positional = stripFlags(rest, [], ["--check", "--shared"]); await cmdDefensives(positional[0], positional[1], hasFlag(rest, "--check"), hasFlag(rest, "--shared"));`. Imports: `openHosted` from `./hosted/db.ts`, `tablesFor` from `./hosted/defensives.ts`, `closeStore`/`getStore` (already imported). Update the `help` text line for `defensives` to mention `[--shared]`.

`scripts/audit-defensives.ts`: `const shared = process.argv.includes("--shared");` after the other args; before the loop `const override = shared ? tablesFor(openHosted((await getStore())._db).defensives, null).override : {};` (imports `getStore` from `../src/signals/store.ts`, `openHosted`, `tablesFor`), and `specDefensives(SHIPPED, override, className, specName)`. Update the usage comment at the top.

Check: `bun src/cli.ts defensives Paladin Holy` prints the shipped table (unchanged), `bun src/cli.ts defensives Paladin Holy --shared` prints it with the `shared (bmpl.db)` label (empty layer locally — no WCL call, only SQLite).

- [ ] **Step 2: Failing front tests (append to `web/src/lib/deepdive.test.ts`)**

```ts
describe("originLabel / tableUsedText", () => {
  test("labels every non-shipped origin", () => {
    expect(originLabel("shipped")).toBeNull();
    expect(originLabel("override")).toBe("override");
    expect(originLabel("shared")).toBe("shared");
    expect(originLabel("pending")).toBe("pending review");
  });
  test("the table line counts the local override or the hosted layers", () => {
    const o = (origin: EntryOrigin) => ({ origin });
    expect(tableUsedText([o("shipped"), o("shipped")], "Holy Paladin")).toBe("Table used: Holy Paladin · 2 entries");
    expect(tableUsedText([o("shipped"), o("override")], "Holy Paladin")).toBe("Table used: Holy Paladin · 2 entries · 1 from your override");
    expect(tableUsedText([o("shared"), o("pending"), o("shipped")], "Holy Paladin")).toBe("Table used: Holy Paladin · 3 entries · 1 shared · 1 pending review");
    expect(tableUsedText([o("shared")], "Holy Paladin")).toBe("Table used: Holy Paladin · 1 entries · 1 shared");
  });
});
```

(`import type { EntryOrigin } from "@shared/deepdive/types.ts";` and add `originLabel, tableUsedText` to the import.) Run: `bun test web/src/lib/deepdive.test.ts` → FAIL.

- [ ] **Step 3: Front implementation**

`web/src/lib/deepdive.ts`:

```ts
/** Suffix shown next to an entry that is not from the shipped table; null for shipped. */
export function originLabel(origin: EntryOrigin): string | null {
  switch (origin) {
    case "override": return "override";
    case "shared": return "shared";
    case "pending": return "pending review";
    default: return null;
  }
}

/** "Table used: …" line: the local override count, or the hosted shared/pending counts. */
export function tableUsedText(defensives: Array<{ origin: EntryOrigin }>, specClass: string): string {
  const count = (o: EntryOrigin) => defensives.filter((u) => u.origin === o).length;
  const parts = [`Table used: ${specClass} · ${defensives.length} entries`];
  const override = count("override"), shared = count("shared"), pending = count("pending");
  if (override > 0) parts.push(`${override} from your override`);
  if (shared > 0) parts.push(`${shared} shared`);
  if (pending > 0) parts.push(`${pending} pending review`);
  return parts.join(" · ");
}
```

In `panelModel`: remove the `overrides` count and set `tableUsed: tableUsedText(d.defensives, specClass)`. The existing `panelModel` expectation `"Table used: Holy Paladin · 3 entries · 1 from your override"` (`web/src/lib/deepdive.test.ts:66`) stays valid — the clause is kept whenever the count is > 0. `RunDeepDive.tsx`: both `u.origin === "override" && …" · override"` spots become `{originLabel(u.origin) && <span className="faint"> · {originLabel(u.origin)}</span>}` (usage row) and `{originLabel(u.origin) ? \` · ${originLabel(u.origin)}\` : ""}` (table row). `web/src/types.ts`: `DefensivesResponse.overridePath: string | null; proposals?: ProposalSummary[];` and a new `export interface DefensivesPatchResult extends DefensivesResponse { proposal?: ProposalSummary }` with `import type { ProposalSummary } from "@shared/hosted/defensives.ts";`; `web/src/api.ts` `patchDefensives` returns `call<DefensivesPatchResult>`. Anything in the front reading `overridePath` as a string (`grep -n overridePath web/src`) gets a null guard.

- [ ] **Step 4: Check and commit**

Run: `bun test web/src/lib/deepdive.test.ts` → PASS. Run: `just check && bun test` → green; optional `cd web && bunx vite build && rm -rf dist`.

```bash
git add src/cli.ts scripts/audit-defensives.ts web/src/lib/deepdive.ts web/src/lib/deepdive.test.ts web/src/components/RunDeepDive.tsx web/src/types.ts web/src/api.ts
git commit -m "feat: --shared for the defensives CLI and audit; shared/pending origin labels in the panel"
```

---

### Task 5: Docs

**Files:** `README.md`, `docs/agents/architecture.md`, `docs/agents/testing.md`, `docs/agents/workflow.md`, `AGENTS.md`

- [ ] **Step 1: README**

- "Hosted mode" section: replace the paragraph "The admin page comes with issue #8. Anyone who signs in can still edit the server's `defensives.json` (`POST /api/defensives`) — harden that before opening the instance beyond a trusted circle, tracked in issue #9." with:

```
**Shared defensives table.** Corrections made from the panel are proposals:
they apply to you immediately (marked "pending review") and to everyone once
an admin approves them (`GET /api/admin/proposals`, `POST
/api/admin/proposals/:id/approve|reject { note }`); a rejected one is dropped
for you too, with the admin's note visible in `GET /api/defensives` →
`proposals`. An admin's own correction is approved on the spot. The server's
`defensives.json` is not used in hosted mode; the approved layer lives in
`bmpl.db` (`bmpl defensives <Class> <Spec> --shared` and `just
audit-defensives --shared` read it). The admin page comes with issue #8.
```

- The defensives section (around lines 125–160 and 276): add one sentence after the CLI description: "`--shared` reads the hosted instance's approved layer from `bmpl.db` instead of the file."

- [ ] **Step 2: `docs/agents/architecture.md`**

- Table rows: `| defensives_shared | (key, id) | hosted-mode approved override entry | until replaced |`, `| defensives_proposals | id | hosted-mode correction proposal (pending/approved/rejected) | forever |`.
- Deep-dive/defensives paragraph: `LoadedTables.source` (`"file"` local, `"shared"` hosted), `EntryOrigin`, `mergeEntry`/`layerPatches`/`tagOrigin` in `src/deepdive/table.ts`; `src/hosted/defensives.ts` (`tablesFor(repo, userId)` = shipped ⊕ shared ⊕ the member's pending proposals, `propose` (member → pending, one row per user/key/spell, admin → approved at once), `decide`); `tablesOf(ctx, runtime)` is the one way handlers get tables; hosted `/api/lookup` and history reads always attach on read against the member's tables (so approvals need no history iteration and a dedupe joiner never sees the starter's pending layer); admin routes.
- Invariants: "Hosted mode never reads or writes the server's `defensives.json`; the approved layer is `defensives_shared`." and "A proposal is validated against its author's effective table (unknown ids must be complete)."

- [ ] **Step 3: `testing.md`, `workflow.md`, `AGENTS.md`**

- `testing.md`: list `test/hosted/defensives.test.ts`, `test/server-defensives.test.ts`; update the count (`bun test` prints it).
- `workflow.md` roadmap: `#2–#6 … shipped; execute #7 → #11 in order`.
- `AGENTS.md`: `src/hosted/` line adds `shared defensives + proposals`; roadmap `#2–#6 … shipped, next is #7 (hosted front design pass)`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/agents/architecture.md docs/agents/testing.md docs/agents/workflow.md AGENTS.md
git commit -m "docs: shared defensives table and moderated proposals in hosted mode"
```

---

## Readiness for the next issues

- **#7 (hosted front pass):** the panel already receives `origin: "pending"` entries and `proposals` (with `status`/`note`) from `GET /api/defensives`; the wording ("Propose: + major", "pending review" chip, rejection note) is a pure presentation change over `originLabel`/`panelModel`.
- **#8 (admin page):** `GET /api/admin/proposals?status=` and the approve/reject routes are the queue's API; `username`/`proposedBy`/`key` are in every row.
- **#9 (hardening):** the moderation routes are state-changing (Origin check); `note` is capped at 500 chars; proposals are validated with the same validator as the file.
- Ruling recorded: no history iteration on approval — attach-on-read (#4) makes it unnecessary; `staleTable` still tells a member to re-analyze when a newly approved spell's casts were not in the raw fetch.

## Self-review

- **Spec coverage:** schema ✔ (Task 2, with `ON DELETE SET NULL` on the two admin references so approvals survive an admin's removal — a deliberate addition); effective table per user = shipped ⊕ shared ⊕ own pending, rejected dropped with note visible ✔ (Task 2 `tablesFor`/`proposalsOf`, Task 3 `proposals`); `POST /api/defensives` → proposal, dedupe, admin auto-approve, `origin` values ✔ (Tasks 2–3; `"mine (pending)"` is spelled `"pending"` in the type and labelled "pending review" in the UI); moderation routes with note, approval writes `defensives_shared` ✔; "re-attaches analyses for every user's history" → satisfied by attach-on-read (ruling in Readiness); local mode untouched, `LoadedTables.source` ✔ (Task 1); CLI + audit `--shared` ✔ (Task 4); acceptance tests: lifecycle, author vs others vs after approval, dedupe, admin auto-approve, rejection note ✔ (`test/hosted/defensives.test.ts`, `test/server-defensives.test.ts`); panel wording → #7 (issue says "front sub-issue"), only the origin labels here.
- **Placeholder scan:** none.
- **Type consistency:** `mergeEntry(list, patch)` (Task 1) used by Task 2 exactly so; `tablesFor(repo, userId | null)` (Task 2) used by Task 3 `tablesOf` and Task 4 CLI/audit; `propose` returns `{ ok, proposal, tables }` consumed by `handleDefensivesPost`; `decide(repo, id, admin, status, note, now)` consumed by the admin route; `ProposalSummary` fields identical in Task 2, the Task 3 responses and `web/src/types.ts`; `withCachedAnalyses(payload, tables)` updated at both call sites (lookup + history read); `LookupDeps.tables` passed to both `performLookup` call sites.
