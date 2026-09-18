import type {
  AdminInstance,
  AdminInvite,
  AdminProposal,
  AdminUsage,
  AdminUser,
  DefensivesPatch,
  DefensivesPatchResult,
  DefensivesResponse,
  DeepdiveRequest,
  HistoryItem,
  LookupPayload,
  LookupRequest,
  RunDefensives,
  WatchOpts,
  WatchStatus,
} from "./types.ts";
import type { Settings } from "./lib/settings.ts";
import { quotaFromFailure } from "./lib/quota.ts";

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; quota?: QuotaInfo };

export interface MeUser {
  id: number;
  discordId: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
  role: "member" | "admin";
}
/** The member's share of the shared Warcraft Logs budget (hosted mode only). */
export interface QuotaInfo { used: number; limit: number | null; resetInS: number }
export type MeResult =
  | { kind: "ok"; user: MeUser; quota: QuotaInfo | null }
  | { kind: "unauthorized" }
  | { kind: "error"; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, error: "Network error" };
  }
  const data = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string; message?: string } & T) | null;
  if (!data || typeof data !== "object") return { ok: false, error: `HTTP ${res.status}` };
  if (!res.ok || data.ok === false) {
    const quota = quotaFromFailure(data);
    return { ok: false, error: data.message ?? data.error ?? `HTTP ${res.status}`, ...(quota ? { quota } : {}) };
  }
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
    call<{ result: LookupPayload; key: string; fromCache: boolean; pointsSpent?: number; quota?: QuotaInfo }>("/api/lookup", post(req)),
  history: () => call<{ items: HistoryItem[] }>("/api/history"),
  historyEntry: (key: string) => call<{ result: LookupPayload; key: string }>(historyPath(key)),
  removeHistory: (key: string) => call<Record<never, never>>(historyPath(key), { method: "DELETE" }),
  clearHistory: () => call<Record<never, never>>("/api/history", { method: "DELETE" }),
  watchStart: (opts: WatchOpts) => call<WatchStatus>("/api/watch/start", post(opts)),
  watchStop: () => call<{ active: false }>("/api/watch/stop", post()),
  quit: () => call<Record<never, never>>("/api/quit", post()),
  deepdive: (req: DeepdiveRequest) =>
    call<{ result: RunDefensives; fromCache: boolean; pointsSpent: number | null; quota?: QuotaInfo }>("/api/deepdive", post(req)),
  defensives: (className: string, spec: string) =>
    call<DefensivesResponse>(`/api/defensives?class=${encodeURIComponent(className)}&spec=${encodeURIComponent(spec)}`),
  patchDefensives: (body: DefensivesPatch) => call<DefensivesPatchResult>("/api/defensives", post(body)),
  adminProposals: () => call<{ proposals: Array<{ id: number }> }>("/api/admin/proposals"),
  admin: {
    users: () => call<{ users: AdminUser[] }>("/api/admin/users"),
    setRole: (id: number, role: "member" | "admin") => call<{ user: AdminUser }>(`/api/admin/users/${id}/role`, post({ role })),
    revokeSessions: (id: number) => call<{ sessionsEnded: number }>(`/api/admin/users/${id}/sessions/revoke`, post()),
    invites: () => call<{ invites: AdminInvite[] }>("/api/admin/invites"),
    addInvite: (discordId: string, note: string | null) => call<{ invite: Omit<AdminInvite, "user"> }>("/api/admin/invites", post({ discordId, note })),
    removeInvite: (discordId: string) => call<{ sessionsEnded: number }>(`/api/admin/invites/${encodeURIComponent(discordId)}`, { method: "DELETE" }),
    proposals: (status: "pending" | "approved" | "rejected") => call<{ proposals: AdminProposal[] }>(`/api/admin/proposals?status=${status}`),
    decide: (id: number, decision: "approve" | "reject", note: string | null) => call<{ proposal: AdminProposal }>(`/api/admin/proposals/${id}/${decision}`, post({ note })),
    usage: () => call<AdminUsage>("/api/admin/usage"),
    instance: () => call<AdminInstance>("/api/admin/instance"),
  },
  settings: () => call<{ settings: Settings }>("/api/settings"),
  putSettings: (patch: Partial<Settings>) =>
    call<{ settings: Settings }>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
  me: async (): Promise<MeResult> => {
    let res: Response;
    try {
      res = await fetch("/api/me");
    } catch {
      return { kind: "error", error: "Network error" };
    }
    if (res.status === 401) return { kind: "unauthorized" };
    const data = (await res.json().catch(() => null)) as { ok?: boolean; user?: MeUser; quota?: QuotaInfo; error?: string } | null;
    if (!res.ok || !data?.ok || !data.user) return { kind: "error", error: data?.error ?? `HTTP ${res.status}` };
    return { kind: "ok", user: data.user, quota: data.quota ?? null };
  },
  logout: () => call<Record<never, never>>("/auth/logout", post()),
};
