// src/server/routes-shared.ts
// Routes that exist in both modes. Local-only routes live in routes-local.ts.
import pkg from "../../package.json";
import { hasCredentials } from "../config.ts";
import type { HostedRuntime } from "../hosted/runtime.ts";
import type { LookupPayload } from "../lookup.ts";
import { handleDeepdive, handleDefensivesGet, handleDefensivesPost, withCachedAnalyses } from "./deepdive.ts";
import { jsonResponse } from "./http.ts";
import { handleLookup, historyOf, historySummary } from "./lookup.ts";
import { prefixRoute, route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { eventsResponse } from "./sse.ts";
import { getStore } from "../signals/store.ts";
import { watcherStatus } from "./watcher.ts";

export interface SharedContext { hosted: boolean; envPath: string; runtime: HostedRuntime | null }

/** null when the trailing segment is not valid percent-encoding (decodeURIComponent throws). */
export const historyKey = (url: URL): string | null => {
  try {
    return decodeURIComponent(url.pathname.slice("/api/history/".length));
  } catch {
    return null;
  }
};

async function handleHealth(): Promise<Response> {
  const base = { version: pkg.version as string, uptimeS: Math.round(process.uptime()) };
  try {
    (await getStore())._db.query("SELECT 1").get();
    return jsonResponse({ ok: true, ...base, db: "ok" });
  } catch {
    return jsonResponse({ ok: false, ...base, db: "error" }, 503);
  }
}

export function sharedRoutes(ctx: SharedContext): Route[] {
  return [
    route("POST", "/api/lookup", (req, _url, rc) => handleLookup(req, rc, ctx.runtime)),
    route("POST", "/api/deepdive", (req, _url, ctx) => handleDeepdive(req, ctx)),
    route("GET", "/api/defensives", (_req, url) => handleDefensivesGet(url, ctx.hosted)),
    route("POST", "/api/defensives", (req) => handleDefensivesPost(req, ctx.hosted)),
    route("GET", "/api/history", (_req, _url, rc) => jsonResponse({ ok: true, items: historyOf(rc).list().map(historySummary) })),
    route("DELETE", "/api/history", (_req, _url, rc) => { historyOf(rc).clear(); return jsonResponse({ ok: true }); }),
    prefixRoute("GET", "/api/history/", async (_req, url, rc) => {
      const key = historyKey(url);
      if (key === null) return jsonResponse({ ok: false, error: "Invalid history key" }, 400);
      const entry = historyOf(rc).get(key);
      if (!entry) return jsonResponse({ ok: false, error: "Not in history" }, 404);
      // Hosted payloads are stored raw: attach today's cached analyses on the way out (0 pts).
      const result = rc.hosted ? await withCachedAnalyses(entry.result as LookupPayload) : entry.result;
      return jsonResponse({ ok: true, result, key, fromCache: true });
    }),
    prefixRoute("DELETE", "/api/history/", (_req, url, rc) => {
      const key = historyKey(url);
      if (key === null) return jsonResponse({ ok: false, error: "Invalid history key" }, 400);
      return jsonResponse({ ok: historyOf(rc).remove(key) });
    }),
    // In hosted mode the watcher never runs; the initial status is simply "inactive" and the stream is the member's own.
    route("GET", "/api/events", (_req, _url, rc) => eventsResponse({ event: "status", data: watcherStatus() }, rc.user?.id ?? null)),
    route("GET", "/api/health", () => handleHealth(), "public"),
    route("GET", "/api/status", () =>
      ctx.hosted
        ? jsonResponse({ ok: true, hosted: true, hasCredentials: hasCredentials() })
        : jsonResponse({ ok: true, hosted: false, hasCredentials: hasCredentials(), envPath: ctx.envPath }), "public"),
  ];
}
