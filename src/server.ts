import type { Server } from "bun";
import { hasCredentials } from "./config.ts";
import { dim, heading, ok } from "./format.ts";
import { LOCAL_CONTEXT, authGate, clientIp, resolveRequest } from "./hosted/auth.ts";
import { clip } from "./hosted/audit.ts";
import type { AuditScope } from "./hosted/audit.ts";
import type { HostedConfig } from "./hosted/config.ts";
import { checkOrigin } from "./hosted/origin.ts";
import { DEFAULT_RATE_LIMITS } from "./hosted/ratelimit.ts";
import type { RateLimiter, RateLimits } from "./hosted/ratelimit.ts";
import { createHostedRuntime } from "./hosted/runtime.ts";
import type { HostedRuntime } from "./hosted/runtime.ts";
import type { Verify } from "./hosted/wcl-clients.ts";
import { findRoute } from "./server/routes.ts";
import type { Route } from "./server/routes.ts";
import { adminRoutes } from "./server/routes-admin.ts";
import { authRoutes } from "./server/routes-auth.ts";
import { userRoutes } from "./server/routes-user.ts";
import { sharedRoutes } from "./server/routes-shared.ts";
import { localRoutes } from "./server/routes-local.ts";
import { getLocalHistory, openLocalHistory } from "./server/local-history.ts";
import { jsonResponse } from "./server/http.ts";
import { withSecurityHeaders } from "./server/security.ts";
import { closeStore, getStore } from "./signals/store.ts";
import { resolveEnvPath } from "./setup.ts";
import { createStaticHandler, defaultAssetLoader } from "./web-static.ts";
import type { AssetLoader } from "./web-static.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
  /** Bind address for `Bun.serve`. `null`/omitted: Bun's default. Hosted deploys default to loopback (127.0.0.1). */
  host?: string | null;
  /** Multi-user deployment: local-only routes are not registered, security headers on, login required. Default false. */
  hosted?: boolean;
  /** Required when hosted: the validated BMPL_* environment. */
  hostedConfig?: HostedConfig;
  /** Test hook: fetch used for Discord calls. Default: global fetch. */
  fetchFn?: typeof fetch;
  /** Test hook: where the built front lives. Default: embedded web/dist. */
  assets?: AssetLoader;
  /** Test hook (hosted): rate-limit rules merged over `DEFAULT_RATE_LIMITS`. */
  rateLimits?: Partial<RateLimits>;
  /** Test hook (hosted): verifies a member's own WCL client. Default: the real PING. */
  verifyWclClient?: Verify;
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

/** Which limiter and key a hosted request is counted against, or null when the route is not rate-limited. */
function rateLimitFor(runtime: HostedRuntime, req: Request, url: URL, userId: number | null, ip: string): { limiter: RateLimiter; key: string } | null {
  if (url.pathname.startsWith("/auth/")) return { limiter: runtime.limits.auth, key: `ip:${ip}` };
  // Every route below is `auth: "user"`: the gate has already turned an anonymous request into a 401.
  const key = `user:${userId ?? "anonymous"}`;
  if (req.method === "POST" && url.pathname === "/api/lookup") return { limiter: runtime.limits.lookup, key };
  if (req.method === "POST" && url.pathname === "/api/deepdive") return { limiter: runtime.limits.deepdive, key };
  if (req.method === "PUT" && url.pathname === "/api/me/wcl-client") return { limiter: runtime.limits.lookup, key };
  if (req.method === "POST" && url.pathname === "/api/me/wcl-client/verify") return { limiter: runtime.limits.lookup, key };
  return null;
}

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
  if (!hosted) await openLocalHistory();
  if (hosted) {
    const store = await getStore();
    if (store._db.filename === ":memory:") throw new Error("hosted mode needs a persistent bmpl.db (check BMPL_DB_PATH)");
    runtime = createHostedRuntime(opts.hostedConfig!, store._db, opts.fetchFn ?? fetch, { ...DEFAULT_RATE_LIMITS, ...opts.rateLimits }, { verifyWclClient: opts.verifyWclClient });
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
      const target = `${req.method} ${url.pathname}`;
      // Hosted: a state-changing request from another origin is refused before the auth gate, so a
      // foreign page cannot even learn whether the cookie it carries is valid. The 403 is
      // unconditional; the audit row is throttled per IP (`limits.security`) so a flood of
      // cross-site requests cannot fill the audit table.
      if (runtime && req.method !== "GET" && req.method !== "HEAD") {
        const why = checkOrigin(req.headers, runtime.config.baseUrl);
        if (why) {
          if (runtime.limits.security.hit(`ip:${ip}`, Date.now()).ok) {
            runtime.audit.record("origin_rejected", { userId: null, ip, target, detail: { origin: clip(req.headers.get("origin") ?? "", 200), fetchSite: req.headers.get("sec-fetch-site"), why } });
          }
          return jsonResponse({ ok: false, error: "Cross-site request refused" }, 403);
        }
      }
      const ctx = runtime ? resolveRequest(req, { db: runtime.db, secret: runtime.config.sessionSecret, now: Date.now(), ip }) : LOCAL_CONTEXT(ip, getLocalHistory());
      const gate = authGate(r, ctx);
      if (gate) return gate;
      if (!runtime) return await r.handle(req, url, ctx);
      // Hosted: in-app rate limits, after the gate (a per-user key needs the user) and before the
      // handler (an invalid body still counts). The 429 is answered here, so it is never a quota
      // row; only the first refusal of a burst is audited (`first`), the rest are 429 only.
      const rl = rateLimitFor(runtime, req, url, ctx.user?.id ?? null, ip);
      if (rl) {
        const verdict = rl.limiter.hit(rl.key, Date.now());
        if (!verdict.ok) {
          const { retryAfterS } = verdict;
          if (verdict.first) {
            runtime.audit.record("rate_limited", { userId: ctx.user?.id ?? null, ip, target, detail: { limit: rl.limiter.rule.limit, windowS: Math.round(rl.limiter.rule.windowMs / 1000), retryAfterS } });
          }
          const res = jsonResponse({ ok: false, error: `Too many requests — try again in ${retryAfterS} s` }, 429);
          res.headers.set("Retry-After", String(retryAfterS));
          return res;
        }
      }
      // Hosted: every WCL point spent while this handler runs is charged to the session user, and
      // every audit row recorded inside it carries the user, ip and target of this request.
      scope = { userId: ctx.user?.id ?? null, ip, target };
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
    hostname: opts.host ?? undefined,
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

  const bindHost = opts.host ?? null;
  const displayHost = bindHost === null || bindHost === "0.0.0.0" || bindHost === "::" ? "localhost" : bindHost;
  const url = `http://${displayHost}:${server.port}`;
  console.log(`${heading("bmpl serve")}  ${ok(url)}${hosted ? dim("  (hosted mode)") : ""}`);
  if (hosted) {
    const cfg = opts.hostedConfig!;
    console.log(dim(`  credentials: ${hasCredentials() ? "loaded" : "NOT SET"}  ·  local routes disabled  ·  signup: ${cfg.openSignup ? "open" : "invite-only"}  ·  guild gate: ${cfg.discordGuildId ? "on" : "off"}  ·  own WCL clients: ${cfg.encryptionKey ? "on" : "off"}`));
    if (bindHost) console.log(dim(`  bound to ${bindHost} — put a reverse proxy in front`));
  } else {
    console.log(dim(`  env path: ${envPathHint}  ·  credentials: ${hasCredentials() ? "loaded" : "not set (setup page will open)"}`));
  }
  console.log(dim("  Ctrl+C to stop."));
  if (opts.open && !hosted) setTimeout(() => openBrowser(url), 80);
  return server;
}
