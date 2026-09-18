// "N pts left this hour": the member's share of the shared Warcraft Logs budget (hosted mode).
import type { QuotaInfo } from "../api.ts";

export function pointsLeft(q: QuotaInfo | null): number | null {
  if (!q || q.limit === null) return null;
  return Math.max(0, q.limit - q.used);
}

export function quotaLabel(q: QuotaInfo | null): string | null {
  const left = pointsLeft(q);
  if (left === null) return null;
  if (left < 1) return `quota reached · resets in ${Math.max(1, Math.ceil(q!.resetInS / 60))} min`;
  return `${Math.floor(left)} pts left this hour`;
}

/** Whether an action estimated at `points` fits in what is left (unlimited or unknown → yes). */
export function canAfford(q: QuotaInfo | null, points: number): boolean {
  const left = pointsLeft(q);
  return left === null || points <= left;
}

/** Tooltip of an Analyze button disabled by the quota. */
export function quotaTooltip(q: QuotaInfo | null): string {
  return q ? `Hourly quota reached · resets in ${Math.max(1, Math.ceil(q.resetInS / 60))} min` : "Hourly quota reached";
}

/** A 429 body from the quota gate: `error: "quota"` carries the member's own numbers, `error: "budget"` the client's — only the former updates the label. */
export function quotaFromFailure(data: unknown): QuotaInfo | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.error !== "quota" || typeof o.used !== "number" || typeof o.limit !== "number" || typeof o.resetInS !== "number") return null;
  return { used: o.used, limit: o.limit, resetInS: o.resetInS };
}
