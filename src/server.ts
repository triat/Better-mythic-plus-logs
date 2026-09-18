import type { Server } from "bun";
import { hasCredentials } from "./config.ts";
import { dim, heading, ok } from "./format.ts";
import { LOCAL_CONTEXT, authGate, clientIp, resolveRequest } from "./hosted/auth.ts";
import type { HostedConfig } from "./hosted/config.ts";
import { openHosted } from "./hosted/db.ts";
import type { HostedDb } from "./hosted/db.ts";
import { OAuthStates } from "./hosted/oauth-state.ts";
import { findRoute } from "./server/routes.ts";
import type { Route } from "./server/routes.ts";
import { authRoutes } from "./server/routes-auth.ts";
import { sharedRoutes } from "./server/routes-shared.ts";
import { localRoutes } from "./server/routes-local.ts";
import { jsonResponse } from "./server/http.ts";
import { withSecurityHeaders } from "./server/security.ts";
import { closeStore, getStore } from "./signals/store.ts";
import { resolveEnvPath } from "./setup.ts";
import { createStaticHandler, defaultAssetLoader } from "./web-static.ts";
import type { AssetLoader } from "./web-static.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
  /** Multi-user deployment: local-only routes are not registered, security headers on, login required. Default false. */
  hosted?: boolean;
  /** Required when hosted: the validated BMPL_* environment. */
  hostedConfig?: HostedConfig;
  /** Test hook: fetch used for Discord calls. Default: global fetch. */
  fetchFn?: typeof fetch;
  /** Test hook: where the built front lives. Default: embedded web/dist. */
  assets?: AssetLoader;
}

/** Everything hosted-only routes need, built once per server. */
export interface HostedRuntime { config: HostedConfig; db: HostedDb; states: OAuthStates; fetchFn: typeof fetch; secure: boolean }

const SESSION_PURGE_INTERVAL_MS = 60 * 60 * 1000;

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
    process.on("SIGINT", () => { closeStore(); process.exit(0); });
  }
  const hosted = opts.hosted ?? false;
  if (hosted && !opts.hostedConfig) throw new Error("hosted mode needs hostedConfig");
  const envPathHint = await resolveEnvPath();
  const serveStatic = createStaticHandler(opts.assets ?? defaultAssetLoader);

  let runtime: HostedRuntime | null = null;
  if (hosted) {
    const config = opts.hostedConfig!;
    runtime = { config, db: openHosted((await getStore())._db), states: new OAuthStates(), fetchFn: opts.fetchFn ?? fetch, secure: config.baseUrl.startsWith("https:") };
    setInterval(() => runtime!.db.sessions.purgeExpired(Date.now()), SESSION_PURGE_INTERVAL_MS).unref();
  }
  const routes: Route[] = [...sharedRoutes({ hosted, envPath: envPathHint }), ...(runtime ? authRoutes(runtime) : localRoutes())];

  const respond = async (req: Request, url: URL, peerIp: string | null): Promise<Response> => {
    try {
      if (req.method === "GET") {
        const staticRes = await serveStatic(url.pathname);
        if (staticRes) return staticRes;
      }
      const r = findRoute(routes, req, url);
      if (!r) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      const ip = clientIp(req, hosted, peerIp);
      const ctx = runtime ? resolveRequest(req, { db: runtime.db, secret: runtime.config.sessionSecret, now: Date.now(), ip }) : LOCAL_CONTEXT(ip);
      return authGate(r, ctx) ?? (await r.handle(req, url, ctx));
    } catch (e) {
      console.error(e);
      return jsonResponse({ ok: false, error: "Internal error" }, 500);
    }
  };

  const server = Bun.serve({
    port: opts.port,
    idleTimeout: 0, // long-lived SSE streams and slow enrichment lookups
    development: !hosted,
    async fetch(req, srv) {
      const url = new URL(req.url);
      const res = await respond(req, url, srv.requestIP(req)?.address ?? null);
      return hosted ? withSecurityHeaders(res) : res;
    },
    // Belt-and-suspenders: `respond` already catches everything reachable through `findRoute` and
    // `serveStatic`, but nothing outside it (e.g. a throw from Bun's own request parsing) should
    // ever reach Bun's default HTML debug page, especially in hosted mode.
    error(e) {
      console.error(e);
      const res = jsonResponse({ ok: false, error: "Internal error" }, 500);
      return hosted ? withSecurityHeaders(res) : res;
    },
  });

  const url = `http://localhost:${server.port}`;
  console.log(`${heading("bmpl serve")}  ${ok(url)}${hosted ? dim("  (hosted mode)") : ""}`);
  if (hosted) console.log(dim(`  credentials: ${hasCredentials() ? "loaded" : "NOT SET"}  ·  local routes disabled`));
  else console.log(dim(`  env path: ${envPathHint}  ·  credentials: ${hasCredentials() ? "loaded" : "not set (setup page will open)"}`));
  console.log(dim("  Ctrl+C to stop."));
  if (opts.open && !hosted) setTimeout(() => openBrowser(url), 80);
  return server;
}
