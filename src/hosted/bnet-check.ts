// The 30-day rule (Battle.net linking spec, decision 6): every round takes the `bnet` characters whose last
// successful check is older than 25 days and asks Blizzard's status endpoint, with the application token, whether
// they still belong to the account. Valid → `verifiedAt` = now. Gone (404, is_valid false, another id) → removed.
// A failure keeps the entry for the next round, until 30 days without a successful check remove it anyway.
// Runs outside any request, so audit rows name the member explicitly. Costs no WCL points.
import type { AuditLog } from "./audit.ts";
import { characterStatus, type BnetAppToken } from "./bnet.ts";
import type { HostedDb } from "./db.ts";
import type { ErrorRing } from "./error-ring.ts";
import { characterKey, type MyCharacter } from "../self/characters.ts";

export const BNET_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const BNET_CHECK_AFTER_MS = 25 * 24 * 60 * 60 * 1000;
export const BNET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** The runtime's first round, after start. */
export const BNET_FIRST_CHECK_MS = 60_000;

export type BnetRemovalReason = "not_found" | "invalid" | "other_id" | "unchecked_30d";
type Outcome = { kind: "valid" } | { kind: "gone"; reason: BnetRemovalReason } | { kind: "failed" };
export interface BnetCheckCounts { checked: number; kept: number; removed: number; failed: number }

type BnetEntry = MyCharacter & { source: "bnet"; bnetId: number; verifiedAt: number };
const isBnet = (c: MyCharacter): c is BnetEntry =>
  c.source === "bnet" && typeof c.bnetId === "number" && typeof c.verifiedAt === "number";
const label = (c: MyCharacter): string => `${c.name}-${c.realm}`;

/**
 * One round. Never throws; returns counts for the log. `checked` counts the due entries; `kept` the ones confirmed,
 * `removed` the ones that left a list, `failed` the ones left for the next round (status failure, or a member
 * whose list could not be written).
 */
export async function checkBnetCharacters(deps: {
  db: HostedDb;
  audit: AuditLog;
  app: BnetAppToken;
  fetchFn: typeof fetch;
  now: number;
  errors?: ErrorRing;
}): Promise<BnetCheckCounts> {
  const { db, audit, app, fetchFn, now } = deps;
  const counts: BnetCheckCounts = { checked: 0, kept: 0, removed: 0, failed: 0 };
  const report = (err: unknown): void => {
    if (deps.errors) deps.errors.push(err, "bnet check", now);
    else console.error(`bnet check: ${err instanceof Error ? err.message : String(err)}`);
  };
  try {
    const due = db.bnet.withBnetCharacters()
      .map((m) => ({ userId: m.userId, entries: m.characters.filter(isBnet).filter((c) => now - c.verifiedAt > BNET_CHECK_AFTER_MS) }))
      .filter((m) => m.entries.length > 0);
    if (due.length === 0) return counts;

    // Asked once, on the first due entry: a failure ends the round (every status call would need it).
    const tok = await app.get(now);
    if (!tok.ok) report(new Error(`application token failed: ${tok.error}`));

    for (const m of due) {
      counts.checked += m.entries.length;
      try {
        const outcomes = new Map<string, Outcome>();
        for (const c of m.entries) {
          let o: Outcome = { kind: "failed" };
          if (tok.ok) {
            const s = await characterStatus(tok.token, c, fetchFn);
            if (s.ok) o = s.outcome === "valid" ? { kind: "valid" } : { kind: "gone", reason: s.reason };
          }
          if (o.kind === "failed" && now - c.verifiedAt > BNET_MAX_AGE_MS) o = { kind: "gone", reason: "unchecked_30d" };
          outcomes.set(`${characterKey(c)}|${c.bnetId}`, o);
        }
        const r = apply(db, m.userId, outcomes, now);
        counts.kept += r.kept;
        counts.removed += r.removed.length;
        counts.failed += r.failed;
        for (const x of r.removed) {
          audit.record("bnet_character_removed", {
            userId: m.userId, target: `user ${m.userId}`, ip: null, at: now, detail: { reason: x.reason }, // no character name: an unlink must leave nothing from Blizzard behind
          });
        }
      } catch (err) {
        counts.failed += m.entries.length;
        report(err);
      }
    }
  } catch (err) {
    report(err);
  }
  return counts;
}

/**
 * Applies a member's outcomes to the list as stored now, not as read before the status calls: the member may have
 * reordered, removed or unlinked meanwhile. Only an entry still there with the same Blizzard id changes; the order
 * and every other entry stay. At most one write.
 */
function apply(
  db: HostedDb,
  userId: number,
  outcomes: Map<string, Outcome>,
  now: number,
): { kept: number; failed: number; removed: Array<{ c: MyCharacter; reason: BnetRemovalReason }> } {
  const list = db.settings.get(userId).characters;
  const next: MyCharacter[] = [];
  const removed: Array<{ c: MyCharacter; reason: BnetRemovalReason }> = [];
  let kept = 0;
  let failed = 0;
  let changed = false;
  for (const c of list) {
    const o = isBnet(c) ? outcomes.get(`${characterKey(c)}|${c.bnetId}`) : undefined;
    if (!o || o.kind === "failed") {
      if (o) failed++;
      next.push(c);
    } else if (o.kind === "valid") {
      kept++;
      changed = true;
      next.push({ ...c, verifiedAt: Math.max(now, c.verifiedAt ?? 0) });
    } else {
      changed = true;
      removed.push({ c, reason: o.reason });
    }
  }
  if (changed) db.settings.update(userId, { characters: next }, now);
  if (removed.length > 0) db.bnet.removed.add(userId, removed.map((x) => label(x.c)));
  return { kept, failed, removed };
}
