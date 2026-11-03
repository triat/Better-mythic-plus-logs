export interface WebAssets {
  index: string;
  appJs: string;
  appCss: string;
  whConfigJs: string;
  geistWoff2: string;
  geistMonoWoff2: string;
  /** The link-preview image (`web/public/og.png`); absent from older builds and test fixtures. */
  ogPng?: string;
}
export type AssetLoader = () => Promise<WebAssets | null>;

import { LIVE_ENABLED } from "./features.ts";

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

// The share image: a day in caches, so a new one shows in previews without a new name.
const ONE_DAY = "public, max-age=86400";
/** In index.html's preview tags: replaced by the instance's origin (hosted `BMPL_BASE_URL`), "" locally. */
export const ORIGIN_PLACEHOLDER = "__BMPL_ORIGIN__";

const ROUTES: Record<string, { pick: (a: WebAssets) => string | undefined; type: string; cache?: string }> = {
  "/": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/setup": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/candidate": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/compare": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/live": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/admin": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/admin/characters": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/settings": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/privacy": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/help": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/me": { pick: (a) => a.index, type: "text/html; charset=utf-8" },
  "/assets/app.js": { pick: (a) => a.appJs, type: "text/javascript; charset=utf-8" },
  "/assets/app.css": { pick: (a) => a.appCss, type: "text/css; charset=utf-8" },
  "/wh-config.js": { pick: (a) => a.whConfigJs, type: "text/javascript; charset=utf-8" },
  "/fonts/Geist-Variable.woff2": { pick: (a) => a.geistWoff2, type: "font/woff2", cache: IMMUTABLE },
  "/fonts/GeistMono-Variable.woff2": { pick: (a) => a.geistMonoWoff2, type: "font/woff2", cache: IMMUTABLE },
  "/og.png": { pick: (a) => a.ogPng, type: "image/png", cache: ONE_DAY },
};

const notBuilt = () =>
  new Response(NOT_BUILT, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * Returns a Response for a static path, or null when the path is not static. `origin` (the hosted instance's
 * `BMPL_BASE_URL`, "" locally) fills index.html's preview tags, which link and preview platforms need absolute.
 */
export function createStaticHandler(loader: AssetLoader, origin = ""): (pathname: string) => Promise<Response | null> {
  let assets: WebAssets | null = null;
  return async (pathname) => {
    // Live is off (src/features.ts): an old link or bookmark lands on the home page.
    if (pathname === "/live" && !LIVE_ENABLED) return new Response(null, { status: 302, headers: { Location: "/" } });
    const route = ROUTES[pathname];
    if (!route) return null;
    // A null result is not cached: building web/dist while the server runs then works.
    assets ??= await loader();
    if (!assets) return notBuilt();
    const path = route.pick(assets);
    if (path === undefined) return null;
    const file = Bun.file(path);
    if (!(await file.exists())) return notBuilt();
    const headers = { "Content-Type": route.type, "Cache-Control": route.cache ?? NO_CACHE };
    if (path === assets.index) return new Response((await file.text()).replaceAll(ORIGIN_PLACEHOLDER, origin), { headers });
    return new Response(file, { headers });
  };
}
