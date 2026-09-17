import type { Server } from "bun";
import pc from "picocolors";
import { hasCredentials } from "./config.ts";
import { dim, err, heading, ok } from "./format.ts";
import { jsonResponse, parseMetric } from "./server/http.ts";
import { eventsResponse } from "./server/sse.ts";
import { handleDefensivesGet, handleDefensivesPost, handleDeepdive } from "./server/deepdive.ts";
import { handleLookup, history, historySummary } from "./server/lookup.ts";
import { startWatcher, stopWatcher, watcherStatus } from "./server/watcher.ts";
import { closeStore } from "./signals/store.ts";
import { resolveEnvPath, writeCredentials } from "./setup.ts";
import { resetAuthCache } from "./wcl/auth.ts";
import { createStaticHandler, defaultAssetLoader } from "./web-static.ts";
import type { AssetLoader } from "./web-static.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
  /** Test hook: where the built front lives. Default: embedded web/dist. */
  assets?: AssetLoader;
}

interface SetupRequest {
  clientId?: string;
  clientSecret?: string;
}

async function handleSetup(req: Request): Promise<Response> {
  let body: SetupRequest;
  try {
    body = (await req.json()) as SetupRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!body.clientId || !body.clientSecret) {
    return jsonResponse(
      { ok: false, error: "Both clientId and clientSecret are required." },
      400,
    );
  }
  try {
    const envPath = await writeCredentials(body.clientId, body.clientSecret);
    resetAuthCache();
    return jsonResponse({ ok: true, envPath });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
}

const openBrowser = (url: string): void => {
  const isWSL =
    process.platform === "linux" &&
    (!!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP);

  let cmd: string[] | null = null;
  if (process.platform === "win32" || isWSL) {
    cmd = ["cmd.exe", "/c", "start", "", url];
  } else if (process.platform === "darwin") {
    cmd = ["open", url];
  } else if (process.platform === "linux") {
    cmd = ["xdg-open", url];
  }
  if (!cmd) return;

  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* best-effort */
  }
};

// Installed bun-types (1.3.12) requires an explicit WebSocketData type argument on
// `Server` (it had none when this task was verified on Bun 1.3.4); `undefined` matches
// `Bun.serve`'s default here since we don't use the websocket upgrade API.
export async function runServer(opts: ServeOptions): Promise<Server<undefined>> {
  if (process.listenerCount("SIGINT") === 0) {
    process.on("SIGINT", () => {
      closeStore();
      process.exit(0);
    });
  }

  const envPathHint = await resolveEnvPath();
  const serveStatic = createStaticHandler(opts.assets ?? defaultAssetLoader);

  const server = Bun.serve({
    port: opts.port,
    // Local single-user tool — disable the 10s idle-connection timeout so
    // long-lived SSE streams and slow enrichment lookups don't get killed.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "GET") {
        const staticRes = await serveStatic(path);
        if (staticRes) return staticRes;
      }
      if (req.method === "POST" && path === "/api/setup") {
        return handleSetup(req);
      }
      if (req.method === "POST" && path === "/api/lookup") {
        return handleLookup(req);
      }
      if (req.method === "POST" && path === "/api/deepdive") return handleDeepdive(req);
      if (req.method === "GET" && path === "/api/defensives") return handleDefensivesGet(url);
      if (req.method === "POST" && path === "/api/defensives") return handleDefensivesPost(req);
      if (req.method === "GET" && path === "/api/history") {
        // Newest first for the UI.
        const items = history.list().map(historySummary);
        return jsonResponse({ ok: true, items });
      }
      if (req.method === "GET" && path.startsWith("/api/history/")) {
        const key = decodeURIComponent(path.slice("/api/history/".length));
        const entry = history.get(key);
        if (!entry) return jsonResponse({ ok: false, error: "Not in history" }, 404);
        return jsonResponse({ ok: true, result: entry.result, key, fromCache: true });
      }
      if (req.method === "DELETE" && path === "/api/history") {
        history.clear();
        return jsonResponse({ ok: true });
      }
      if (req.method === "DELETE" && path.startsWith("/api/history/")) {
        const key = decodeURIComponent(path.slice("/api/history/".length));
        const removed = history.remove(key);
        return jsonResponse({ ok: removed });
      }
      if (req.method === "GET" && path === "/api/events") {
        return eventsResponse({ event: "status", data: watcherStatus() });
      }
      if (req.method === "POST" && path === "/api/watch/start") {
        let body: {
          level?: number | string | null;
          spec?: string | null;
          metric?: string | null;
        };
        try {
          body = await req.json();
        } catch {
          body = {};
        }
        let level: number | null = null;
        if (body.level !== undefined && body.level !== null && body.level !== "") {
          const n = Number.parseInt(String(body.level), 10);
          if (Number.isFinite(n) && n >= 2) level = n;
        }
        const opts = {
          level,
          spec: body.spec && body.spec.trim() ? body.spec.trim() : null,
          metric: parseMetric(body.metric ?? null) ?? null,
        };
        try {
          await startWatcher(opts);
          return jsonResponse({ ok: true, active: true, opts });
        } catch (e) {
          return jsonResponse(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            500,
          );
        }
      }
      if (req.method === "POST" && path === "/api/watch/stop") {
        stopWatcher();
        return jsonResponse({ ok: true, active: false });
      }
      if (req.method === "GET" && path === "/api/watch/status") {
        return jsonResponse({ ok: true, ...watcherStatus() });
      }
      if (req.method === "POST" && path === "/api/quit") {
        stopWatcher();
        queueMicrotask(() => setTimeout(() => {
          closeStore();
          process.exit(0);
        }, 120));
        return jsonResponse({ ok: true });
      }
      if (req.method === "GET" && path === "/api/status") {
        return jsonResponse({
          ok: true,
          hasCredentials: hasCredentials(),
          envPath: envPathHint,
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const url = `http://localhost:${server.port}`;
  console.log(`${heading("bmpl serve")}  ${ok(url)}`);
  console.log(
    dim(
      `  env path: ${envPathHint}  ·  credentials: ${
        hasCredentials() ? "loaded" : "not set (setup page will open)"
      }`,
    ),
  );
  console.log(dim("  Ctrl+C to stop."));

  if (opts.open) {
    // tiny delay so the server is ready before the browser hits it
    setTimeout(() => openBrowser(url), 80);
  }

  return server;
}
