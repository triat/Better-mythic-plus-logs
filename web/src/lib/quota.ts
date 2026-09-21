// "N pts left this hour": the member's share of the shared Warcraft Logs budget (hosted mode).
import type { T } from "../i18n/t.ts";
import type { QuotaInfo } from "../api.ts";

export function pointsLeft(q: QuotaInfo | null): number | null {
  if (!q || q.limit === null) return null;
  return Math.max(0, q.limit - q.used);
}

export function quotaLabel(t: T, q: QuotaInfo | null): string | null {
  const left = pointsLeft(q);
  if (left === null) return null;
  if (left < 1) return t("header.quota.reached", { min: Math.max(1, Math.ceil(q!.resetInS / 60)) });
  return t("header.quota.leftShort", { left: Math.floor(left) });
}

/** Whether an action estimated at `points` fits in what is left (unlimited or unknown → yes). */
export function canAfford(q: QuotaInfo | null, points: number): boolean {
  const left = pointsLeft(q);
  return left === null || points <= left;
}

/** Tooltip of an Analyze button disabled by the quota. */
export function quotaTooltip(t: T, q: QuotaInfo | null): string {
  return q
    ? t("header.quota.tooltip", { min: Math.max(1, Math.ceil(q.resetInS / 60)) })
    : t("header.quota.tooltipNoReset");
}

/** A refused call as `api.ts` returns it: the 429 kind (null for anything else), the numbers it carried, the server's English message. */
export interface QuotaFailure { code: "quota" | "budget" | null; quota?: QuotaInfo; budget?: QuotaInfo; error: string }

/**
 * A quota/budget 429's dictionary message; falls back to the server's English text for any other failure.
 * Points are REALs on the wire (the meter estimates fractions): rounded here as the server did in its own message.
 */
export function quotaOrBudgetMessage(t: T, r: QuotaFailure): string {
  const min = (s: number) => Math.max(1, Math.ceil(s / 60));
  if (r.code === "quota" && r.quota) return t("errors.quota", { used: Math.round(r.quota.used), limit: Math.round(r.quota.limit ?? 0), min: min(r.quota.resetInS) });
  if (r.code === "budget" && r.budget) return t("errors.budget", { left: Math.round(Math.max(0, (r.budget.limit ?? 0) - r.budget.used)), min: min(r.budget.resetInS) });
  return r.error;
}

/** A 429 body from the quota gate: `error: "quota"` carries the member's own numbers, `error: "budget"` the client's — only the former updates the label. */
export function quotaFromFailure(data: unknown): QuotaInfo | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.error !== "quota" || typeof o.used !== "number" || typeof o.limit !== "number" || typeof o.resetInS !== "number") return null;
  return { used: o.used, limit: o.limit, resetInS: o.resetInS };
}

/** The sibling of `quotaFromFailure` for the shared client's own budget refusal (`error: "budget"`). */
export function budgetFromFailure(data: unknown): QuotaInfo | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.error !== "budget" || typeof o.used !== "number" || typeof o.limit !== "number" || typeof o.resetInS !== "number") return null;
  return { used: o.used, limit: o.limit, resetInS: o.resetInS };
}
