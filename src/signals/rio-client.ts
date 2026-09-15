import { realmToSlug } from "../util.ts";
import { parseRioProfile, rioProfileUrl } from "./rio-profile.ts";
import type { Store } from "./store.ts";
import type { RioProfile } from "./types.ts";

export const RIO_RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface RioFetchResult {
  profile: RioProfile | null;
  error?: string;
  fromCache: boolean;
}

interface Opts {
  refresh?: boolean;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchRioProfile(
  region: string,
  realm: string,
  name: string,
  store: Store,
  opts: Opts = {},
): Promise<RioFetchResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const slug = realmToSlug(realm);

  if (!opts.refresh) {
    const hit = store.getRio(region, slug, name, { now: now() });
    if (hit) return { profile: parseRioProfile(hit.raw, hit.fetchedAt), fromCache: true };
  }

  const url = rioProfileUrl(region, slug, name);
  let lastError = "Raider.IO unavailable";
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(url);
      if (res.ok) {
        const raw: unknown = await res.json();
        const t = now();
        store.putRio(region, slug, name, raw, t);
        return { profile: parseRioProfile(raw, t), fromCache: false };
      }
      if (res.status === 400 || res.status === 404) {
        return { profile: null, error: "Not found on Raider.IO", fromCache: false };
      }
      lastError = `Raider.IO unavailable (HTTP ${res.status})`;
    } catch (e) {
      lastError = `Raider.IO unreachable (${e instanceof Error ? e.message : String(e)})`;
    }
    if (attempt >= RIO_RETRY_DELAYS_MS.length) break;
    await sleep(RIO_RETRY_DELAYS_MS[attempt]!);
  }
  return { profile: null, error: lastError, fromCache: false };
}
