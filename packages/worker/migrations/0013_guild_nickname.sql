-- Per-guild custom nickname for the bot (M16).
-- Applied via REST (PATCH /guilds/:id/members/@me); stored here regardless so
-- the panel keeps the chosen value even when the bot lacks CHANGE_NICKNAME.
-- NULL = no custom nickname (bot shows its default username).
ALTER TABLE guilds ADD COLUMN custom_nickname TEXT;
