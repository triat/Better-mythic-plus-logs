// The signed-in member as the hosted header shows them: trigger label, menu contents, quota line.
import type { MeUser, QuotaInfo } from "../api.ts";
import type { T } from "../i18n/t.ts";
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
  /** Under the quota bar while on the shared budget (not an admin, no usable own client): the /help guide to an own client. */
  guideLink: { label: string; href: string } | null;
}

/** The href to the "use your own client" guide; the visible label is `t("header.quota.guide")` (in the menu) or
 * `t("errors.ownClientAction")` (in a quota/budget toast). */
export const OWN_CLIENT_GUIDE = { href: "/help#wcl-client" } as const;

const resetText = (t: T, s: number): string => t("header.quota.resets", { min: Math.max(1, Math.ceil(s / 60)) });

/** Under 30 pts (about one uncached lookup) the line turns yellow; at 0 red. Admins have no limit. */
export function quotaLine(t: T, q: QuotaInfo | null, isAdmin: boolean): QuotaLine {
  const left = pointsLeft(q);
  if (q === null || left === null || q.limit === null) return { text: isAdmin ? t("header.quota.unlimited") : t("header.quota.none"), sub: null, pct: null, tone: "" };
  const pct = q.limit > 0 ? Math.round((left / q.limit) * 100) : 0;
  return {
    text: t("header.quota.left", { left: Math.floor(left), limit: q.limit }),
    sub: resetText(t, q.resetInS),
    pct,
    tone: left < 1 ? "tone-bad" : left < 30 ? "tone-warn" : "",
  };
}

/** "Your WCL client · 1 412 / 3 600 pts" from the client's last rateLimitData; the tone follows what is left, as `quotaLine` does. */
export function ownClientLine(t: T, c: OwnClientView): QuotaLine {
  const s = c.snapshot;
  if (!s) return { text: t("header.quota.ownNoRequest"), sub: null, pct: null, tone: "" };
  const left = Math.max(0, s.limitPerHour - s.pointsSpentThisHour);
  return {
    text: t("header.quota.own", { spent: fmtPts(s.pointsSpentThisHour), limit: fmtPts(s.limitPerHour) }),
    sub: resetText(t, s.pointsResetIn),
    pct: s.limitPerHour > 0 ? Math.round((left / s.limitPerHour) * 100) : 0,
    tone: left < 1 ? "tone-bad" : left < 100 ? "tone-warn" : "",
  };
}

export const initialsOf = (name: string): string => {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
};

/** "N pending proposal(s)" for the Admin menu item; null when there is nothing to review. */
export const pendingText = (t: T, n: number): string | null => (n > 0 ? t("header.quota.pending", { count: n }) : null);

/** The stored secret no longer decrypts (instance key rotated): requests silently use the shared client, so say so. */
const staleClientLine = (t: T): QuotaLine => ({ text: t("header.quota.stale"), sub: t("header.quota.staleSub"), pct: null, tone: "tone-warn" });

/**
 * With a usable own client the shared quota is irrelevant: its counter replaces the line and nothing is ever "exhausted".
 * An unusable one (see `OwnClientView.usable`) warns and keeps the shared-quota behaviour, since that is what gets charged.
 */
export function menuModel(t: T, me: MeUser, q: QuotaInfo | null, ownClient: OwnClientView | null = null): MenuModel {
  const isAdmin = me.role === "admin";
  const name = me.globalName ?? me.username;
  const left = pointsLeft(q);
  const usable = ownClient !== null && ownClient.usable;
  const stale = ownClient !== null && !ownClient.usable;
  return {
    name,
    handle: `@${me.username}${isAdmin ? t("header.quota.adminHandle") : ""}`,
    initials: initialsOf(name),
    avatarUrl: me.avatarUrl,
    isAdmin,
    quota: usable ? ownClientLine(t, ownClient) : stale ? staleClientLine(t) : quotaLine(t, q, isAdmin),
    exhausted: !usable && left !== null && left < 1 ? quotaLabel(t, q) : null,
    ownClient: usable,
    guideLink: !usable && !isAdmin && q !== null && q.limit !== null ? { label: t("header.quota.guide"), href: OWN_CLIENT_GUIDE.href } : null,
  };
}
