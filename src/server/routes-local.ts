// src/server/routes-local.ts
// Local single-user routes: they touch the machine (write .env, read the clipboard, exit the
// process) and are therefore never registered in hosted mode.
import { config } from "../config.ts";
import { closeStore, getStore } from "../signals/store.ts";
import { writeCredentials } from "../setup.ts";
import { resetAuthCache } from "../wcl/auth.ts";
import { jsonResponse } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { SETUP_BODY, WATCH_BODY, parseBody } from "./validate.ts";
import { startWatcher, stopWatcher, watcherStatus } from "./watcher.ts";

async function handleSetup(req: Request): Promise<Response> {
  const b = await parseBody(req, SETUP_BODY);
  if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
  try {
    const envPath = await writeCredentials(b.value.clientId, b.value.clientSecret);
    resetAuthCache();
    return jsonResponse({ ok: true, envPath });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleWatchStart(req: Request): Promise<Response> {
  const b = await parseBody(req, WATCH_BODY, {});
  if (!b.ok) return jsonResponse({ ok: false, error: b.error }, 400);
  const opts = { level: b.value.level ?? null, spec: b.value.spec || null, metric: b.value.metric ?? null, region: b.value.region ?? config.region };
  try {
    await startWatcher(opts);
    return jsonResponse({ ok: true, active: true, opts });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/** How many characters the search suggestions get from the cache (newest first); the field filters them in the page. */
export const KNOWN_CHARACTERS_LIMIT = 500;

export function localRoutes(): Route[] {
  return [
    route("POST", "/api/setup", handleSetup),
    route("POST", "/api/watch/start", handleWatchStart),
    route("POST", "/api/watch/stop", () => { stopWatcher(); return jsonResponse({ ok: true, active: false }); }),
    route("GET", "/api/watch/status", () => jsonResponse({ ok: true, ...watcherStatus() })),
    // The search suggestions' local source: SQLite only, 0 WCL points. Never hosted: the cache is shared by every
    // member there, so it would show what the others looked up.
    route("GET", "/api/known-characters", async () =>
      jsonResponse({ ok: true, characters: (await getStore()).knownCharacters(KNOWN_CHARACTERS_LIMIT) })),
    route("POST", "/api/quit", () => {
      stopWatcher();
      queueMicrotask(() => setTimeout(() => { closeStore(); process.exit(0); }, 120));
      return jsonResponse({ ok: true });
    }),
  ];
}
