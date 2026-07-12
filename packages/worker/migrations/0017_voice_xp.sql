-- Voice XP (M22). Members earn XP for time spent in voice (in addition to the
-- message XP of M13). The gateway ticks eligible members once a minute; the
-- Worker grants voice_xp_per_min per tick via the same curve + reward roles.
ALTER TABLE xp_settings ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE xp_settings ADD COLUMN voice_xp_per_min INTEGER NOT NULL DEFAULT 10;
-- Voice minutes that earned XP (for display; the XP itself accumulates in xp).
ALTER TABLE xp_members ADD COLUMN voice_minutes INTEGER NOT NULL DEFAULT 0;
