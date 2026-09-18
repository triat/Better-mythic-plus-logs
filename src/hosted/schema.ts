// Hosted-mode tables (users, sessions, invites). Additive only: every statement is
// CREATE ... IF NOT EXISTS so it can run on every start next to the cache tables.
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
  user_id    INTEGER NOT NULL REFERENCES users(id),
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
`;

export function applyHostedSchema(db: Database): void {
  db.exec(HOSTED_SCHEMA);
}
