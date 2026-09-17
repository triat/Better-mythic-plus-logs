// src/server/routes-shared.ts
// Routes that exist in both modes. Local-only routes live in routes-local.ts.
import { hasCredentials } from "../config.ts";
import { handleDeepdive, handleDefensivesGet, handleDefensivesPost } from "./deepdive.ts";
import { jsonResponse } from "./http.ts";
import { handleLookup, history, historySummary } from "./lookup.ts";
import { prefixRoute, route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { eventsResponse } from "./sse.ts";
import { watcherStatus } from "./watcher.ts";

export interface SharedContext { hosted: boolean; envPath: string }

const historyKey = (url: URL) => decodeURIComponent(url.pathname.slice("/api/history/".length));

export function sharedRoutes(ctx: SharedContext): Route[] {
  return [
    route("POST", "/api/lookup", (req) => handleLookup(req)),
    route("POST", "/api/deepdive", (req) => handleDeepdive(req)),
    route("GET", "/api/defensives", (_req, url) => handleDefensivesGet(url)),
    route("POST", "/api/defensives", (req) => handleDefensivesPost(req)),
    route("GET", "/api/history", () => jsonResponse({ ok: true, items: history.list().map(historySummary) })),
    route("DELETE", "/api/history", () => { history.clear(); return jsonResponse({ ok: true }); }),
    prefixRoute("GET", "/api/history/", (_req, url) => {
      const key = historyKey(url);
      const entry = history.get(key);
      if (!entry) return jsonResponse({ ok: false, error: "Not in history" }, 404);
      return jsonResponse({ ok: true, result: entry.result, key, fromCache: true });
    }),
    prefixRoute("DELETE", "/api/history/", (_req, url) => jsonResponse({ ok: history.remove(historyKey(url)) })),
    // In hosted mode the watcher never runs; the initial status is simply "inactive".
    route("GET", "/api/events", () => eventsResponse({ event: "status", data: watcherStatus() })),
    route("GET", "/api/status", () =>
      ctx.hosted
        ? jsonResponse({ ok: true, hosted: true, hasCredentials: hasCredentials() })
        : jsonResponse({ ok: true, hosted: false, hasCredentials: hasCredentials(), envPath: ctx.envPath })),
  ];
}
