// Hosted-mode tables (users, sessions, invites, per-user history and settings). Additive only:
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
  last_seen_at INTEGER NOT NULL
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
`;

export function applyHostedSchema(db: Database): void {
  db.exec(HOSTED_SCHEMA);
}
