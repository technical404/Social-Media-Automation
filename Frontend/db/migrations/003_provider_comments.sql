CREATE TABLE IF NOT EXISTS provider_comments (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (kind IN ('user','system','fallback','error','test'))
);
CREATE INDEX IF NOT EXISTS idx_provider_comments_pid ON provider_comments(provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_models_cache (
  provider_id TEXT PRIMARY KEY REFERENCES ai_providers(id) ON DELETE CASCADE,
  models_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO provider_comments(id, provider_id, kind, title, body)
SELECT lower(hex(randomblob(8))), id, 'system', 'Comments',
  'This log is created automatically. Fallback reasons, credit/key errors and connection tests appear here.'
FROM ai_providers
WHERE NOT EXISTS (SELECT 1 FROM provider_comments c WHERE c.provider_id = ai_providers.id AND c.kind = 'system');
