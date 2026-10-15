// The page's uncaught errors, for the logs stack (`POST /api/client-error`, the Errors dashboard). Pure; tested.
// Only bmpl's own code is reported: a cross-origin script (Wowhead's tooltips) shows up as "Script error." with no
// source, and is dropped. The page is the pathname alone: the query can name a character.

export type ClientErrorKind = "error" | "rejection";

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack: string | null;
  page: string;
  version: string | null;
}

/** At most this many reports per page load: a loop that throws on every frame sends five, not thousands. */
export const MAX_REPORTS = 5;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const PAGE = /^\/[A-Za-z0-9/_-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Benign browser noise, never a bug of the page. */
const NOISE = [/^ResizeObserver loop/, /^Script error\.?$/];

/**
 * The report for one uncaught error, or null when it is not ours to report: an empty message, browser noise, or an
 * error whose `source` (the script URL, when the browser gives one) is on another origin than `origin`.
 */
export function clientErrorReport(
  kind: ClientErrorKind,
  reason: unknown,
  ctx: { page: string; origin: string; version: string | null; source?: string | null },
): ClientErrorReport | null {
  if (ctx.source && !ctx.source.startsWith(ctx.origin)) return null;
  const message = (reason instanceof Error ? `${reason.name}: ${reason.message}` : typeof reason === "string" ? reason : String(reason ?? "")).trim();
  if (!message || NOISE.some((re) => re.test(message))) return null;
  const stack = reason instanceof Error && reason.stack ? clip(reason.stack, MAX_STACK) : null;
  return {
    kind, message: clip(message, MAX_MESSAGE), stack,
    page: PAGE.test(ctx.page) ? clip(ctx.page, 64) : "/",
    version: ctx.version !== null && SEMVER.test(ctx.version) ? ctx.version : null,
  };
}

/** Sends each distinct report once, at most `max` per page load. */
export function createErrorReporter(send: (r: ClientErrorReport) => void, max = MAX_REPORTS): (r: ClientErrorReport | null) => void {
  const seen = new Set<string>();
  return (r) => {
    if (!r || seen.size >= max) return;
    const key = `${r.kind}|${r.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    send(r);
  };
}
