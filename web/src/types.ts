// Types only. Anything runtime from src/ is forbidden here (see spec).
export type { LookupPayload } from "@shared/lookup.ts";
export type { AxisKey, AxisScore, Confidence, Evaluation, Evidence, Verdict } from "@shared/evaluation/types.ts";
export type { MPlusRun, SeasonDungeon } from "@shared/mplus.ts";
export type { RioProfile, RioRun, RunSignals } from "@shared/signals/types.ts";
export type { SignalSummary } from "@shared/signals/summary.ts";
export type { Metric } from "@shared/roles.ts";

/** One row of GET /api/history (server's `historySummary`). */
export interface HistoryItem {
  key: string;
  label: string;
  charClass: number;
  spec: string | null;
  targetLevel: number;
  targetAutoDetected: boolean;
  fetchedAt: number;
  request: { character: string; level: number | null; spec: string | null; metric: "dps" | "hps" | null };
}

export interface LookupRequest {
  character: string;
  level?: number | string | null;
  spec?: string | null;
  metric?: string | null;
  refresh?: boolean;
}

export interface WatchOpts {
  level?: number | string | null;
  spec?: string | null;
  metric?: string | null;
}

export interface WatchStatus {
  active: boolean;
  opts: WatchOpts | null;
  backend: string | null;
}
