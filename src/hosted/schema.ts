// Hosted-mode tables (users, sessions, invites, per-user history and settings, audit log). Additive only:
// every statement is CREATE ... IF NOT EXISTS so it can run on every start next to the cache tables.
import type { Database } from "bun:sqlite";

export const HOSTED_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  discord_id   TEXT    NOT NULL UNIQUE,
  username     TEXT    NOT NULL,
  global_name  TEXT,
  avatar_hash  TEXT,
  role         TEXT    NOT NULL CHECK (role IN ('member', 'admin')),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  banned_at    INTEGER,
  banned_by    INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS invites (
  discord_id TEXT    PRIMARY KEY,
  invited_by TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  note       TEXT
);
CREATE TABLE IF NOT EXISTS user_history (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS user_history_key ON user_history(key, fetched_at);
CREATE TABLE IF NOT EXISTS user_history_auto (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_key TEXT    NOT NULL,
  level     INTEGER NOT NULL,
  set_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, alias_key)
);
CREATE INDEX IF NOT EXISTS user_history_auto_key ON user_history_auto(alias_key, set_at);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  your_key    INTEGER,
  legend_open INTEGER NOT NULL DEFAULT 1,
  region      TEXT,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_hourly (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hour_start INTEGER NOT NULL,
  points     REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, hour_start)
);
CREATE INDEX IF NOT EXISTS usage_hourly_hour ON usage_hourly(hour_start);
CREATE TABLE IF NOT EXISTS defensives_shared (
  key         TEXT    NOT NULL,
  id          INTEGER NOT NULL,
  entry       TEXT    NOT NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (key, id)
);
CREATE TABLE IF NOT EXISTS defensives_proposals (
  id          INTEGER PRIMARY KEY,
  key         TEXT    NOT NULL,
  spell_id    INTEGER NOT NULL,
  patch       TEXT    NOT NULL,
  proposed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at  INTEGER,
  note        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS defensives_proposals_pending ON defensives_proposals(proposed_by, key, spell_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS defensives_proposals_status ON defensives_proposals(status, created_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action  TEXT    NOT NULL,
  target  TEXT,
  detail  TEXT,
  ip      TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_log_action_at ON audit_log(action, at);
CREATE TABLE IF NOT EXISTS user_wcl_clients (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT    NOT NULL,
  secret_enc  TEXT    NOT NULL,
  verified_at INTEGER,
  updated_at  INTEGER NOT NULL
);
`;

/** Columns added to `users` after its first release; migrated in place on an older database. */
const USER_COLUMNS: ReadonlyArray<readonly [string, string]> = [["banned_at", "INTEGER"], ["banned_by", "INTEGER"]];
/** Columns added to `user_settings` after its first release; migrated in place on an older database. */
const SETTINGS_COLUMNS: ReadonlyArray<readonly [string, string]> = [["region", "TEXT"]];

function migrateColumns(db: Database, table: string, columns: ReadonlyArray<readonly [string, string]>): void {
  const have = new Set(db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  for (const [name, type] of columns) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

export function applyHostedSchema(db: Database): void {
  db.exec(HOSTED_SCHEMA);
  migrateColumns(db, "users", USER_COLUMNS);
  migrateColumns(db, "user_settings", SETTINGS_COLUMNS);
}
