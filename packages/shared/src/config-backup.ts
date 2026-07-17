import { z } from "zod";

/**
 * M07 config backup — canonical, versioned snapshots of allowlisted module config.
 * Starts with two modules: "general" (Config) and "automod". Serializers are pure
 * (shape + Discord-reference handling); DB reads/writes live in the Worker. No secret,
 * webhook or token is ever part of a payload.
 */
export const CONFIG_BACKUP_SCHEMA_VERSION = 1;
export const CONFIG_BACKUP_FORMAT = "archodev.config-backup" as const;

export const BACKUP_MODULE_IDS = ["general", "automod"] as const;
export type BackupModuleId = (typeof BACKUP_MODULE_IDS)[number];

export const BACKUP_MODULE_LABELS: Record<BackupModuleId, string> = {
  general: "Configuration générale",
  automod: "Auto-modération",
};

export type DiscordRefType = "channel" | "role";

const SNOWFLAKE = /^\d{5,20}$/;
const DOMAIN = /^[a-z0-9.-]{3,100}$/;

// --- Per-module value schemas (mirror the live write validators) -------------

export const generalSnapshotSchema = z.object({
  guild: z.object({
    logChannelId: z.string().regex(SNOWFLAKE).nullable(),
    warnThreshold: z.number().int().min(1).max(20),
    warnTimeoutMinutes: z.number().int().min(1).max(40320),
    mentionCards: z.boolean(),
    customNickname: z.string().min(1).max(32).nullable(),
  }),
  logSettings: z.object({
    channelId: z.string().regex(SNOWFLAKE).nullable(),
    memberJoin: z.boolean(),
    memberLeave: z.boolean(),
    messageDelete: z.boolean(),
    messageEdit: z.boolean(),
    memberUpdate: z.boolean(),
    voiceJoin: z.boolean(),
    voiceLeave: z.boolean(),
    voiceMove: z.boolean(),
    voiceState: z.boolean(),
  }),
});
export type GeneralSnapshot = z.infer<typeof generalSnapshotSchema>;

export const automodSnapshotSchema = z.object({
  antiSpamEnabled: z.boolean(),
  antiSpamMaxMessages: z.number().int().min(2).max(20),
  antiSpamWindowSeconds: z.number().int().min(2).max(60),
  antiInviteEnabled: z.boolean(),
  antiLinkEnabled: z.boolean(),
  linkWhitelist: z.array(z.string().toLowerCase().regex(DOMAIN)).max(50),
  bannedWords: z.array(z.string().min(2).max(50)).max(100),
  exemptRoleIds: z.array(z.string().regex(SNOWFLAKE)).max(25),
  exemptChannelIds: z.array(z.string().regex(SNOWFLAKE)).max(25),
  action: z.enum(["delete", "warn", "timeout"]),
  timeoutMinutes: z.number().int().min(1).max(40320),
});
export type AutomodSnapshot = z.infer<typeof automodSnapshotSchema>;

const moduleSection = <T extends z.ZodTypeAny>(values: T) => z.object({ version: z.number().int().min(1), values });

export const configBackupPayloadSchema = z.object({
  schemaVersion: z.literal(CONFIG_BACKUP_SCHEMA_VERSION),
  modules: z.object({
    general: moduleSection(generalSnapshotSchema).optional(),
    automod: moduleSection(automodSnapshotSchema).optional(),
  }),
});
export type ConfigBackupPayload = z.infer<typeof configBackupPayloadSchema>;

export const configExportSchema = z.object({
  format: z.literal(CONFIG_BACKUP_FORMAT),
  schemaVersion: z.literal(CONFIG_BACKUP_SCHEMA_VERSION),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  exportedAt: z.string(),
  sourceGuildId: z.string().regex(SNOWFLAKE),
  reason: z.string().max(120),
  payload: configBackupPayloadSchema,
});
export type ConfigExport = z.infer<typeof configExportSchema>;

// --- Discord references (for cross-server remap) -----------------------------

export interface DiscordRef {
  module: BackupModuleId;
  path: string;
  type: DiscordRefType;
  id: string;
}

/** Every Discord id embedded in a payload, so import can remap them explicitly. */
export function collectRefs(payload: ConfigBackupPayload): DiscordRef[] {
  const refs: DiscordRef[] = [];
  const general = payload.modules.general?.values;
  if (general) {
    if (general.guild.logChannelId) refs.push({ module: "general", path: "guild.logChannelId", type: "channel", id: general.guild.logChannelId });
    if (general.logSettings.channelId) refs.push({ module: "general", path: "logSettings.channelId", type: "channel", id: general.logSettings.channelId });
  }
  const automod = payload.modules.automod?.values;
  if (automod) {
    for (const id of automod.exemptRoleIds) refs.push({ module: "automod", path: "exemptRoleIds", type: "role", id });
    for (const id of automod.exemptChannelIds) refs.push({ module: "automod", path: "exemptChannelIds", type: "channel", id });
  }
  return refs;
}

/**
 * Remaps every Discord id using `mapping` (sourceId → targetId | null). An id absent
 * from the mapping is kept as-is (same-server restore = identity); an id mapped to null
 * is dropped (arrays) or cleared (single fields).
 */
export function remapRefs(payload: ConfigBackupPayload, mapping: Record<string, string | null>): ConfigBackupPayload {
  const map = (id: string): string | null => (id in mapping ? mapping[id]! : id);
  const next = structuredClone(payload);
  const general = next.modules.general?.values;
  if (general) {
    if (general.guild.logChannelId) general.guild.logChannelId = map(general.guild.logChannelId);
    if (general.logSettings.channelId) general.logSettings.channelId = map(general.logSettings.channelId);
  }
  const automod = next.modules.automod?.values;
  if (automod) {
    automod.exemptRoleIds = automod.exemptRoleIds.map(map).filter((id): id is string => id !== null);
    automod.exemptChannelIds = automod.exemptChannelIds.map(map).filter((id): id is string => id !== null);
  }
  return next;
}

// --- Canonicalization + diff (pure) ------------------------------------------

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/** Deterministic JSON (sorted keys) — the exact bytes the checksum is taken over. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function payloadModules(payload: ConfigBackupPayload): BackupModuleId[] {
  return BACKUP_MODULE_IDS.filter((id) => payload.modules[id] !== undefined);
}

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

/** Semantic diff of two value trees; arrays are compared as whole leaves. */
export function diffValues(before: unknown, after: unknown, prefix = ""): FieldChange[] {
  const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffValues(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null) ? [] : [{ path: prefix, before: before ?? null, after: after ?? null }];
}
