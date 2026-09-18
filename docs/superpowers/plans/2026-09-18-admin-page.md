# Admin Page (invites, users, proposal queue, budget gauge, instance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` in the hosted web front — one page (layout **B**) with the shared WCL budget gauge, the proposal queue with a decided history, users (role toggle, revoke sessions, points), invites (add / remove, who signed in) and instance info; members get a 403 screen; the whole invite → login → proposal → approve flow runs from the UI.

**Architecture:** The server already exposes `/api/admin/{invites,users,usage,proposals}`; this plan adds what the page needs (24 h points per user, session revocation, the invite → user link, the current entry behind each proposal, `GET /api/admin/instance`) and keeps every route `auth: "admin"`. The front keeps its pattern: pure tested view models in `web/src/lib/admin.ts`, thin components under `web/src/components/admin/`, `api.ts` as the single fetch wrapper, new CSS classes appended (`.admin-*`, `.diff*`, `.gauge*`), local mode untouched (`/admin` shows the "Admins only" screen there too).

**Tech Stack:** Bun + `bun:sqlite` (`src/hosted/*`), Vite 8 + React 19 + TypeScript strict (`web/`), `bun test`.

**Spec:** GitHub issue #8 (`gh issue view 8`), parent #1. Design: canvas https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s page "Hosted" — artboards `AdminOnePage.dc.html` (chosen: **B · one page**) and `AdminDetails.dc.html` (403 screen, proposal card anatomy, empty queue, post-decision line, inline confirmations); sources in `docs/design/canvas/` (already written, uncommitted). Builds on #3 (admin routes, roles, invites), #5 (`/api/admin/usage`, meter snapshot), #6 (proposals, `tablesFor`), #7 (`UserMenu` Admin item → `/admin`, `/admin` static route, `pendingText`).

## Global Constraints

- **Scope rulings** (from the issue, adjusted): the "last 50 WCL errors" list needs the audit log of issue #9 — the gauge ships **without** it; "last litestream sync" reads the file `last-backup` next to `.env` that #10's deploy will write (`null` → "never" until then).
- **Every `/api/admin/*` route is `auth: "admin"`** (403 for members, 401 anonymous — the gate already exists). No route reads `process.env` secrets into a response: the instance route masks secrets (`•••• (set)` / `(not set)`, session secret shows its byte length, `WCL_CLIENT_ID` shows `first4…last4`).
- **Local mode untouched**: no local route changes; the page renders only the "Admins only" screen when `!status.hosted`; new CSS classes only (`.admin-*`, `.gauge*`, `.diff*`, `.confirm`), existing rules unchanged.
- **View models pure and tested** (`web/src/lib/admin.ts` + `admin.test.ts`, no React/DOM); components thin; `web/` imports from `src/` are types only via `web/src/types.ts`.
- **English strings only**; the strings the canvas shows are the strings to ship: "Shared WCL budget · this hour", "Top consumers · this hour", "Last 24 h · pts per hour", "Proposal queue", "Pending · N" / "Decided · N", "Approve" / "Reject", "Note to the author (optional)", "Users", "Invites", "Invite", "Remove", "Revoke sessions", "make admin" / "make member", "signed in as {name}" / "not signed in yet", "Instance", "Effective environment", "Admins only", "← back to lookups", "Nothing to review. Members' corrections land here."
- **Never spend WCL points**: nothing here calls WCL; tests use the hosted test server (`test/server-admin.test.ts` pattern: `runServer` with `TEST_HOSTED_CONFIG`, fake assets, `loginAs`).
- **Style**: 2 spaces, double quotes, trailing commas, `.ts`/`.tsx` import extensions; `just check && bun test` green with `web/dist` absent at the end of every task.
- **Git**: `main` in place, explicit `git add` paths, never `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`, `web/dist`. Commit trailers as the session provides.

## File map

| File | Responsibility |
|---|---|
| `src/hosted/db.ts` | + `usage.byUserSince(sinceAt)`, `sessions.countForUser(userId, now)` |
| `src/hosted/instance.ts` (new) + `test/hosted/instance.test.ts` | pure `describeConfig(config, wcl)` (masked env rows), `lastBackupAt(dir)` |
| `src/server/routes-admin.ts` + `test/server-admin.test.ts` | users rows + points/sessions, `POST /api/admin/users/:id/sessions/revoke`, invites `user`, proposals `current`/`ignored`, `GET /api/admin/instance` |
| `web/src/types.ts` | admin API types |
| `web/src/api.ts` | `api.admin.*` |
| `web/src/lib/hostedMode.ts` + test | `adminAccess(status, me)` |
| `web/src/lib/admin.ts` (new) + test | `gaugeModel`, `topConsumers`, `hourBars`, `proposalCard`, `decidedLine`, `userRow`, `inviteRow`, `instanceModel`, `maskedEnvRows` |
| `web/src/components/admin/AdminPage.tsx`, `Gauge.tsx`, `Queue.tsx`, `Users.tsx`, `Invites.tsx`, `Instance.tsx`, `Forbidden.tsx` (new) | thin components |
| `web/src/App.tsx` | `/admin` → `AdminPage` inside `Main` |
| `web/src/styles/app.css` | + admin classes |
| `README.md`, `docs/agents/web-front.md`, `docs/agents/architecture.md`, `AGENTS.md`, `docs/design/canvas/Admin*.dc.html`, `canvas.json` | docs + canvas sources |

---

### Task 1: Server — repo additions, instance helper, admin routes

**Files:**
- Modify: `src/hosted/db.ts`, `src/server/routes-admin.ts`, `test/server-admin.test.ts`
- Create: `src/hosted/instance.ts`, `test/hosted/instance.test.ts`

**Interfaces:**
- Consumes: `HostedDb` (`users`, `sessions`, `invites`, `usage`, `defensives`), `HostedRuntime` (`config`, `meter.snapshot()`), `tablesFor(repo, null)`, `specDefensives(SHIPPED, override, className, spec)`, `proposalSummary`, `avatarUrl`, `pkg.version`, `getStore()._db.filename`, `resolveEnvPath()`.
- Produces (JSON shapes the front consumes — Task 2 types mirror them):
  - `GET /api/admin/users` → `{ ok, users: AdminUser[] }`, `AdminUser = { id, discordId, username, globalName, avatarUrl, role, createdAt, lastSeenAt, pointsHour: number, points24h: number, sessions: number, configAdmin: boolean }`.
  - `POST /api/admin/users/:id/sessions/revoke` → `{ ok: true, sessionsEnded }`; 400 `"Sign out instead"` for the caller's own id; 404 `"Unknown user"`.
  - `GET /api/admin/invites` → `{ ok, invites: AdminInvite[] }`, `AdminInvite = InviteRow & { user: { id, username } | null }`.
  - `GET /api/admin/proposals?status=` → rows gain `current: DefensiveSpell | null` (the effective entry for `spellId` in the shared ⊕ shipped table of the proposal's key, spec `*` allowed) and `ignored: boolean`.
  - `GET /api/admin/instance` → `{ ok, version, uptimeS, dbPath, dbBytes, lastBackupAt: number | null, env: EnvRow[] }`, `EnvRow = { key: string; value: string; secret: boolean }`.

- [ ] **Step 1: Failing tests**

`test/hosted/instance.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeConfig, lastBackupAt } from "../../src/hosted/instance.ts";
import { TEST_HOSTED_CONFIG } from "./helpers.ts";

describe("describeConfig", () => {
  test("masks secrets, shows the session secret's byte length and a WCL id abbreviation", () => {
    const rows = describeConfig(TEST_HOSTED_CONFIG, { clientId: "a3f1b2c3d4e59c2e", hasSecret: true });
    expect(rows).toEqual([
      { key: "BMPL_BASE_URL", value: "http://localhost", secret: false },
      { key: "BMPL_DISCORD_CLIENT_ID", value: "123456789012345678", secret: false },
      { key: "BMPL_DISCORD_CLIENT_SECRET", value: "•••• (set)", secret: true },
      { key: "BMPL_SESSION_SECRET", value: "•••• (32 bytes)", secret: true },
      { key: "BMPL_ADMIN_DISCORD_IDS", value: "111111111111111111, 444444444444444444", secret: false },
      { key: "BMPL_POINTS_PER_USER_HOUR", value: "300", secret: false },
      { key: "WCL_CLIENT_ID", value: "a3f1…9c2e", secret: false },
      { key: "WCL_CLIENT_SECRET", value: "•••• (set)", secret: true },
    ]);
  });
  test("missing WCL credentials read as not set; a short WCL id is shown whole", () => {
    const rows = describeConfig(TEST_HOSTED_CONFIG, { clientId: null, hasSecret: false });
    expect(rows.find((r) => r.key === "WCL_CLIENT_ID")!.value).toBe("(not set)");
    expect(rows.find((r) => r.key === "WCL_CLIENT_SECRET")!.value).toBe("(not set)");
    expect(describeConfig(TEST_HOSTED_CONFIG, { clientId: "abcdefgh", hasSecret: true }).find((r) => r.key === "WCL_CLIENT_ID")!.value).toBe("abcdefgh");
  });
});

describe("lastBackupAt", () => {
  test("mtime of last-backup next to the env file; null when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "bmpl-instance-"));
    try {
      expect(lastBackupAt(dir)).toBeNull();
      writeFileSync(join(dir, "last-backup"), "");
      utimesSync(join(dir, "last-backup"), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
      expect(lastBackupAt(dir)).toBe(1_700_000_000_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

Append to `test/server-admin.test.ts` (the file's `admin`, `member`, `db`, `u`, `json` are in scope; add `import { SHIPPED } from "../src/deepdive/table.ts";` and `import { propose } from "../src/hosted/defensives.ts";` at the top):

```ts
describe("users: points, sessions, revoke", () => {
  test("rows carry this hour's and 24 h points, the live session count and the config-admin flag", async () => {
    const now = Date.now();
    db.usage.add(member.user.id, now - 5 * 3600_000, 40);
    db.usage.add(member.user.id, now, 7.5);
    const r = await (await fetch(u("/api/admin/users"), { headers: { cookie: admin.cookie } })).json();
    const tom = r.users.find((x: { username: string }) => x.username === "tom");
    const thisHour = db.usage.byUser(now).find((x) => x.userId === member.user.id)?.points ?? 0; // the usage test above added 12.5 too
    expect(tom.pointsHour).toBe(thisHour);
    expect(tom.points24h).toBe(thisHour + 40);
    expect(tom.sessions).toBe(1);
    expect(tom.configAdmin).toBe(false);
    expect(r.users.find((x: { username: string }) => x.username === "boss").configAdmin).toBe(true);
  });
  test("revoke ends the user's sessions; self and unknown ids are refused", async () => {
    const r = await fetch(u(`/api/admin/users/${member.user.id}/sessions/revoke`), json("POST", undefined, admin.cookie));
    expect(await r.json()).toEqual({ ok: true, sessionsEnded: 1 });
    expect((await fetch(u("/api/me"), { headers: { cookie: member.cookie } })).status).toBe(401);
    expect((await fetch(u(`/api/admin/users/${admin.user.id}/sessions/revoke`), json("POST", undefined, admin.cookie))).status).toBe(400);
    expect((await fetch(u("/api/admin/users/9999/sessions/revoke"), json("POST", undefined, admin.cookie))).status).toBe(404);
    member = loginAs(db, TEST_HOSTED_CONFIG.sessionSecret, { discordId: "123456789012345678", role: "member", username: "tom" });
  });
});

describe("invites carry the user who signed in", () => {
  test("user is null until the id signs in", async () => {
    await fetch(u("/api/admin/invites"), json("POST", { discordId: "123456789012345678", note: "tom" }, admin.cookie));
    await fetch(u("/api/admin/invites"), json("POST", { discordId: "777777777777777777" }, admin.cookie));
    const list = (await (await fetch(u("/api/admin/invites"), { headers: { cookie: admin.cookie } })).json()).invites;
    expect(list.find((i: { discordId: string }) => i.discordId === "123456789012345678").user).toEqual({ id: member.user.id, username: "tom" });
    expect(list.find((i: { discordId: string }) => i.discordId === "777777777777777777").user).toBeNull();
  });
});

describe("proposals carry the current entry", () => {
  test("current is the shared/shipped entry for the spell, null for an unknown id; ignored reflects the shared layer", async () => {
    const now = Date.now();
    propose(db.defensives, { id: member.user.id, role: "member" }, "Paladin", "Holy", { id: 498, cooldownS: 45 }, now);
    propose(db.defensives, { id: member.user.id, role: "member" }, "Paladin", "Holy", { id: 424242, name: "Made up", kind: "minor", cooldownS: 30, durationS: 5 }, now);
    const r = await (await fetch(u("/api/admin/proposals"), { headers: { cookie: admin.cookie } })).json();
    const shipped = SHIPPED.specs["Paladin:*"]!.find((e) => e.id === 498)!;
    const p498 = r.proposals.find((p: { spellId: number }) => p.spellId === 498);
    expect(p498.current).toEqual(shipped);
    expect(p498.ignored).toBe(false);
    const pNew = r.proposals.find((p: { spellId: number }) => p.spellId === 424242);
    expect(pNew.current).toBeNull();
    expect(pNew.key).toBe("Paladin:Holy");
  });
});

describe("GET /api/admin/instance", () => {
  test("version, uptime, db size, no backup file, masked env", async () => {
    expect((await fetch(u("/api/admin/instance"), { headers: { cookie: member.cookie } })).status).toBe(403);
    const r = await (await fetch(u("/api/admin/instance"), { headers: { cookie: admin.cookie } })).json();
    expect(r.ok).toBe(true);
    expect(typeof r.version).toBe("string");
    expect(r.uptimeS).toBeGreaterThanOrEqual(0);
    expect(r.dbPath.endsWith("bmpl.db")).toBe(true);
    expect(r.dbBytes).toBeGreaterThan(0);
    expect(r.lastBackupAt).toBeNull();
    expect(r.env.map((e: { key: string }) => e.key)).toEqual(["BMPL_BASE_URL", "BMPL_DISCORD_CLIENT_ID", "BMPL_DISCORD_CLIENT_SECRET", "BMPL_SESSION_SECRET", "BMPL_ADMIN_DISCORD_IDS", "BMPL_POINTS_PER_USER_HOUR", "WCL_CLIENT_ID", "WCL_CLIENT_SECRET"]);
    expect(JSON.stringify(r)).not.toContain(TEST_HOSTED_CONFIG.sessionSecret);
    expect(JSON.stringify(r)).not.toContain(TEST_HOSTED_CONFIG.discordClientSecret);
  });
});
```

(`SHIPPED.specs` is the `Record<key, DefensiveSpell[]>` of `src/deepdive/defensives.json`; 498 "Divine Protection" and 642 "Divine Shield" live under `Paladin:*`.) The revoke test re-logs `member` in because later tests use its cookie — keep it last in its describe and declare `let member` (already `let`).

- [ ] **Step 2: Run, expect failures**

Run: `bun test test/hosted/instance.test.ts test/server-admin.test.ts` → FAIL (`instance.ts` missing, new fields undefined, 404 on the new routes).

- [ ] **Step 3: Implement**

`src/hosted/db.ts`: in the `HostedDb` interface add `sessions.countForUser(userId: number, now: number): number;` and `usage.byUserSince(sinceAt: number): Array<{ userId: number; points: number }>;` (doc: "Every user's points from the bucket of `sinceAt` on, largest first."). Queries:

```ts
  const sessionCount = db.query<{ n: number }, [number, number]>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?");
  const usageByUserSince = db.query<{ user_id: number; points: number }, [number]>("SELECT user_id, SUM(points) AS points FROM usage_hourly WHERE hour_start >= ? GROUP BY user_id ORDER BY points DESC, user_id");
```

Implementations: `countForUser: (userId, now) => sessionCount.get(userId, now)!.n,` and `byUserSince: (sinceAt) => usageByUserSince.all(hourStart(sinceAt)).map((r) => ({ userId: r.user_id, points: r.points })),`.

`src/hosted/instance.ts`:

```ts
// Instance panel of the admin page: the effective configuration with secrets masked, and the deploy's backup marker.
import { statSync } from "node:fs";
import { join } from "node:path";
import type { HostedConfig } from "./config.ts";

export interface EnvRow { key: string; value: string; secret: boolean }

const SET = "•••• (set)";
const NOT_SET = "(not set)";
const abbreviate = (id: string): string => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

/** The env the instance runs with, in `.env.hosted.example` order; secrets never leave the server. */
export function describeConfig(config: HostedConfig, wcl: { clientId: string | null; hasSecret: boolean }): EnvRow[] {
  return [
    { key: "BMPL_BASE_URL", value: config.baseUrl, secret: false },
    { key: "BMPL_DISCORD_CLIENT_ID", value: config.discordClientId, secret: false },
    { key: "BMPL_DISCORD_CLIENT_SECRET", value: config.discordClientSecret ? SET : NOT_SET, secret: true },
    { key: "BMPL_SESSION_SECRET", value: `•••• (${Buffer.byteLength(config.sessionSecret)} bytes)`, secret: true },
    { key: "BMPL_ADMIN_DISCORD_IDS", value: config.adminDiscordIds.join(", "), secret: false },
    { key: "BMPL_POINTS_PER_USER_HOUR", value: String(config.pointsPerUserHour), secret: false },
    { key: "WCL_CLIENT_ID", value: wcl.clientId ? abbreviate(wcl.clientId) : NOT_SET, secret: false },
    { key: "WCL_CLIENT_SECRET", value: wcl.hasSecret ? SET : NOT_SET, secret: true },
  ];
}

/** mtime of `<dir>/last-backup` (written by the deploy's litestream check, issue #10); null when absent. */
export function lastBackupAt(dir: string): number | null {
  try { return Math.round(statSync(join(dir, "last-backup")).mtimeMs); } catch { return null; }
}
```

`src/server/routes-admin.ts`:
- Imports: `import { statSync } from "node:fs"; import { dirname } from "node:path"; import pkg from "../../package.json"; import { SHIPPED, specDefensives } from "../deepdive/table.ts"; import { tablesFor } from "../hosted/defensives.ts"; import { describeConfig, lastBackupAt } from "../hosted/instance.ts"; import { resolveEnvPath } from "../setup.ts"; import { getStore } from "../signals/store.ts";` (keep the existing ones).
- `adminUser` becomes `adminUser(u: UserRow, extra: { pointsHour: number; points24h: number; sessions: number; configAdmin: boolean })` spreading `extra`. `GET /api/admin/users`:

```ts
    route("GET", "/api/admin/users", (_req, _url, ctx) => {
      const at = ctx.now;
      const hour = new Map(rt.db.usage.byUser(at).map((r) => [r.userId, r.points]));
      const day = new Map(rt.db.usage.byUserSince(at - 24 * HOUR_MS).map((r) => [r.userId, r.points]));
      const users = rt.db.users.list().map((u) => adminUser(u, {
        pointsHour: hour.get(u.id) ?? 0, points24h: day.get(u.id) ?? 0,
        sessions: rt.db.sessions.countForUser(u.id, at), configAdmin: rt.config.adminDiscordIds.includes(u.discordId),
      }));
      return jsonResponse({ ok: true, users });
    }, "admin"),
```

  The existing role route's `adminUser(rt.db.users.byId(id)!)` call passes the same `extra` computed for that one user (a small `userExtra(u, at)` helper avoids repeating it).
- The users prefix route now matches two shapes: `/^(\d+)\/role$/` (unchanged) and `/^(\d+)\/sessions\/revoke$/`:

```ts
      const revoke = /^(\d+)\/sessions\/revoke$/.exec(tail(url, "/api/admin/users/"));
      if (revoke) {
        const id = Number.parseInt(revoke[1]!, 10);
        if (id === ctx.user!.id) return jsonResponse({ ok: false, error: "Sign out instead" }, 400);
        if (!rt.db.users.byId(id)) return jsonResponse({ ok: false, error: "Unknown user" }, 404);
        return jsonResponse({ ok: true, sessionsEnded: rt.db.sessions.deleteForUser(id) });
      }
```

  placed before the role regex inside the same `prefixRoute("POST", "/api/admin/users/", …)` handler.
- `GET /api/admin/invites`: `invites: rt.db.invites.list().map((i) => { const u = rt.db.users.byDiscordId(i.discordId); return { ...i, user: u ? { id: u.id, username: u.username } : null }; })`.
- `GET /api/admin/proposals`: after mapping, enrich each row:

```ts
      const shared = tablesFor(rt.db.defensives, null).override;
      const proposals = rt.db.defensives.listProposals(status).map((p) => {
        const [className, spec] = p.key.split(":") as [string, string];
        const d = specDefensives(SHIPPED, shared, className, spec);
        const e = d.entries.find((x) => x.id === p.spellId);
        const current = e ? { id: e.id, name: e.name, cooldownS: e.cooldownS, durationS: e.durationS, kind: e.kind } : null;
        return { ...proposalSummary(p), key: p.key, proposedBy: p.proposedBy, username: p.username, current, ignored: d.ignored.includes(p.spellId) };
      });
```

- `GET /api/admin/instance`:

```ts
    route("GET", "/api/admin/instance", async () => {
      const dbPath = (await getStore())._db.filename;
      let dbBytes = 0;
      try { dbBytes = statSync(dbPath).size; } catch { /* :memory: or unreadable */ }
      const env = describeConfig(rt.config, { clientId: process.env.WCL_CLIENT_ID ?? null, hasSecret: !!process.env.WCL_CLIENT_SECRET });
      return jsonResponse({ ok: true, version: pkg.version as string, uptimeS: Math.round(process.uptime()), dbPath, dbBytes, lastBackupAt: lastBackupAt(dirname(await resolveEnvPath())), env });
    }, "admin"),
```

  (`process.env.WCL_CLIENT_ID` is the value the WCL client itself reads — only its abbreviation leaves the server.)

- [ ] **Step 4: Verify and commit**

Run: `bun test test/hosted test/server-admin.test.ts` → PASS; `just check && bun test` → green.

```bash
git add src/hosted/db.ts src/hosted/instance.ts src/server/routes-admin.ts test/hosted/instance.test.ts test/server-admin.test.ts
git commit -m "feat(server): admin page data — user points/sessions, session revocation, invite→user link, proposal current entry, instance info"
```

---

### Task 2: Front view models and API

**Files:**
- Create: `web/src/lib/admin.ts`, `web/src/lib/admin.test.ts`
- Modify: `web/src/types.ts`, `web/src/api.ts`, `web/src/lib/hostedMode.ts`, `web/src/lib/hostedMode.test.ts`

**Interfaces:**
- Consumes: Task 1 shapes; `fmtAge`, `fmtDuration` (`format.ts`); `patchText`, `OriginDot` (`deepdive.ts`); `initialsOf` (`session.ts`); `ProposalSummary`, `DefensiveSpell`, `OverrideEntry` types.
- Produces (all pure):
  - types in `web/src/types.ts`: `AdminUser`, `AdminInvite`, `AdminProposal` (= `ProposalSummary & { key: string; proposedBy: number; username: string | null; current: DefensiveSpell | null; ignored: boolean }`), `AdminUsage` (= the `/api/admin/usage` body: `{ hourStart, resetInS, limitPerUser, instance: RateLimitSnapshot | null, users: { userId, discordId, username, role, points }[], hours: { hourStart, points }[] }`), `AdminInstance`, `EnvRow`. `RateLimitSnapshot` is `import type` from `@shared/wcl/meter.ts` (re-exported through `types.ts`), `DefensiveSpell` from `@shared/deepdive/types.ts`.
  - `api.admin = { users(), revokeSessions(id), setRole(id, role), invites(), addInvite(discordId, note), removeInvite(discordId), proposals(status), approve(id, note), reject(id, note), usage(), instance() }`.
  - `adminAccess(status, me): "ok" | "member" | "local"`.
  - `web/src/lib/admin.ts`: `gaugeModel(u: AdminUsage | null): GaugeModel`, `topConsumers(u, users: AdminUser[]): ConsumerRow[]`, `hourBars(u, now): HourBar[]`, `diffRows(p: AdminProposal): DiffRow[]`, `proposalCard(p, now): ProposalCardModel`, `decidedLine(p, now): DecidedLine`, `userRow(u, now, selfId): UserRowModel`, `inviteRow(i, now): InviteRowModel`, `instanceModel(i, now): InstanceModel`, `fmtPts(n)`, `fmtBytes(n)`, `fmtUptime(s)`.

- [ ] **Step 1: Failing tests** — `web/src/lib/admin.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser } from "../types.ts";
import { decidedLine, diffRows, fmtBytes, fmtPts, fmtUptime, gaugeModel, hourBars, instanceModel, inviteRow, proposalCard, topConsumers, userRow } from "./admin.ts";

const NOW = 1_800_000_000_000;
const H = 3600_000;
const usage: AdminUsage = {
  hourStart: NOW - (NOW % H), resetInS: 2280, limitPerUser: 300,
  instance: { limitPerHour: 3600, pointsSpentThisHour: 1412, pointsResetIn: 2280, observedAt: NOW - 120_000, windowEnd: NOW + 2280_000 },
  users: [{ userId: 2, discordId: "22", username: "tom", role: "member", points: 252 }, { userId: 1, discordId: "11", username: "muleyoxo", role: "admin", points: 181 }],
  hours: [{ hourStart: NOW - (NOW % H) - 2 * H, points: 3170 }, { hourStart: NOW - (NOW % H), points: 1412 }],
};
const users: AdminUser[] = [
  { id: 1, discordId: "11", username: "muleyoxo", globalName: "Muleyoxo", avatarUrl: "a", role: "admin", createdAt: 0, lastSeenAt: NOW - 10_000, pointsHour: 181, points24h: 2340, sessions: 2, configAdmin: true },
  { id: 2, discordId: "22", username: "tom", globalName: null, avatarUrl: "b", role: "member", createdAt: 0, lastSeenAt: NOW - 2 * H, pointsHour: 252, points24h: 1118, sessions: 1, configAdmin: false },
];

describe("gauge", () => {
  test("instance points vs limit, reset, floor note, snapshot age", () => {
    const g = gaugeModel(usage, NOW);
    expect(g).toEqual({ used: "1 412", limit: "3 600", pct: 39, tone: "", sub: "resets in 38 min · floor 100 pts · last rateLimitData 2 min ago" });
  });
  test("tones: yellow above 75 %, red above 90 %; no snapshot yet", () => {
    expect(gaugeModel({ ...usage, instance: { ...usage.instance!, pointsSpentThisHour: 2800 } }, NOW).tone).toBe("tone-warn");
    expect(gaugeModel({ ...usage, instance: { ...usage.instance!, pointsSpentThisHour: 3400 } }, NOW).tone).toBe("tone-bad");
    expect(gaugeModel({ ...usage, instance: null }, NOW)).toEqual({ used: "—", limit: "3 600", pct: 0, tone: "", sub: "no WCL call observed since the server started" });
    expect(gaugeModel(null, NOW).used).toBe("—");
  });
  test("top consumers: largest first, bar vs the member limit, admins unlimited", () => {
    expect(topConsumers(usage, users)).toEqual([
      { userId: 2, name: "tom", initials: "T", avatarUrl: "b", isAdmin: false, pct: 84, text: "252 / 300", tone: "tone-warn" },
      { userId: 1, name: "Muleyoxo", initials: "M", avatarUrl: "a", isAdmin: true, pct: 60, text: "181 · no limit", tone: "" },
    ]);
  });
  test("hour bars: 24 slots ending now, missing hours at 0, heights relative to the peak, current hour marked", () => {
    const bars = hourBars(usage, NOW);
    expect(bars).toHaveLength(24);
    expect(bars[23]).toEqual({ hourStart: NOW - (NOW % H), points: 1412, pct: 45, current: true });
    expect(bars[21]).toEqual({ hourStart: NOW - (NOW % H) - 2 * H, points: 3170, pct: 100, current: false });
    expect(bars[0]!.points).toBe(0);
    expect(hourBars({ ...usage, hours: [] }, NOW).every((b) => b.pct === 0)).toBe(true);
  });
});

const proposal = (over: Partial<AdminProposal> = {}): AdminProposal => ({
  id: 7, spellId: 642, status: "pending", patch: { id: 642, cooldownS: 240 }, note: null, createdAt: NOW - 2 * H, decidedAt: null,
  key: "Paladin:Holy", proposedBy: 2, username: "bob", current: { id: 642, name: "Divine Shield", cooldownS: 300, durationS: 8, kind: "immunity" }, ignored: false, ...over,
});

describe("proposal cards", () => {
  test("diff rows: changed fields only, current → proposed", () => {
    expect(diffRows(proposal())).toEqual([{ field: "cooldown", from: "300 s", to: "240 s" }]);
    expect(diffRows(proposal({ patch: { id: 1044, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 }, current: null, spellId: 1044 }))).toEqual([
      { field: "kind", from: "— (not in table)", to: "minor" }, { field: "cooldown", from: "—", to: "25 s" }, { field: "duration", from: "—", to: "6 s" },
    ]);
    expect(diffRows(proposal({ patch: { id: 642, ignore: true } }))).toEqual([{ field: "ignore", from: "listed (immunity, cd 300 s)", to: "ignored for this spec" }]);
    expect(diffRows(proposal({ patch: { id: 642, ignore: true }, current: null, ignored: true }))).toEqual([{ field: "ignore", from: "already ignored", to: "ignored for this spec" }]);
    expect(diffRows(proposal({ patch: { id: 642, cooldownS: 300 } }))).toEqual([{ field: "cooldown", from: "300 s", to: "300 s (no change)" }]);
  });
  test("card: name from current or patch, key, author, age", () => {
    const c = proposalCard(proposal(), NOW);
    expect(c).toEqual({ id: 7, spellId: 642, name: "Divine Shield", key: "Paladin:Holy", author: "bob", when: "2h ago", rows: [{ field: "cooldown", from: "300 s", to: "240 s" }] });
    expect(proposalCard(proposal({ current: null, patch: { id: 9, name: "New", kind: "minor", cooldownS: 1, durationS: 1 }, username: null }), NOW).name).toBe("New");
    expect(proposalCard(proposal({ current: null, patch: { id: 9, cooldownS: 1 }, username: null }), NOW)).toMatchObject({ name: "spell 9", author: "unknown user" });
  });
  test("decided line: dot by status, what, who, when, note", () => {
    const l = decidedLine(proposal({ status: "approved", decidedAt: NOW - 5 * 24 * H, note: "Fine as a minor.", patch: { id: 498, cooldownS: 60 }, spellId: 498, current: { id: 498, name: "Divine Protection", cooldownS: 60, durationS: 8, kind: "major" } }), NOW);
    expect(l).toEqual({ id: 7, dot: "dot-approved", what: "Divine Protection · Paladin:Holy · cd 60 s", author: "bob", status: "approved", when: "5d ago", note: "Fine as a minor." });
    expect(decidedLine(proposal({ status: "rejected", decidedAt: NOW - H }), NOW).dot).toBe("dot-rejected");
  });
});

describe("users, invites, instance", () => {
  test("user row: display name, handle, role chip, toggle label, last seen, points, revoke text, self/config guards", () => {
    expect(userRow(users[0]!, NOW, 1)).toEqual({
      id: 1, name: "Muleyoxo", handle: "@muleyoxo", initials: "M", avatarUrl: "a", role: "admin", roleNote: "env", toggle: null,
      lastSeen: "just now", pointsHour: "181", pointsHourTone: "", points24h: "2 340", discordId: "11", sessions: 2, canRevoke: false,
    });
    const tom = userRow(users[1]!, NOW, 1);
    expect(tom).toMatchObject({ role: "member", roleNote: null, toggle: "make admin", lastSeen: "2h ago", pointsHour: "252", pointsHourTone: "tone-warn", points24h: "1 118", canRevoke: true });
    expect(userRow({ ...users[1]!, role: "admin" }, NOW, 1).toggle).toBe("make member");
    expect(userRow({ ...users[1]!, pointsHour: 300 }, NOW, 1).pointsHourTone).toBe("tone-bad");
  });
  test("invite row: note or dash, added by admin id or CLI, status chip", () => {
    const base: AdminInvite = { discordId: "22", invitedBy: "admin:1", createdAt: NOW - 6 * 24 * H, note: "guild mate", user: { id: 2, username: "tom" } };
    expect(inviteRow(base, NOW)).toEqual({ discordId: "22", note: "guild mate", added: "6d ago · admin #1", status: "signed in as tom", signedIn: true });
    expect(inviteRow({ ...base, note: null, invitedBy: "cli", user: null }, NOW)).toEqual({ discordId: "22", note: "—", added: "6d ago · cli", status: "not signed in yet", signedIn: false });
  });
  test("instance: version, uptime, db, backup age or never, env rows as given", () => {
    const i: AdminInstance = { version: "0.1.0", uptimeS: 3 * 86400 + 4 * 3600 + 5, dbPath: "/opt/bmpl/bmpl.db", dbBytes: 43_200_000, lastBackupAt: NOW - 12 * 60_000, env: [{ key: "BMPL_BASE_URL", value: "https://x", secret: false }] };
    expect(instanceModel(i, NOW)).toEqual({ version: "0.1.0", uptime: "3 d 4 h", db: "bmpl.db · 41.2 MB", dbPath: "/opt/bmpl/bmpl.db", backup: "12 min ago", env: i.env });
    expect(instanceModel({ ...i, lastBackupAt: null, uptimeS: 90 }, NOW)).toMatchObject({ backup: "never (no last-backup file yet)", uptime: "1 min" });
  });
  test("formatters", () => {
    expect(fmtPts(1412.4)).toBe("1 412");
    expect(fmtPts(37)).toBe("37");
    expect(fmtBytes(43_200_000)).toBe("41.2 MB");
    expect(fmtBytes(800)).toBe("800 B");
    expect(fmtBytes(20_480)).toBe("20.0 KB");
    expect(fmtUptime(59)).toBe("less than a minute");
    expect(fmtUptime(3600 * 5 + 60 * 7)).toBe("5 h 7 min");
  });
});
```

Append to `web/src/lib/hostedMode.test.ts` (import `adminAccess`):

```ts
describe("adminAccess", () => {
  const user = { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const };
  test("local → local, hosted member → member, hosted admin → ok", () => {
    expect(adminAccess(local, null)).toBe("local");
    expect(adminAccess(hosted, user)).toBe("member");
    expect(adminAccess(hosted, null)).toBe("member");
    expect(adminAccess(hosted, { ...user, role: "admin" })).toBe("ok");
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test web/src/lib/admin.test.ts web/src/lib/hostedMode.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`web/src/types.ts` — add:

```ts
import type { DefensiveSpell } from "@shared/deepdive/types.ts";   // extend the existing type import from that module
export type { RateLimitSnapshot } from "@shared/wcl/meter.ts";
export type { DefensiveSpell } from "@shared/deepdive/types.ts";
export type { EnvRow } from "@shared/hosted/instance.ts";

/** GET /api/admin/users row. */
export interface AdminUser {
  id: number; discordId: string; username: string; globalName: string | null; avatarUrl: string; role: "member" | "admin";
  createdAt: number; lastSeenAt: number; pointsHour: number; points24h: number; sessions: number; configAdmin: boolean;
}
/** GET /api/admin/invites row. */
export interface AdminInvite { discordId: string; invitedBy: string; createdAt: number; note: string | null; user: { id: number; username: string } | null }
/** GET /api/admin/proposals row: the member's proposal plus the entry it would change. */
export interface AdminProposal extends ProposalSummary { key: string; proposedBy: number; username: string | null; current: DefensiveSpell | null; ignored: boolean }
/** GET /api/admin/usage body. */
export interface AdminUsage {
  hourStart: number; resetInS: number; limitPerUser: number; instance: RateLimitSnapshot | null;
  users: Array<{ userId: number; discordId: string | null; username: string | null; role: "member" | "admin" | null; points: number }>;
  hours: Array<{ hourStart: number; points: number }>;
}
/** GET /api/admin/instance body. */
export interface AdminInstance { version: string; uptimeS: number; dbPath: string; dbBytes: number; lastBackupAt: number | null; env: EnvRow[] }
```

(`ProposalSummary` and `RateLimitSnapshot`/`EnvRow` are imported as types at the top of `types.ts` for use in these interfaces — `import type { RateLimitSnapshot } from "@shared/wcl/meter.ts"; import type { EnvRow } from "@shared/hosted/instance.ts";` — `@shared/wcl/meter.ts` imports `node:async_hooks`; a **type-only** import is erased by `verbatimModuleSyntax`, so the Vite build stays clean; verify with `cd web && bunx vite build && rm -rf dist`.)

`web/src/api.ts` — replace `adminProposals` with an `admin` namespace (keep `adminProposals` as `admin.proposals("pending")` alias? No: update the one caller in `App.tsx` `onMenuOpen` to `api.admin.proposals("pending")` in Task 3; until then keep `adminProposals` too and delete it in Task 3):

```ts
  admin: {
    users: () => call<{ users: AdminUser[] }>("/api/admin/users"),
    setRole: (id: number, role: "member" | "admin") => call<{ user: AdminUser }>(`/api/admin/users/${id}/role`, post({ role })),
    revokeSessions: (id: number) => call<{ sessionsEnded: number }>(`/api/admin/users/${id}/sessions/revoke`, post()),
    invites: () => call<{ invites: AdminInvite[] }>("/api/admin/invites"),
    addInvite: (discordId: string, note: string | null) => call<{ invite: AdminInvite }>("/api/admin/invites", post({ discordId, note })),
    removeInvite: (discordId: string) => call<{ sessionsEnded: number }>(`/api/admin/invites/${encodeURIComponent(discordId)}`, { method: "DELETE" }),
    proposals: (status: "pending" | "approved" | "rejected") => call<{ proposals: AdminProposal[] }>(`/api/admin/proposals?status=${status}`),
    decide: (id: number, decision: "approve" | "reject", note: string | null) => call<{ proposal: AdminProposal }>(`/api/admin/proposals/${id}/${decision}`, post({ note })),
    usage: () => call<AdminUsage>("/api/admin/usage"),
    instance: () => call<AdminInstance>("/api/admin/instance"),
  },
```

(`addInvite`'s response `invite` has no `user` field server-side — the front re-lists after adding, so type it `Omit<AdminInvite, "user">`.)

`web/src/lib/hostedMode.ts`:

```ts
/** Who may see /admin: hosted admins; members get the "Admins only" screen; local mode has no admin at all. */
export type AdminAccess = "ok" | "member" | "local";
export function adminAccess(status: StatusInfo, me: MeUser | null): AdminAccess {
  if (!status.hosted) return "local";
  return me?.role === "admin" ? "ok" : "member";
}
```

`web/src/lib/admin.ts` (pure):

```ts
// Admin page view models (issue #8): budget gauge, proposal queue, users, invites, instance. Pure; tested.
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser, OverrideEntry } from "../types.ts";
import { fmtAge } from "./format.ts";
import { initialsOf } from "./session.ts";

const H = 3600_000;
const minutes = (s: number): number => Math.max(1, Math.ceil(s / 60));

/** Thousands separated by a thin space, no decimals: "1 412". */
export const fmtPts = (n: number): string => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const fmtBytes = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);
export function fmtUptime(s: number): string {
  if (s < 60) return "less than a minute";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
const pointsTone = (used: number, limit: number): "" | "tone-warn" | "tone-bad" => (used >= limit * 0.9 ? "tone-bad" : used >= limit * 0.75 ? "tone-warn" : "");

export interface GaugeModel { used: string; limit: string; pct: number; tone: "" | "tone-warn" | "tone-bad"; sub: string }
export function gaugeModel(u: AdminUsage | null, now = Date.now()): GaugeModel {
  const limit = u?.instance?.limitPerHour ?? 3600;
  if (!u || !u.instance) return { used: "—", limit: fmtPts(limit), pct: 0, tone: "", sub: "no WCL call observed since the server started" };
  const used = u.instance.pointsSpentThisHour;
  return {
    used: fmtPts(used), limit: fmtPts(limit), pct: Math.min(100, Math.round((used / limit) * 100)), tone: pointsTone(used, limit),
    sub: `resets in ${minutes(u.resetInS)} min · floor 100 pts · last rateLimitData ${fmtAge(u.instance.observedAt, now).replace("just now", "just now")}`,
  };
}
```

`fmtAge` says "just now" under an hour — the gauge test expects "2 min ago": add a local `fmtShortAge(ms, now)` in `admin.ts`: `< 60 s → "just now"`, `< 1 h → "N min ago"`, else `fmtAge`. Use it for the gauge sub and the instance backup (`"12 min ago"`); `fmtAge` elsewhere (cards, users, invites — the tests expect "2h ago", "5d ago", "6d ago").

```ts
export interface ConsumerRow { userId: number; name: string; initials: string; avatarUrl: string; isAdmin: boolean; pct: number; text: string; tone: "" | "tone-warn" | "tone-bad" }
/** This hour's spenders, largest first; the bar is the member limit (admins: relative to it, "no limit"). */
export function topConsumers(u: AdminUsage | null, users: AdminUser[]): ConsumerRow[] {
  if (!u) return [];
  return u.users.map((r) => {
    const user = users.find((x) => x.id === r.userId);
    const isAdmin = (user?.role ?? r.role) === "admin";
    const name = user?.globalName ?? user?.username ?? r.username ?? `user #${r.userId}`;
    return {
      userId: r.userId, name, initials: initialsOf(name), avatarUrl: user?.avatarUrl ?? "", isAdmin,
      pct: Math.min(100, Math.round((r.points / u.limitPerUser) * 100)),
      text: isAdmin ? `${fmtPts(r.points)} · no limit` : `${fmtPts(r.points)} / ${fmtPts(u.limitPerUser)}`,
      tone: isAdmin ? "" : pointsTone(r.points, u.limitPerUser),
    };
  });
}

export interface HourBar { hourStart: number; points: number; pct: number; current: boolean }
/** 24 hourly slots ending with the current hour; heights relative to the busiest slot. */
export function hourBars(u: AdminUsage | null, now = Date.now()): HourBar[] {
  const end = Math.floor(now / H) * H;
  const byHour = new Map((u?.hours ?? []).map((h) => [h.hourStart, h.points]));
  const slots = Array.from({ length: 24 }, (_, i) => end - (23 - i) * H);
  const peak = Math.max(0, ...slots.map((h) => byHour.get(h) ?? 0));
  return slots.map((h) => { const points = byHour.get(h) ?? 0; return { hourStart: h, points, pct: peak > 0 ? Math.round((points / peak) * 100) : 0, current: h === end }; });
}

export interface DiffRow { field: string; from: string; to: string }
const secs = (n: number | undefined): string => (n === undefined ? "—" : `${n} s`);
/** What a proposal changes, field by field, current → proposed (the canvas "diff" column). */
export function diffRows(p: AdminProposal): DiffRow[] {
  const patch: OverrideEntry = p.patch;
  const cur = p.current;
  if (patch.ignore) {
    const from = cur ? `listed (${cur.kind}, cd ${cur.cooldownS} s)` : p.ignored ? "already ignored" : "— (not in table)";
    return [{ field: "ignore", from, to: "ignored for this spec" }];
  }
  const rows: DiffRow[] = [];
  const same = (to: string) => `${to} (no change)`;
  if (patch.kind !== undefined) rows.push({ field: "kind", from: cur ? cur.kind : "— (not in table)", to: cur?.kind === patch.kind ? same(patch.kind) : patch.kind });
  if (patch.cooldownS !== undefined) rows.push({ field: "cooldown", from: secs(cur?.cooldownS), to: cur?.cooldownS === patch.cooldownS ? same(secs(patch.cooldownS)) : secs(patch.cooldownS) });
  if (patch.durationS !== undefined) rows.push({ field: "duration", from: secs(cur?.durationS), to: cur?.durationS === patch.durationS ? same(secs(patch.durationS)) : secs(patch.durationS) });
  return rows;
}

export interface ProposalCardModel { id: number; spellId: number; name: string; key: string; author: string; when: string; rows: DiffRow[] }
export function proposalCard(p: AdminProposal, now = Date.now()): ProposalCardModel {
  return { id: p.id, spellId: p.spellId, name: p.current?.name ?? p.patch.name ?? `spell ${p.spellId}`, key: p.key, author: p.username ?? "unknown user", when: fmtAge(p.createdAt, now), rows: diffRows(p) };
}

export interface DecidedLine { id: number; dot: "dot-approved" | "dot-rejected"; what: string; author: string; status: "approved" | "rejected"; when: string; note: string | null }
export function decidedLine(p: AdminProposal, now = Date.now()): DecidedLine {
  const status = p.status === "approved" ? "approved" : "rejected";
  const name = p.current?.name ?? p.patch.name ?? `spell ${p.spellId}`;
  return { id: p.id, dot: status === "approved" ? "dot-approved" : "dot-rejected", what: `${name} · ${p.key} · ${patchText(p.patch)}`, author: p.username ?? "unknown user", status, when: fmtAge(p.decidedAt ?? p.createdAt, now), note: p.note };
}
```

(`patchText` from `./deepdive.ts` — for `{ id, cooldownS: 60 }` it gives "cd 60 s", matching the test.)

```ts
export interface UserRowModel {
  id: number; name: string; handle: string; initials: string; avatarUrl: string; role: "member" | "admin"; roleNote: "env" | null; toggle: "make admin" | "make member" | null;
  lastSeen: string; pointsHour: string; pointsHourTone: "" | "tone-warn" | "tone-bad"; points24h: string; discordId: string; sessions: number; canRevoke: boolean;
}
/** `selfId` is the signed-in admin: no toggle, no revoke on yourself; env admins have no toggle either. */
export function userRow(u: AdminUser, now = Date.now(), selfId: number, limitPerUser = 300): UserRowModel {
  const name = u.globalName ?? u.username;
  const self = u.id === selfId;
  return {
    id: u.id, name, handle: `@${u.username}`, initials: initialsOf(name), avatarUrl: u.avatarUrl, role: u.role, roleNote: u.configAdmin ? "env" : null,
    toggle: self || u.configAdmin ? null : u.role === "admin" ? "make member" : "make admin",
    lastSeen: fmtAge(u.lastSeenAt, now), pointsHour: fmtPts(u.pointsHour), pointsHourTone: u.role === "admin" ? "" : pointsTone(u.pointsHour, limitPerUser),
    points24h: fmtPts(u.points24h), discordId: u.discordId, sessions: u.sessions, canRevoke: !self,
  };
}
```

(`fmtAge(NOW - 10_000, NOW)` → "just now" ✓; the test calls `userRow(users[0], NOW, 1)` with the default limit 300: 181 < 225 → "" ✓, 252 ≥ 225 → warn ✓, 300 ≥ 270 → bad ✓.)

```ts
export interface InviteRowModel { discordId: string; note: string; added: string; status: string; signedIn: boolean }
export function inviteRow(i: AdminInvite, now = Date.now()): InviteRowModel {
  const by = i.invitedBy.startsWith("admin:") ? `admin #${i.invitedBy.slice(6)}` : i.invitedBy;
  return { discordId: i.discordId, note: i.note ?? "—", added: `${fmtAge(i.createdAt, now)} · ${by}`, status: i.user ? `signed in as ${i.user.username}` : "not signed in yet", signedIn: i.user !== null };
}

export interface InstanceModel { version: string; uptime: string; db: string; dbPath: string; backup: string; env: AdminInstance["env"] }
export function instanceModel(i: AdminInstance, now = Date.now()): InstanceModel {
  const file = i.dbPath.split(/[\\/]/).pop() ?? i.dbPath;
  return { version: i.version, uptime: fmtUptime(i.uptimeS), db: `${file} · ${fmtBytes(i.dbBytes)}`, dbPath: i.dbPath, backup: i.lastBackupAt === null ? "never (no last-backup file yet)" : fmtShortAge(i.lastBackupAt, now), env: i.env };
}
```

The "added" text in the invite test is `"6d ago · admin #1"`; the canvas showed the admin's name — resolving ids to names is a component concern (it has the users list): the component replaces `admin #N` with the user's name when known (`usersById`). Keep the model simple.

- [ ] **Step 4: Verify and commit**

Run: `bun test web/src/lib` → PASS; `just check` → clean; `cd web && bunx vite build && rm -rf dist` → builds (the type-only `@shared/wcl/meter.ts` import must not pull Node code into the bundle).

```bash
git add web/src/lib/admin.ts web/src/lib/admin.test.ts web/src/lib/hostedMode.ts web/src/lib/hostedMode.test.ts web/src/types.ts web/src/api.ts
git commit -m "feat(web): admin page view models, admin API namespace, adminAccess"
```

---

### Task 3: The page — components, CSS, routing

**Files:**
- Create: `web/src/components/admin/AdminPage.tsx`, `Gauge.tsx`, `Queue.tsx`, `Users.tsx`, `Invites.tsx`, `Instance.tsx`, `Forbidden.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles/app.css`, `web/src/api.ts` (drop `adminProposals`)

**Interfaces:**
- Consumes: Task 2 models and `api.admin`; `adminAccess`; `UserMenu`/`Header` unchanged (the Admin item is an `<a href="/admin">`, a full navigation).
- Produces: `AdminPage({ me: MeUser })`, `Forbidden({ reason: "member" | "local"; handle: string | null })`.

- [ ] **Step 1: CSS** (append to `web/src/styles/app.css`; every value is a token or lifted from the canvas' `admin-common.css`)

```css
/* --- hosted: admin page (components/admin/*) --- */
.admin-title { display: flex; align-items: baseline; gap: 12px; padding: 14px 24px 0; }
.admin-title h1 { font-size: 18px; font-weight: 700; margin: 0; }
.admin-nav { display: flex; gap: 14px; padding: 10px 24px; border-bottom: 1px solid var(--border-soft); font-size: 13px; }
.admin-nav a { color: var(--muted); } .admin-nav a:hover { color: var(--text); }
.admin-section { display: flex; flex-direction: column; gap: 6px; }
.admin-section-head { display: flex; align-items: center; gap: 10px; }
.admin-section-head .muted { font-size: 12px; }
.admin-row { display: grid; align-items: center; gap: 12px; padding: 8px 10px; font-size: 13px; }
.admin-row > * { white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.admin-row-head { padding: 2px 10px; }
.admin-row-user { grid-template-columns: 24px 180px 150px 100px 90px 90px 1fr auto; }
.admin-row-invite { grid-template-columns: 200px 1fr 190px 190px auto; }
.admin-row-decided { grid-template-columns: 1fr 140px 90px 160px 1fr; }
.admin-form { display: flex; gap: 8px; align-items: center; margin: 4px 0 6px; }
.admin-form input { height: 32px; }
.gauge { display: grid; grid-template-columns: 300px 1fr 1fr; gap: 24px; align-items: start; }
.gauge-big { font-size: 26px; font-weight: 800; font-family: var(--mono); }
.gauge-big .muted { font-size: 14px; font-weight: 400; font-family: inherit; }
.gauge-bar { display: block; height: 6px; background: var(--border-soft); border-radius: 3px; overflow: hidden; margin: 6px 0; }
.gauge-bar > span { display: block; height: 100%; background: var(--green); }
.gauge-bar.tone-warn > span { background: var(--yellow); } .gauge-bar.tone-bad > span { background: var(--red); }
.consumer { display: flex; gap: 10px; align-items: center; font-size: 13px; }
.consumer .consumer-name { width: 120px; }
.consumer .gauge-bar { width: 160px; margin: 0; }
.hours { display: flex; align-items: flex-end; gap: 3px; height: 64px; }
.hours span { width: 12px; background: var(--border); } .hours span.current { background: var(--green); }
.proposal { padding: 10px 12px; display: grid; grid-template-columns: 1fr 340px auto; gap: 16px; align-items: center; }
.diff { display: grid; grid-template-columns: 90px 1fr 1fr; gap: 2px 12px; font-size: 12px; align-items: baseline; }
.diff .diff-field { color: var(--faint); } .diff .diff-from { color: var(--muted); text-decoration: line-through; } .diff .diff-to { color: var(--yellow); }
.proposal-actions { display: inline-flex; gap: 6px; align-items: center; }
.proposal-actions input { width: 260px; height: 26px; font-size: 12px; }
.btn-danger { color: var(--red); border-color: var(--red-border); }
.chip-ok { color: var(--green); border-color: var(--green-border); background: var(--green-bg); }
.chip-admin { color: var(--link); }
.confirm { display: inline-flex; gap: 8px; align-items: center; padding: 6px 10px; font-size: 13px; }
.kv { display: grid; grid-template-columns: 200px 1fr; gap: 4px 16px; font-size: 13px; }
.kv .kv-key { color: var(--muted); }
.forbidden { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: calc(100vh - 65px); text-align: center; }
.forbidden h1 { font-size: 22px; font-weight: 700; margin: 0; }
```

- [ ] **Step 2: Components** (`web/src/components/admin/`)

`Forbidden.tsx`:

```tsx
interface Props { reason: "member" | "local"; handle: string | null }
/** /admin for a member (server answers 403 on every /api/admin/* anyway) or in local mode. */
export function Forbidden({ reason, handle }: Props) {
  return (
    <main className="forbidden">
      <h1>Admins only</h1>
      <p className="muted" style={{ margin: 0 }}>
        {reason === "local" ? "The admin page exists in hosted mode only." : <>This page is for the people who run this instance. Your account ({handle && <span className="mono">{handle}</span>}) is a member.</>}
      </p>
      <a className="btn" href="/" style={{ marginTop: 6 }}>← back to lookups</a>
    </main>
  );
}
```

`AdminPage.tsx` — owns the data and the refresh:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { MeUser } from "../../api.ts";
import type { AdminInstance, AdminInvite, AdminProposal, AdminUsage, AdminUser } from "../../types.ts";
import { Toast } from "../Toast.tsx";
import { Gauge } from "./Gauge.tsx";
import { Instance } from "./Instance.tsx";
import { Invites } from "./Invites.tsx";
import { Queue } from "./Queue.tsx";
import { Users } from "./Users.tsx";

export interface AdminData { usage: AdminUsage | null; users: AdminUser[]; invites: AdminInvite[]; pending: AdminProposal[]; decided: AdminProposal[]; instance: AdminInstance | null }
const EMPTY: AdminData = { usage: null, users: [], invites: [], pending: [], decided: [], instance: null };

/** Layout B of the canvas: every section stacked, anchor sub-nav. All data is 0 WCL pts (SQLite + the meter's last snapshot). */
export function AdminPage({ me }: { me: MeUser }) {
  const [data, setData] = useState<AdminData>(EMPTY);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const reload = useCallback(async () => {
    const [usage, users, invites, pending, approved, rejected, instance] = await Promise.all([
      api.admin.usage(), api.admin.users(), api.admin.invites(), api.admin.proposals("pending"), api.admin.proposals("approved"), api.admin.proposals("rejected"), api.admin.instance(),
    ]);
    const firstError = [usage, users, invites, pending, approved, rejected, instance].find((r) => !r.ok);
    if (firstError && !firstError.ok) setToast(firstError.error);
    const decided = [...(approved.ok ? approved.proposals : []), ...(rejected.ok ? rejected.proposals : [])]
      .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).slice(0, 50);
    setData({
      usage: usage.ok ? usage : null, users: users.ok ? users.users : [], invites: invites.ok ? invites.invites : [],
      pending: pending.ok ? pending.proposals : [], decided, instance: instance.ok ? instance : null,
    });
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  /** Runs an admin action, shows its error, reloads everything (the sections are small; one round trip keeps them consistent). */
  const act = useCallback(async (r: Promise<{ ok: boolean; error?: string }>) => {
    const res = await r;
    if (!res.ok) setToast(res.error ?? "Request failed");
    await reload();
  }, [reload]);
  return (
    <>
      <div className="admin-title"><a href="/" className="muted" style={{ fontSize: 13 }}>← back to lookups</a><h1>Admin</h1><span className="muted" style={{ fontSize: 12 }}>invites, users, proposals, budget, instance</span></div>
      <nav className="admin-nav">
        <a href="#budget">Budget</a><a href="#proposals">Proposals{data.pending.length > 0 && <span className="chip chip-warn" style={{ marginLeft: 4 }}>{data.pending.length}</span>}</a><a href="#users">Users</a><a href="#invites">Invites</a><a href="#instance">Instance</a>
      </nav>
      <main className="content content-home">
        <Gauge usage={data.usage} users={data.users} />
        <Queue pending={data.pending} decided={data.decided} usersById={new Map(data.users.map((u) => [u.id, u]))} onDecide={(id, d, note) => act(api.admin.decide(id, d, note))} />
        <Users users={data.users} selfId={me.id} limitPerUser={data.usage?.limitPerUser ?? 300} onRole={(id, role) => act(api.admin.setRole(id, role))} onRevoke={(id) => act(api.admin.revokeSessions(id))} />
        <Invites invites={data.invites} users={data.users} onAdd={(id, note) => act(api.admin.addInvite(id, note))} onRemove={(id) => act(api.admin.removeInvite(id))} />
        <Instance instance={data.instance} usage={data.usage} />
      </main>
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
```

`Gauge.tsx` (section `id="budget"`, class `card gauge`): left column `label-caps` "Shared WCL budget · this hour", `.gauge-big` `{g.used} <span class="muted">/ {g.limit} pts</span>`, `.gauge-bar {g.tone}` with `width: g.pct%`, `.muted` 12 px `g.sub`; middle "Top consumers · this hour" → `topConsumers(usage, users).map(...)` rows `.consumer` (avatar `<img className="avatar">` with initials fallback like `UserMenu`'s `Avatar` — move that `Avatar` into `web/src/components/Avatar.tsx` and import it from both places, props `{ src, initials, size }`), name (+ `chip chip-admin` "admin"), bar, mono text; right "Last 24 h · pts per hour" → `.hours` with 24 `<span title="HH:00 · N pts" style={{ height: pct% }} className={current ? "current" : ""}>`, faint line `peak {fmtPts(max)} pts at {HH}:00` (`null` peak → "no points spent in the last 24 h").

`Queue.tsx` (section `id="proposals"`): head "Proposal queue" + muted "members' defensives corrections · approve applies to everyone, reject drops it for the author (note is shown to them)" + `grow` + two chips `Pending · N` / `Decided · N` toggling a `view` state. Pending: one `.inset.proposal` per `proposalCard(p)` — left: `.dot.dot-pending` + `<SpellLink id name />` + faint `· {key} · id {spellId}`, muted line `by <span class="text-soft">{author}</span> · {when}`; middle: `.diff` rows (`diff-field`, `diff-from`, `diff-to`); right `.proposal-actions`: `<input placeholder="Note to the author (optional)" maxLength={500}>` (per-card state `notes: Record<id, string>`), `btn btn-sm btn-primary` "Approve", `btn btn-sm btn-danger` "Reject" → `onDecide(id, "approve"|"reject", note.trim() || null)`; both disabled while `busy` (the id being decided). Empty: faint "Nothing to review. Members' corrections land here.". Decided view: `.admin-row.admin-row-decided.inset` per `decidedLine(p)`: `dot` + what · author · status · `{when} · {decidedBy name from usersById or "—"}` · faint `"note"`. (The decided rows need `decidedBy` — `ProposalSummary` has none; show the age only. Ruling: no decider name in this issue.)

`Users.tsx` (section `id="users"`): head "Users" + muted "N · signed in at least once"; `.admin-row.admin-row-head.label-caps` columns (blank, name, role, last seen, pts · hour, pts · 24 h, discord id, blank); per `userRow(u, now, selfId, limitPerUser)` an `.inset.admin-row.admin-row-user`: `Avatar`, `name <span class="faint">{handle}</span>`, role cell = `chip` (`chip-admin` when admin) `{role}` + (`roleNote` → faint "env") + (`toggle` → `chip` button), `muted lastSeen`, `mono {pointsHour}` with `pointsHourTone`, `mono points24h`, `mono faint discordId`, `btn btn-sm` "Revoke sessions" (hidden when `!canRevoke`). Inline confirmations (canvas details): clicking the toggle or Revoke replaces the row's action cells with `.inset.confirm`: "Make **{name}** an admin? They get the Admin page, no quota, and can approve proposals." + `btn btn-sm btn-primary` "Make admin" / `btn btn-sm` "Cancel"; "Make **{name}** a member? They lose the Admin page and get the hourly quota." + "Make member"; "Revoke **{name}**'s sessions? {sessions} session(s) end now." + `btn btn-sm btn-danger` "Revoke" + Cancel. State `confirm: { id: number; kind: "role" | "revoke" } | null`.

`Invites.tsx` (section `id="invites"`): head "Invites" + muted "N · a Discord id may sign in once it is listed here (admins from the env are implicit)"; `.admin-form`: `<input className="mono" placeholder="Discord id (17–20 digits)" value maxLength={20}>`, `<input placeholder="Note (guild mate, alt of…)" maxLength={200}>`, `btn btn-primary` "Invite" (disabled unless `/^\d{17,20}$/.test(id)`), faint "Developer Mode → Copy User ID"; on submit `onAdd(id, note.trim() || null)` then clear the inputs. Header row (discord id, note, added, status, blank); rows `inviteRow(i)`: `mono discordId`, `muted note`, `muted added` (with `admin #N` replaced by the admin's display name when `users` has it: `added.replace(/admin #(\d+)/, (_, n) => users.find((u) => u.id === Number(n))?.globalName ?? users.find(…)?.username ?? \`admin #${n}\`)` — do this in the component, once, as a tiny helper), status `chip chip-ok` when `signedIn` else `chip`, `btn btn-sm` "Remove" (confirm inline: "Remove the invite for **{discordId}**? {signedIn ? "They are signed out and cannot sign in again." : "They will not be able to sign in."}" + `btn btn-sm btn-danger` "Remove" / Cancel).

`Instance.tsx` (section `id="instance"`, `card` with two columns `grid-template-columns: 1fr 1fr; gap: 24px` inline): left "Instance" `.kv`: version (mono), uptime, database (mono `db`, title = `dbPath`), last backup (`backup` + faint `· last-backup next to .env`), WCL client (`usage.instance ? \`rateLimitData ${fmtShortAge(observedAt)} · ${fmtPts(limitPerHour)} pts/h\` : "no WCL call observed yet"`); right "Effective environment" + faint "secrets masked": `.kv.mono` 12 px rows `key` / `value` (faint when `secret`). Renders "loading…" muted until `instance` arrives.

- [ ] **Step 3: Routing** — `web/src/App.tsx`

Imports: `import { AdminPage } from "./components/admin/AdminPage.tsx"; import { Forbidden } from "./components/admin/Forbidden.tsx";` and `adminAccess` from `./lib/hostedMode.ts`. In `Main`, before the `return`:

```ts
  const isAdminPath = location.pathname === "/admin";
  const access = adminAccess(status, me);
```

and in the JSX, after `<Header …/>`: when `isAdminPath`, render instead of `<Tabs …/>` + `<main …>`:

```tsx
      {isAdminPath ? (
        access === "ok" && me ? <AdminPage me={me} /> : <Forbidden reason={access === "local" ? "local" : "member"} handle={me ? `@${me.username}` : null} />
      ) : (
        <> …the existing Tabs + main… </>
      )}
```

The header stays (search still works from the admin page — a lookup navigates? No: `runLookup` sets state only; the admin page would not show the result. Ruling: on `/admin` the header's `hero` is false and `onLookup` does `location.assign("/")` after `runLookup`? Simpler and honest: **on `/admin` the search form is hidden** — pass `hero={false}` and a new `Header` prop `search?: boolean` (default `true`) that skips the form; the canvas shows the search box but a lookup there has nowhere to land.) Update the `onMenuOpen` call to `api.admin.proposals("pending")` and remove `adminProposals` from `api.ts`.

Local mode check: `location.pathname` is `/` or `/setup` in local mode; `/admin` served locally shows `Forbidden` with the local wording (server serves index for `/admin` in both modes since #7). Nothing else changes.

- [ ] **Step 4: Verify and commit**

Run: `just check && bun test` → green; `cd web && bunx vite build && rm -rf dist`. Live check (hosted `.env` with dummy WCL creds, seeded admin + member sessions, a pending proposal; the #7 smoke procedure): `/admin` as member → "Admins only"; as admin → gauge ("—" until a WCL call, that is fine), queue with the diff, approve with a note → the card becomes a decided line and the member's panel shows the note; invite an id → "not signed in yet"; make member admin → chip flips; revoke → the member's `/api/me` is 401; instance shows masked env and "never" backup.

```bash
git add web/src/components/admin web/src/components/Avatar.tsx web/src/components/UserMenu.tsx web/src/components/Header.tsx web/src/App.tsx web/src/api.ts web/src/styles/app.css
git commit -m "feat(web): admin page — budget gauge, proposal queue, users, invites, instance (layout B)"
```

---

### Task 4: Docs and canvas sources

**Files:** `README.md`, `docs/agents/web-front.md`, `docs/agents/architecture.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-16-web-front-design.md`, `docs/design/canvas/AdminTabs.dc.html`, `AdminOnePage.dc.html`, `AdminDashboard.dc.html`, `AdminDetails.dc.html`, `canvas.json` (already written).

- [ ] **Step 1: README** — "Hosted mode":
  - **Login**: "or the admin page once issue #8 lands" → "or the admin page (`/admin`, admins only): invites with a note, who signed in, remove"; "change the role on the admin page (issue #8) or via `POST /api/admin/users/:id/role`" → "change the role on the admin page (Users → make admin / make member) or via `POST /api/admin/users/:id/role`; **Revoke sessions** signs a user out everywhere (`POST /api/admin/users/:id/sessions/revoke`)".
  - **WCL budget**: after "admins can read `GET /api/admin/usage` (…)": "— the admin page shows it as a gauge (this hour vs the client's limit, reset countdown, top consumers, the last 24 h per hour)".
  - **Shared defensives table**: "(`GET /api/admin/proposals`, `POST /api/admin/proposals/:id/approve|reject { note }`)" → "(the admin page's proposal queue shows what changes — current → proposed — with the author; `GET /api/admin/proposals` returns the same rows with `current`, `POST /api/admin/proposals/:id/approve|reject { note }` decides)".
  - New short paragraph **Instance info** after the defensives one: "`GET /api/admin/instance` (and the page's Instance section) reports the version, uptime, database size, the last backup (mtime of a `last-backup` file next to `.env`, written by the deploy — issue #10) and the effective environment with secrets masked. The WCL error list of the issue waits for the audit log (issue #9)."
- [ ] **Step 2: `docs/agents/web-front.md`** — view models list: add `admin.ts` (gauge, proposal cards/diff, user/invite rows, instance); components map: "`AdminPage` (`components/admin/*`: `Gauge`, `Queue`, `Users`, `Invites`, `Instance`, `Forbidden`) at `/admin`, data via `api.admin.*`, one `reload()` after every action" and `Avatar`; hosted bullet: "`/admin` renders inside `Main` (header without the search form); `adminAccess(status, me)` decides page vs `Forbidden`". Design first: the canvas artboards for #8 (`AdminOnePage` chosen, `AdminDetails`).
- [ ] **Step 3: `docs/agents/architecture.md`** — hosted section: the four route additions and `src/hosted/instance.ts` (masking rule: secrets never leave the server; `WCL_CLIENT_ID` abbreviated). `AGENTS.md` roadmap: "#2–#8 (…, admin page) are shipped, next is #9 (hardening)". Spec status line: "admin page implemented 2026-09-18 — issue #8, canvas artboards Admin*".
- [ ] **Step 4: Verify and commit**

Run: `just check && bun test` → green. `git status --short` shows only docs and canvas files.

```bash
git add README.md docs/agents/web-front.md docs/agents/architecture.md AGENTS.md docs/superpowers/specs/2026-09-16-web-front-design.md docs/design/canvas/AdminTabs.dc.html docs/design/canvas/AdminOnePage.dc.html docs/design/canvas/AdminDashboard.dc.html docs/design/canvas/AdminDetails.dc.html docs/design/canvas/canvas.json docs/superpowers/plans/2026-09-18-admin-page.md
git commit -m "docs: admin page (invites, users, proposal queue, budget gauge, instance) and its canvas artboards"
```

---

## Self-review

- **Spec coverage** (issue #8): `/admin` admins only, 403 screen for members ✓ (Task 3, server 403 pre-existing); invites list/add/remove + who signed in ✓ (Task 1 `user`, Task 3); users with last seen, points hour / 24 h, role toggle, revoke sessions ✓ (Tasks 1–3); proposal queue with diff (spell, key, patch vs current, author, when), approve/reject with note, decided history ✓; budget gauge (this hour vs limit, reset, top consumers) ✓ — **WCL error list deferred to #9** (needs the audit log); instance info (version, uptime, DB size, last backup file, masked env) ✓; view models in `admin.ts` tested ✓; canvas first ✓ (B chosen); acceptance flow invite → login → proposal → approve from the UI ✓ (Task 3 live check).
- **Decisions to flag**: the search form is hidden on `/admin` (a lookup there has nowhere to land; the canvas drew it); confirmations are inline (canvas details) rather than `window.confirm`; decided rows show no decider name (`ProposalSummary` has none; adding `decidedBy` is a two-line server change if wanted later); `addInvite` response lacks `user` → the page re-lists; env admins (`BMPL_ADMIN_DISCORD_IDS`) show "env" and no toggle (server refuses anyway); revoking your own sessions is refused ("Sign out instead").
- **Placeholder scan**: none.
- **Type consistency**: `AdminUser.pointsHour/points24h/sessions/configAdmin` (T1 route ↔ T2 type ↔ `userRow`); `AdminProposal.current/ignored` (T1 ↔ T2 `diffRows`); `AdminUsage.instance: RateLimitSnapshot | null` (`observedAt`, `pointsSpentThisHour`, `limitPerHour` used by `gaugeModel`); `api.admin.decide(id, "approve"|"reject", note)` ↔ route `/:id/approve|reject`; `adminAccess` ↔ `Forbidden.reason`; `Avatar` extracted from `UserMenu` (T3) keeps `UserMenu`'s behaviour.
