import { Database } from "bun:sqlite";
import { resolveDbPath } from "../setup.ts";
import type { RawRunReport } from "./types.ts";

// Bump when REPORT_RUN_SUMMARY_QUERY gains/loses fields: older raw rows are
// then ignored (kept on disk for a possible migration) and re-fetched.
export const QUERY_VERSION = 2;
export const RIO_TTL_MS = 60 * 60 * 1000;

export interface Store {
  getWclRun(code: string, fightID: number): RawRunReport | null;
  putWclRun(code: string, fightID: number, report: RawRunReport): void;
  getRio(
    region: string,
    realmSlug: string,
    name: string,
    opts?: { maxAgeMs?: number; now?: number },
  ): { raw: unknown; fetchedAt: number } | null;
  putRio(region: string, realmSlug: string, name: string, raw: unknown, now?: number): void;
  close(): void;
  /** Exposed for tests only. */
  _db: Database;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wcl_run_raw (
  report_code   TEXT    NOT NULL,
  fight_id      INTEGER NOT NULL,
  query_version INTEGER NOT NULL,
  fetched_at    INTEGER NOT NULL,
  json          TEXT    NOT NULL,
  PRIMARY KEY (report_code, fight_id)
);
CREATE TABLE IF NOT EXISTS rio_profile (
  region     TEXT    NOT NULL,
  realm      TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL,
  json       TEXT    NOT NULL,
  PRIMARY KEY (region, realm, name)
);
`;

const rioKey = (region: string, realmSlug: string, name: string) =>
  [region.toLowerCase(), realmSlug.toLowerCase(), name.toLowerCase()] as const;

export function openStore(path: string): Store {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const getRun = db.query<{ json: string }, [string, number, number]>(
    "SELECT json FROM wcl_run_raw WHERE report_code = ? AND fight_id = ? AND query_version = ?",
  );
  const putRun = db.query(
    "INSERT OR REPLACE INTO wcl_run_raw (report_code, fight_id, query_version, fetched_at, json) VALUES (?, ?, ?, ?, ?)",
  );
  const getRioQ = db.query<{ json: string; fetched_at: number }, [string, string, string]>(
    "SELECT json, fetched_at FROM rio_profile WHERE region = ? AND realm = ? AND name = ?",
  );
  const putRioQ = db.query(
    "INSERT OR REPLACE INTO rio_profile (region, realm, name, fetched_at, json) VALUES (?, ?, ?, ?, ?)",
  );

  return {
    _db: db,
    getWclRun(code, fightID) {
      const row = getRun.get(code, fightID, QUERY_VERSION);
      return row ? (JSON.parse(row.json) as RawRunReport) : null;
    },
    putWclRun(code, fightID, report) {
      putRun.run(code, fightID, QUERY_VERSION, Date.now(), JSON.stringify(report));
    },
    getRio(region, realmSlug, name, opts = {}) {
      const row = getRioQ.get(...rioKey(region, realmSlug, name));
      if (!row) return null;
      const now = opts.now ?? Date.now();
      const maxAge = opts.maxAgeMs ?? RIO_TTL_MS;
      if (now - row.fetched_at > maxAge) return null;
      return { raw: JSON.parse(row.json), fetchedAt: row.fetched_at };
    },
    putRio(region, realmSlug, name, raw, now = Date.now()) {
      putRioQ.run(...rioKey(region, realmSlug, name), now, JSON.stringify(raw));
    },
    close() {
      db.close();
    },
  };
}

let singleton: Promise<Store> | null = null;

/** Process-wide store at the resolved db path (next to .env). */
export const getStore = (): Promise<Store> => {
  if (!singleton) singleton = resolveDbPath().then(openStore);
  return singleton;
};
