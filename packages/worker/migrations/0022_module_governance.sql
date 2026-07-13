-- M03 module governance. Additive registry state; legacy settings remain intact
-- as sub-configuration and as an application rollback path.

CREATE TABLE guild_modules (
  guild_id       TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  module_id      TEXT NOT NULL CHECK (module_id IN (
    'general','custom_commands','tickets','button_roles','welcome','automod','levels','starboard',
    'temp_voice','music','moderation','voice_logs','stats','panel_access','health','audit','social'
  )),
  enabled        INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  authority      TEXT NOT NULL DEFAULT 'governance' CHECK (authority IN ('legacy', 'governance')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, module_id)
);

CREATE INDEX idx_guild_modules_enabled ON guild_modules(guild_id, enabled, module_id);

-- Platform modules and historically always-on modules preserve their behavior.
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'general', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'custom_commands', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'button_roles', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'music', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'moderation', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'voice_logs', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'stats', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'panel_access', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'health', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'audit', 1, 'governance' FROM guilds;
INSERT INTO guild_modules (guild_id, module_id, enabled, authority) SELECT id, 'social', 1, 'governance' FROM guilds;

-- Modules with a historical module-level flag initially keep that flag as the
-- declared authority. The first M03/settings mutation switches to governance.
INSERT INTO guild_modules (guild_id, module_id, enabled, authority)
SELECT g.id, 'tickets', COALESCE((SELECT enabled FROM ticket_settings WHERE guild_id = g.id), 0), 'legacy' FROM guilds g;

INSERT INTO guild_modules (guild_id, module_id, enabled, authority)
SELECT g.id, 'welcome', CASE WHEN
  COALESCE((SELECT welcome_enabled OR leave_enabled FROM welcome_settings WHERE guild_id = g.id), 0) = 1
  OR EXISTS (SELECT 1 FROM auto_roles WHERE guild_id = g.id AND enabled = 1)
THEN 1 ELSE 0 END, 'legacy' FROM guilds g;

INSERT INTO guild_modules (guild_id, module_id, enabled, authority)
SELECT g.id, 'automod', CASE WHEN COALESCE((
  SELECT anti_spam_enabled OR anti_invite_enabled OR anti_link_enabled OR banned_words <> '[]'
  FROM automod_settings WHERE guild_id = g.id
), 0) = 1 THEN 1 ELSE 0 END, 'legacy' FROM guilds g;

INSERT INTO guild_modules (guild_id, module_id, enabled, authority)
SELECT g.id, 'levels', COALESCE((SELECT enabled FROM xp_settings WHERE guild_id = g.id), 0), 'legacy' FROM guilds g;

INSERT INTO guild_modules (guild_id, module_id, enabled, authority)
SELECT g.id, 'starboard', COALESCE((SELECT enabled FROM starboard_settings WHERE guild_id = g.id), 0), 'legacy' FROM guilds g;

INSERT INTO guild_modules (guild_id, module_id, enabled, authority)
SELECT g.id, 'temp_voice', COALESCE((SELECT enabled FROM guild_tempvoice_settings WHERE guild_id = g.id), 0), 'legacy' FROM guilds g;
