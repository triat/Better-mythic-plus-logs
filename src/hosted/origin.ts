// Hosted-mode CSRF guard (issue #9): a state-changing request must come from our own origin.
// Browsers send `Origin` on every cross-origin request and every non-GET one, and `Sec-Fetch-Site`
// on every request; a request carrying neither (curl, an old client) passes — the session cookie is
// SameSite=Lax anyway, this is the second lock. The check runs before the auth gate, so a foreign
// page cannot even probe whether a cookie is valid.

const FOREIGN_FETCH_SITES = new Set(["cross-site", "same-site"]);

/** The origin `Origin: <value>` names, or null when it is not a URL (including the literal `null`). */
const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * `null` when the request may proceed; `"origin"` when `Origin` is present and is not `baseUrl`'s
 * origin (unparsable and the literal `null` included); `"fetch-site"` when `Sec-Fetch-Site` says
 * `cross-site` or `same-site` (a matching `Origin` does not excuse it).
 */
export function checkOrigin(headers: Headers, baseUrl: string): null | "origin" | "fetch-site" {
  const origin = headers.get("origin");
  if (origin !== null) {
    const got = originOf(origin);
    if (got === null || got !== originOf(baseUrl)) return "origin";
  }
  const site = headers.get("sec-fetch-site");
  if (site !== null && FOREIGN_FETCH_SITES.has(site.trim().toLowerCase())) return "fetch-site";
  return null;
}
