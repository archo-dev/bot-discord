/** Button-role messages (M9): message composer rows + per-button role bindings. */

export interface ButtonRoleMessageRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  description: string | null;
  created_at: string;
}

export interface ButtonRoleRow {
  id: number;
  message_ref: number;
  guild_id: string;
  role_id: string;
  label: string;
  emoji: string | null;
  style: number;
  position: number;
}

export async function insertButtonRoleMessage(
  db: D1Database,
  msg: { guildId: string; channelId: string; title: string; description: string | null },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO button_role_messages (guild_id, channel_id, title, description)
       VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    )
    .bind(msg.guildId, msg.channelId, msg.title, msg.description)
    .first<{ id: number }>();
  return row!.id;
}

export async function insertButtonRole(
  db: D1Database,
  btn: { messageRef: number; guildId: string; roleId: string; label: string; emoji: string | null; style: number; position: number },
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO button_roles (message_ref, guild_id, role_id, label, emoji, style, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
    )
    .bind(btn.messageRef, btn.guildId, btn.roleId, btn.label, btn.emoji, btn.style, btn.position)
    .first<{ id: number }>();
  return row!.id;
}

export async function setButtonRoleMessageId(db: D1Database, id: number, messageId: string): Promise<void> {
  await db.prepare(`UPDATE button_role_messages SET message_id = ?2 WHERE id = ?1`).bind(id, messageId).run();
}

export async function getButtonRole(db: D1Database, id: number): Promise<ButtonRoleRow | null> {
  return db.prepare(`SELECT * FROM button_roles WHERE id = ?1`).bind(id).first<ButtonRoleRow>();
}

export async function listButtonRoleMessages(db: D1Database, guildId: string): Promise<ButtonRoleMessageRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM button_role_messages WHERE guild_id = ?1 ORDER BY created_at DESC`)
      .bind(guildId)
      .all<ButtonRoleMessageRow>()
  ).results;
}

export async function getButtonRoleMessage(db: D1Database, guildId: string, id: number): Promise<ButtonRoleMessageRow | null> {
  return db
    .prepare(`SELECT * FROM button_role_messages WHERE guild_id = ?1 AND id = ?2`)
    .bind(guildId, id)
    .first<ButtonRoleMessageRow>();
}

export async function listButtonRolesForMessage(db: D1Database, messageRef: number): Promise<ButtonRoleRow[]> {
  return (
    await db
      .prepare(`SELECT * FROM button_roles WHERE message_ref = ?1 ORDER BY position, id`)
      .bind(messageRef)
      .all<ButtonRoleRow>()
  ).results;
}

export async function deleteButtonRoleMessage(db: D1Database, guildId: string, id: number): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM button_roles WHERE message_ref = ?1 AND guild_id = ?2`).bind(id, guildId),
    db.prepare(`DELETE FROM button_role_messages WHERE id = ?1 AND guild_id = ?2`).bind(id, guildId),
  ]);
}
