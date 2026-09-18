import type {
  DefensivesPatch,
  DefensivesResponse,
  DeepdiveRequest,
  HistoryItem,
  LookupPayload,
  LookupRequest,
  RunDefensives,
  WatchOpts,
  WatchStatus,
} from "./types.ts";

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface MeUser {
  id: number;
  discordId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
  role: "member" | "admin";
}
export type MeResult = { kind: "ok"; user: MeUser } | { kind: "unauthorized" } | { kind: "error"; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, error: "Network error" };
  }
  const data = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  if (!data || typeof data !== "object") return { ok: false, error: `HTTP ${res.status}` };
  if (!res.ok || data.ok === false) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
  return { ...data, ok: true } as ApiResult<T>;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const historyPath = (key: string) => `/api/history/${encodeURIComponent(key)}`;

export const api = {
  status: () => call<{ hosted: boolean; hasCredentials: boolean; envPath?: string }>("/api/status"),
  setup: (clientId: string, clientSecret: string) =>
    call<{ envPath: string }>("/api/setup", post({ clientId, clientSecret })),
  lookup: (req: LookupRequest) =>
    call<{ result: LookupPayload; key: string; fromCache: boolean }>("/api/lookup", post(req)),
  history: () => call<{ items: HistoryItem[] }>("/api/history"),
  historyEntry: (key: string) => call<{ result: LookupPayload; key: string }>(historyPath(key)),
  removeHistory: (key: string) => call<Record<never, never>>(historyPath(key), { method: "DELETE" }),
  clearHistory: () => call<Record<never, never>>("/api/history", { method: "DELETE" }),
  watchStart: (opts: WatchOpts) => call<WatchStatus>("/api/watch/start", post(opts)),
  watchStop: () => call<{ active: false }>("/api/watch/stop", post()),
  quit: () => call<Record<never, never>>("/api/quit", post()),
  deepdive: (req: DeepdiveRequest) =>
    call<{ result: RunDefensives; fromCache: boolean; pointsSpent: number | null }>("/api/deepdive", post(req)),
  defensives: (className: string, spec: string) =>
    call<DefensivesResponse>(`/api/defensives?class=${encodeURIComponent(className)}&spec=${encodeURIComponent(spec)}`),
  patchDefensives: (body: DefensivesPatch) => call<DefensivesResponse>("/api/defensives", post(body)),
  me: async (): Promise<MeResult> => {
    let res: Response;
    try {
      res = await fetch("/api/me");
    } catch {
      return { kind: "error", error: "Network error" };
    }
    if (res.status === 401) return { kind: "unauthorized" };
    const data = (await res.json().catch(() => null)) as { ok?: boolean; user?: MeUser; error?: string } | null;
    if (!res.ok || !data?.ok || !data.user) return { kind: "error", error: data?.error ?? `HTTP ${res.status}` };
    return { kind: "ok", user: data.user };
  },
  logout: () => call<Record<never, never>>("/auth/logout", post()),
};
