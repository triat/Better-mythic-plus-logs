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
    throw new Error(`WCL HTTP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as GqlResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const msg = json.errors
      .map((e) => `${e.message}${e.path ? ` (at ${e.path.join(".")})` : ""}`)
      .join("; ");
    throw new Error(`WCL GraphQL error: ${msg}`);
  }
  if (!json.data) {
    throw new Error("WCL GraphQL: no data returned");
  }
  observeRateLimit(json.data);
  return json.data;
}
