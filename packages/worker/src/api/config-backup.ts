import { Hono } from "hono";
import { z } from "zod";
import {
  BACKUP_MODULE_IDS,
  CONFIG_BACKUP_FORMAT,
  CONFIG_BACKUP_SCHEMA_VERSION,
  canonicalJson,
  collectRefs,
  configBackupPayloadSchema,
  configExportSchema,
  diffValues,
  payloadModules,
  remapRefs,
  type BackupModuleId,
  type ConfigBackupPayload,
  type ConfigExport,
  type ConfigSnapshotDetail,
  type ConfigSnapshotDiff,
  type ConfigSnapshotList,
  type ConfigSnapshotSummary,
  type ImportApplyResult,
  type ImportReference,
  type ImportValidateResult,
  type RestoreResult,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import {
  createSnapshot,
  getSnapshot,
  listSnapshots,
  sha256Hex,
  SNAPSHOT_RETENTION_LIMIT,
  type ConfigSnapshotRow,
} from "../db/queries.js";
import { restoreStatements, serializeModules } from "../config-backup/serialize.js";
import { rateLimit } from "../ratelimit.js";
import { invalidBody } from "./validation.js";

const SNOWFLAKE = /^\d{5,20}$/;

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

// --- Export / import ---------------------------------------------------------

/** Downloadable, checksummed export. No secret, webhook or token can be present. */
configBackupRouter.get("/guilds/:guildId/config-snapshots/:id/export", async (c) => {
  const guildId = c.req.param("guildId");
  const row = await getSnapshot(c.env.DB, guildId, c.req.param("id"));
  if (!row) return c.json({ error: "snapshot_not_found" }, 404);
  const body: ConfigExport = {
    format: CONFIG_BACKUP_FORMAT,
    schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
    checksum: row.checksum,
    exportedAt: new Date().toISOString(),
    sourceGuildId: guildId,
    reason: row.reason,
    payload: parsePayload(row),
  };
  c.header("content-disposition", `attachment; filename="config-backup-${guildId}-${row.id}.json"`);
  return c.json(body);
});

/** Step 1: validate an export and list the Discord references the admin must map. */
configBackupRouter.post("/guilds/:guildId/config-import/validate", rateLimit({ name: "config-import", limit: 20 }), async (c) => {
  const parsed = z.object({ export: configExportSchema }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const empty: ImportValidateResult = { ok: false, checksumValid: false, schemaVersion: 0, sameGuild: false, modules: [], references: [], issues: ["Fichier d'import invalide ou illisible."] };
    return c.json(empty, 200);
  }
  const guildId = c.req.param("guildId");
  const exported = parsed.data.export;
  const checksumValid = (await sha256Hex(canonicalJson(exported.payload))) === exported.checksum;
  const modules = payloadModules(exported.payload);

  const references = groupReferences(exported.payload, modules);
  const issues: string[] = [];
  if (!checksumValid) issues.push("Le checksum ne correspond pas : le fichier a été modifié.");
  if (exported.schemaVersion !== CONFIG_BACKUP_SCHEMA_VERSION) issues.push("Version de schéma incompatible.");

  const body: ImportValidateResult = {
    ok: checksumValid && exported.schemaVersion === CONFIG_BACKUP_SCHEMA_VERSION,
    checksumValid,
    schemaVersion: exported.schemaVersion,
    sameGuild: exported.sourceGuildId === guildId,
    modules,
    references,
    issues,
  };
  return c.json(body);
});

const importApplySchema = z.object({
  export: configExportSchema,
  modules: modulesSchema,
  mapping: z.record(z.string().regex(SNOWFLAKE), z.string().regex(SNOWFLAKE).nullable()),
});

/** Step 2: apply an import after explicit role/channel remapping, atomically. */
configBackupRouter.post("/guilds/:guildId/config-import/apply", rateLimit({ name: "config-import-apply", limit: 10 }), async (c) => {
  const parsed = importApplySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalidBody(c, parsed.error);
  const guildId = c.req.param("guildId");
  const { export: exported, modules, mapping } = parsed.data;

  if ((await sha256Hex(canonicalJson(exported.payload))) !== exported.checksum) return c.json({ error: "checksum_mismatch" }, 422);
  const available = payloadModules(exported.payload);
  if (modules.some((module) => !available.includes(module))) return c.json({ error: "module_not_in_export" }, 400);

  // Every referenced id in the selected modules must be explicitly mapped (target or null).
  const refIds = [...new Set(collectRefs(exported.payload).filter((ref) => modules.includes(ref.module)).map((ref) => ref.id))];
  const unmapped = refIds.filter((id) => !(id in mapping));
  if (unmapped.length > 0) return c.json({ error: "unmapped_reference", unmapped }, 400);

  const remapped = remapRefs(exported.payload, mapping);
  const revalidated = configBackupPayloadSchema.safeParse(remapped);
  if (!revalidated.success) return c.json({ error: "invalid_after_remap" }, 422);

  const previous = await createSnapshot(c.env.DB, {
    guildId,
    actorId: c.get("session").userId,
    reason: "pre_import",
    payload: await serializeModules(c.env.DB, guildId, modules),
  });
  const statements = restoreStatements(c.env.DB, guildId, revalidated.data, modules);
  if (statements.length > 0) await c.env.DB.batch(statements);

  const body: ImportApplyResult = {
    imported: modules,
    previousSnapshotId: previous.id,
    droppedReferences: refIds.filter((id) => mapping[id] === null).length,
  };
  return c.json(body);
});

/** Groups a payload's Discord references by (type, id), listing the modules that use each. */
function groupReferences(payload: ConfigBackupPayload, modules: BackupModuleId[]): ImportReference[] {
  const byKey = new Map<string, ImportReference>();
  for (const ref of collectRefs(payload)) {
    if (!modules.includes(ref.module)) continue;
    const key = `${ref.type}:${ref.id}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.usedBy.includes(ref.module)) existing.usedBy.push(ref.module);
    } else {
      byKey.set(key, { type: ref.type, sourceId: ref.id, usedBy: [ref.module] });
    }
  }
  return [...byKey.values()];
}
