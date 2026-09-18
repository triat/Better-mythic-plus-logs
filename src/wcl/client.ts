import { config } from "../config.ts";
import { getAccessToken } from "./auth.ts";
import type { RateLimitData } from "./types.ts";

export type RateLimit = RateLimitData["rateLimitData"];
export type RateLimitObserver = (rl: RateLimit) => void;

let observer: RateLimitObserver | null = null;

/** Hosted mode installs its PointsMeter here; local mode and the CLI never observe. */
export const setRateLimitObserver = (fn: RateLimitObserver | null): void => { observer = fn; };

/** Hands a response's `rateLimitData` (if any) to the installed observer. */
export const observeRateLimit = (data: unknown): void => {
  if (!observer) return;
  const rl = (data as { rateLimitData?: RateLimit } | null)?.rateLimitData;
  if (rl && typeof rl.pointsSpentThisHour === "number") observer(rl);
};

/** A failed WCL call. `publicMessage` (≤ ~220 chars, body clipped) is safe to show a hosted member; `message` is it with a `WCL ` prefix. */
export class WclError extends Error {
  constructor(readonly kind: "http" | "graphql" | "nodata", readonly status: number | null, readonly publicMessage: string) {
    super(`WCL ${publicMessage}`);
    this.name = "WclError";
  }
}

/** Longest slice of an HTTP body or GraphQL message kept in an error. */
const ERROR_TEXT_MAX = 200;
const clipText = (s: string): string => (s.length > ERROR_TEXT_MAX ? s.slice(0, ERROR_TEXT_MAX - 1) + "…" : s);

let errorObserver: ((e: WclError) => void) | null = null;

/** Hosted mode installs its audit hook here; local mode and the CLI never observe. */
export const setWclErrorObserver = (fn: ((e: WclError) => void) | null): void => { errorObserver = fn; };

/** Hands a WCL failure to the installed observer (called by `gql` right before it throws). */
export const notifyWclError = (e: WclError): void => { errorObserver?.(e); };

const fail = (e: WclError): never => { notifyWclError(e); throw e; };

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: ReadonlyArray<string | number> }>;
}

export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(config.graphqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    return fail(new WclError("http", res.status, `HTTP ${res.status}: ${clipText(await res.text())}`));
  }

  const json = (await res.json()) as GqlResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const msg = json.errors
      .map((e) => `${e.message}${e.path ? ` (at ${e.path.join(".")})` : ""}`)
      .join("; ");
    return fail(new WclError("graphql", null, `GraphQL error: ${clipText(msg)}`));
  }
  if (!json.data) {
    return fail(new WclError("nodata", null, "GraphQL: no data returned"));
  }
  observeRateLimit(json.data);
  return json.data;
}
