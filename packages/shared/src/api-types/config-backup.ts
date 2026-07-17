import type { BackupModuleId, ConfigBackupPayload, ConfigExport, DiscordRefType, FieldChange } from "../config-backup.js";

export type SnapshotReason = "manual" | "pre_restore" | "pre_import";

export interface ConfigSnapshotSummary {
  id: string;
  actorId: string | null;
  reason: SnapshotReason;
  createdAt: string;
  modules: BackupModuleId[];
  sizeBytes: number;
}

export interface ConfigSnapshotDetail extends ConfigSnapshotSummary {
  schemaVersion: number;
  checksum: string;
  payload: ConfigBackupPayload;
}

export interface ConfigSnapshotList {
  snapshots: ConfigSnapshotSummary[];
  /** Max snapshots kept per guild (retention cap). */
  retentionLimit: number;
}

/** Diff of a snapshot against the guild's current config. */
export interface ConfigSnapshotDiff {
  snapshotId: string;
  modules: { module: BackupModuleId; changes: FieldChange[] }[];
}

// --- Requests ----------------------------------------------------------------

export interface CreateSnapshotRequest {
  reason?: "manual";
  /** Modules to capture; defaults to all backup modules. */
  modules?: BackupModuleId[];
}

export interface RestoreSnapshotRequest {
  /** Modules to restore from the snapshot (selective). */
  modules: BackupModuleId[];
}

export interface RestoreResult {
  restored: BackupModuleId[];
  /** Id of the safety snapshot taken of the replaced state. */
  previousSnapshotId: string;
}

// --- Import (validate → map → apply) -----------------------------------------

/** A source Discord reference the admin must map to a local channel/role. */
export interface ImportReference {
  type: DiscordRefType;
  sourceId: string;
  usedBy: BackupModuleId[];
}

export interface ImportValidateRequest {
  export: ConfigExport;
}

export interface ImportValidateResult {
  ok: boolean;
  checksumValid: boolean;
  schemaVersion: number;
  sameGuild: boolean;
  modules: BackupModuleId[];
  references: ImportReference[];
  /** Human-readable blocking or warning notes. */
  issues: string[];
}

export interface ImportApplyRequest {
  export: ConfigExport;
  /** Modules the admin chose to import. */
  modules: BackupModuleId[];
  /** sourceId → targetId (local) or null to drop the reference. */
  mapping: Record<string, string | null>;
}

export interface ImportApplyResult {
  imported: BackupModuleId[];
  previousSnapshotId: string;
  droppedReferences: number;
}
