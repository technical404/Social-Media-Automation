-- SocialAI Studio — initial local schema (SQLite).
-- Shared by the browser engine (sql.js) and the Python backend (sqlite3).
-- Never edit an applied migration; add a new numbered file instead.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  provider_type    TEXT NOT NULL,              -- openai | anthropic | gemini | nvidia | perplexity | ollama | custom | lovable | mock
  protocol         TEXT NOT NULL,              -- openai | anthropic | gemini | ollama | lovable | mock
  base_url         TEXT NOT NULL DEFAULT '',
  model_id         TEXT NOT NULL DEFAULT '',
  context_window   INTEGER,
  max_output       INTEGER NOT NULL DEFAULT 4096,
  thinking_effort  TEXT NOT NULL DEFAULT 'none', -- none | low | medium | high
  image_input      INTEGER NOT NULL DEFAULT 0,
  timeout_ms       INTEGER NOT NULL DEFAULT 90000,
  retry_count      INTEGER NOT NULL DEFAULT 1,
  enabled          INTEGER NOT NULL DEFAULT 1,
  is_default       INTEGER NOT NULL DEFAULT 0,
  fallback_priority INTEGER NOT NULL DEFAULT 100,
  has_api_key      INTEGER NOT NULL DEFAULT 0,
  api_key_hint     TEXT,
  last_test_at     TEXT,
  last_test_ok     INTEGER,
  last_test_ms     INTEGER,
  last_test_message TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_request_logs (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
  provider_name TEXT,
  task         TEXT NOT NULL,
  model        TEXT,
  ok           INTEGER NOT NULL,
  latency_ms   INTEGER,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_request_logs_created ON ai_request_logs(created_at);

CREATE TABLE IF NOT EXISTS calendars (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  industry      TEXT NOT NULL DEFAULT '',
  region        TEXT NOT NULL DEFAULT '',
  theme         TEXT NOT NULL DEFAULT '',
  default_time  TEXT NOT NULL DEFAULT '10:00',   -- HH:MM wall clock
  timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS events (
  id                   TEXT PRIMARY KEY,
  calendar_id          TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  short_description    TEXT NOT NULL DEFAULT '',
  detailed_description TEXT NOT NULL DEFAULT '',
  category             TEXT NOT NULL DEFAULT 'Other',
  industry             TEXT NOT NULL DEFAULT '',
  region               TEXT NOT NULL DEFAULT '',
  start_date           TEXT NOT NULL,               -- YYYY-MM-DD
  end_date             TEXT NOT NULL,               -- YYYY-MM-DD (>= start_date)
  importance           TEXT NOT NULL DEFAULT 'medium', -- low | medium | high
  event_kind           TEXT NOT NULL DEFAULT 'ai_suggestion', -- official_observance | ai_suggestion | custom
  source_url           TEXT NOT NULL DEFAULT '',
  verification_status  TEXT NOT NULL DEFAULT 'unverified', -- unverified | source_provided | verified
  campaign_topic       TEXT NOT NULL DEFAULT '',
  content_format       TEXT NOT NULL DEFAULT '',
  hashtags             TEXT NOT NULL DEFAULT '[]',  -- JSON array
  image_prompt         TEXT NOT NULL DEFAULT '',
  video_prompt         TEXT NOT NULL DEFAULT '',
  platforms            TEXT NOT NULL DEFAULT '[]',  -- JSON array
  time_override        TEXT,                        -- HH:MM; wins over calendar default
  event_status         TEXT NOT NULL DEFAULT 'planned',  -- planned | cancelled | done
  approval_status      TEXT NOT NULL DEFAULT 'pending_review', -- pending_review | approved | rejected
  publish_status       TEXT NOT NULL DEFAULT 'not_scheduled', -- not_scheduled | scheduled | published | failed
  approved_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date >= start_date),
  CHECK (approval_status IN ('pending_review','approved','rejected')),
  CHECK (publish_status IN ('not_scheduled','scheduled','published','failed'))
);
CREATE INDEX IF NOT EXISTS idx_events_calendar_date ON events(calendar_id, start_date);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(start_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_calendar_date_name ON events(calendar_id, start_date, lower(name));

CREATE TABLE IF NOT EXISTS event_sources (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- AI proposals waiting for human approval (the "preview state").
CREATE TABLE IF NOT EXISTS event_generation_runs (
  id           TEXT PRIMARY KEY,
  calendar_id  TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  request      TEXT NOT NULL,           -- JSON of the user's request
  provider_name TEXT,
  model        TEXT,
  proposals    TEXT NOT NULL DEFAULT '[]', -- JSON array of validated proposals
  rejected     TEXT NOT NULL DEFAULT '[]', -- JSON array of {item, reason}
  status       TEXT NOT NULL DEFAULT 'preview', -- preview | committed | discarded
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  committed_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT,
  summary     TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info', -- info | success | warning | error
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);

CREATE TABLE IF NOT EXISTS scheduler_jobs (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  last_run_at  TEXT,
  last_status  TEXT,
  last_message TEXT,
  heartbeat_at TEXT
);
