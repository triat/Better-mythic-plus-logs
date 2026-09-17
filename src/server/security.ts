// Response headers for hosted mode. HSTS is set by the reverse proxy (Caddy), not here.
// Wowhead tooltips (web/index.html): tooltips.js itself is loaded from wow.zamimg.com;
// it fetches tooltip data with fetch/XHR from nether.wowhead.com (connect-src, not
// script-src — it's data, not JSONP) and injects a <link rel=stylesheet> pointing at
// wow.zamimg.com/css/universal.css (style-src-elem); spell icons also come from
// wow.zamimg.com (img-src). Discord avatars (issue #3) come from cdn.discordapp.com.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://wow.zamimg.com",
  "style-src 'self' 'unsafe-inline' https://wow.zamimg.com", // React style props + Wowhead's injected stylesheet
  "img-src 'self' data: https://wow.zamimg.com https://cdn.discordapp.com",
  "connect-src 'self' https://nether.wowhead.com",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "clipboard-read=()",
  "X-Frame-Options": "DENY",
});

/** Returns a response carrying the hosted security headers; the body (file or stream) is passed through untouched. */
export function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
