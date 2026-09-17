// src/server/routes.ts
// Minimal route table: first match wins, in registration order (prefix routes go after exact ones).
export type Handler = (req: Request, url: URL) => Response | Promise<Response>;
export interface Route { method: "GET" | "POST" | "DELETE"; match: (path: string) => boolean; handle: Handler }

export const route = (method: Route["method"], path: string, handle: Handler): Route =>
  ({ method, match: (p) => p === path, handle });

export const prefixRoute = (method: Route["method"], prefix: string, handle: Handler): Route =>
  ({ method, match: (p) => p.startsWith(prefix), handle });

export function dispatch(routes: Route[], req: Request, url: URL): Response | Promise<Response> | null {
  for (const r of routes) if (r.method === req.method && r.match(url.pathname)) return r.handle(req, url);
  return null;
}
