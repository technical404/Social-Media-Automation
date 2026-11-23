-- AI-generated events can belong to one client instead of the shared Global Calendar.
-- The row still lives in the master events table (calendar_id points at the Global
-- Calendar) so scheduling, approvals and exports keep one source of truth.
-- NULL means the event is global and visible to every client in scope.
ALTER TABLE events ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_events_client ON events(client_id);

-- The old uniqueness rule did not know about client ownership, so a client-specific
-- event could be dropped when a same-named global event already existed. Keeping
-- client_id in the key lets one client own a copy while still blocking duplicates
-- inside the same scope (NULL means the shared Global Calendar).
DROP INDEX IF EXISTS uq_events_calendar_date_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_calendar_date_name_client
  ON events(calendar_id, start_date, lower(name), ifnull(client_id, ''));
