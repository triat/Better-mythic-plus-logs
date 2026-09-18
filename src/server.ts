import type { Server } from "bun";
import { hasCredentials } from "./config.ts";
import { dim, heading, ok } from "./format.ts";
import { LOCAL_CONTEXT, authGate, clientIp, resolveRequest } from "./hosted/auth.ts";
import { clip } from "./hosted/audit.ts";
import type { AuditScope } from "./hosted/audit.ts";
import type { HostedConfig } from "./hosted/config.ts";
import { createHostedRuntime } from "./hosted/runtime.ts";
import type { HostedRuntime } from "./hosted/runtime.ts";
import { findRoute } from "./server/routes.ts";
import type { Route } from "./server/routes.ts";
import { adminRoutes } from "./server/routes-admin.ts";
import { authRoutes } from "./server/routes-auth.ts";
import { userRoutes } from "./server/routes-user.ts";
import { sharedRoutes } from "./server/routes-shared.ts";
import { localRoutes } from "./server/routes-local.ts";
import { localHistory } from "./server/local-history.ts";
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

/** Test hook: the runtime of the last hosted `runServer` in this process (null before / in local mode). */
let current: HostedRuntime | null = null;
export const getHostedRuntime = (): HostedRuntime | null => current;

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
    const store = await getStore();
    if (store._db.filename === ":memory:") throw new Error("hosted mode needs a persistent bmpl.db (check BMPL_DB_PATH)");
    runtime = createHostedRuntime(opts.hostedConfig!, store._db, opts.fetchFn ?? fetch);
    current = runtime;
  }
  const routes: Route[] = [
    ...sharedRoutes({ hosted, envPath: envPathHint, runtime }),
    ...(runtime ? [...authRoutes(runtime), ...adminRoutes(runtime), ...userRoutes(runtime)] : localRoutes()),
  ];

  const respond = async (req: Request, url: URL, peerIp: string | null): Promise<Response> => {
    // Hosted: what the audit row of an uncaught throw is attributed to (known once the request is resolved).
    let scope: AuditScope | null = null;
    try {
      if (req.method === "GET") {
        const staticRes = await serveStatic(url.pathname);
        if (staticRes) return staticRes;
      }
      const r = findRoute(routes, req, url);
      if (!r) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      const ip = clientIp(req, hosted, peerIp);
      const ctx = runtime ? resolveRequest(req, { db: runtime.db, secret: runtime.config.sessionSecret, now: Date.now(), ip }) : LOCAL_CONTEXT(ip, localHistory);
      const gate = authGate(r, ctx);
      if (gate) return gate;
      if (!runtime) return await r.handle(req, url, ctx);
      // Hosted: every WCL point spent while this handler runs is charged to the session user, and
      // every audit row recorded inside it carries the user, ip and target of this request.
      scope = { userId: ctx.user?.id ?? null, ip, target: `${req.method} ${url.pathname}` };
      const rt = runtime;
      return await rt.audit.scope(scope, () => rt.meter.run(ctx.user?.id ?? null, () => Promise.resolve(r.handle(req, url, ctx))));
    } catch (e) {
      console.error(e);
      // The message stays in the log (clipped) and in stderr; the client only ever sees "Internal error".
      runtime?.audit.record("server_error", { ...(scope ?? { userId: null, ip: clientIp(req, hosted, peerIp), target: `${req.method} ${url.pathname}` }), detail: { message: clip(String(e instanceof Error ? e.message : e)) } });
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
