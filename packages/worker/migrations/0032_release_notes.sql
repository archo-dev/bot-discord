-- M5: public release notes. Additive, backend-owned, read-only public surface
-- (GET /api/updates). No guild_id: release notes are global product content,
-- not per-tenant data. Publication workflow (draft -> published) belongs to the
-- Studio (M12); M5 ships storage + a strictly-published public read path.
--
-- Public visibility is derived in SQL, never trusted from the client:
--   status='published' AND published_at IS NOT NULL AND published_at <= now
--   AND audience='all'
-- Drafts, scheduled, archived, future publications and plan-targeted notes are
-- never public. Internal columns (author, status, publish_at, audience,
-- timestamps) are never serialized to the public API.

CREATE TABLE release_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  version TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  body_md TEXT,
  sections_json TEXT,
  module_tags_json TEXT,
  audience TEXT NOT NULL DEFAULT 'all'
    CHECK (audience = 'all' OR audience LIKE 'plan:%'),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  publish_at TEXT,
  published_at TEXT,
  author TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  -- A scheduled note must carry its target publish time.
  CHECK (status != 'scheduled' OR publish_at IS NOT NULL)
);

-- Public list query: published notes ordered by publication date.
CREATE INDEX idx_release_notes_public ON release_notes(status, published_at DESC);
-- Future scheduling sweep (Studio/cron, later milestones).
CREATE INDEX idx_release_notes_publish_at ON release_notes(publish_at);
