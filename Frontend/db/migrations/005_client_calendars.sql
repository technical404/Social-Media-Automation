-- A client's calendars are ordinary calendars rows tagged with client_id.
-- NULL client_id = the standalone planner calendars. This lets every scheduler
-- feature (events, snapshot/undo, times) work for clients unchanged.
ALTER TABLE calendars ADD COLUMN client_id TEXT;

-- Remove the early parallel table (only present if the first 004 draft ran).
DROP TABLE IF EXISTS client_calendars;
