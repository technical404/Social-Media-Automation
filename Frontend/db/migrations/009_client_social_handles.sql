-- Client profiles carry their own content theme and social handles.
-- A handle is a profile identity (for example @acme.health), not an OAuth connection;
-- social_accounts stays the place for OAuth connection placeholders.
ALTER TABLE clients ADD COLUMN theme TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS client_social_handles (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  handle       TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_client_social_handles_client ON client_social_handles(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_social_handles_platform_handle
  ON client_social_handles(client_id, platform, lower(handle));
