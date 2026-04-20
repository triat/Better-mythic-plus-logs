import { config } from "../config.ts";
import { getAccessToken } from "./auth.ts";

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
  return json.data;
}
