// src/server/routes-local.ts
// Local single-user routes: they touch the machine (write .env, read the clipboard, exit the
// process) and are therefore never registered in hosted mode.
import { closeStore } from "../signals/store.ts";
import { writeCredentials } from "../setup.ts";
import { resetAuthCache } from "../wcl/auth.ts";
import { jsonResponse, parseMetric, readJson } from "./http.ts";
import { route } from "./routes.ts";
import type { Route } from "./routes.ts";
import { startWatcher, stopWatcher, watcherStatus } from "./watcher.ts";

interface SetupRequest { clientId?: string; clientSecret?: string }
interface WatchStartBody { level?: number | string | null; spec?: string | null; metric?: string | null }

async function handleSetup(req: Request): Promise<Response> {
  const body = await readJson<SetupRequest>(req);
  if (!body) return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  if (!body.clientId || !body.clientSecret) return jsonResponse({ ok: false, error: "Both clientId and clientSecret are required." }, 400);
  try {
    const envPath = await writeCredentials(body.clientId, body.clientSecret);
    resetAuthCache();
    return jsonResponse({ ok: true, envPath });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleWatchStart(req: Request): Promise<Response> {
  const body = (await readJson<WatchStartBody>(req)) ?? {};
  let level: number | null = null;
  if (body.level !== undefined && body.level !== null && body.level !== "") {
    const n = Number.parseInt(String(body.level), 10);
    if (Number.isFinite(n) && n >= 2) level = n;
  }
  const opts = { level, spec: body.spec && body.spec.trim() ? body.spec.trim() : null, metric: parseMetric(body.metric ?? null) ?? null };
  try {
    await startWatcher(opts);
    return jsonResponse({ ok: true, active: true, opts });
  } catch (e) {
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export function localRoutes(): Route[] {
  return [
    route("POST", "/api/setup", handleSetup),
    route("POST", "/api/watch/start", handleWatchStart),
    route("POST", "/api/watch/stop", () => { stopWatcher(); return jsonResponse({ ok: true, active: false }); }),
    route("GET", "/api/watch/status", () => jsonResponse({ ok: true, ...watcherStatus() })),
    route("POST", "/api/quit", () => {
      stopWatcher();
      queueMicrotask(() => setTimeout(() => { closeStore(); process.exit(0); }, 120));
      return jsonResponse({ ok: true });
    }),
  ];
}
