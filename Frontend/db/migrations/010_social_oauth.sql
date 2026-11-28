-- Official OAuth 2.0 setup for social platforms, per client.
--
-- Non-secret metadata only. OAuth app secrets and access/refresh tokens are
-- stored by backend/secrets_store.py (DPAPI-encrypted on Windows) and never
-- enter this database or its backups.
--
-- social_oauth_apps
--   One row per (platform, scope). client_id NULL is the workspace-wide app
--   used by every client; a non-NULL client_id is that client's own developer
--   app and takes precedence for that client.
--
-- social_connections
--   One row per (client, platform) account. status becomes 'connected' only
--   after the provider's token endpoint returns a real token.

CREATE TABLE IF NOT EXISTS social_oauth_apps (
  id                      TEXT PRIMARY KEY,
  platform                TEXT NOT NULL,
  client_id               TEXT REFERENCES clients(id) ON DELETE CASCADE,
  app_client_id           TEXT NOT NULL DEFAULT '',
  app_client_secret_hint  TEXT,
  has_client_secret       INTEGER NOT NULL DEFAULT 0,
  redirect_uri            TEXT NOT NULL DEFAULT '',
  scopes                  TEXT NOT NULL DEFAULT '',
  enabled                 INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_oauth_apps_platform_scope
  ON social_oauth_apps(platform, ifnull(client_id, ''));
CREATE INDEX IF NOT EXISTS idx_social_oauth_apps_client ON social_oauth_apps(client_id);

CREATE TABLE IF NOT EXISTS social_connections (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,
  handle            TEXT NOT NULL DEFAULT '',
  display_name      TEXT NOT NULL DEFAULT '',
  external_id       TEXT,
  status            TEXT NOT NULL DEFAULT 'not_connected', -- not_connected | connected | expired | error
  scopes            TEXT NOT NULL DEFAULT '',
  token_type        TEXT NOT NULL DEFAULT 'Bearer',
  expires_at        TEXT,
  connected_at      TEXT,
  last_refreshed_at TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status IN ('not_connected','connected','expired','error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_connections_client_platform
  ON social_connections(client_id, platform);
CREATE INDEX IF NOT EXISTS idx_social_connections_client ON social_connections(client_id);
