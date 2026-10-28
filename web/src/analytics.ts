// Loads Umami's tracker once per page load when the instance has one (hosted, `GET /api/status`'s `analytics`), sends
// the page view and the events of `lib/analytics.ts`. Spec docs/superpowers/specs/2026-10-28-umami-analytics-design.md.
// Never throws, never waits: a blocked or failed script only means nothing is counted.
import { type AnalyticsConfig, type AnalyticsEvent, type AnalyticsProps, eventProps, scriptAttributes } from "./lib/analytics.ts";

interface Umami { track: (arg?: string | ((p: Record<string, unknown>) => Record<string, unknown>), data?: Record<string, string | number>) => void }

let started = false;
let pending: (() => void)[] = [];
const umami = (): Umami | undefined => (window as unknown as { umami?: Umami }).umami;

/** Adds the tracker and sends one page view with `path` (`pagePath`); a no-op without config or when already started. */
export function startAnalytics(cfg: AnalyticsConfig | null | undefined, path: string): void {
  if (!cfg || started) return;
  started = true;
  try {
    const s = document.createElement("script");
    for (const [k, v] of Object.entries(scriptAttributes(cfg, location.hostname))) s.setAttribute(k, v);
    s.defer = true;
    s.onload = () => {
      umami()?.track((p) => ({ ...p, url: path }));
      for (const f of pending) f();
      pending = [];
    };
    document.head.appendChild(s);
  } catch {
    // Never let analytics break the page.
  }
}

/** One event of the closed list; queued until the tracker has loaded, dropped when there is none. */
export function analyticsEvent(name: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!started) return;
  const send = () => { try { umami()?.track(name, eventProps(name, props)); } catch { /* ignored */ } };
  if (umami()) send(); else if (pending.length < 20) pending.push(send);
}
