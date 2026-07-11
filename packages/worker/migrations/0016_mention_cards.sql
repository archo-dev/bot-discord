-- Member cards on mentions (M20). Opt-in per guild: when on, bot messages that
-- mention users get a compact member-info embed appended (1 card per unique
-- mention, capped at 3 — decided in M20). 0 = off (default).
ALTER TABLE guilds ADD COLUMN mention_cards INTEGER NOT NULL DEFAULT 0;
