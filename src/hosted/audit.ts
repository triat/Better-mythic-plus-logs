// Hosted-mode audit log: who did what, from where, and what went wrong — the admin page's "Audit"
// section reads it through GET /api/admin/audit. A request-scoped recorder (AsyncLocalStorage, like
// the PointsMeter) lets any code that runs inside a request record a row without threading the
// user/ip/target through; `record` never throws, since a logging failure must not fail the request.
// Rows never carry secrets, cookies or full WCL bodies: callers clip every free-text string in
// `detail`; `record` itself bounds `target` (300) and `ip` (64), which come straight from the request.
import { AsyncLocalStorage } from "node:async_hooks";
import type { HostedDb } from "./db.ts";

export type AuditAction =
  | "login" | "login_denied" | "logout" | "account_delete" | "wcl_client_set" | "wcl_client_remove"
  | "invite_add" | "invite_remove" | "role_change" | "sessions_revoke" | "proposal_approve" | "proposal_reject"
  | "user_ban" | "user_unban"
  | "quota_refused"
  | "rate_limited" | "origin_rejected"
  | "wcl_error" | "server_error";
export type AuditKind = "login" | "admin" | "quota" | "security" | "error";

export const AUDIT_KINDS: readonly AuditKind[] = ["login", "admin", "quota", "security", "error"];

export const ACTION_KIND: Record<AuditAction, AuditKind> = {
  login: "login",
  login_denied: "login",
  logout: "login",
  account_delete: "login",
  wcl_client_set: "login",
  wcl_client_remove: "login",
  invite_add: "admin",
  invite_remove: "admin",
  role_change: "admin",
  sessions_revoke: "admin",
  proposal_approve: "admin",
  proposal_reject: "admin",
  user_ban: "admin",
  user_unban: "admin",
  quota_refused: "quota",
  rate_limited: "security",
  origin_rejected: "security",
  wcl_error: "error",
  server_error: "error",
};

export const kindOf = (a: AuditAction): AuditKind => ACTION_KIND[a];
export const actionsOf = (k: AuditKind): AuditAction[] => (Object.keys(ACTION_KIND) as AuditAction[]).filter((a) => ACTION_KIND[a] === k);

export interface AuditRow {
  id: number;
  at: number;
  userId: number | null;
  /** Joined from users at read time; null once the user is gone. */
  username: string | null;
  action: AuditAction;
  target: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

/** What a caller may give `record`; anything absent comes from the request scope (an explicit `null` wins over the scope). */
export interface AuditEntry {
  userId?: number | null;
  target?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
  at?: number;
}

export const AUDIT_RETENTION_MS = 90 * 24 * 3600_000;

/** Truncates to `n` characters with an ellipsis — every free-text string stored in a row goes through this. */
export const clip = (s: string, n = 300): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export interface AuditScope { userId: number | null; ip: string; target: string }

export class AuditLog {
  private readonly als = new AsyncLocalStorage<AuditScope>();

  constructor(private readonly repo: HostedDb["audit"]) {}

  /** Runs `fn` with `scope` as the default user/ip/target of every `record` inside it. */
  scope<T>(scope: AuditScope, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ ...scope }, fn);
  }

  /** Refines the running request's target (e.g. `POST /api/lookup` → `lookup Name-Realm`); no-op outside a scope. */
  setTarget(target: string): void {
    const s = this.als.getStore();
    if (s) s.target = target;
  }

  /** The running request's scope, or undefined outside `scope`. */
  current(): AuditScope | undefined {
    return this.als.getStore();
  }

  /** Inserts one row (`target` clipped to 300 chars, `ip` to 64); a failure is reported once on stderr and otherwise swallowed. */
  record(action: AuditAction, e: AuditEntry = {}): void {
    const s = this.als.getStore();
    try {
      const target = e.target !== undefined ? e.target : s?.target ?? null;
      const ip = e.ip !== undefined ? e.ip : s?.ip ?? null;
      this.repo.add({
        at: e.at ?? Date.now(),
        userId: e.userId !== undefined ? e.userId : s?.userId ?? null,
        action,
        target: target === null ? null : clip(target, 300),
        detail: e.detail ? JSON.stringify(e.detail) : null,
        ip: ip === null ? null : clip(ip, 64),
      });
    } catch (err) {
      console.error(`audit: could not record ${action}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
