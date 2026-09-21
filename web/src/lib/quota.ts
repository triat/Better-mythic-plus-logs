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
