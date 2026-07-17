import { Hono } from "hono";
import { z } from "zod";
import {
  BACKUP_MODULE_IDS,
  configBackupPayloadSchema,
  diffValues,
  payloadModules,
  type BackupModuleId,
  type ConfigBackupPayload,
  type ConfigSnapshotDetail,
  type ConfigSnapshotDiff,
  type ConfigSnapshotList,
  type ConfigSnapshotSummary,
  type RestoreResult,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import {
  createSnapshot,
  getSnapshot,
  listSnapshots,
  SNAPSHOT_RETENTION_LIMIT,
  type ConfigSnapshotRow,
} from "../db/queries.js";
import { restoreStatements, serializeModules } from "../config-backup/serialize.js";
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

/** Diff of a snapshot against the guild's current config: before = current, after = snapshot. */
configBackupRouter.get("/guilds/:guildId/config-snapshots/:id/diff", async (c) => {
  const guildId = c.req.param("guildId");
  const row = await getSnapshot(c.env.DB, guildId, c.req.param("id"));
  if (!row) return c.json({ error: "snapshot_not_found" }, 404);
  const snapshot = configBackupPayloadSchema.safeParse(parsePayload(row));
  if (!snapshot.success) return c.json({ error: "snapshot_invalid" }, 422);

  const modules = payloadModules(snapshot.data);
  const current = await serializeModules(c.env.DB, guildId, modules);
  const body: ConfigSnapshotDiff = {
    snapshotId: row.id,
    modules: modules.map((module) => ({
      module,
      changes: diffValues(current.modules[module]?.values, snapshot.data.modules[module]?.values),
    })),
  };
  return c.json(body);
});

const restoreSchema = z.object({ modules: modulesSchema });

/**
 * Selective, atomic restore. First snapshots the state being replaced (reason
 * pre_restore) so the action is itself reversible, then applies the restore
 * statements in a single D1 batch.
 */
configBackupRouter.post("/guilds/:guildId/config-snapshots/:id/restore", rateLimit({ name: "config-restore", limit: 10 }), async (c) => {
  const parsed = restoreSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const guildId = c.req.param("guildId");
  const row = await getSnapshot(c.env.DB, guildId, c.req.param("id"));
  if (!row) return c.json({ error: "snapshot_not_found" }, 404);
  const snapshot = configBackupPayloadSchema.safeParse(parsePayload(row));
  if (!snapshot.success) return c.json({ error: "snapshot_invalid" }, 422);

  const available = payloadModules(snapshot.data);
  const requested = parsed.data.modules;
  if (requested.some((module) => !available.includes(module))) return c.json({ error: "module_not_in_snapshot" }, 400);

  const previous = await createSnapshot(c.env.DB, {
    guildId,
    actorId: c.get("session").userId,
    reason: "pre_restore",
    payload: await serializeModules(c.env.DB, guildId, requested),
  });
  const statements = restoreStatements(c.env.DB, guildId, snapshot.data, requested);
  if (statements.length > 0) await c.env.DB.batch(statements);

  const body: RestoreResult = { restored: requested, previousSnapshotId: previous.id };
  return c.json(body);
});
