# Hosted Front (sign-in, user menu, quota UX, proposal wording) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In hosted mode the web front gets a designed sign-in gate, a header user menu (avatar, name, quota, Admin, Sign out), quota feedback that follows 429 responses, and "Propose …" wording plus shared / pending / rejected marks in the deep-dive panel — while local mode stays pixel-identical.

**Architecture:** Everything hosted-only is gated by `/api/status` (`hosted`) and `/api/me` (role), through pure view models in `web/src/lib/*` (`session.ts` for the user menu, `hostedMode.ts` for which controls and wording apply, `quota.ts` for tooltips and 429 bodies, `deepdive.ts` for the panel's proposal lines). Components stay thin: a new `UserMenu.tsx`, a redesigned `SignIn.tsx`, small edits to `Header.tsx`, `DungeonRuns.tsx`, `RunDeepDive.tsx`, `App.tsx`. New CSS classes only (`.signin*`, `.user-menu`/`.menu*`, `.avatar`, `.dot*`, `.btn-discord`) plus one token `--discord`; no existing rule changes.

**Tech Stack:** Vite 8 + React 19 (`web/`), TypeScript strict with `verbatimModuleSyntax`, `bun test` for the view models (no DOM), tokens in `web/src/styles/tokens.css`.

**Spec:** GitHub issue #7 (`gh issue view 7`), parent #1. Design: Claude Design canvas https://claude.ai/artifact/3yUjZKgaQyHKebzyqcio5s, page "Hosted" (sources `docs/design/canvas/Hosted*.dc.html`). Chosen variants: sign-in **A · hero** with the denied notice **2 · neutral inset**, `--discord` token for the button, header **A · text trigger** (quota only inside the menu, red label in the header only once exhausted), panel **C · status dot + "Your proposals" footer**. Builds on #4 (`SettingsProvider`, `GET/PUT /api/settings`), #5 (`/api/me.quota`, 429 bodies `{ error: "quota"|"budget", message, used, limit, resetInS }`, `quota` on lookup/deepdive responses) and #6 (`GET /api/defensives` → `proposals`, `origin` on entries, `GET /api/admin/proposals`).

## Global Constraints

- **Local mode pixel-identical**: every new class is used only when `status.hosted`; no existing CSS rule or local string changes. All existing `web/src/**/*.test.ts` stay green unchanged, except where a test is explicitly extended below.
- **Colours / radii / fonts from `tokens.css` only.** The single new token is `--discord: #5865f2` (Discord "blurple", sign-in button only). No other raw hex in `app.css` or components (`#fff` on a primary button is the existing convention).
- **`web/` imports from `src/` are types only** (`import type … from "@shared/…"`); `ProposalSummary`, `EntryOrigin`, `OverrideEntry` are type imports.
- **View models pure and tested** (`web/src/lib/*.ts` + sibling `*.test.ts`, no React/DOM). Components map a model to markup and hold local UI state only. The one fetch inside a component (`RunDeepDive` loading the member's proposals) is documented in `docs/agents/web-front.md`.
- **English strings only**, short and factual: "Sign in with Discord", "Invitation required", "Propose + major", "Propose ignore", "Propose cd", "Propose removal", "pending review", "Your proposals", "Hourly quota reached · resets in N min".
- **Settings sync** ("your key", legend) already comes from `/api/settings` in hosted mode (#4) — nothing to do; the docs say so.
- **Never spend WCL points**: nothing here calls WCL; tests never touch the network. `just check && bun test` green with `web/dist` absent at the end of every task.
- **Git**: `main` in place, explicit `git add` paths, never the root files `biwaasham.json`, `defensives.json`, `evaluation.json`, `.env`, `bmpl.db*`, nor `web/dist`.

## File map

| File | Responsibility |
|---|---|
| `web/src/styles/tokens.css` | + `--discord` |
| `web/src/styles/app.css` | + hosted-only classes: sign-in, user menu, avatar, origin dots, Discord button |
| `web/src/lib/session.ts` (new) + test | `menuModel(me, quota)`, `quotaLine`, `initialsOf`, `pendingText` |
| `web/src/lib/quota.ts` + test | + `quotaTooltip(q)`, `quotaFromFailure(data)` |
| `web/src/lib/hostedMode.ts` + test | + `ProposalMode`, `proposalMode(status, me)` |
| `web/src/lib/deepdive.ts` + test | + `actionLabels(mode)`, `originDot`, `originSuffix`, `tableUsedParts`, `patchText`, `proposalLines`; `panelModel` gains `specClass`, `tableParts` |
| `web/src/api.ts` | failure results carry `quota` from `error: "quota"` bodies; `adminProposals()` |
| `web/src/components/SignIn.tsx` | hero gate (A) + denied inset (2) + login-failed line |
| `web/src/components/UserMenu.tsx` (new) | avatar trigger, dropdown (identity, quota bar, Admin, Sign out) |
| `web/src/components/Header.tsx` | hosted right side = exhausted label + `UserMenu` |
| `web/src/components/Detail.tsx` | `DeepdiveActions` + `mode`, `quotaTooltip` |
| `web/src/components/DungeonRuns.tsx`, `RunDeepDive.tsx` | tooltips from `quotaTooltip`; wording, dots, proposals footer by `mode` |
| `web/src/App.tsx` | `menuModel`, quota refresh from 429 failures, pending-proposal count for admins, `mode` |
| `src/web-static.ts` + `test/server.test.ts` | `/admin` serves `index.html` (the page itself is issue #8) |
| `README.md`, `docs/agents/web-front.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-16-web-front-design.md` | docs |
| `docs/design/canvas/Hosted*.dc.html`, `canvas.json` | the canvas sources (already written, uncommitted) |

---

### Task 1: View models — session, quota tooltip / 429 body, proposal mode

**Files:**
- Create: `web/src/lib/session.ts`, `web/src/lib/session.test.ts`
- Modify: `web/src/lib/quota.ts`, `web/src/lib/quota.test.ts`, `web/src/lib/hostedMode.ts`, `web/src/lib/hostedMode.test.ts`

**Interfaces:**
- Consumes: `MeUser`, `QuotaInfo` (`web/src/api.ts`), `pointsLeft`, `quotaLabel` (`quota.ts`), `StatusInfo` (`hostedMode.ts`).
- Produces: `menuModel(me: MeUser, q: QuotaInfo | null): MenuModel`, `quotaLine(q, isAdmin): QuotaLine`, `initialsOf(name): string`, `pendingText(n: number): string | null`; `quotaTooltip(q: QuotaInfo | null): string`, `quotaFromFailure(data: unknown): QuotaInfo | null`; `type ProposalMode = "local" | "propose" | "admin"`, `proposalMode(status: StatusInfo, me: MeUser | null): ProposalMode`.

- [ ] **Step 1: Failing tests**

`web/src/lib/session.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { initialsOf, menuModel, pendingText, quotaLine } from "./session.ts";

const member = { id: 2, discordId: "22", username: "muleyoxo", globalName: "Muleyoxo", avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png", role: "member" as const };
const admin = { ...member, id: 1, role: "admin" as const, globalName: null };

describe("quotaLine", () => {
  test("left of limit, reset in minutes, percentage left, tone by what is left", () => {
    expect(quotaLine({ used: 88, limit: 300, resetInS: 2280 }, false)).toEqual({ text: "212 of 300 pts left this hour", sub: "resets in 38 min", pct: 71, tone: "" });
    expect(quotaLine({ used: 280, limit: 300, resetInS: 60 }, false).tone).toBe("tone-warn");
    expect(quotaLine({ used: 300, limit: 300, resetInS: 5 }, false)).toEqual({ text: "0 of 300 pts left this hour", sub: "resets in 1 min", pct: 0, tone: "tone-bad" });
  });
  test("no limit: admins are unlimited, otherwise no quota", () => {
    expect(quotaLine({ used: 5, limit: null, resetInS: 1 }, true)).toEqual({ text: "unlimited · admin", sub: null, pct: null, tone: "" });
    expect(quotaLine(null, false)).toEqual({ text: "no quota", sub: null, pct: null, tone: "" });
  });
});

describe("menuModel", () => {
  test("display name, handle with role, initials, admin flag, quota line", () => {
    const m = menuModel(member, { used: 88, limit: 300, resetInS: 2280 });
    expect(m.name).toBe("Muleyoxo");
    expect(m.handle).toBe("@muleyoxo");
    expect(m.initials).toBe("M");
    expect(m.isAdmin).toBe(false);
    expect(m.avatarUrl).toBe(member.avatarUrl);
    expect(m.quota.text).toBe("212 of 300 pts left this hour");
    expect(m.exhausted).toBeNull();
  });
  test("admin: username as name, ' · admin' in the handle", () => {
    const m = menuModel(admin, null);
    expect(m.name).toBe("muleyoxo");
    expect(m.handle).toBe("@muleyoxo · admin");
    expect(m.isAdmin).toBe(true);
    expect(m.quota.text).toBe("unlimited · admin");
  });
  test("exhausted: the header label only once nothing is left", () => {
    expect(menuModel(member, { used: 299, limit: 300, resetInS: 90 }).exhausted).toBeNull();
    expect(menuModel(member, { used: 300, limit: 300, resetInS: 90 }).exhausted).toBe("quota reached · resets in 2 min");
  });
});

describe("initialsOf / pendingText", () => {
  test("first letter upper-cased, '?' for an empty name", () => {
    expect(initialsOf("muleyoxo")).toBe("M");
    expect(initialsOf("  ")).toBe("?");
  });
  test("pending proposals count, singular/plural, null for none", () => {
    expect(pendingText(0)).toBeNull();
    expect(pendingText(1)).toBe("1 pending proposal");
    expect(pendingText(2)).toBe("2 pending proposals");
  });
});
```

Append to `web/src/lib/quota.test.ts` (add `quotaFromFailure, quotaTooltip` to the import):

```ts
describe("quotaTooltip / quotaFromFailure", () => {
  test("tooltip of a disabled Analyze button says when the quota resets", () => {
    expect(quotaTooltip({ used: 300, limit: 300, resetInS: 2280 })).toBe("Hourly quota reached · resets in 38 min");
    expect(quotaTooltip({ used: 300, limit: 300, resetInS: 5 })).toBe("Hourly quota reached · resets in 1 min");
    expect(quotaTooltip(null)).toBe("Hourly quota reached");
  });
  test("only an `error: \"quota\"` body carries the member's numbers", () => {
    expect(quotaFromFailure({ ok: false, error: "quota", message: "x", used: 300, limit: 300, resetInS: 120 })).toEqual({ used: 300, limit: 300, resetInS: 120 });
    expect(quotaFromFailure({ ok: false, error: "budget", message: "x", used: 3500, limit: 3600, resetInS: 120 })).toBeNull();
    expect(quotaFromFailure({ ok: false, error: "quota", message: "x" })).toBeNull();
    expect(quotaFromFailure(null)).toBeNull();
    expect(quotaFromFailure("nope")).toBeNull();
  });
});
```

Append to `web/src/lib/hostedMode.test.ts` (add `proposalMode` to the import):

```ts
describe("proposalMode", () => {
  const user = { id: 1, discordId: "1", username: "t", globalName: null, avatarUrl: "", role: "member" as const };
  test("local edits the file, hosted members propose, hosted admins correct on the spot", () => {
    expect(proposalMode(local, null)).toBe("local");
    expect(proposalMode(local, user)).toBe("local");
    expect(proposalMode(hosted, user)).toBe("propose");
    expect(proposalMode(hosted, { ...user, role: "admin" })).toBe("admin");
    expect(proposalMode(hosted, null)).toBe("propose");
  });
});
```

- [ ] **Step 2: Run them, expect failures**

Run: `bun test web/src/lib/session.test.ts web/src/lib/quota.test.ts web/src/lib/hostedMode.test.ts` → FAIL (`session.ts` missing, `quotaTooltip`/`quotaFromFailure`/`proposalMode` undefined).

- [ ] **Step 3: Implement**

`web/src/lib/session.ts`:

```ts
// The signed-in member as the hosted header shows them: trigger label, menu contents, quota line.
import type { MeUser, QuotaInfo } from "../api.ts";
import { pointsLeft, quotaLabel } from "./quota.ts";

export interface QuotaLine { text: string; sub: string | null; pct: number | null; tone: "" | "tone-warn" | "tone-bad" }
export interface MenuModel {
  name: string;
  handle: string;
  initials: string;
  avatarUrl: string;
  isAdmin: boolean;
  quota: QuotaLine;
  /** Red label in the header row itself — only once the quota is exhausted (the menu carries the numbers otherwise). */
  exhausted: string | null;
}

const resetText = (s: number): string => `resets in ${Math.max(1, Math.ceil(s / 60))} min`;

/** Under 30 pts (about one uncached lookup) the line turns yellow; at 0 red. Admins have no limit. */
export function quotaLine(q: QuotaInfo | null, isAdmin: boolean): QuotaLine {
  const left = pointsLeft(q);
  if (q === null || left === null || q.limit === null) return { text: isAdmin ? "unlimited · admin" : "no quota", sub: null, pct: null, tone: "" };
  const pct = q.limit > 0 ? Math.round((left / q.limit) * 100) : 0;
  return {
    text: `${Math.floor(left)} of ${q.limit} pts left this hour`,
    sub: resetText(q.resetInS),
    pct,
    tone: left < 1 ? "tone-bad" : left < 30 ? "tone-warn" : "",
  };
}

export const initialsOf = (name: string): string => name.trim().slice(0, 1).toUpperCase() || "?";

/** "N pending proposal(s)" for the Admin menu item; null when there is nothing to review. */
export const pendingText = (n: number): string | null => (n > 0 ? `${n} pending proposal${n === 1 ? "" : "s"}` : null);

export function menuModel(me: MeUser, q: QuotaInfo | null): MenuModel {
  const isAdmin = me.role === "admin";
  const name = me.globalName ?? me.username;
  const left = pointsLeft(q);
  return {
    name,
    handle: `@${me.username}${isAdmin ? " · admin" : ""}`,
    initials: initialsOf(name),
    avatarUrl: me.avatarUrl,
    isAdmin,
    quota: quotaLine(q, isAdmin),
    exhausted: left !== null && left < 1 ? quotaLabel(q) : null,
  };
}
```

Append to `web/src/lib/quota.ts`:

```ts
/** Tooltip of an Analyze button disabled by the quota. */
export function quotaTooltip(q: QuotaInfo | null): string {
  return q ? `Hourly quota reached · resets in ${Math.max(1, Math.ceil(q.resetInS / 60))} min` : "Hourly quota reached";
}

/** A 429 body from the quota gate: `error: "quota"` carries the member's own numbers, `error: "budget"` the client's — only the former updates the label. */
export function quotaFromFailure(data: unknown): QuotaInfo | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.error !== "quota" || typeof o.used !== "number" || typeof o.limit !== "number" || typeof o.resetInS !== "number") return null;
  return { used: o.used, limit: o.limit, resetInS: o.resetInS };
}
```

Append to `web/src/lib/hostedMode.ts` (extend the first import: `import type { MeResult, MeUser } from "../api.ts";`):

```ts
/** Wording of the panel's table corrections: local file edits, member proposals, or admin corrections (approved on the spot). */
export type ProposalMode = "local" | "propose" | "admin";
export function proposalMode(status: StatusInfo, me: MeUser | null): ProposalMode {
  if (!status.hosted) return "local";
  return me?.role === "admin" ? "admin" : "propose";
}
```

- [ ] **Step 4: Verify and commit**

Run: `bun test web/src/lib` → PASS. Run: `just check` → clean.

```bash
git add web/src/lib/session.ts web/src/lib/session.test.ts web/src/lib/quota.ts web/src/lib/quota.test.ts web/src/lib/hostedMode.ts web/src/lib/hostedMode.test.ts
git commit -m "feat(web): session/quota/proposal-mode view models for the hosted front"
```

---

### Task 2: Panel view model — action labels, origin dots, proposal lines; 429 bodies in `api.ts`

**Files:**
- Modify: `web/src/lib/deepdive.ts`, `web/src/lib/deepdive.test.ts`, `web/src/api.ts`

**Interfaces:**
- Consumes: `ProposalMode` (Task 1), `quotaFromFailure` (Task 1), `ProposalSummary` (`@shared/hosted/defensives.ts`: `{ id, spellId, status: "pending"|"approved"|"rejected", patch: OverrideEntry, note: string | null, createdAt, decidedAt: number | null }`), `fmtAge` (`format.ts`).
- Produces: `actionLabels(mode): ActionLabels`, `originDot(origin): "dot-shared" | "dot-pending" | null`, `originSuffix(origin): string | null`, `tableUsedParts(defensives, specClass): TablePart[]`, `patchText(patch): string`, `proposalLines(proposals, names, now): ProposalLine[]`; `PanelModel.specClass`, `PanelModel.tableParts`; `ApiResult` failure `{ ok: false; error: string; quota?: QuotaInfo }`; `api.adminProposals()`.

- [ ] **Step 1: Failing tests** (append to `web/src/lib/deepdive.test.ts`; extend the import with `actionLabels, originDot, originSuffix, patchText, proposalLines, tableUsedParts` and add `import type { ProposalSummary } from "@shared/hosted/defensives.ts";`)

```ts
describe("hosted panel: labels, dots, proposals", () => {
  test("actionLabels: members propose, local and admin edit", () => {
    const p = actionLabels("propose");
    expect([p.add("major"), p.ignore, p.editCd, p.remove, p.addSubmit("minor"), p.save]).toEqual(["Propose + major", "Propose ignore", "Propose cd", "Propose removal", "Propose as minor", "Propose"]);
    for (const mode of ["local", "admin"] as const) {
      const l = actionLabels(mode);
      expect([l.add("major"), l.ignore, l.editCd, l.remove, l.addSubmit("minor"), l.save]).toEqual(["+ major", "Ignore", "Edit cd", "Remove for this spec", "Add as minor", "Save"]);
    }
  });
  test("originDot marks shared and pending; originSuffix keeps the text only for a local override", () => {
    expect(originDot("shared")).toBe("dot-shared");
    expect(originDot("pending")).toBe("dot-pending");
    expect(originDot("override")).toBeNull();
    expect(originDot("shipped")).toBeNull();
    expect(originSuffix("override")).toBe("override");
    expect(originSuffix("shared")).toBeNull();
    expect(originSuffix("pending")).toBeNull();
    expect(originSuffix("shipped")).toBeNull();
  });
  test("tableUsedParts splits the line so shared / pending counts get their dot", () => {
    const o = (origin: EntryOrigin) => ({ origin });
    expect(tableUsedParts([o("shipped"), o("override")], "Holy Paladin")).toEqual([{ text: "Table used: Holy Paladin · 2 entries", dot: null }, { text: "1 from your override", dot: null }]);
    expect(tableUsedParts([o("shared"), o("shared"), o("pending"), o("shipped")], "Holy Paladin")).toEqual([
      { text: "Table used: Holy Paladin · 4 entries", dot: null }, { text: "2 shared", dot: "dot-shared" }, { text: "1 pending review", dot: "dot-pending" },
    ]);
    expect(tableUsedParts([o("shipped"), o("override")], "Holy Paladin").map((p) => p.text).join(" · ")).toBe(tableUsedText([o("shipped"), o("override")], "Holy Paladin"));
  });
  test("patchText describes a patch", () => {
    expect(patchText({ id: 1, ignore: true })).toBe("ignore");
    expect(patchText({ id: 1, cooldownS: 300 })).toBe("cd 300 s");
    expect(patchText({ id: 1, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 })).toBe("+ minor, cd 25 s, 6 s");
    expect(patchText({ id: 1 })).toBe("no change");
  });
  test("proposalLines: name from the patch or the table, status with age and note", () => {
    const now = 1_000_000 + 2 * 3600_000;
    const proposals: ProposalSummary[] = [
      { id: 3, spellId: 642, status: "pending", patch: { id: 642, cooldownS: 300 }, note: null, createdAt: 1_000_000, decidedAt: null },
      { id: 2, spellId: 1044, status: "rejected", patch: { id: 1044, name: "Blessing of Freedom", kind: "minor", cooldownS: 25, durationS: 6 }, note: "It is a freedom, not a defensive.", createdAt: 1_000_000 - 3 * 86400_000, decidedAt: 1_000_000 - 2 * 86400_000 },
      { id: 1, spellId: 498, status: "approved", patch: { id: 498, cooldownS: 60 }, note: null, createdAt: 1_000_000 - 6 * 86400_000, decidedAt: 1_000_000 - 5 * 86400_000 },
      { id: 4, spellId: 9999, status: "pending", patch: { id: 9999, ignore: true }, note: null, createdAt: now, decidedAt: null },
    ];
    expect(proposalLines(proposals, dd().defensives, now)).toEqual([
      { id: 3, dot: "dot-pending", what: "Divine Shield · cd 300 s", when: "pending · 2h ago" },
      { id: 2, dot: "dot-rejected", what: "Blessing of Freedom · + minor, cd 25 s, 6 s", when: "rejected 2d ago — \"It is a freedom, not a defensive.\"" },
      { id: 1, dot: "dot-approved", what: "Divine Protection · cd 60 s", when: "approved 5d ago" },
      { id: 4, dot: "dot-pending", what: "spell 9999 · ignore", when: "pending · just now" },
    ]);
  });
  test("panelModel exposes specClass and tableParts", () => {
    const m = panelModel(dd(), 1_000_000);
    expect(m.specClass).toBe("Holy Paladin");
    expect(m.tableParts).toEqual([{ text: "Table used: Holy Paladin · 3 entries", dot: null }, { text: "1 from your override", dot: null }]);
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test web/src/lib/deepdive.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Implement** in `web/src/lib/deepdive.ts`

Imports: add `import type { ProposalSummary } from "@shared/hosted/defensives.ts";`, `import type { OverrideEntry } from "../types.ts";` (extend the existing `../types.ts` type import), `import type { ProposalMode } from "./hostedMode.ts";`.

```ts
export interface ActionLabels { add: (kind: DefensiveKind) => string; ignore: string; editCd: string; remove: string; addSubmit: (kind: DefensiveKind) => string; save: string }
/** Members propose; local mode and admins edit the table directly (an admin's correction is approved on the spot). */
export function actionLabels(mode: ProposalMode): ActionLabels {
  const p = mode === "propose";
  return {
    add: (kind) => (p ? `Propose + ${kind}` : `+ ${kind}`),
    ignore: p ? "Propose ignore" : "Ignore",
    editCd: p ? "Propose cd" : "Edit cd",
    remove: p ? "Propose removal" : "Remove for this spec",
    addSubmit: (kind) => (p ? `Propose as ${kind}` : `Add as ${kind}`),
    save: p ? "Propose" : "Save",
  };
}

export type OriginDot = "dot-shared" | "dot-pending";
/** Colour dot before an entry name: blue for the shared layer, yellow while pending; null for shipped and local override entries. */
export const originDot = (origin: EntryOrigin): OriginDot | null => (origin === "shared" ? "dot-shared" : origin === "pending" ? "dot-pending" : null);
/** Text suffix (" · override") for the origins that have no dot. */
export const originSuffix = (origin: EntryOrigin): string | null => (originDot(origin) ? null : originLabel(origin));

export interface TablePart { text: string; dot: OriginDot | null }
/** `tableUsedText` split into parts so the hosted counts carry their dot. Joined with " · " it equals `tableUsedText`. */
export function tableUsedParts(defensives: Array<{ origin: EntryOrigin }>, specClass: string): TablePart[] {
  const count = (o: EntryOrigin) => defensives.filter((u) => u.origin === o).length;
  const parts: TablePart[] = [{ text: `Table used: ${specClass} · ${defensives.length} entries`, dot: null }];
  const override = count("override"), shared = count("shared"), pending = count("pending");
  if (override > 0) parts.push({ text: `${override} from your override`, dot: null });
  if (shared > 0) parts.push({ text: `${shared} shared`, dot: "dot-shared" });
  if (pending > 0) parts.push({ text: `${pending} pending review`, dot: "dot-pending" });
  return parts;
}

/** What a proposal changes, as the "Your proposals" footer says it. */
export function patchText(p: OverrideEntry): string {
  if (p.ignore) return "ignore";
  const parts: string[] = [];
  if (p.kind) parts.push(`+ ${p.kind}`);
  if (p.cooldownS !== undefined) parts.push(`cd ${p.cooldownS} s`);
  if (p.durationS !== undefined && p.kind) parts.push(`${p.durationS} s`);
  return parts.length > 0 ? parts.join(", ") : "no change";
}

export interface ProposalLine { id: number; dot: "dot-pending" | "dot-rejected" | "dot-approved"; what: string; when: string }
/** The member's own proposals for this spec, newest first as the server returns them; the spell name comes from the patch, else the run's table. */
export function proposalLines(proposals: ProposalSummary[], names: Array<{ id: number; name: string }>, now = Date.now()): ProposalLine[] {
  return proposals.map((p) => {
    const name = p.patch.name ?? names.find((n) => n.id === p.spellId)?.name ?? `spell ${p.spellId}`;
    const what = `${name} · ${patchText(p.patch)}`;
    if (p.status === "pending") return { id: p.id, dot: "dot-pending", what, when: `pending · ${fmtAge(p.createdAt, now)}` };
    const note = p.note ? ` — "${p.note}"` : "";
    const age = fmtAge(p.decidedAt ?? p.createdAt, now);
    return p.status === "rejected"
      ? { id: p.id, dot: "dot-rejected", what, when: `rejected ${age}${note}` }
      : { id: p.id, dot: "dot-approved", what, when: `approved ${age}${note}` };
  });
}
```

`PanelModel` gains `specClass: string; tableParts: TablePart[]`; `panelModel` returns `specClass` and `tableParts: tableUsedParts(d.defensives, specClass)` next to `tableUsed`. (`tableUsedText` stays — `RunDeepDive` switches to the parts in Task 5.)

`web/src/api.ts`:

```ts
import { quotaFromFailure } from "./lib/quota.ts";
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; quota?: QuotaInfo };
```

In `call`, replace the failure line with:

```ts
  if (!res.ok || data.ok === false) {
    const quota = quotaFromFailure(data);
    return { ok: false, error: data.message ?? data.error ?? `HTTP ${res.status}`, ...(quota ? { quota } : {}) };
  }
```

Add to `api`: `adminProposals: () => call<{ proposals: Array<{ id: number }> }>("/api/admin/proposals"),` (pending by default — only the count is used here; the admin page is issue #8).

- [ ] **Step 4: Verify and commit**

Run: `bun test web/src/lib` → PASS; `just check` → clean.

```bash
git add web/src/lib/deepdive.ts web/src/lib/deepdive.test.ts web/src/api.ts
git commit -m "feat(web): proposal wording, origin dots and proposal lines in the panel model; 429 bodies carry quota"
```

---

### Task 3: Sign-in screen (hero A, denied inset 2, `--discord` token)

**Files:**
- Modify: `web/src/styles/tokens.css`, `web/src/styles/app.css`, `web/src/components/SignIn.tsx`

**Interfaces:**
- Consumes: `deniedDiscordId`, `loginFailed` (unchanged, `App.tsx`).
- Produces: nothing new for later tasks. Markup follows `docs/design/canvas/HostedSignIn.dc.html` (A) and `HostedDenied.dc.html` (2, "?login=failed", "Redirecting…" is not implemented — the link navigates at once).

- [ ] **Step 1: Token and classes**

`web/src/styles/tokens.css`, after `--button`: `  --discord: #5865f2; /* Discord brand colour ("blurple") — the hosted sign-in button only, issue #7 */`

Append to `web/src/styles/app.css`:

```css
/* --- hosted: sign-in gate (SignIn.tsx) --- */
.signin { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; min-height: calc(100vh - 65px); padding: 0 24px 40px; text-align: center; }
.signin h1 { font-size: 26px; font-weight: 700; margin: 0; }
.signin p { margin: 0; }
.btn-discord { height: 48px; padding: 0 22px; gap: 8px; font-size: 15px; font-weight: 600; background: var(--discord); border-color: var(--discord); color: #fff; margin-top: 6px; }
.btn-discord:hover { color: #fff; border-color: var(--discord); filter: brightness(1.1); }
.signin-note { font-size: 12px; color: var(--faint); margin-top: 16px; }
.signin-denied { width: 520px; max-width: 100%; text-align: left; display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; font-size: 13px; color: var(--text-soft); }
.signin-id { display: flex; align-items: center; gap: 10px; margin-top: 2px; font-size: 15px; color: var(--text); }
```

(65 px = the `.top` header: 40 px row + 12 px padding twice + 1 px border.)

- [ ] **Step 2: Component**

`web/src/components/SignIn.tsx`:

```tsx
import { useState } from "react";

interface Props { deniedDiscordId: string | null; loginFailed: boolean }

const DiscordMark = () => (
  <svg width="20" height="16" viewBox="0 0 127 96" fill="currentColor" aria-hidden="true">
    <path d="M107.7 8.1A105.2 105.2 0 0 0 81.5 0c-1.1 2-2.4 4.7-3.3 6.8a97.7 97.7 0 0 0-29.1 0C48.2 4.7 46.9 2 45.7 0a105 105 0 0 0-26.2 8.1C2.9 33.2-1.6 57.6.6 81.7a106 106 0 0 0 32.2 16.2c2.6-3.5 4.9-7.3 6.9-11.2a68.6 68.6 0 0 1-10.9-5.2c.9-.7 1.8-1.4 2.7-2.1a75.6 75.6 0 0 0 64.6 0c.9.7 1.8 1.4 2.7 2.1-3.5 2.1-7.1 3.8-10.9 5.2 2 3.9 4.3 7.7 6.9 11.2a105.8 105.8 0 0 0 32.2-16.2c2.6-27.9-4.5-52.1-18.9-73.6zM42.5 66.9c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5.1 12.9-11.5 12.9zm42.5 0c-6.3 0-11.5-5.8-11.5-12.9s5.1-12.9 11.5-12.9 11.6 5.8 11.5 12.9c0 7.1-5 12.9-11.5 12.9z" />
  </svg>
);

/** Hosted-mode gate (GET /api/me → 401). Design: canvas page "Hosted", sign-in A + denied notice 2. */
export function SignIn({ deniedDiscordId, loginFailed }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!deniedDiscordId) return;
    try { await navigator.clipboard.writeText(deniedDiscordId); setCopied(true); } catch { /* no clipboard access: the id is plain text, selectable */ }
  };
  return (
    <>
      <header className="top"><div className="top-row"><div className="brand">bmpl</div></div></header>
      <main className="signin">
        <h1>Who applied to your key?</h1>
        <p className="muted">Vet a Mythic+ applicant from their Warcraft Logs and Raider.IO history.</p>
        <a className="btn btn-discord" href="/auth/discord"><DiscordMark /> Sign in with Discord</a>
        {loginFailed && <p style={{ color: "var(--red)", fontSize: 13 }}>✗ Sign-in failed — Discord did not complete the login. Try again.</p>}
        {deniedDiscordId && (
          <div className="inset signin-denied">
            <div className="label-caps">Invitation required</div>
            <div>Your Discord account signed in fine, but it is not invited. Send your id to the admin:</div>
            <div className="signin-id">
              <span className="mono">{deniedDiscordId}</span>
              <button type="button" className="chip" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>Then sign in again — no need to reload.</div>
          </div>
        )}
        <p className="signin-note">Invite-only. Only your Discord id and name are stored — no message or server access.</p>
      </main>
    </>
  );
}
```

- [ ] **Step 3: Check and commit**

Run: `just check` → clean (the `web/` tsc). Optional visual check: `just serve --hosted --no-open` needs a hosted `.env`; alternatively `cd web && bunx vite build && rm -rf dist` to be sure it bundles.

```bash
git add web/src/styles/tokens.css web/src/styles/app.css web/src/components/SignIn.tsx
git commit -m "feat(web): designed hosted sign-in screen (hero, Discord button, invitation notice)"
```

---

### Task 4: Header user menu (A), quota refresh from 429s, tooltips with the reset time, `/admin` route

**Files:**
- Create: `web/src/components/UserMenu.tsx`
- Modify: `web/src/styles/app.css`, `web/src/components/Header.tsx`, `web/src/components/Detail.tsx`, `web/src/components/DungeonRuns.tsx`, `web/src/components/RunDeepDive.tsx`, `web/src/App.tsx`, `src/web-static.ts`, `test/server.test.ts`

**Interfaces:**
- Consumes: `menuModel`, `pendingText` (Task 1), `quotaTooltip` (Task 1), `api.adminProposals`, failure `quota` (Task 2).
- Produces: `UserMenu({ m: MenuModel, pendingProposals: number | null, onOpen: () => void, onSignOut: () => void })`; `Header` props `menu: MenuModel | null`, `pendingProposals`, `onMenuOpen` (replacing `me`, `quotaLabel`); `DeepdiveActions.quotaTooltip: string`; `RunDeepDive` prop `quotaTooltip: string`.

- [ ] **Step 1: CSS** (append to `web/src/styles/app.css`)

```css
/* --- hosted: user menu (UserMenu.tsx) --- */
.user-menu { position: relative; }
.avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--border); color: var(--text); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: none; object-fit: cover; }
.menu { position: absolute; right: 0; top: 42px; width: 280px; padding: 6px; z-index: 20; box-shadow: 0 4px 16px rgba(0,0,0,.5); display: flex; flex-direction: column; }
.menu-head { display: flex; align-items: center; gap: 10px; padding: 8px 10px 10px; border-bottom: 1px solid var(--border-soft); }
.menu-id { display: flex; flex-direction: column; line-height: 1.3; font-size: 12px; }
.menu-name { font-weight: 600; font-size: 13px; color: var(--text); }
.menu-quota { display: flex; flex-direction: column; gap: 6px; padding: 10px 10px 7px; font-size: 12px; }
.menu-quota-row { display: flex; justify-content: space-between; gap: 8px; }
.menu-quota .dd-bar { display: block; }
.menu-sep { border-top: 1px solid var(--border-soft); margin: 4px 0; }
.menu-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius); background: transparent; color: var(--text-soft); font-size: 13px; text-align: left; cursor: pointer; }
.menu-item:hover { background: var(--inset); color: var(--text); }
.quota-exhausted { font-size: 12px; color: var(--red); }
```

- [ ] **Step 2: `UserMenu.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import type { MenuModel } from "../lib/session.ts";
import { pendingText } from "../lib/session.ts";

interface Props { m: MenuModel; pendingProposals: number | null; onOpen: () => void; onSignOut: () => void }

/** Header trigger "[avatar] Name ▾" and its dropdown: identity, quota line + bar, Admin (admins), Sign out. Design: canvas "Hosted", header A. */
export function UserMenu({ m, pendingProposals, onOpen, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    onOpen();
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- onOpen is read once per opening
  const pending = pendingProposals === null ? null : pendingText(pendingProposals);
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className={"btn" + (open ? " active" : "")} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={m.handle}>
        <Avatar m={m} size={24} />{m.name} <span className="faint" style={{ fontSize: 12 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="menu card" role="menu">
          <div className="menu-head">
            <Avatar m={m} size={32} />
            <div className="menu-id"><span className="menu-name">{m.name}</span><span className="faint">{m.handle}</span></div>
          </div>
          <div className="menu-quota" title="Your share of the shared Warcraft Logs budget">
            <div className="menu-quota-row">
              <span className={"mono " + m.quota.tone}>{m.quota.text}</span>
              {m.quota.sub && <span className="faint">{m.quota.sub}</span>}
            </div>
            {m.quota.pct !== null && <span className="dd-bar" aria-hidden="true"><span style={{ width: `${m.quota.pct}%` }} /></span>}
          </div>
          <div className="menu-sep" />
          {m.isAdmin && <a className="menu-item" href="/admin" role="menuitem">Admin{pending && <span className="faint">· {pending}</span>}</a>}
          <button type="button" className="menu-item" role="menuitem" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function Avatar({ m, size }: { m: MenuModel; size: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="avatar" style={{ width: size, height: size, fontSize: size > 24 ? 13 : 11 }}>{m.initials}</span>;
  return <img className="avatar" src={m.avatarUrl} width={size} height={size} alt="" onError={() => setBroken(true)} />;
}
```

- [ ] **Step 3: `Header.tsx`**

Replace the `me` / `quotaLabel` props with `menu: MenuModel | null; pendingProposals: number | null; onMenuOpen: () => void;` (import `type { MenuModel } from "../lib/session.ts"` and `{ UserMenu } from "./UserMenu.tsx"`; drop the `MeUser` import). Replace the `p.controls.signOut && (…)` block with:

```tsx
        {p.controls.signOut && p.menu && (
          <>
            {p.menu.exhausted && <span className="mono quota-exhausted" title="Your share of the shared Warcraft Logs budget">{p.menu.exhausted}</span>}
            <UserMenu m={p.menu} pendingProposals={p.pendingProposals} onOpen={p.onMenuOpen} onSignOut={p.onSignOut} />
          </>
        )}
```

- [ ] **Step 4: Tooltips**

`Detail.tsx` `DeepdiveActions`: add `/** Tooltip of a disabled Analyze button: "Hourly quota reached · resets in N min". */ quotaTooltip: string;`.
`DungeonRuns.tsx`: both `title={deepdive.canAfford(n) ? undefined : "Hourly quota reached"}` become `title={deepdive.canAfford(n) ? undefined : deepdive.quotaTooltip}`; pass `quotaTooltip={deepdive.quotaTooltip}` to `RunDeepDive`.
`RunDeepDive.tsx`: new prop `quotaTooltip: string`; the Re-analyze button's `title={canAfford ? undefined : "Hourly quota reached"}` becomes `title={canAfford ? undefined : quotaTooltip}`.

- [ ] **Step 5: `App.tsx`**

Imports: `import { menuModel } from "./lib/session.ts";`, `import { canAfford, quotaTooltip } from "./lib/quota.ts";` (drop `quotaLabel`).
In `Main`:

```ts
  const menu = me ? menuModel(me, quota) : null;
  // Admins see "N pending proposals" next to the Admin item; counted when the menu opens (0 WCL pts, SQLite only).
  const [pendingProposals, setPendingProposals] = useState<number | null>(null);
  const onMenuOpen = useCallback(async () => {
    if (me?.role !== "admin") return;
    const r = await api.adminProposals();
    if (r.ok) setPendingProposals(r.proposals.length);
  }, [me]);
```

`runLookup`: `if (!r.ok) { if (r.quota) setQuota(r.quota); setToast(r.error); return; }`. `analyze`: `if (!r.ok) { if (r.quota) setQuota(r.quota); setAnalyzing(null); setToast(r.error); return false; }`.
`deepdiveActions`: add `quotaTooltip: quotaTooltip(quota),`.
`<Header … me={me} … quotaLabel={quotaLabel(quota)} />` → `menu={menu} pendingProposals={pendingProposals} onMenuOpen={() => void onMenuOpen()}`.

- [ ] **Step 6: `/admin` serves the app**

`src/web-static.ts` `ROUTES`: add `"/admin": { pick: (a) => a.index, type: "text/html; charset=utf-8" },` after `"/setup"`. `test/server.test.ts`: the loop `for (const p of ["/", "/setup"])` becomes `["/", "/setup", "/admin"]` and the test name "/, /setup and /admin serve index.html with no-cache". (The Admin item links there; the page itself is issue #8 — until then `/admin` shows the main screen.)

- [ ] **Step 7: Verify and commit**

Run: `just check && bun test` → green. Optional live check with a hosted `.env` (dummy WCL creds, seeded session as in the #6 smoke test): the header shows `[avatar] name ▾`, the menu opens/closes (click outside, Escape), quota line and bar, Admin item for an admin.

```bash
git add web/src/components/UserMenu.tsx web/src/components/Header.tsx web/src/components/Detail.tsx web/src/components/DungeonRuns.tsx web/src/components/RunDeepDive.tsx web/src/App.tsx web/src/styles/app.css src/web-static.ts test/server.test.ts
git commit -m "feat(web): hosted user menu with quota, quota refresh from 429 bodies, reset time in Analyze tooltips"
```

---

### Task 5: Deep-dive panel — "Propose …" wording, origin dots, "Your proposals" footer (C)

**Files:**
- Modify: `web/src/styles/app.css`, `web/src/components/Detail.tsx`, `web/src/components/DungeonRuns.tsx`, `web/src/components/RunDeepDive.tsx`, `web/src/App.tsx`

**Interfaces:**
- Consumes: `proposalMode` (Task 1), `actionLabels`, `originDot`, `originSuffix`, `proposalLines`, `PanelModel.specClass/tableParts` (Task 2), `api.defensives(className, spec)` → `proposals?: ProposalSummary[]`.
- Produces: `DeepdiveActions.mode: ProposalMode`; `RunDeepDive` prop `mode: ProposalMode`.

- [ ] **Step 1: CSS** (append to `web/src/styles/app.css`)

```css
/* --- hosted: origin dots and the proposals footer (RunDeepDive.tsx) --- */
.dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 6px; vertical-align: 1px; }
.dot-shared { background: var(--link); }
.dot-pending { background: var(--yellow); }
.dot-rejected { background: var(--red); }
.dot-approved { background: var(--green); }
```

- [ ] **Step 2: Thread the mode**

`Detail.tsx` `DeepdiveActions`: add `/** Local file edits, member proposals, or admin corrections — decides the panel's wording and footer. */ mode: ProposalMode;` (`import type { ProposalMode } from "../lib/hostedMode.ts"`).
`App.tsx`: `import { …, proposalMode, … } from "./lib/hostedMode.ts";` and in `deepdiveActions`: `mode: proposalMode(status, me),`.
`DungeonRuns.tsx`: pass `mode={deepdive.mode}` to `RunDeepDive`.

- [ ] **Step 3: `RunDeepDive.tsx`**

Imports: `import { useEffect, useState } from "react";`, `import type { ProposalSummary } from "@shared/hosted/defensives.ts";`, `import type { ProposalMode } from "../lib/hostedMode.ts";`, `import { api } from "../api.ts";`, and from `../lib/deepdive.ts`: `actionLabels, costText, originDot, originLabel, originSuffix, panelModel, proposalLines`.

Props: `mode: ProposalMode; quotaTooltip: string;` (the latter from Task 4).

Inside the component:

```tsx
  const labels = actionLabels(mode);
  // The member's own proposals for this spec (hosted only; 0 WCL pts — SQLite). Re-read whenever the analysis object changes
  // (App.reloadActive after a patch hands a fresh `d`).
  const [proposals, setProposals] = useState<ProposalSummary[] | null>(null);
  useEffect(() => {
    if (mode !== "propose") return;
    let alive = true;
    void api.defensives(d.className, d.spec).then((r) => { if (alive && r.ok) setProposals(r.proposals ?? []); });
    return () => { alive = false; };
  }, [mode, d]);
  const lines = mode === "propose" && proposals ? proposalLines(proposals, d.defensives) : [];
```

A tiny helper above the component for the name cell:

```tsx
/** Dot (shared / pending) before the spell name, or the " · override" suffix after it. */
function NameCell({ id, name, origin }: { id: number; name: string; origin: EntryOrigin }) {
  const dot = originDot(origin);
  const suffix = originSuffix(origin);
  return (
    <span>
      {dot && <span className={"dot " + dot} title={originLabel(origin) ?? undefined} />}
      <SpellLink id={id} name={name} />
      {suffix && <span className="faint"> · {suffix}</span>}
    </span>
  );
}
```

(`import type { DefensiveKind, EntryOrigin, OverrideEntry, RunDefensives } from "../types.ts";` — add `EntryOrigin` to the re-exports in `web/src/types.ts` if it is not there: `export type { …, EntryOrigin, … } from "@shared/deepdive/types.ts";`.)

Markup changes, in order:
- Usage row first cell: `<NameCell id={u.id} name={u.name} origin={u.origin} />`.
- Audit add form submit: `{labels.addSubmit(adding.kind)}`; audit actions: `{labels.add(k)}` and `{labels.ignore}`.
- Table head: `<span className="muted">{m.tableParts.map((p, i) => <span key={i}>{i > 0 && " · "}{p.dot && <span className={"dot " + p.dot} />}{p.text}</span>)}</span>` (replaces `{m.tableUsed}`).
- Table rows: first cell `<span><NameCell id={u.id} name={u.name} origin={u.origin} /> <span className="faint">{u.kind} · cd {u.cooldownS} s · {u.durationS} s</span></span>` (the origin suffix moved into `NameCell`); edit form submit `{labels.save}`; actions `{labels.editCd}` / `{labels.remove}`.
- After the table rows (inside the `tableOpen &&` block is wrong — the footer is always visible), append at the end of the panel:

```tsx
      {lines.length > 0 && (
        <>
          <div className="label-caps dd-section">Your proposals · {m.specClass}</div>
          {lines.map((l) => (
            <div key={l.id} className="dd-audit" style={{ fontSize: 12 }}>
              <span><span className={"dot " + l.dot} />{l.what}</span>
              <span className="faint">{l.when}</span>
            </div>
          ))}
        </>
      )}
```

Local mode check: `mode === "local"` → no fetch, `labels` identical to today's strings, dots never render (origins are shipped/override), the table-used line renders the same text (`tableParts` joined with " · " equals `tableUsedText`), the origin suffix " · override" is unchanged.

- [ ] **Step 4: Verify and commit**

Run: `just check && bun test` → green. Live check (hosted `.env` with dummy WCL creds, a seeded member session, a cached analysis — e.g. a saved payload — or at least the labels on any analyzed run): chips read "Propose + major … Propose ignore", table rows "Propose cd / Propose removal", a proposal made from the panel appears at once with a yellow dot and in "Your proposals · Holy Paladin"; an admin session keeps "+ major / Ignore / Edit cd" and gets a blue dot after saving.

```bash
git add web/src/styles/app.css web/src/components/Detail.tsx web/src/components/DungeonRuns.tsx web/src/components/RunDeepDive.tsx web/src/App.tsx web/src/types.ts
git commit -m "feat(web): propose wording, shared/pending dots and the proposals footer in the hosted deep-dive panel"
```

---

### Task 6: Docs and canvas sources

**Files:** `README.md`, `docs/agents/web-front.md`, `AGENTS.md`, `docs/superpowers/specs/2026-09-16-web-front-design.md`, `docs/design/canvas/HostedSignIn.dc.html`, `HostedDenied.dc.html`, `HostedHeader.dc.html`, `HostedPanel.dc.html`, `canvas.json` (already written by the design pass, untracked/modified).

- [ ] **Step 1: README** — "Hosted mode" section:
  - In the **Login** paragraph, "A user who is not invited sees their Discord id on the sign-in page so they can send it to you." → "The sign-in page is a single **Sign in with Discord** button; a user who is not invited comes back to it with an *Invitation required* notice showing their Discord id (with a Copy button) so they can send it to you."
  - In **WCL budget**, replace `The header shows "N pts left this hour"; ` with: `The user menu (avatar · name, top right) shows "N of L pts left this hour" with a bar and the reset time; the header itself only turns red ("quota reached · resets in N min") once nothing is left. Analyze buttons are disabled with that reset time as tooltip when the estimate exceeds what is left; a 429 shows the server's message as a toast and refreshes the numbers. `
  - In **Shared defensives table**, after "marked "pending review"" add ` — in the panel a yellow dot before the entry, a blue one for the approved layer, and a "Your proposals" footer with each decision and the admin's note; the actions read "Propose + major / Propose ignore / Propose cd / Propose removal" for members (admins keep the local wording, their correction is approved on the spot)`.
  - "Anyone who signs in…"-style leftovers: none expected; `grep -n "issue #7" README.md` must return nothing after the edit.

- [ ] **Step 2: `docs/agents/web-front.md`**
  - Rules → **View models** list: add `session.ts` (user menu / quota line), `hostedMode.ts` (controls, `proposalMode`), `quota.ts` (labels, tooltips, 429 bodies).
  - Rules → **Tokens**: mention `--discord` as the only brand colour, sign-in button only.
  - Rules → **Settings** unchanged. Add a bullet **Hosted mode in the front**: "Everything hosted-only is decided by `uiControls(status)` / `proposalMode(status, me)`; local mode must stay pixel-identical (new classes only: `.signin*`, `.user-menu`/`.menu*`, `.avatar`, `.dot*`, `.btn-discord`). `RunDeepDive` is the one component that fetches on its own (`GET /api/defensives` for the member's proposals, 0 WCL pts) — keyed on the analysis object so a patch → `reloadActive` re-reads it."
  - **Design first**: pages list gains `hosted`.
  - **Components map**: `Header` (… , hosted: `UserMenu` — avatar, quota, Admin, Sign out) · `SignIn` (hosted gate) · `RunDeepDive` (… , hosted wording and proposals footer).

- [ ] **Step 3: `AGENTS.md`** roadmap line: "#2–#7 (…, hosted front) are shipped, next is #8 (admin page)". `docs/superpowers/specs/2026-09-16-web-front-design.md` **Status** line: append "; hosted-mode screens (sign-in, user menu, proposal wording) implemented 2026-09-18 — issue #7, canvas page "Hosted"". Routing row: "`GET /`, `GET /setup` and `GET /admin`".

- [ ] **Step 4: Verify and commit**

Run: `just check && bun test` → green. `git status --short` must show only the docs and canvas files (never `biwaasham.json`, `defensives.json`).

```bash
git add README.md docs/agents/web-front.md AGENTS.md docs/superpowers/specs/2026-09-16-web-front-design.md docs/design/canvas/HostedSignIn.dc.html docs/design/canvas/HostedDenied.dc.html docs/design/canvas/HostedHeader.dc.html docs/design/canvas/HostedPanel.dc.html docs/design/canvas/canvas.json docs/superpowers/plans/2026-09-18-hosted-front.md
git commit -m "docs: hosted front (sign-in, user menu, quota UX, proposal wording) and the Hosted canvas page"
```

---

## Self-review

- **Spec coverage** (issue #7): login screen ✓ (Task 3, incl. `?denied=1` id and `?login=failed`); header user menu with avatar, name, quota, Admin, Sign out, local controls hidden ✓ (Task 4; hiding was #2, `uiControls`); quota UX — 429 toast with reset time (server message already says "resets in N min", Task 4 refreshes the numbers from `error: "quota"` bodies), Analyze / Analyze all disabled with a tooltip carrying the reset time ✓ (Task 4); settings sync ✓ already shipped in #4 (documented in Task 6); panel wording, pending mark, rejected note, shared origin ✓ (Tasks 2, 5); English, pure tested view models `session.ts` / `hostedMode.ts` ✓ (Tasks 1, 2); local mode pixel-identical ✓ (new classes only, `mode === "local"` paths keep today's strings; existing tests untouched except the three explicit extensions); manual hosted pass ✓ (Tasks 4, 5 checks; two accounts = the seeded admin + member sessions); canvas mocked first ✓ (done, sources committed in Task 6).
- **Decisions to flag**: **Look up stays enabled** when the quota is exhausted (a cached lookup costs 0 pts and must keep working; the server's 429 says why otherwise) — the canvas showed it dimmed. The "Redirecting to Discord…" state is not implemented (plain link). Admin item links to `/admin`, which serves the app until #8 fills it. The "Your proposals" footer only in `propose` mode (an admin's corrections are all approved, listing them is noise).
- **Placeholder scan**: none.
- **Type consistency**: `MenuModel` (Task 1) used by `Header`/`UserMenu` (Task 4); `ProposalMode` (Task 1) by `actionLabels` (Task 2) and `DeepdiveActions.mode` (Task 5); `quotaTooltip` (Task 1) by `DeepdiveActions.quotaTooltip` (Task 4); `PanelModel.tableParts/specClass` (Task 2) by `RunDeepDive` (Task 5); `ApiResult` failure `quota` (Task 2) by `App` (Task 4); `EntryOrigin` re-export in `web/src/types.ts` (Task 5).
