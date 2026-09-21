import { Database } from "bun:sqlite";
import { resolveDbPath } from "../setup.ts";
import type { RawRunReport } from "./types.ts";
import type { RawDeepDive } from "../deepdive/types.ts";

// Bump when REPORT_RUN_SUMMARY_QUERY gains/loses fields, or when the
// avoidable-damage spell list changes materially: older raw rows are then
// ignored (INSERT OR REPLACE overwrites them on the next fetch — nothing is
// migrated) and re-fetched. Rows cached under an older QUERY_VERSION keep the
// `avoidable` spell-list snapshot they were fetched with until re-fetched.
export const QUERY_VERSION = 2;
// Bump when REPORT_DEEPDIVE_QUERY changes shape (not when the defensives
// table changes: analysis is recomputed from raw rows).
export const DEEPDIVE_QUERY_VERSION = 1;
export const RIO_TTL_MS = 60 * 60 * 1000;

export interface Store {
  getWclRun(code: string, fightID: number): RawRunReport | null;
  putWclRun(code: string, fightID: number, report: RawRunReport): void;
  getDeepDive(code: string, fightID: number, character: string): RawDeepDive | null;
  putDeepDive(code: string, fightID: number, character: string, raw: RawDeepDive): void;
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
CREATE TABLE IF NOT EXISTS wcl_deepdive (
  report_code   TEXT    NOT NULL,
  fight_id      INTEGER NOT NULL,
  character     TEXT    NOT NULL,
  query_version INTEGER NOT NULL,
  fetched_at    INTEGER NOT NULL,
  json          TEXT    NOT NULL,
  PRIMARY KEY (report_code, fight_id, character)
);
-- Local mode's lookup tabs (one person → user_id 0): the hosted user_history tables without the users FK.
-- Same columns, read/written by src/hosted/history.ts' openUserHistory with LOCAL_HISTORY_TABLES.
CREATE TABLE IF NOT EXISTS local_history (
  user_id      INTEGER NOT NULL,
  key          TEXT    NOT NULL,
  request      TEXT    NOT NULL,
  payload      TEXT    NOT NULL,
  label        TEXT    NOT NULL,
  char_class   INTEGER NOT NULL,
  spec         TEXT,
  target_level INTEGER NOT NULL,
  target_auto  INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS local_history_auto (
  user_id   INTEGER NOT NULL,
  alias_key TEXT    NOT NULL,
  level     INTEGER NOT NULL,
  set_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, alias_key)
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
  // The CLI and the local server may open the same db file concurrently;
  // wait rather than throwing SQLITE_BUSY on a write collision.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);

  const getRun = db.query<{ json: string }, [string, number, number]>(
    "SELECT json FROM wcl_run_raw WHERE report_code = ? AND fight_id = ? AND query_version = ?",
  );
  const putRun = db.query(
    "INSERT OR REPLACE INTO wcl_run_raw (report_code, fight_id, query_version, fetched_at, json) VALUES (?, ?, ?, ?, ?)",
  );
  const getDd = db.query<{ json: string }, [string, number, string, number]>(
    "SELECT json FROM wcl_deepdive WHERE report_code = ? AND fight_id = ? AND character = ? AND query_version = ?",
  );
  const putDd = db.query(
    "INSERT OR REPLACE INTO wcl_deepdive (report_code, fight_id, character, query_version, fetched_at, json) VALUES (?, ?, ?, ?, ?, ?)",
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
    getDeepDive(code, fightID, character) {
      const row = getDd.get(code, fightID, character, DEEPDIVE_QUERY_VERSION);
      return row ? (JSON.parse(row.json) as RawDeepDive) : null;
    },
    putDeepDive(code, fightID, character, raw) {
      putDd.run(code, fightID, character, DEEPDIVE_QUERY_VERSION, Date.now(), JSON.stringify(raw));
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

/**
 * Open the store at `path`, falling back to an in-memory store if opening it
 * fails (e.g. an unwritable/missing directory) — a broken cache must not
 * fail every lookup.
 */
export function openStoreOrMemory(path: string): Store {
  try {
    return openStore(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`bmpl: cache unavailable (${msg}), running without cache`);
    return openStore(":memory:");
  }
}

let singleton: Promise<Store> | null = null;
let opened: Store | null = null;

/** Process-wide store at the resolved db path (next to .env). */
export const getStore = (): Promise<Store> => {
  if (!singleton) {
    const p = resolveDbPath().then(openStoreOrMemory);
    // Never cache a rejected promise — a transient failure (e.g. resolving
    // the .env path) should not stay sticky for the rest of the process.
    p.then((s) => { opened = s; }).catch(() => { singleton = null; });
    singleton = p;
  }
  return singleton;
};

/** Close the process-wide store (if one was ever opened) and reset it. */
export function closeStore(): void {
  opened?.close();
  opened = null;
  singleton = null;
}
