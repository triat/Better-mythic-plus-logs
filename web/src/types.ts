// Types only. Anything runtime from src/ is forbidden here (see spec).
import type { DefensiveSpell, EffectiveEntry, OverrideEntry } from "@shared/deepdive/types.ts";
import type { ProposalSummary } from "@shared/hosted/defensives.ts";
import type { RateLimitSnapshot } from "@shared/wcl/meter.ts";
import type { EnvRow } from "@shared/hosted/instance.ts";
import type { AuditKind, AuditRow } from "@shared/hosted/audit.ts";
import type { HistoryRequest } from "@shared/server-history.ts";
import type { Region } from "@shared/wow/regions.ts";

export type { LookupPayload, SpecSeen } from "@shared/lookup.ts";
export type { Region } from "@shared/wow/regions.ts";
export type { HistoryRequest } from "@shared/server-history.ts";
export type { ProposalSummary } from "@shared/hosted/defensives.ts";
export type { RateLimitSnapshot } from "@shared/wcl/meter.ts";
export type { DefensiveSpell } from "@shared/deepdive/types.ts";
export type { EnvRow } from "@shared/hosted/instance.ts";
export type { AuditAction, AuditKind, AuditRow } from "@shared/hosted/audit.ts";
export type { OwnClientView, OwnClientSnapshot } from "@shared/hosted/wcl-clients.ts";
export type { AxisKey, AxisScore, Confidence, CurvePoints, Driver, Evaluation, Evidence, NextVerdict, Verdict } from "@shared/evaluation/types.ts";
export type { Role } from "@shared/evaluation/types.ts";
export type { EvidenceSource } from "@shared/evaluation/axes/index.ts";
export type { EvaluationDocs, AxisDoc, SubSignalDoc, ExtraDoc, FaqEntry, SourceDoc, TextBlock } from "@shared/evaluation/docs.ts";
export type { DocsResponse } from "@shared/server/routes-shared.ts";
export type { WclClientDoc, LiveAddonDoc } from "@shared/evaluation/docs.ts";
export type { TextSegment } from "./lib/help.ts";
export type { MPlusRun, SeasonDungeon } from "@shared/mplus.ts";
export type { RioProfile, RioRun, RunSignals } from "@shared/signals/types.ts";
export type { LiveVerdict } from "@shared/server/routes-live.ts";
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
  /** The effective request (region included) — what Refresh re-runs. */
  request: HistoryRequest;
}

export interface LookupRequest {
  character: string;
  level?: number | null;
  spec?: string | null;
  metric?: "dps" | "hps" | null;
  /** Lower-case; omitted = the instance default. A pasted Raider.IO URL's own region wins. */
  region?: Region;
  refresh?: boolean;
}

export interface WatchOpts {
  level?: number | string | null;
  spec?: string | null;
  metric?: string | null;
  region?: Region;
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

/** GET /api/admin/users row. */
export interface AdminUser {
  id: number; discordId: string; username: string; globalName: string | null; avatarUrl: string; role: "member" | "admin";
  createdAt: number; lastSeenAt: number; pointsHour: number; points24h: number; sessions: number; configAdmin: boolean;
  bannedAt: number | null; ownClient: boolean;
}
/** GET /api/admin/invites row. */
export interface AdminInvite { discordId: string; invitedBy: string; createdAt: number; note: string | null; user: { id: number; username: string } | null }
/** GET /api/admin/proposals row: the member's proposal plus the entry it would change. */
export interface AdminProposal extends ProposalSummary { key: string; proposedBy: number; username: string | null; current: DefensiveSpell | null; ignored: boolean }
/** GET /api/admin/usage body. */
export interface AdminUsage {
  hourStart: number; resetInS: number; limitPerUser: number; instance: RateLimitSnapshot | null;
  users: Array<{ userId: number; discordId: string | null; username: string | null; role: "member" | "admin" | null; points: number }>;
  hours: Array<{ hourStart: number; points: number }>;
}
/** GET /api/admin/instance body. */
export interface AdminInstance { version: string; uptimeS: number; dbPath: string; dbBytes: number; lastBackupAt: number | null; env: EnvRow[] }
/** GET /api/admin/audit body: one page of rows (newest first), the per-kind totals, WCL/server errors in the last 24 h. */
export interface AdminAudit { rows: AuditRow[]; counts: Record<AuditKind | "all", number>; errors24h: number; nextBefore: number | null }
