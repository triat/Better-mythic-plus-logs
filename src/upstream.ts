// Outbound calls (WCL, Raider.IO, Discord, Battle.net) for the logs stack's Dependencies dashboard. Silent until an
// observer is installed: the hosted runtime and `bmpl calibrate` install one, so local mode and the CLI print nothing.
// An `op` never carries a character name, a realm or a token: a GraphQL call is named by its first field, an HTTP
// call by its path with everything after `character` replaced.
export type UpstreamService = "wcl" | "raiderio" | "discord" | "bnet";

export interface UpstreamCall {
  service: UpstreamService;
  op: string;
  /** The HTTP status, or null when the request never got an answer (network error, timeout). */
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  /** WCL only: the instance's client or a member's own. */
  client?: "shared" | "own";
}

let observer: ((c: UpstreamCall) => void) | null = null;

/** The `upstream` log line's fields: `service` is the logs stack's own stream label (`service=bmpl`), so the
 *  dependency goes as `dep`. */
export const upstreamFields = (c: UpstreamCall): Record<string, unknown> => {
  const { service, ...rest } = c;
  return { dep: service, ...rest };
};

export const setUpstreamObserver = (fn: ((c: UpstreamCall) => void) | null): void => { observer = fn; };

/** Never throws: a logging failure must not fail the call it describes. */
export const reportUpstream = (c: UpstreamCall): void => {
  try { observer?.(c); } catch { /* ignore */ }
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Runs one HTTP call and reports it; `ok` is the response's own (a 404 is reported as such, the caller decides). */
export async function timedFetch(
  service: UpstreamService, op: string, call: () => Promise<Response>, extra: Pick<UpstreamCall, "client"> = {},
): Promise<Response> {
  const started = performance.now();
  try {
    const res = await call();
    reportUpstream({ service, op, status: res.status, ms: Math.round(performance.now() - started), ok: res.ok, ...extra });
    return res;
  } catch (e) {
    reportUpstream({ service, op, status: null, ms: Math.round(performance.now() - started), ok: false, error: message(e), ...extra });
    throw e;
  }
}

/** A GraphQL query's first field (`worldData`, `reportData`, `characterData`, `rateLimitData`). */
export const opOfQuery = (query: string): string => /\{\s*([A-Za-z_]\w*)/.exec(query)?.[1] ?? "query";

/** Discord or Battle.net for an absolute URL, else null (WCL and Raider.IO report their calls where they make them). */
export function serviceOfUrl(url: string): UpstreamService | null {
  const host = new URL(url).hostname;
  if (host === "discord.com" || host.endsWith(".discord.com")) return "discord";
  if (host.endsWith("battle.net") || host.endsWith("api.blizzard.com")) return "bnet";
  return null;
}

/** The path, at most four segments, with what follows `character` (realm, name) replaced by `*`. */
export function opOfUrl(url: string): string {
  let segs = new URL(url).pathname.split("/").filter(Boolean);
  const at = segs.indexOf("character");
  if (at >= 0) segs = [...segs.slice(0, at + 1), "*"];
  return `/${segs.slice(0, 4).join("/")}`;
}

/** Wraps a fetch so that every call to a known service is reported (the hosted runtime's Discord and Battle.net calls). */
export function instrumentFetch(base: typeof fetch): typeof fetch {
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let service: UpstreamService | null = null;
    try { service = serviceOfUrl(url); } catch { /* relative or odd URL: not ours to report */ }
    if (!service) return base(input, init);
    return timedFetch(service, opOfUrl(url), () => base(input, init));
  };
  return Object.assign(wrapped, { preconnect: base.preconnect }) as typeof fetch;
}
