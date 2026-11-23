-- Topic-wise social content calendars + client-owned posts.
-- Events remain in the master events table; topic plans become scheduled draft posts.
ALTER TABLE posts ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE posts ADD COLUMN topic TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN pillar TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN content_format TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_posts_client ON posts(client_id);
CREATE INDEX IF NOT EXISTS idx_posts_topic ON posts(topic);

-- One preview run can be an event plan or a topic/content plan.
ALTER TABLE event_generation_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'events';
CREATE INDEX IF NOT EXISTS idx_runs_calendar_kind_status ON event_generation_runs(calendar_id, kind, status);
