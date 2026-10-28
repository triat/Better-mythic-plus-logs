// Umami analytics (spec docs/superpowers/specs/2026-10-28-umami-analytics-design.md): what the tracker is told and the
// closed list of what it may send. Pure; `web/src/analytics.ts` loads the script and calls Umami.
import type { Page } from "./hostedMode.ts";

/** `GET /api/status`'s `analytics` (hosted, configured): the Umami origin and the website's id. */
export interface AnalyticsConfig { url: string; websiteId: string }

/** The events and the properties each may carry; nothing else ever reaches Umami. */
export const ANALYTICS_EVENTS = {
  sign_in_click: [],
  lookup: ["source"],
  compare: ["count"],
  deepdive: [],
  season_sync: [],
  live_connect: [],
  wcl_client_set: [],
  bnet_link: [],
} as const satisfies Record<string, readonly string[]>;
export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export interface AnalyticsProps { source?: "fetched" | "cached"; count?: number }

const PAGE_PATH: Record<Page, string> = {
  home: "/", candidate: "/candidate", compare: "/compare", live: "/live", admin: "/admin",
  settings: "/settings", privacy: "/privacy", help: "/help", me: "/me",
};

/** The URL a page view is sent with: the page's kind, never its query; a signed-out visitor's home is the landing. */
export const pagePath = (page: Page, signedOut: boolean): string => (signedOut && page === "home" ? "/landing" : PAGE_PATH[page]);

/** The event's properties reduced to the allowed ones with allowed values; undefined when none is left. */
export function eventProps(name: AnalyticsEvent, props: AnalyticsProps = {}): Record<string, string | number> | undefined {
  const allowed: readonly string[] = ANALYTICS_EVENTS[name];
  const out: Record<string, string | number> = {};
  if (allowed.includes("source") && (props.source === "fetched" || props.source === "cached")) out.source = props.source;
  if (allowed.includes("count") && Number.isInteger(props.count) && props.count! >= 2 && props.count! <= 5) out.count = props.count!;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The tracker's `<script>` attributes: no automatic page views (one is sent by hand per page load), the query and the
 * hash never sent (they hold character names), the browser's Do Not Track obeyed, and only this host counted.
 */
export function scriptAttributes(cfg: AnalyticsConfig, host: string): Record<string, string> {
  return {
    src: `${cfg.url}/script.js`,
    "data-website-id": cfg.websiteId,
    "data-auto-track": "false",
    "data-exclude-search": "true",
    "data-exclude-hash": "true",
    "data-do-not-track": "true",
    "data-domains": host,
  };
}
