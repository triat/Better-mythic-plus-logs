import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.ts";
import { getAccessToken } from "./auth.ts";
import type { WclCredentials } from "./auth.ts";
import type { RateLimitData } from "./types.ts";

export type RateLimit = RateLimitData["rateLimitData"];
export type RateLimitObserver = (rl: RateLimit) => void;

let observer: RateLimitObserver | null = null;

/** Hosted mode installs its PointsMeter here; local mode and the CLI never observe. */
export const setRateLimitObserver = (fn: RateLimitObserver | null): void => { observer = fn; };

/** A response's `rateLimitData`, if present and well-formed. */
export const rateLimitOf = (data: unknown): RateLimit | null => {
  const rl = (data as { rateLimitData?: RateLimit } | null)?.rateLimitData;
  return rl && typeof rl.pointsSpentThisHour === "number" ? rl : null;
};

/** Hands a response's `rateLimitData` (if any) to the installed observer. */
export const observeRateLimit = (data: unknown): void => {
  if (!observer) return;
  const rl = rateLimitOf(data);
  if (rl) observer(rl);
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

/** A member's own WCL client, in effect for the duration of `runWithWclClient`'s callback (issue #11). */
export interface WclClientScope {
  creds: WclCredentials;
  onRateLimit: ((rl: RateLimit) => void) | null;
}

const clientScope = new AsyncLocalStorage<WclClientScope>();

/** Runs `fn` with `gql` authenticated as `scope.creds`; its `rateLimitData` goes to `scope.onRateLimit`, never the meter. */
export function runWithWclClient<T>(scope: WclClientScope, fn: () => Promise<T>): Promise<T> {
  return clientScope.run(scope, fn);
}

/** The running request's own-client scope, or undefined outside `runWithWclClient` (the env/shared client). */
export const currentWclClient = (): WclClientScope | undefined => clientScope.getStore();

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: ReadonlyArray<string | number> }>;
}

export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const scope = currentWclClient();
  const token = await getAccessToken(scope?.creds);
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
  if (scope) {
    const rl = rateLimitOf(json.data);
    if (rl) scope.onRateLimit?.(rl);
  } else {
    observeRateLimit(json.data);
  }
  return json.data;
}
