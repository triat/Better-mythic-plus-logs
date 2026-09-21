import type {
  AdminAudit,
  AdminInstance,
  AdminInvite,
  AdminProposal,
  AdminUsage,
  AdminUser,
  AuditKind,
  DefensivesPatch,
  DefensivesPatchResult,
  DefensivesResponse,
  DeepdiveRequest,
  DocsResponse,
  HistoryItem,
  HistoryRequest,
  LookupPayload,
  LookupRequest,
  OwnClientView,
  Region,
  RunDefensives,
  WatchOpts,
  WatchStatus,
} from "./types.ts";
import type { Settings } from "./lib/settings.ts";
import { budgetFromFailure, quotaFromFailure } from "./lib/quota.ts";

/**
 * `code` distinguishes the two 429 refusals when the caller wants the dictionary-driven wording
 * (`errors.quota` / `errors.budget`): `quota` also carries the member's own numbers (and updates the header's
 * quota line), `budget` carries the shared client's numbers for the toast only.
 */
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; code: "quota" | "budget" | null; quota?: QuotaInfo; budget?: QuotaInfo };

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
  | { kind: "ok"; user: MeUser; quota: QuotaInfo | null; ownClient: OwnClientView | null }
  | { kind: "unauthorized" }
  | { kind: "error"; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, error: "Network error", code: null };
  }
  const data = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string; message?: string } & T) | null;
  if (!data || typeof data !== "object") return { ok: false, error: `HTTP ${res.status}`, code: null };
  if (!res.ok || data.ok === false) {
    const quota = quotaFromFailure(data);
    const budget = budgetFromFailure(data);
    return {
      ok: false,
      error: data.message ?? data.error ?? `HTTP ${res.status}`,
      code: quota ? "quota" : budget ? "budget" : null,
      ...(quota ? { quota } : {}),
      ...(budget ? { budget } : {}),
    };
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
  status: () =>
    call<{ hosted: boolean; hasCredentials: boolean; envPath?: string; openSignup?: boolean; guildRequired?: boolean; wclClients?: boolean; operator?: string; region?: Region }>("/api/status"),
  setup: (clientId: string, clientSecret: string) =>
    call<{ envPath: string }>("/api/setup", post({ clientId, clientSecret })),
  lookup: (req: LookupRequest) =>
    call<{ result: LookupPayload; key: string; fromCache: boolean; request: HistoryRequest; pointsSpent?: number; quota?: QuotaInfo; ownClient?: OwnClientView | null }>("/api/lookup", post(req)),
  history: () => call<{ items: HistoryItem[] }>("/api/history"),
  historyEntry: (key: string) => call<{ result: LookupPayload; key: string }>(historyPath(key)),
  removeHistory: (key: string) => call<Record<never, never>>(historyPath(key), { method: "DELETE" }),
  clearHistory: () => call<Record<never, never>>("/api/history", { method: "DELETE" }),
  watchStart: (opts: WatchOpts) => call<WatchStatus>("/api/watch/start", post(opts)),
  watchStop: () => call<{ active: false }>("/api/watch/stop", post()),
  quit: () => call<Record<never, never>>("/api/quit", post()),
  deepdive: (req: DeepdiveRequest) =>
    call<{ result: RunDefensives; fromCache: boolean; pointsSpent: number | null; quota?: QuotaInfo; ownClient?: OwnClientView | null }>("/api/deepdive", post(req)),
  defensives: (className: string, spec: string) =>
    call<DefensivesResponse>(`/api/defensives?class=${encodeURIComponent(className)}&spec=${encodeURIComponent(spec)}`),
  patchDefensives: (body: DefensivesPatch) => call<DefensivesPatchResult>("/api/defensives", post(body)),
  admin: {
    users: () => call<{ users: AdminUser[] }>("/api/admin/users"),
    setRole: (id: number, role: "member" | "admin") => call<{ user: AdminUser }>(`/api/admin/users/${id}/role`, post({ role })),
    revokeSessions: (id: number) => call<{ sessionsEnded: number }>(`/api/admin/users/${id}/sessions/revoke`, post()),
    ban: (id: number) => call<{ user: AdminUser }>(`/api/admin/users/${id}/ban`, post()),
    unban: (id: number) => call<{ user: AdminUser }>(`/api/admin/users/${id}/unban`, post()),
    invites: () => call<{ invites: AdminInvite[] }>("/api/admin/invites"),
    addInvite: (discordId: string, note: string | null) => call<{ invite: Omit<AdminInvite, "user"> }>("/api/admin/invites", post({ discordId, note })),
    removeInvite: (discordId: string) => call<{ sessionsEnded: number }>(`/api/admin/invites/${encodeURIComponent(discordId)}`, { method: "DELETE" }),
    proposals: (status: "pending" | "approved" | "rejected") => call<{ proposals: AdminProposal[] }>(`/api/admin/proposals?status=${status}`),
    decide: (id: number, decision: "approve" | "reject", note: string | null) => call<{ proposal: AdminProposal }>(`/api/admin/proposals/${id}/${decision}`, post({ note })),
    usage: () => call<AdminUsage>("/api/admin/usage"),
    instance: () => call<AdminInstance>("/api/admin/instance"),
    audit: (o: { kind: AuditKind | "all"; before?: number | null; limit?: number }) =>
      call<AdminAudit>(`/api/admin/audit?kind=${o.kind}${o.before ? `&before=${o.before}` : ""}&limit=${o.limit ?? 50}`),
  },
  /** The member's own Warcraft Logs client and account (issue #11): the secret is write-only, the id comes back abbreviated. */
  account: {
    wclClient: () => call<{ enabled: boolean; client: OwnClientView | null }>("/api/me/wcl-client"),
    saveWclClient: (clientId: string, clientSecret: string) =>
      call<{ client: OwnClientView }>("/api/me/wcl-client", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, clientSecret }) }),
    verifyWclClient: () => call<{ client: OwnClientView }>("/api/me/wcl-client/verify", post()),
    removeWclClient: () => call<Record<never, never>>("/api/me/wcl-client", { method: "DELETE" }),
    deleteAccount: () => call<Record<never, never>>("/api/me", { method: "DELETE" }),
  },
  /** The documentation registry plus the effective evaluation config (/help): 0 WCL pts, readable signed out. */
  docs: () => call<Omit<DocsResponse, "ok">>("/api/docs"),
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
    const data = (await res.json().catch(() => null)) as { ok?: boolean; user?: MeUser; quota?: QuotaInfo; ownClient?: OwnClientView | null; error?: string } | null;
    if (!res.ok || !data?.ok || !data.user) return { kind: "error", error: data?.error ?? `HTTP ${res.status}` };
    return { kind: "ok", user: data.user, quota: data.quota ?? null, ownClient: data.ownClient ?? null };
  },
  logout: () => call<Record<never, never>>("/auth/logout", post()),
};
