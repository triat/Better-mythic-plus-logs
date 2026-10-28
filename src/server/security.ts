// Response headers for hosted mode. HSTS is set by the reverse proxy (Caddy), not here.
// Wowhead tooltips (web/index.html): tooltips.js itself is loaded from wow.zamimg.com;
// it fetches tooltip data with fetch/XHR from nether.wowhead.com (connect-src, not
// script-src — it's data, not JSONP) and injects a <link rel=stylesheet> pointing at
// wow.zamimg.com/css/universal.css (style-src-elem); spell icons also come from
// wow.zamimg.com (img-src). Discord avatars (issue #3) come from cdn.discordapp.com.
/** The CSP; `analyticsOrigin` (the Umami instance, hosted config `analytics.url`) adds its script and its /api/send. */
export function cspFor(analyticsOrigin: string | null = null): string {
  const extra = analyticsOrigin ? ` ${analyticsOrigin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' https://wow.zamimg.com${extra}`,
    // 'unsafe-inline' is for Wowhead's injected <link rel=stylesheet>/style tags, not React:
    // React style props are CSSOM writes (element.style.x = …), never subject to CSP at all.
    "style-src 'self' 'unsafe-inline' https://wow.zamimg.com",
    "img-src 'self' data: https://wow.zamimg.com https://cdn.discordapp.com",
    `connect-src 'self' https://nether.wowhead.com${extra}`,
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export const CSP = cspFor();

/** The hosted headers, the CSP opened to the analytics origin when there is one. */
export function securityHeaders(analyticsOrigin: string | null = null): Readonly<Record<string, string>> {
  return Object.freeze({ ...BASE_HEADERS, "Content-Security-Policy": cspFor(analyticsOrigin) });
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // display-capture=(self): the Live chip's getDisplayMedia call (issue: game integration) is same-origin only.
  "Permissions-Policy": "clipboard-read=(), display-capture=(self)",
  "X-Frame-Options": "DENY",
};

export const SECURITY_HEADERS: Readonly<Record<string, string>> = securityHeaders();

/**
 * Adds the hosted security headers to a response, in place, so implicit headers Bun set on
 * the body (e.g. `text/plain` on `new Response("Not found")`) survive. Falls back to a
 * re-wrap (losing that implicit type) only if the response's headers are immutable.
 */
export function withSecurityHeaders(res: Response, extra: Record<string, string> = {}, base: Readonly<Record<string, string>> = SECURITY_HEADERS): Response {
  const all = { ...base, ...extra };
  try {
    for (const [k, v] of Object.entries(all)) res.headers.set(k, v);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(all)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}
