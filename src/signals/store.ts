import { Database } from "bun:sqlite";
import { resolveDbPath } from "../setup.ts";
import type { RawRunControl, RawRunReport } from "./types.ts";
import type { RawDeepDive } from "../deepdive/types.ts";
import type { MPlusRun } from "../mplus.ts";
import type { Metric } from "../roles.ts";

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

/** A character as the season store keys it (lower-cased on every read and write, like `rio_profile`). */
export interface CharacterKey { region: string; realm: string; name: string }

export interface SeasonRow {
  reportCode: string;
  fightID: number;
  zoneID: number;
  encounterID: number;
  encounterName: string;
  startTime: number;
  durationMs: number | null;
  keyLevel: number;
  timed: boolean | null;
  /** The metric `parse` and `amount` were ranked on (the last lookup's). */
  metric: Metric;
  parse: number;
  amount: number;
  spec: string;
  score: number;
  affixes: number[];
  discoveredAt: number;
  /** Last time a rankings fetch listed the run. */
  seenAt: number;
  /** Last time a sync asked WCL for the report and got none. */
  failedAt: number | null;
}

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
  /** Records every run of a rankings fetch for the character (0 pts: already fetched). */
  upsertSeasonRuns(key: CharacterKey, zoneID: number, metric: Metric, runs: MPlusRun[], now?: number): void;
  /** The character's runs in that zone (season), newest first. */
  seasonRuns(key: CharacterKey, zoneID: number): SeasonRow[];
  /** The zone of the character's newest stored run; null when none is stored. */
  latestSeasonZone(key: CharacterKey): number | null;
  markSeasonRunFailed(key: CharacterKey, code: string, fightID: number, now?: number): void;
  /** Whether the run's raw report is cached at the current QUERY_VERSION, without parsing it. */
  hasWclRun(code: string, fightID: number): boolean;
  /** The run's cached crowd-control events, whatever table version they were fetched with. */
  getRunControl(code: string, fightID: number): RawRunControl | null;
  putRunControl(code: string, fightID: number, raw: RawRunControl): void;
  /** Cached at that table version. */
  hasRunControl(code: string, fightID: number, tableVersion: string): boolean;
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
-- Every ranked run WCL's rankings returned for a character (self-review spec, decision 2). Filled by every
-- lookup at 0 extra points; a sync fetches the raw reports of the runs not yet in wcl_run_raw.
CREATE TABLE IF NOT EXISTS character_runs (
  region         TEXT    NOT NULL,
  realm          TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  report_code    TEXT    NOT NULL,
  fight_id       INTEGER NOT NULL,
  zone_id        INTEGER NOT NULL,
  encounter_id   INTEGER NOT NULL,
  encounter_name TEXT    NOT NULL,
  start_time     INTEGER NOT NULL,
  duration_ms    INTEGER,
  key_level      INTEGER NOT NULL,
  timed          INTEGER,
  metric         TEXT    NOT NULL,
  parse          REAL    NOT NULL,
  amount         REAL    NOT NULL,
  spec           TEXT    NOT NULL,
  score          REAL    NOT NULL,
  affixes        TEXT    NOT NULL,
  discovered_at  INTEGER NOT NULL,
  seen_at        INTEGER NOT NULL,
  failed_at      INTEGER,
  PRIMARY KEY (region, realm, name, report_code, fight_id)
);
CREATE INDEX IF NOT EXISTS character_runs_zone ON character_runs (region, realm, name, zone_id, start_time);
-- Crowd-control events of a run (self-review phase 2, decision 3), all five players and their pets, as fetched.
-- Immutable; a newer table version replaces the row only on an explicit fetch.
CREATE TABLE IF NOT EXISTS wcl_run_control (
  report_code   TEXT    NOT NULL,
  fight_id      INTEGER NOT NULL,
  table_version TEXT    NOT NULL,
  fetched_at    INTEGER NOT NULL,
  json          TEXT    NOT NULL,
  PRIMARY KEY (report_code, fight_id)
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
  const ck = (k: CharacterKey) => [k.region.toLowerCase(), k.realm.toLowerCase(), k.name.toLowerCase()] as const;
  const upsertSeason = db.query(
    "INSERT INTO character_runs (region, realm, name, report_code, fight_id, zone_id, encounter_id, encounter_name, start_time, duration_ms, " +
    "key_level, timed, metric, parse, amount, spec, score, affixes, discovered_at, seen_at, failed_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) " +
    "ON CONFLICT (region, realm, name, report_code, fight_id) DO UPDATE SET zone_id = excluded.zone_id, " +
    "encounter_id = excluded.encounter_id, encounter_name = excluded.encounter_name, start_time = excluded.start_time, " +
    "duration_ms = excluded.duration_ms, key_level = excluded.key_level, timed = excluded.timed, metric = excluded.metric, " +
    "parse = excluded.parse, amount = excluded.amount, spec = excluded.spec, score = excluded.score, affixes = excluded.affixes, " +
    "seen_at = excluded.seen_at",
  );
  const upsertSeasonMany = db.transaction((k: readonly [string, string, string], zoneID: number, metric: Metric, runs: MPlusRun[], now: number) => {
    for (const r of runs) {
      upsertSeason.run(k[0], k[1], k[2], r.reportCode, r.fightID, zoneID, r.encounterID, r.encounterName, r.startTime, r.durationMs ?? null,
        r.keyLevel, r.timed === undefined ? null : r.timed ? 1 : 0, metric, r.parsePercent, r.amount, r.spec, r.score, JSON.stringify(r.affixes), now, now);
    }
  });
  interface SeasonDbRow {
    report_code: string; fight_id: number; zone_id: number; encounter_id: number; encounter_name: string; start_time: number;
    duration_ms: number | null; key_level: number; timed: number | null; metric: Metric; parse: number; amount: number; spec: string;
    score: number; affixes: string; discovered_at: number; seen_at: number; failed_at: number | null;
  }
  const seasonQ = db.query<SeasonDbRow, [string, string, string, number]>(
    "SELECT * FROM character_runs WHERE region = ? AND realm = ? AND name = ? AND zone_id = ? ORDER BY start_time DESC",
  );
  const latestZoneQ = db.query<{ zone_id: number }, [string, string, string]>(
    "SELECT zone_id FROM character_runs WHERE region = ? AND realm = ? AND name = ? ORDER BY start_time DESC LIMIT 1",
  );
  const failSeason = db.query("UPDATE character_runs SET failed_at = ? WHERE region = ? AND realm = ? AND name = ? AND report_code = ? AND fight_id = ?");
  const hasRunQ = db.query<{ one: number }, [string, number, number]>(
    "SELECT 1 AS one FROM wcl_run_raw WHERE report_code = ? AND fight_id = ? AND query_version = ?",
  );
  const getControlQ = db.query<{ json: string }, [string, number]>("SELECT json FROM wcl_run_control WHERE report_code = ? AND fight_id = ?");
  const putControlQ = db.query(
    "INSERT OR REPLACE INTO wcl_run_control (report_code, fight_id, table_version, fetched_at, json) VALUES (?, ?, ?, ?, ?)",
  );
  const hasControlQ = db.query<{ one: number }, [string, number, string]>(
    "SELECT 1 AS one FROM wcl_run_control WHERE report_code = ? AND fight_id = ? AND table_version = ?",
  );
  const toSeasonRow = (r: SeasonDbRow): SeasonRow => ({
    reportCode: r.report_code, fightID: r.fight_id, zoneID: r.zone_id, encounterID: r.encounter_id, encounterName: r.encounter_name,
    startTime: r.start_time, durationMs: r.duration_ms, keyLevel: r.key_level, timed: r.timed === null ? null : r.timed === 1,
    metric: r.metric, parse: r.parse, amount: r.amount, spec: r.spec, score: r.score, affixes: JSON.parse(r.affixes) as number[],
    discoveredAt: r.discovered_at, seenAt: r.seen_at, failedAt: r.failed_at,
  });

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
    upsertSeasonRuns(key, zoneID, metric, runs, now = Date.now()) {
      upsertSeasonMany(ck(key), zoneID, metric, runs, now);
    },
    seasonRuns(key, zoneID) {
      return seasonQ.all(...ck(key), zoneID).map(toSeasonRow);
    },
    latestSeasonZone(key) {
      return latestZoneQ.get(...ck(key))?.zone_id ?? null;
    },
    markSeasonRunFailed(key, code, fightID, now = Date.now()) {
      failSeason.run(now, ...ck(key), code, fightID);
    },
    hasWclRun(code, fightID) {
      return hasRunQ.get(code, fightID, QUERY_VERSION) !== null;
    },
    getRunControl(code, fightID) {
      const row = getControlQ.get(code, fightID);
      return row ? (JSON.parse(row.json) as RawRunControl) : null;
    },
    putRunControl(code, fightID, raw) {
      putControlQ.run(code, fightID, raw.tableVersion, Date.now(), JSON.stringify(raw));
    },
    hasRunControl(code, fightID, tableVersion) {
      return hasControlQ.get(code, fightID, tableVersion) !== null;
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
