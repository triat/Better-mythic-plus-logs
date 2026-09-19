// The signed-in member as the hosted header shows them: trigger label, menu contents, quota line.
import type { MeUser, QuotaInfo } from "../api.ts";
import type { OwnClientView } from "../types.ts";
import { fmtPts } from "./format.ts";
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
  /** The member runs lookups through their own WCL client: the quota line is that client's counter (issue #11). */
  ownClient: boolean;
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

/** "Your WCL client · 1 412 / 3 600 pts" from the client's last rateLimitData; the tone follows what is left, as `quotaLine` does. */
export function ownClientLine(c: OwnClientView): QuotaLine {
  const s = c.snapshot;
  if (!s) return { text: "Your WCL client · no request yet", sub: null, pct: null, tone: "" };
  const left = Math.max(0, s.limitPerHour - s.pointsSpentThisHour);
  return {
    text: `Your WCL client · ${fmtPts(s.pointsSpentThisHour)} / ${fmtPts(s.limitPerHour)} pts`,
    sub: resetText(s.pointsResetIn),
    pct: s.limitPerHour > 0 ? Math.round((left / s.limitPerHour) * 100) : 0,
    tone: left < 1 ? "tone-bad" : left < 100 ? "tone-warn" : "",
  };
}

export const initialsOf = (name: string): string => {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
};

/** "N pending proposal(s)" for the Admin menu item; null when there is nothing to review. */
export const pendingText = (n: number): string | null => (n > 0 ? `${n} pending proposal${n === 1 ? "" : "s"}` : null);

/** With an own client the shared quota is irrelevant: its counter replaces the line and nothing is ever "exhausted". */
export function menuModel(me: MeUser, q: QuotaInfo | null, ownClient: OwnClientView | null = null): MenuModel {
  const isAdmin = me.role === "admin";
  const name = me.globalName ?? me.username;
  const left = pointsLeft(q);
  return {
    name,
    handle: `@${me.username}${isAdmin ? " · admin" : ""}`,
    initials: initialsOf(name),
    avatarUrl: me.avatarUrl,
    isAdmin,
    quota: ownClient ? ownClientLine(ownClient) : quotaLine(q, isAdmin),
    exhausted: !ownClient && left !== null && left < 1 ? quotaLabel(q) : null,
    ownClient: ownClient !== null,
  };
}
