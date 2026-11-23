-- P1: one master (global) calendar that every client calendar references.
--
-- - calendars.is_global = 1 marks THE single global calendar (there is only ever one).
-- - calendars.scope / events.scope / clients.scope is the region tag (GLOBAL, IN, US, GB, ...).
--   A client calendar shows global events whose scope is GLOBAL or equal to its own scope.
-- - events.event_code is a stable per-observance code, e.g. IN-INDEPENDENCE-DAY-0815, so the
--   same observance can be added/updated once and sync to every matching client.
-- - client_event_state holds ONLY per-client overrides (own time / status / category / hidden);
--   the event's name and dates always come from the global calendar.

ALTER TABLE calendars ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendars ADD COLUMN scope TEXT NOT NULL DEFAULT 'GLOBAL';

ALTER TABLE events ADD COLUMN event_code TEXT;
ALTER TABLE events ADD COLUMN scope TEXT NOT NULL DEFAULT 'GLOBAL';

ALTER TABLE clients ADD COLUMN scope TEXT NOT NULL DEFAULT 'GLOBAL';

-- One row per observance per year (fixed dates repeat every year with the same code).
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_code_year
  ON events(event_code, substr(start_date, 1, 4)) WHERE event_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_event_state (
  calendar_id     TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  time_override   TEXT,
  approval_status TEXT,
  publish_status  TEXT,
  category        TEXT,
  note            TEXT NOT NULL DEFAULT '',
  hidden          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (calendar_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_client_event_state_event ON client_event_state(event_id);
