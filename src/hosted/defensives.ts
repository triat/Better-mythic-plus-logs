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
  /** Runs `fn` inside a SQLite transaction; a thrown error rolls back every write `fn` made. */
  transaction<T>(fn: () => T): T;
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
    transaction: (fn) => db.transaction(fn)(),
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
  let key: string;
  let validated: OverrideEntry;
  try {
    key = specKey(className, spec);
    validated = validateOverride({ [key]: [patch] })[key]![0]!;
    const mine = tablesFor(repo, user.id);
    applyPatch(mine.override, key, validated, specDefensives(mine.shipped, mine.override, className, spec)); // completeness check only
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e) };
  }
  if (user.role === "admin") {
    const proposal = repo.transaction(() => {
      const shared = repo.shared();
      const entry = mergeEntry(shared[key] ?? [], validated).find((e) => e.id === validated.id)!;
      repo.upsertShared(key, entry, user.id, now);
      return repo.insertProposal({ key, spellId: validated.id, patch: validated, proposedBy: user.id, createdAt: now, status: "approved", decidedBy: user.id, decidedAt: now, note: null });
    });
    return { ok: true, proposal, tables: tablesFor(repo, user.id) };
  }
  const proposal = repo.transaction(() => {
    const existing = repo.pendingOf(user.id).find((p) => p.key === key && p.spellId === validated.id);
    if (existing) {
      const merged = mergeEntry([existing.patch], validated).find((e) => e.id === validated.id)!;
      repo.updatePatch(existing.id, merged);
      return repo.proposalById(existing.id)!;
    }
    return repo.insertProposal({ key, spellId: validated.id, patch: validated, proposedBy: user.id, createdAt: now, status: "pending", decidedBy: null, decidedAt: null, note: null });
  });
  return { ok: true, proposal, tables: tablesFor(repo, user.id) };
}

/** Approves (writes the shared layer) or rejects a pending proposal; null when it is not pending. */
export function decide(repo: DefensivesRepo, id: number, admin: { id: number }, status: "approved" | "rejected", note: string | null, now: number): ProposalRow | null {
  const p = repo.proposalById(id);
  if (!p || p.status !== "pending") return null;
  // markDecided runs first: a row that turns out not to be pending any more never touches
  // defensives_shared, and a throw from upsertShared rolls back the decision too.
  const decided = repo.transaction(() => {
    if (!repo.markDecided(id, status, admin.id, note, now)) return false;
    if (status === "approved") {
      const shared = repo.shared();
      const entry = mergeEntry(shared[p.key] ?? [], p.patch).find((e) => e.id === p.spellId)!;
      repo.upsertShared(p.key, entry, admin.id, now);
    }
    return true;
  });
  if (!decided) return null;
  return repo.proposalById(id);
}
