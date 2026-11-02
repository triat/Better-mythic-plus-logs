// Members' feedback (canvas "bmpl · Retours"): a verdict judged fair or not, from the Synthèse card, and a free message
// from the account menu or the one-time invitation. Stored per member, deleted with the account (ON DELETE CASCADE),
// read by the admins on the admin page.
import type { Database } from "bun:sqlite";

export const FEEDBACK_KINDS = ["idea", "problem", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const VERDICT_RATINGS = ["fair", "unfair"] as const;
export type VerdictRating = (typeof VERDICT_RATINGS)[number];
export const VERDICT_REASONS = ["generous", "harsh", "missing_runs", "other"] as const;
export type VerdictReason = (typeof VERDICT_REASONS)[number];
export const FEEDBACK_MESSAGE_MAX = 1000;

/** The verdict a member judged: the character (as the store keys it), the key level and what bmpl said. */
export interface VerdictTarget { region: string; realm: string; name: string; level: number }
export interface VerdictContext { label: string; verdict: string | null; score: number | null }

export interface VerdictFeedback { rating: VerdictRating; reason: VerdictReason | null; message: string | null; at: number }

export interface FeedbackRow {
  id: number;
  at: number;
  kind: FeedbackKind | "verdict";
  /** The member; their Discord name only when they agreed to be answered (`replyOk`), else null. */
  userId: number;
  username: string | null;
  discordId: string | null;
  replyOk: boolean;
  message: string | null;
  rating: VerdictRating | null;
  reason: VerdictReason | null;
  /** verdict: the character label, bmpl's verdict and score at the level; general: the page and version. */
  context: Record<string, unknown> | null;
  target: string | null;
  readAt: number | null;
}

export interface FeedbackRepo {
  addGeneral(userId: number, at: number, f: { kind: FeedbackKind; message: string; replyOk: boolean; page: string | null; version: string | null }): number;
  /** One per member, character and level: a later answer replaces the earlier one. */
  setVerdict(userId: number, at: number, target: VerdictTarget, f: { rating: VerdictRating; reason: VerdictReason | null; message: string | null; context: VerdictContext }): void;
  verdictOf(userId: number, target: VerdictTarget): VerdictFeedback | null;
  /** Whether the member already sent a general message (the invitation then never shows). */
  hasGeneral(userId: number): boolean;
  list(limit: number): FeedbackRow[];
  unread(): number;
  markRead(id: number, at: number): boolean;
}

const targetKey = (t: VerdictTarget): string => `${t.region.toLowerCase()}|${t.realm.toLowerCase()}|${t.name.toLowerCase()}|${t.level}`;

interface Raw {
  id: number; at: number; kind: string; user_id: number; username: string; discord_id: string; reply_ok: number; message: string | null;
  rating: string | null; reason: string | null; context: string | null; target: string | null; read_at: number | null;
}

export function openFeedback(db: Database): FeedbackRepo {
  const insert = db.query<{ id: number }, [number, number, string, string, number, string]>(
    "INSERT INTO feedback (user_id, at, kind, message, reply_ok, context) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
  );
  const upsertVerdict = db.query(
    "INSERT INTO feedback (user_id, at, kind, target, rating, reason, message, reply_ok, context) VALUES (?, ?, 'verdict', ?, ?, ?, ?, 0, ?) " +
    "ON CONFLICT(user_id, target) WHERE target IS NOT NULL DO UPDATE SET at = excluded.at, rating = excluded.rating, reason = excluded.reason, " +
    "message = excluded.message, context = excluded.context, read_at = NULL",
  );
  const verdictQ = db.query<{ rating: string; reason: string | null; message: string | null; at: number }, [number, string]>(
    "SELECT rating, reason, message, at FROM feedback WHERE user_id = ? AND target = ?",
  );
  const generalQ = db.query<{ one: number }, [number]>("SELECT 1 AS one FROM feedback WHERE user_id = ? AND kind <> 'verdict' LIMIT 1");
  const listQ = db.query<Raw, [number]>(
    "SELECT f.id, f.at, f.kind, f.user_id, u.username, u.discord_id, f.reply_ok, f.message, f.rating, f.reason, f.context, f.target, f.read_at " +
    "FROM feedback f JOIN users u ON u.id = f.user_id ORDER BY f.at DESC, f.id DESC LIMIT ?",
  );
  const unreadQ = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM feedback WHERE read_at IS NULL");
  const readQ = db.query("UPDATE feedback SET read_at = ? WHERE id = ? AND read_at IS NULL");
  const changes = (): number => Number(db.query<{ n: number }, []>("SELECT changes() AS n").get()!.n);
  const parse = (s: string | null): Record<string, unknown> | null => {
    if (!s) return null;
    try { const v = JSON.parse(s) as unknown; return v && typeof v === "object" ? (v as Record<string, unknown>) : null; } catch { return null; }
  };
  return {
    addGeneral(userId, at, f) {
      return insert.get(userId, at, f.kind, f.message, f.replyOk ? 1 : 0, JSON.stringify({ page: f.page, version: f.version }))!.id;
    },
    setVerdict(userId, at, target, f) {
      upsertVerdict.run(userId, at, targetKey(target), f.rating, f.reason, f.message, JSON.stringify(f.context));
    },
    verdictOf(userId, target) {
      const r = verdictQ.get(userId, targetKey(target));
      return r ? { rating: r.rating as VerdictRating, reason: r.reason as VerdictReason | null, message: r.message, at: r.at } : null;
    },
    hasGeneral: (userId) => generalQ.get(userId) !== null,
    list(limit) {
      return listQ.all(limit).map((r) => ({
        id: r.id, at: r.at, kind: r.kind as FeedbackRow["kind"], userId: r.user_id,
        username: r.reply_ok ? r.username : null, discordId: r.reply_ok ? r.discord_id : null, replyOk: r.reply_ok === 1,
        message: r.message, rating: r.rating as VerdictRating | null, reason: r.reason as VerdictReason | null,
        context: parse(r.context), target: r.target, readAt: r.read_at,
      }));
    },
    unread: () => unreadQ.get()!.n,
    markRead(id, at) { readQ.run(at, id); return changes() > 0; },
  };
}
