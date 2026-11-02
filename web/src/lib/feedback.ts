// Members' feedback (canvas "bmpl · Retours"): what a verdict's answer is about, and when the one-time invitation shows.
// Pure: components and web/src/feedback.tsx call it.
import type { T } from "../i18n/t.ts";
import { realmName } from "./format.ts";
import type { FeedbackRow, LookupPayload, VerdictReason, VerdictTarget } from "../types.ts";

export const FEEDBACK_KINDS = ["idea", "problem", "other"] as const;
export const VERDICT_REASONS: readonly VerdictReason[] = ["generous", "harsh", "missing_runs", "other"];
export const FEEDBACK_MESSAGE_MAX = 1000;

export interface VerdictSubject {
  target: VerdictTarget;
  label: string;
  verdict: "invite" | "maybe" | "pass";
  score: number | null;
}

/** The character, key level and verdict a Synthèse answer is about; null when there is no verdict to judge. */
export function verdictSubject(p: LookupPayload): VerdictSubject | null {
  const ev = p.evaluation;
  if (ev.verdict === "insufficient") return null;
  const c = p.character as { name: string; realmSlug: string; region: string };
  return {
    target: { region: c.region, realm: c.realmSlug.toLowerCase(), name: c.name.toLowerCase(), level: ev.targetLevel },
    label: `${c.name}-${realmName(c.realmSlug)}`,
    verdict: ev.verdict,
    score: ev.global === null ? null : Math.round(ev.global),
  };
}

/**
 * The invitation (canvas Form, right): after the 5th successful lookup in this browser, at most twice in all.
 * "Later" waits 14 days and 10 more lookups; the cross, or any message sent, stops it for good.
 */
export interface PromptState { lookups: number; shown: number; nextAt: number | null; nextLookups: number; stopped: boolean }
export const PROMPT_FIRST_LOOKUPS = 5;
export const PROMPT_MAX = 2;
export const PROMPT_LATER_DAYS = 14;
export const PROMPT_LATER_LOOKUPS = 10;
export const PROMPT_KEY = "bmpl.feedbackPrompt";
const DAY = 86_400_000;
export const NEW_PROMPT: PromptState = { lookups: 0, shown: 0, nextAt: null, nextLookups: PROMPT_FIRST_LOOKUPS, stopped: false };

/** The stored state, or a new one when absent or unreadable. */
export function parsePrompt(raw: string | null): PromptState {
  if (!raw) return NEW_PROMPT;
  try {
    const v = JSON.parse(raw) as Partial<PromptState>;
    const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : d);
    return {
      lookups: n(v.lookups, 0), shown: n(v.shown, 0), nextAt: typeof v.nextAt === "number" ? v.nextAt : null,
      nextLookups: n(v.nextLookups, PROMPT_FIRST_LOOKUPS), stopped: v.stopped === true,
    };
  } catch {
    return NEW_PROMPT;
  }
}

export const promptAfterLookup = (s: PromptState): PromptState => ({ ...s, lookups: s.lookups + 1 });

/** Whether the card shows now; never once the member sent a message from anywhere (`sentGeneral`). */
export const promptDue = (s: PromptState, now: number, sentGeneral: boolean): boolean =>
  !s.stopped && !sentGeneral && s.shown < PROMPT_MAX && s.lookups >= s.nextLookups && (s.nextAt === null || now >= s.nextAt);

export const promptLater = (s: PromptState, now: number): PromptState =>
  ({ ...s, shown: s.shown + 1, nextAt: now + PROMPT_LATER_DAYS * DAY, nextLookups: s.lookups + PROMPT_LATER_LOOKUPS });

export const promptStop = (s: PromptState): PromptState => ({ ...s, stopped: true });

/** One admin row: the kind, who (only when they agreed to be answered), the message or the verdict judged. */
export interface FeedbackLine { id: number; kind: string; at: number; unread: boolean; who: string; context: string | null; message: string | null }
export function feedbackLine(t: T, r: FeedbackRow): FeedbackLine {
  const c = r.context ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let context: string | null = null;
  if (r.kind === "verdict") {
    const level = r.target?.split("|")[3] ?? "?";
    const verdict = str(c.verdict).toUpperCase() || "—";
    const score = typeof c.score === "number" ? ` ${c.score}` : "";
    const judgement = r.rating === "fair" ? t("admin.feedback.fair") : t(`feedback.verdict.reasonDone.${r.reason ?? "other"}`);
    context = t("admin.feedback.verdictLine", { label: str(c.label), level, verdict, score, judgement });
  }
  return {
    id: r.id, kind: t(`admin.feedback.kind.${r.kind}`), at: r.at, unread: r.readAt === null,
    who: r.username ? t("admin.feedback.replyTo", { name: r.username }) : t("admin.feedback.noReply"),
    context, message: r.message,
  };
}
