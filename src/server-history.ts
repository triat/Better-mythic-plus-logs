import type { Metric } from "./roles.ts";

export interface HistoryRequest {
  character: string;
  level: number | null;
  spec: string | null;
  metric: Metric | null;
}

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
}

export type HistoryRecord = Omit<HistoryEntry, "key" | "request" | "fetchedAt">;

/** Cache key: character + effective level + spec + metric. `level: null` is the auto-alias key. */
export const cacheKey = (r: HistoryRequest): string =>
  JSON.stringify([
    r.character.trim().toLowerCase(),
    r.level ?? "auto",
    r.spec ? r.spec.trim().toLowerCase() : "",
    r.metric ?? "",
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
  /** Store a fresh result; returns the entry (its key uses the effective level). */
  record(r: HistoryRequest, rec: HistoryRecord): HistoryEntry;
  get(key: string): HistoryEntry | undefined;
  /** Newest first, without payloads. */
  list(): HistoryListItem[];
  remove(key: string): boolean;
  clear(): void;
  /** Replace the stored payload of an entry (e.g. after a deep-dive changed its analyses); no-op for unknown keys. */
  updateResult(key: string, result: unknown): void;
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
    const entry: HistoryEntry = { key, request: r, fetchedAt: this.now(), ...rec };
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
    if (e) e.result = result;
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
