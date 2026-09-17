import type { Server } from "bun";
import { hasCredentials } from "./config.ts";
import { dim, heading, ok } from "./format.ts";
import { dispatch } from "./server/routes.ts";
import type { Route } from "./server/routes.ts";
import { sharedRoutes } from "./server/routes-shared.ts";
import { localRoutes } from "./server/routes-local.ts";
import { jsonResponse } from "./server/http.ts";
import { withSecurityHeaders } from "./server/security.ts";
import { closeStore } from "./signals/store.ts";
import { resolveEnvPath } from "./setup.ts";
import { createStaticHandler, defaultAssetLoader } from "./web-static.ts";
import type { AssetLoader } from "./web-static.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
  /** Multi-user deployment: local-only routes are not registered, security headers on. Default false. */
  hosted?: boolean;
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

// Installed bun-types (1.3.12) requires an explicit WebSocketData type argument on
// `Server` (it had none when this task was verified on Bun 1.3.4); `undefined` matches
// `Bun.serve`'s default here since we don't use the websocket upgrade API.
export async function runServer(opts: ServeOptions): Promise<Server<undefined>> {
  if (process.listenerCount("SIGINT") === 0) {
    process.on("SIGINT", () => { closeStore(); process.exit(0); });
  }
  const hosted = opts.hosted ?? false;
  const envPathHint = await resolveEnvPath();
  const serveStatic = createStaticHandler(opts.assets ?? defaultAssetLoader);
  const routes: Route[] = [...sharedRoutes({ hosted, envPath: envPathHint }), ...(hosted ? [] : localRoutes())];

  const respond = async (req: Request, url: URL): Promise<Response> => {
    try {
      if (req.method === "GET") {
        const staticRes = await serveStatic(url.pathname);
        if (staticRes) return staticRes;
      }
      return (
        (await dispatch(routes, req, url)) ??
        new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })
      );
    } catch (e) {
      console.error(e);
      return jsonResponse({ ok: false, error: "Internal error" }, 500);
    }
  };

  const server = Bun.serve({
    port: opts.port,
    idleTimeout: 0, // long-lived SSE streams and slow enrichment lookups
    development: !hosted,
    async fetch(req) {
      const url = new URL(req.url);
      const res = await respond(req, url);
      return hosted ? withSecurityHeaders(res) : res;
    },
    // Belt-and-suspenders: `respond` already catches everything reachable through `dispatch` and
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
