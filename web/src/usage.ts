// The app's one usage tracker (spec 2026-10-09-feature-usage-dashboard-design.md, decision 5): `track`
// is safe to call from any component; it only counts once `startUsageTracking(true)` ran (hosted mode,
// signed in). Batches go to `POST /api/usage/events`; a failed send is dropped, never retried.
import { api } from "./api.ts";
import { FLUSH_EVERY_MS, createTracker } from "./lib/usage.ts";
import type { UiEvent } from "./types.ts";

const tracker = createTracker((events, keepalive) => { void api.usage(events, keepalive); });

export const track = (event: UiEvent): void => tracker.track(event);

/** Turns tracking on (hosted + signed in) with its timer and the flush on hide; returns the teardown. */
export function startUsageTracking(enabled: boolean): () => void {
  tracker.setEnabled(enabled);
  if (!enabled) return () => {};
  const timer = setInterval(() => tracker.flush(false), FLUSH_EVERY_MS);
  const onVisibility = (): void => { if (document.visibilityState === "hidden") tracker.flush(true); };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    tracker.setEnabled(false);
  };
}
