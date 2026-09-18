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

export const initialsOf = (name: string): string => {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
};

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
