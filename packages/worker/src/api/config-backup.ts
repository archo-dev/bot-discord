import { Hono } from "hono";
import { z } from "zod";
import {
  BACKUP_MODULE_IDS,
  payloadModules,
  type BackupModuleId,
  type ConfigBackupPayload,
  type ConfigSnapshotDetail,
  type ConfigSnapshotList,
  type ConfigSnapshotSummary,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import {
  createSnapshot,
  getSnapshot,
  listSnapshots,
  SNAPSHOT_RETENTION_LIMIT,
  type ConfigSnapshotRow,
} from "../db/queries.js";
import { serializeModules } from "../config-backup/serialize.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

export const configBackupRouter = new Hono<AppContext>();

const modulesSchema = z.array(z.enum(BACKUP_MODULE_IDS)).min(1);

function parsePayload(row: ConfigSnapshotRow): ConfigBackupPayload {
  return JSON.parse(row.payload_json) as ConfigBackupPayload;
}

function rowToSummary(row: ConfigSnapshotRow): ConfigSnapshotSummary {
  return { id: row.id, actorId: row.actor_id, reason: row.reason, createdAt: row.created_at, modules: payloadModules(parsePayload(row)), sizeBytes: row.size_bytes };
}

export function rowToDetail(row: ConfigSnapshotRow): ConfigSnapshotDetail {
  const payload = parsePayload(row);
  return { id: row.id, actorId: row.actor_id, reason: row.reason, createdAt: row.created_at, modules: payloadModules(payload), sizeBytes: row.size_bytes, schemaVersion: row.schema_version, checksum: row.checksum, payload };
}

configBackupRouter.get("/guilds/:guildId/config-snapshots", async (c) => {
  const rows = await listSnapshots(c.env.DB, c.req.param("guildId"));
  const body: ConfigSnapshotList = { snapshots: rows.map(rowToSummary), retentionLimit: SNAPSHOT_RETENTION_LIMIT };
  return c.json(body);
});

const createSchema = z.object({ reason: z.literal("manual").optional(), modules: modulesSchema.optional() });

configBackupRouter.post("/guilds/:guildId/config-snapshots", rateLimit({ name: "config-snapshot", limit: 15 }), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const guildId = c.req.param("guildId");
  const modules: BackupModuleId[] = parsed.data.modules ?? [...BACKUP_MODULE_IDS];
  const payload = await serializeModules(c.env.DB, guildId, modules);
  const row = await createSnapshot(c.env.DB, { guildId, actorId: c.get("session").userId, reason: "manual", payload });
  return c.json(rowToDetail(row), 201);
});

configBackupRouter.get("/guilds/:guildId/config-snapshots/:id", async (c) => {
  const row = await getSnapshot(c.env.DB, c.req.param("guildId"), c.req.param("id"));
  if (!row) return c.json({ error: "snapshot_not_found" }, 404);
  return c.json(rowToDetail(row));
});
