// `calibration.db`: the weekly recalibration's samples, its discovery pages and pool, and the failures it must not
// retry. Opened next to `.env` (`resolveCalibrationDbPath`), never `bmpl.db`. The lookups the collector runs cache their
// raw WCL and Raider.IO answers in the same file (`openStore`), so they never reach the instance's store either.
// Spec: docs/superpowers/specs/2026-10-14-weekly-recalibration-design.md (decisions 6 and 7).
import { Database } from "bun:sqlite";
import type { EvalPayload } from "../evaluation/inputs.ts";
import { type Candidate, cellOf, type PoolEntry } from "./discover.ts";
import type { Sample } from "./fit.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cal_samples (
  key          TEXT    NOT NULL,
  season       INTEGER NOT NULL,
  study        TEXT    NOT NULL,
  cell         TEXT    NOT NULL,
  collected_at INTEGER NOT NULL,
  payload      BLOB    NOT NULL,
  PRIMARY KEY (key, season)
);
CREATE INDEX IF NOT EXISTS cal_samples_at ON cal_samples (season, collected_at);
CREATE TABLE IF NOT EXISTS cal_failed (
  key    TEXT    NOT NULL,
  season INTEGER NOT NULL,
  at     INTEGER NOT NULL,
  error  TEXT    NOT NULL,
  PRIMARY KEY (key, season)
);
CREATE TABLE IF NOT EXISTS cal_pages (
  season    INTEGER NOT NULL,
  cycle     INTEGER NOT NULL,
  encounter INTEGER NOT NULL,
  spec      TEXT    NOT NULL,
  page      INTEGER NOT NULL,
  json      TEXT    NOT NULL,
  PRIMARY KEY (season, cycle, encounter, spec, page)
);
CREATE TABLE IF NOT EXISTS cal_pool (
  season   INTEGER NOT NULL,
  cycle    INTEGER NOT NULL,
  built_at INTEGER NOT NULL,
  json     TEXT    NOT NULL,
  PRIMARY KEY (season, cycle)
);
`;

/** The lookups' cache tables (src/signals/store.ts) and the column that dates a row, pruned with the samples. */
const CACHE_TABLES: [string, string][] = [
  ["wcl_run_raw", "fetched_at"], ["wcl_deepdive", "fetched_at"], ["wcl_run_control", "fetched_at"],
  ["rio_profile", "fetched_at"], ["character_runs", "seen_at"],
];

export interface SampleStore {
  put(study: Candidate, payload: EvalPayload, season: number, now: number): void;
  /** Whether this character was sampled (or failed) in `season` since `since`: the collector skips it. */
  done(key: string, season: number, since: number): boolean;
  fail(key: string, season: number, now: number, error: string): void;
  /** Samples per cell (`role|level|quintile`) and in all, in `season` since `since`. */
  count(season: number, since: number): { total: number; cells: Map<string, number> };
  list(season: number, since: number): Sample[];
  getPage(season: number, cycle: number, encounter: number, spec: string, page: number): unknown[] | null;
  putPage(season: number, cycle: number, encounter: number, spec: string, page: number, rows: unknown[]): void;
  putPool(season: number, cycle: number, pool: PoolEntry[], now: number): void;
  /** The newest pool of `season` (any cycle), or null before the first discovery completes. */
  latestPool(season: number): { cycle: number; builtAt: number; pool: PoolEntry[] } | null;
  /**
   * Drops every sample, failure, page and pool of another season, those of `season` older than `keepSince`, and the
   * lookups' cache rows older than `keepSince`.
   */
  prune(season: number, keepSince: number): void;
  close(): void;
}

const gzip = (s: string): Uint8Array => Bun.gzipSync(new TextEncoder().encode(s));
const gunzip = (b: Uint8Array<ArrayBuffer>): string => new TextDecoder().decode(Bun.gunzipSync(b));

export function openSamples(path: string): SampleStore {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  const putQ = db.query("INSERT OR REPLACE INTO cal_samples (key, season, study, cell, collected_at, payload) VALUES (?, ?, ?, ?, ?, ?)");
  const doneQ = db.query<{ one: number }, [string, number, number, string, number, number]>(
    "SELECT 1 AS one FROM cal_samples WHERE key = ? AND season = ? AND collected_at >= ? " +
    "UNION ALL SELECT 1 FROM cal_failed WHERE key = ? AND season = ? AND at >= ? LIMIT 1",
  );
  const failQ = db.query("INSERT OR REPLACE INTO cal_failed (key, season, at, error) VALUES (?, ?, ?, ?)");
  const countQ = db.query<{ cell: string; n: number }, [number, number]>(
    "SELECT cell, COUNT(*) AS n FROM cal_samples WHERE season = ? AND collected_at >= ? GROUP BY cell",
  );
  const listQ = db.query<{ study: string; payload: Uint8Array<ArrayBuffer> }, [number, number]>(
    "SELECT study, payload FROM cal_samples WHERE season = ? AND collected_at >= ? ORDER BY key",
  );
  const getPageQ = db.query<{ json: string }, [number, number, number, string, number]>(
    "SELECT json FROM cal_pages WHERE season = ? AND cycle = ? AND encounter = ? AND spec = ? AND page = ?",
  );
  const putPageQ = db.query("INSERT OR REPLACE INTO cal_pages (season, cycle, encounter, spec, page, json) VALUES (?, ?, ?, ?, ?, ?)");
  const putPoolQ = db.query("INSERT OR REPLACE INTO cal_pool (season, cycle, built_at, json) VALUES (?, ?, ?, ?)");
  const poolQ = db.query<{ cycle: number; built_at: number; json: string }, [number]>(
    "SELECT cycle, built_at, json FROM cal_pool WHERE season = ? ORDER BY cycle DESC LIMIT 1",
  );

  return {
    put(study, payload, season, now) {
      putQ.run(study.key, season, JSON.stringify(study), cellOf(study), now, gzip(JSON.stringify(payload)));
    },
    done(key, season, since) {
      return doneQ.get(key, season, since, key, season, since) !== null;
    },
    fail(key, season, now, error) {
      failQ.run(key, season, now, error.slice(0, 300));
    },
    count(season, since) {
      const cells = new Map(countQ.all(season, since).map((r) => [r.cell, r.n]));
      return { total: [...cells.values()].reduce((a, b) => a + b, 0), cells };
    },
    list(season, since) {
      return listQ.all(season, since).map((r) => ({ study: JSON.parse(r.study) as Candidate, payload: JSON.parse(gunzip(r.payload)) as EvalPayload }));
    },
    getPage(season, cycle, encounter, spec, page) {
      const row = getPageQ.get(season, cycle, encounter, spec, page);
      return row ? (JSON.parse(row.json) as unknown[]) : null;
    },
    putPage(season, cycle, encounter, spec, page, rows) {
      putPageQ.run(season, cycle, encounter, spec, page, JSON.stringify(rows));
    },
    putPool(season, cycle, pool, now) {
      putPoolQ.run(season, cycle, now, JSON.stringify(pool));
      // The pages served this pool; an older cycle's pages are never read again.
      db.query("DELETE FROM cal_pages WHERE season = ? AND cycle < ?").run(season, cycle);
    },
    latestPool(season) {
      const row = poolQ.get(season);
      return row ? { cycle: row.cycle, builtAt: row.built_at, pool: JSON.parse(row.json) as PoolEntry[] } : null;
    },
    prune(season, keepSince) {
      // Read now: the lookups' store (`openStore` on the same file) creates its tables after this one opened.
      const tables = new Set(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
      db.transaction(() => {
        db.query("DELETE FROM cal_samples WHERE season <> ? OR collected_at < ?").run(season, keepSince);
        db.query("DELETE FROM cal_failed WHERE season <> ? OR at < ?").run(season, keepSince);
        db.query("DELETE FROM cal_pages WHERE season <> ?").run(season);
        db.query("DELETE FROM cal_pool WHERE season <> ?").run(season);
        for (const [t, col] of CACHE_TABLES) if (tables.has(t)) db.query(`DELETE FROM ${t} WHERE ${col} < ?`).run(keepSince);
      })();
    },
    close() {
      db.close();
    },
  };
}
