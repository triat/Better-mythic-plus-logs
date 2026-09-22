// Response headers for hosted mode. HSTS is set by the reverse proxy (Caddy), not here.
// Wowhead tooltips (web/index.html): tooltips.js itself is loaded from wow.zamimg.com;
// it fetches tooltip data with fetch/XHR from nether.wowhead.com (connect-src, not
// script-src — it's data, not JSONP) and injects a <link rel=stylesheet> pointing at
// wow.zamimg.com/css/universal.css (style-src-elem); spell icons also come from
// wow.zamimg.com (img-src). Discord avatars (issue #3) come from cdn.discordapp.com.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://wow.zamimg.com",
  // 'unsafe-inline' is for Wowhead's injected <link rel=stylesheet>/style tags, not React:
  // React style props are CSSOM writes (element.style.x = …), never subject to CSP at all.
  "style-src 'self' 'unsafe-inline' https://wow.zamimg.com",
  "img-src 'self' data: https://wow.zamimg.com https://cdn.discordapp.com",
  "connect-src 'self' https://nether.wowhead.com",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // display-capture=(self): the Live chip's getDisplayMedia call (issue: game integration) is same-origin only.
  "Permissions-Policy": "clipboard-read=(), display-capture=(self)",
  "X-Frame-Options": "DENY",
});

/**
 * Adds the hosted security headers to a response, in place, so implicit headers Bun set on
 * the body (e.g. `text/plain` on `new Response("Not found")`) survive. Falls back to a
 * re-wrap (losing that implicit type) only if the response's headers are immutable.
 */
export function withSecurityHeaders(res: Response): Response {
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}
