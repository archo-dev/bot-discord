-- M06 onboarding. Additive progress columns on guilds: the checklist itself is
-- derived from the M03 module registry at request time; only the "seen / done /
-- dismissed" state that cannot be derived is persisted here. NULL everywhere =
-- fresh install, so existing guilds keep behaving exactly as before.

ALTER TABLE guilds ADD COLUMN onboarding_completed_at TEXT;      -- ISO timestamp when the admin marked setup done (or applied a preset)
ALTER TABLE guilds ADD COLUMN onboarding_preset TEXT;            -- last applied preset id ('community' | 'moderation' | 'support'), or NULL
ALTER TABLE guilds ADD COLUMN onboarding_dismissed_steps TEXT;   -- JSON array of step ids the admin explicitly hid, or NULL
