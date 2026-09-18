// Types only. Anything runtime from src/ is forbidden here (see spec).
import type { EffectiveEntry, OverrideEntry } from "@shared/deepdive/types.ts";
import type { ProposalSummary } from "@shared/hosted/defensives.ts";

export type { LookupPayload } from "@shared/lookup.ts";
export type { ProposalSummary } from "@shared/hosted/defensives.ts";
export type { AxisKey, AxisScore, Confidence, Evaluation, Evidence, Verdict } from "@shared/evaluation/types.ts";
export type { MPlusRun, SeasonDungeon } from "@shared/mplus.ts";
export type { RioProfile, RioRun, RunSignals } from "@shared/signals/types.ts";
export type { SignalSummary } from "@shared/signals/summary.ts";
export type { Metric } from "@shared/roles.ts";
export type {
  RunDefensives,
  DeathAnalysis,
  DefensiveUse,
  EffectiveEntry,
  EntryOrigin,
  OverrideEntry,
  DeepdiveSummary,
  DefensiveKind,
} from "@shared/deepdive/types.ts";

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

export interface DeepdiveRequest {
  reportCode: string;
  fightID: number;
  character: string;
  force?: boolean;
}

export interface DefensivesResponse {
  key: string;
  entries: EffectiveEntry[];
  ignored: number[];
  tableMissing: boolean;
  overridePath: string | null;
  warning?: string | null;
  proposals?: ProposalSummary[];
}

export interface DefensivesPatch {
  className: string;
  spec: string;
  patch: OverrideEntry;
}

export interface DefensivesPatchResult extends DefensivesResponse {
  proposal?: ProposalSummary;
}
