CREATE TABLE IF NOT EXISTS content_jobs (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  project TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  clone_slug TEXT NOT NULL,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  intended_hash TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owned_drafts (
  project TEXT NOT NULL,
  document_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  slug TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_by_job TEXT NOT NULL UNIQUE,
  last_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project, document_id, locale),
  FOREIGN KEY (created_by_job) REFERENCES content_jobs(idempotency_key)
);

CREATE INDEX IF NOT EXISTS owned_drafts_source_idx ON owned_drafts(project, source_document_id, locale);
