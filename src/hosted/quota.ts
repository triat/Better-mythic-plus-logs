// Per-member hourly WCL quota plus a global floor for the shared client. Pure over the usage
// repository and the meter's last snapshot; `reserve` is consulted before spending and never writes.
import type { PointsMeter } from "../wcl/meter.ts";
import { HOUR_MS, hourStart } from "./db.ts";
import type { HostedDb, Role } from "./db.ts";

/** The shared client is never driven below this many points left, so cached lookups keep working for everyone. */
export const POINTS_FLOOR = 100;

export interface Quota { used: number; limit: number | null; resetInS: number }
export interface QuotaRefusal { error: "quota" | "budget"; message: string; used: number; limit: number; resetInS: number }
export interface QuotaUser { id: number; role: Role }
export type Reserve = (estimate: number) => QuotaRefusal | null;

export const resetInS = (at: number): number => Math.ceil((hourStart(at) + HOUR_MS - at) / 1000);
const minutes = (s: number): string => `${Math.ceil(s / 60)} min`;

export class QuotaGate {
  constructor(private readonly deps: { usage: HostedDb["usage"]; meter: PointsMeter; limit: number; now?: () => number }) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }

  status(user: QuotaUser): Quota {
    const at = this.now();
    return { used: this.deps.usage.used(user.id, at), limit: user.role === "admin" ? null : this.deps.limit, resetInS: resetInS(at) };
  }

  /** null = go ahead; otherwise why the estimated spend is refused. Nothing is spent either way. */
  reserve(user: QuotaUser, estimate: number): QuotaRefusal | null {
    const at = this.now();
    if (user.role !== "admin") {
      const used = this.deps.usage.used(user.id, at);
      if (used + estimate > this.deps.limit) {
        const r = resetInS(at);
        return { error: "quota", message: `Hourly quota reached (${Math.round(used)}/${this.deps.limit} pts) — resets in ${minutes(r)}`, used, limit: this.deps.limit, resetInS: r };
      }
    }
    const snap = this.deps.meter.snapshot();
    if (snap && at < snap.windowEnd) {
      const left = snap.limitPerHour - snap.pointsSpentThisHour;
      if (left - estimate < POINTS_FLOOR) {
        const r = Math.max(1, Math.ceil((snap.windowEnd - at) / 1000));
        return { error: "budget", message: `The shared WCL budget is nearly exhausted (${Math.round(left)} pts left) — resets in ${minutes(r)}`, used: snap.pointsSpentThisHour, limit: snap.limitPerHour, resetInS: r };
      }
    }
    return null;
  }

  /** Bound to one user, for the lookup and deep-dive code paths. */
  for(user: QuotaUser): Reserve { return (estimate) => this.reserve(user, estimate); }
}
