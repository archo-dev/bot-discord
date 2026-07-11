-- Two-tier panel permissions: each grant carries a level.
--  'admin'     → full read/write on the panel (like before)
--  'moderator' → read-only: every POST/PUT/PATCH/DELETE under the guild is 403
-- Existing grants keep full access (DEFAULT 'admin'), so this is backward compatible.
ALTER TABLE panel_access ADD COLUMN level TEXT NOT NULL DEFAULT 'admin'
  CHECK (level IN ('admin','moderator'));
