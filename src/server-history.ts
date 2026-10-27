import type { Metric } from "./roles.ts";
import { type Region, isRegion } from "./wow/regions.ts";

export interface HistoryRequest {
  character: string;
  level: number | null;
  spec: string | null;
  metric: Metric | null;
  region: Region;
}

/** A stored request (JSON) may predate the region: default it. */
export const requestFromJson = (json: string, fallbackRegion: Region): HistoryRequest => {
  const r = JSON.parse(json) as Omit<HistoryRequest, "region"> & { region?: unknown };
  return { ...r, region: isRegion(r.region) ? r.region : fallbackRegion };
};

export interface HistoryEntry {
  key: string;
  request: HistoryRequest;
  fetchedAt: number;
  // Full payload sent to the client (same shape as a non-cached /api/lookup response).
  result: unknown;
  // Summary fields used to render the tab strip + compare view.
  label: string;
  charClass: number;
  spec: string | null;
  targetLevel: number;
  targetAutoDetected: boolean;
  /** The evaluation's verdict (null for INSUFFICIENT DATA or a payload without one), derived from `result`. */
  verdict: HistoryVerdict | null;
  /** The evaluation's global score, derived from `result`. */
  score: number | null;
  /** How far the score moves when one run is left out (max distance to `range.low` / `range.high`), from `result`. */
  spread: number | null;
  /** The target level is not proven (`evaluation.level.proven` false), from `result`; null when unknown. */
  unproven: boolean | null;
}

export type HistoryVerdict = "invite" | "maybe" | "pass";

/** What a caller stores: the summary is never passed, the stores derive it from `result` (`summaryOf`). */
export type HistoryRecord = Omit<HistoryEntry, "key" | "request" | "fetchedAt" | "verdict" | "score" | "spread" | "unproven">;

export interface HistorySummary { verdict: HistoryVerdict | null; score: number | null; spread: number | null; unproven: boolean | null }

const VERDICTS: readonly unknown[] = ["invite", "maybe", "pass"] satisfies HistoryVerdict[];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * `result.evaluation.verdict` / `.global` / `.range` / `.level`, read defensively: null when absent or of the wrong
 * type (a payload evaluated before 2026-10-27 has no range or level).
 */
export function summaryOf(result: unknown): HistorySummary {
  const ev = typeof result === "object" && result !== null ? (result as { evaluation?: unknown }).evaluation : undefined;
  if (typeof ev !== "object" || ev === null) return { verdict: null, score: null, spread: null, unproven: null };
  const { verdict, global, range, level } = ev as { verdict?: unknown; global?: unknown; range?: unknown; level?: unknown };
  const score = finite(global) ? global : null;
  const r = typeof range === "object" && range !== null ? range as { low?: unknown; high?: unknown } : null;
  const proven = typeof level === "object" && level !== null ? (level as { proven?: unknown }).proven : undefined;
  return {
    verdict: VERDICTS.includes(verdict) ? verdict as HistoryVerdict : null,
    score,
    spread: score !== null && r && finite(r.low) && finite(r.high) ? Math.max(score - r.low, r.high - score, 0) : null,
    unproven: typeof proven === "boolean" ? !proven : null,
  };
}

/** Cache key: character + effective level + spec + metric + region. `level: null` is the auto-alias key. */
export const cacheKey = (r: HistoryRequest): string =>
  JSON.stringify([
    r.character.trim().toLowerCase(),
    r.level ?? "auto",
    r.spec ? r.spec.trim().toLowerCase() : "",
    r.metric ?? "",
    r.region,
  ]);

/** A history entry without its payload — what the tab strip needs. */
export type HistoryListItem = Omit<HistoryEntry, "result">;

/**
 * One caller's lookup history. Local mode: `History` below (in memory, one per process).
 * Hosted mode: `src/hosted/history.ts` (SQLite, one per user).
 */
export interface HistoryStore {
  readonly size: number;
  /** Cache hit (moved to the newest position) or null. */
  cached(r: HistoryRequest): HistoryEntry | null;
  /**
   * `cached()` without any write: no recency bump, and (hosted) no copy of another member's entry into
   * the caller's own history. For readers that answer a question rather than serve a lookup —
   * `POST /api/live/cached` runs on every Group Finder roster change, with up to 40 names, and must not
   * churn or evict the member's real lookups (nor persist an applicant's name; see `docs/hosted.md`).
   */
  peek(r: HistoryRequest): HistoryEntry | null;
  /** Store a fresh result; returns the entry (its key uses the effective level). */
  record(r: HistoryRequest, rec: HistoryRecord): HistoryEntry;
  get(key: string): HistoryEntry | undefined;
  /** Newest first, without payloads. */
  list(): HistoryListItem[];
  remove(key: string): boolean;
  clear(): void;
  /** Replace the stored payload of an entry (e.g. after a deep-dive changed its analyses); no-op for unknown keys. */
  updateResult(key: string, result: unknown): void;
  /**
   * Set only the row's verdict and score from `result` (a re-evaluated copy of the stored payload): the payload,
   * `fetchedAt` and the order stay as they are. `fetchedAt` is the stored entry's the caller re-evaluated: when the row
   * was replaced since (a Refresh landing in between), its summary is the newer payload's and stays. No-op for unknown
   * keys or when nothing changed.
   */
  syncSummary(key: string, result: unknown, fetchedAt: number): void;
}

/**
 * Lookup history, newest last in insertion order. Entries are keyed by the
 * *effective* target level, so an auto-detected +21 and an explicit +21 are
 * the same tab. An auto request remembers the level it resolved to
 * (`autoLevel`) so the next auto request for the same character is a cache hit.
 */
export class History implements HistoryStore {
  private readonly entries = new Map<string, HistoryEntry>();
  private readonly autoLevel = new Map<string, number>(); // auto-alias key → effective level

  constructor(private readonly max: number, private readonly now: () => number = Date.now) {}

  get size(): number { return this.entries.size; }

  /** Effective key for a request, or null when an auto request has not been resolved yet. */
  private resolveKey(r: HistoryRequest): string | null {
    if (r.level !== null) return cacheKey(r);
    const level = this.autoLevel.get(cacheKey(r));
    return level === undefined ? null : cacheKey({ ...r, level });
  }

  /** Cache hit (moved to the newest position) or null. */
  cached(r: HistoryRequest): HistoryEntry | null {
    const key = this.resolveKey(r);
    const entry = key === null ? undefined : this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key!);
    this.entries.set(key!, entry);
    return entry;
  }

  /** Cache lookup with no write at all: the insertion order (the LRU the tab strip shows) is untouched. */
  peek(r: HistoryRequest): HistoryEntry | null {
    const key = this.resolveKey(r);
    return (key === null ? undefined : this.entries.get(key)) ?? null;
  }

  /** Store a fresh result; returns the entry (its key uses the effective level). */
  record(r: HistoryRequest, rec: HistoryRecord): HistoryEntry {
    const key = cacheKey({ ...r, level: rec.targetLevel });
    if (r.level === null) {
      const aliasKey = cacheKey(r);
      const previous = this.autoLevel.get(aliasKey);
      // The auto-detected level moved: drop the stale auto entry (never an explicit one).
      if (previous !== undefined && previous !== rec.targetLevel) {
        const old = this.entries.get(cacheKey({ ...r, level: previous }));
        if (old?.targetAutoDetected) this.entries.delete(old.key);
      }
      this.autoLevel.set(aliasKey, rec.targetLevel);
    }
    const entry: HistoryEntry = { key, request: r, fetchedAt: this.now(), ...rec, ...summaryOf(rec.result) };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.forget(oldest);
    }
    return entry;
  }

  get(key: string): HistoryEntry | undefined { return this.entries.get(key); }

  /** Newest first. */
  list(): HistoryEntry[] { return [...this.entries.values()].reverse(); }

  remove(key: string): boolean {
    if (!this.entries.has(key)) return false;
    this.forget(key);
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.autoLevel.clear();
  }

  /** Replace the stored payload of an entry (e.g. after a deep-dive changed its analyses); no-op for unknown keys. */
  updateResult(key: string, result: unknown): void {
    const e = this.entries.get(key);
    if (e) Object.assign(e, { result }, summaryOf(result));
  }

  syncSummary(key: string, result: unknown, fetchedAt: number): void {
    const e = this.entries.get(key);
    if (e && e.fetchedAt === fetchedAt) Object.assign(e, summaryOf(result));
  }

  private forget(key: string): void {
    const e = this.entries.get(key);
    this.entries.delete(key);
    if (!e) return;
    // Drop the auto alias only if it pointed at this entry.
    const aliasKey = cacheKey({ ...e.request, level: null });
    if (this.autoLevel.get(aliasKey) === e.targetLevel) this.autoLevel.delete(aliasKey);
  }
}
