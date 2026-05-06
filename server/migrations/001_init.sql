-- Initial schema: users + sessions + magic links + per-user state + mailing list + campaigns.
-- All tokens are stored hashed (sha-256 hex). Raw values only appear in URLs/emails.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT,
  is_admin        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT
);

CREATE TABLE IF NOT EXISTS magic_login_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL COLLATE NOCASE,
  token_hash      TEXT NOT NULL UNIQUE,
  next_url        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  used_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON magic_login_tokens(email);

CREATE TABLE IF NOT EXISTS user_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent      TEXT,
  ip              TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

-- v1 only writes kind='current' rows with name=NULL. The kind/name columns
-- and unique index let us add named saves later (kind='saved', name='...')
-- without a schema migration.
CREATE TABLE IF NOT EXISTS user_state_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'current',
  name            TEXT,
  data            TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_state_unique
  ON user_state_documents(user_id, kind, IFNULL(name, ''));

CREATE TABLE IF NOT EXISTS subscribers (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  email                   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status                  TEXT NOT NULL DEFAULT 'pending',
  confirm_token_hash      TEXT,
  unsubscribe_token_hash  TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at            TEXT,
  unsubscribed_at         TEXT,
  ip                      TEXT,
  user_agent              TEXT
);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);

CREATE TABLE IF NOT EXISTS campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject     TEXT NOT NULL,
  html_body   TEXT NOT NULL DEFAULT '',
  text_body   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT
);

CREATE TABLE IF NOT EXISTS campaign_sends (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subscriber_id   INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL,
  error_message   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_sends_unique
  ON campaign_sends(campaign_id, subscriber_id);
