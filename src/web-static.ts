export interface WebAssets {
  index: string;
  appJs: string;
  appCss: string;
  whConfigJs: string;
  geistWoff2: string;
  geistMonoWoff2: string;
}
export type AssetLoader = () => Promise<WebAssets | null>;

export const NOT_BUILT = "web UI not built — run: just web-build";

/** Resolves the embedded/built front, or null when web/dist is absent. */
export const defaultAssetLoader: AssetLoader = async () => {
  try {
    const m = await import("./web-assets.ts");
    return m.WEB_ASSETS;
  } catch {
    return null;
  }
};

const NO_CACHE = "no-cache";
// Font names are versioned by the file: changing a font means a new name, so these can be cached forever.
const IMMUTABLE = "public, max-age=31536000, immutable";

const ROUTES: Record<string, { pick: (a: WebAssets) => string; type: string; cache?: string }> = {
  "/": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/setup": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/admin": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/settings": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/privacy": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/help": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/me": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/assets/app.js": { pick: (a) => a.appJs, type: "text/javascript; charset=utf-8" },
  "/assets/app.css": { pick: (a) => a.appCss, type: "text/css; charset=utf-8" },
  "/wh-config.js": { pick: (a) => a.whConfigJs, type: "text/javascript; charset=utf-8" },
  "/fonts/Geist-Variable.woff2": { pick: (a) => a.geistWoff2, type: "font/woff2", cache: IMMUTABLE },
  "/fonts/GeistMono-Variable.woff2": { pick: (a) => a.geistMonoWoff2, type: "font/woff2", cache: IMMUTABLE },
};

const notBuilt = () =>
  new Response(NOT_BUILT, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** Returns a Response for a static path, or null when the path is not static. */
export function createStaticHandler(loader: AssetLoader): (pathname: string) => Promise<Response | null> {
  let assets: WebAssets | null = null;
  return async (pathname) => {
    const route = ROUTES[pathname];
    if (!route) return null;
    // A null result is not cached: building web/dist while the server runs then works.
    assets ??= await loader();
    if (!assets) return notBuilt();
    const file = Bun.file(route.pick(assets));
    if (!(await file.exists())) return notBuilt();
    return new Response(file, { headers: { "Content-Type": route.type, "Cache-Control": route.cache ?? NO_CACHE } });
  };
}
