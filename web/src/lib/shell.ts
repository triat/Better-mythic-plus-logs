// The frame around every in-app page (redesign spec decision 1, mockup F-Palette): the sidebar's navigation,
// its Récents list (history) and the account block at the bottom.
import type { T } from "../i18n/t.ts";
import type { HistoryItem } from "../types.ts";
import { candidateHref, type Page, type StatusInfo } from "./hostedMode.ts";
import type { MenuModel } from "./session.ts";

export type NavKey = "home" | "candidate" | "me" | "compare" | "live" | "help";
export type IconName = "home" | "users" | "user" | "compare" | "live" | "help";
export interface NavItem { key: NavKey; href: string; label: string; icon: IconName; active: boolean; count?: number; dot?: "on" | "off" }
export interface RecentRow { key: string; href: string; name: string; verdict: "invite" | "maybe" | "pass" | null; score: string; active: boolean; classId: number }
export interface AccountView { title: string; lines: string[]; local: boolean }

const NAV: readonly { key: NavKey; href: string; icon: IconName }[] = [
  { key: "home", href: "/", icon: "home" },
  { key: "candidate", href: "/candidate", icon: "users" },
  { key: "me", href: "/me", icon: "user" },
  { key: "compare", href: "/compare", icon: "compare" },
  { key: "live", href: "/live", icon: "live" },
  { key: "help", href: "/help", icon: "help" },
];

/** The six navigation links, in order; the candidate count only when there is one, the Live dot always. */
export function navItems(t: T, page: Page, o: { candidates: number; liveOn: boolean }): NavItem[] {
  return NAV.map((n) => ({
    ...n,
    label: t(`shell.nav.${n.key}`),
    active: n.key === page,
    ...(n.key === "candidate" && o.candidates > 0 ? { count: o.candidates } : {}),
    ...(n.key === "live" ? { dot: o.liveOn ? ("on" as const) : ("off" as const) } : {}),
  }));
}

export interface RecentList { rows: RecentRow[]; /** History entries not shown (0 when expanded). */ hidden: number; /** More than `max` entries: the foot toggle shows. */ toggle: boolean }

function recentRow(i: HistoryItem, activeKey: string | null): RecentRow {
  return {
    key: i.key,
    href: candidateHref(i.key),
    name: i.label.split("-")[0] ?? i.label,
    verdict: i.verdict,
    score: i.score === null ? "—" : String(Math.round(i.score)),
    active: i.key === activeKey,
    classId: i.charClass,
  };
}

/** Récents = history, newest first, at most `max` rows; the open profile is active. */
export function recentRows(items: HistoryItem[], activeKey: string | null, max = 8): RecentRow[] {
  return items.slice(0, max).map((i) => recentRow(i, activeKey));
}

/**
 * The sidebar's Récents list: the first `max` entries, plus the active one as an extra row when it sits further down;
 * `expanded` shows the whole history (every entry stays reachable and removable).
 */
export function recentList(items: HistoryItem[], activeKey: string | null, expanded: boolean, max = 8): RecentList {
  const toggle = items.length > max;
  if (expanded || !toggle) return { rows: items.map((i) => recentRow(i, activeKey)), hidden: 0, toggle };
  const rows = recentRows(items, activeKey, max);
  const active = activeKey === null ? -1 : items.findIndex((i) => i.key === activeKey);
  if (active >= max) rows.push(recentRow(items[active]!, activeKey));
  return { rows, hidden: items.length - rows.length, toggle };
}

/** The account block: hosted = the user menu's name + quota line; local = "Local mode", no lines. */
export function accountView(t: T, status: StatusInfo, menu: MenuModel | null): AccountView {
  if (!status.hosted) return { title: t("shell.account.local"), lines: [], local: true };
  return { title: menu?.name ?? "", lines: menu ? [menu.quota.text] : [], local: false };
}
