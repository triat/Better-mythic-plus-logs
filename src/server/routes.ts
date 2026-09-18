// src/server/routes.ts
// Minimal route table: first match wins, in registration order (prefix routes go after exact ones).
// `auth` is enforced by the server in hosted mode only (src/hosted/auth.ts authGate).
import type { RequestContext } from "../hosted/auth.ts";

export type RouteAuth = "public" | "user" | "admin";
export type Handler = (req: Request, url: URL, ctx: RequestContext) => Response | Promise<Response>;
export interface Route { method: "GET" | "POST" | "DELETE"; match: (path: string) => boolean; handle: Handler; auth: RouteAuth }

export const route = (method: Route["method"], path: string, handle: Handler, auth: RouteAuth = "user"): Route =>
  ({ method, match: (p) => p === path, handle, auth });

export const prefixRoute = (method: Route["method"], prefix: string, handle: Handler, auth: RouteAuth = "user"): Route =>
  ({ method, match: (p) => p.startsWith(prefix), handle, auth });

export function findRoute(routes: Route[], req: Request, url: URL): Route | null {
  for (const r of routes) if (r.method === req.method && r.match(url.pathname)) return r;
  return null;
}
