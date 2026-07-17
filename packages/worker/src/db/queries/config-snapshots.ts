import { canonicalJson, type ConfigBackupPayload } from "@bot/shared";
import type { SnapshotReason } from "@bot/shared";

/** Max snapshots kept per guild; older ones are pruned on each create. */
export const SNAPSHOT_RETENTION_LIMIT = 25;
/** Hard cap on a canonical payload (defensive; allowlisted config stays small). */
export const SNAPSHOT_MAX_BYTES = 64 * 1024;

export interface ConfigSnapshotRow {
  id: string;
  guild_id: string;
  actor_id: string | null;
  reason: SnapshotReason;
  schema_version: number;
  payload_json: string;
  checksum: string;
  size_bytes: number;
  created_at: string;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Serializes to canonical JSON, checksums it and returns statement + metadata (no write yet). */
export async function prepareSnapshot(payload: ConfigBackupPayload): Promise<{ canonical: string; checksum: string; size: number }> {
  const canonical = canonicalJson(payload);
  const size = new TextEncoder().encode(canonical).length;
  return { canonical, checksum: await sha256Hex(canonical), size };
}

export async function createSnapshot(
  db: D1Database,
  input: { guildId: string; actorId: string | null; reason: SnapshotReason; payload: ConfigBackupPayload },
): Promise<ConfigSnapshotRow> {
  const { canonical, checksum, size } = await prepareSnapshot(input.payload);
  const id = crypto.randomUUID();
  const row = (await db.prepare(
    `INSERT INTO config_snapshots (id, guild_id, actor_id, reason, schema_version, payload_json, checksum, size_bytes)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING *`,
  ).bind(id, input.guildId, input.actorId, input.reason, input.payload.schemaVersion, canonical, checksum, size).first<ConfigSnapshotRow>())!;

  // Retention: keep the newest N per guild.
  await db.prepare(
    `DELETE FROM config_snapshots WHERE guild_id = ?1 AND id NOT IN (
       SELECT id FROM config_snapshots WHERE guild_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2
     )`,
  ).bind(input.guildId, SNAPSHOT_RETENTION_LIMIT).run();

  return row;
}

export async function listSnapshots(db: D1Database, guildId: string): Promise<ConfigSnapshotRow[]> {
  const result = await db.prepare(
    `SELECT * FROM config_snapshots WHERE guild_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2`,
  ).bind(guildId, SNAPSHOT_RETENTION_LIMIT).all<ConfigSnapshotRow>();
  return result.results;
}

export async function getSnapshot(db: D1Database, guildId: string, id: string): Promise<ConfigSnapshotRow | null> {
  return db.prepare(`SELECT * FROM config_snapshots WHERE guild_id = ?1 AND id = ?2`).bind(guildId, id).first<ConfigSnapshotRow>();
}
