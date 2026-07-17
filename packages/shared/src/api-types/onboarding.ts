import type { DiscordPermissionId, ModuleId, ModuleStateReason } from "../modules.js";
import type { OnboardingPresetId } from "../onboarding.js";

/** A checklist item. `done` = satisfied, `todo` = not started, `attention` = needs a fix, `skipped` = hidden by the admin. */
export type OnboardingStepStatus = "done" | "todo" | "attention" | "skipped";

export interface OnboardingStep {
  /** Stable identifier, e.g. "log_channel", "gateway", "permissions", or a module id. */
  id: string;
  title: string;
  description: string;
  status: OnboardingStepStatus;
  /** Panel-relative deep link to the corrective screen (e.g. "config", "modules"), or null. */
  href: string | null;
  /** Present when the step maps to a module. */
  moduleId?: ModuleId;
  /** True when the admin can dismiss this step (optional steps only). */
  dismissible: boolean;
}

export interface OnboardingInvite {
  url: string;
  /** Decimal permission bitfield string requested by the invite. */
  permissions: string;
  /** Each requested permission and the modules that justify it. */
  usage: { permission: DiscordPermissionId; modules: ModuleId[] }[];
}

export interface OnboardingPresetSummary {
  id: OnboardingPresetId;
  name: string;
  description: string;
  modules: ModuleId[];
}

export interface OnboardingResponse {
  generatedAt: string;
  completedAt: string | null;
  appliedPreset: OnboardingPresetId | null;
  dismissedSteps: string[];
  gatewayOnline: boolean;
  canWrite: boolean;
  invite: OnboardingInvite;
  steps: OnboardingStep[];
  presets: OnboardingPresetSummary[];
  progress: { done: number; total: number };
}

// --- Preset preview + apply --------------------------------------------------

export type OnboardingPresetEntryAction = "enable" | "already_enabled" | "blocked";

export interface OnboardingPresetEntry {
  moduleId: ModuleId;
  publicName: string;
  action: OnboardingPresetEntryAction;
  /** Set when action is "blocked": why the module cannot be enabled yet. */
  reason: ModuleStateReason | null;
}

/** Returned for a dry-run: the diff the admin confirms before applying. */
export interface OnboardingPresetPreview {
  preset: OnboardingPresetId;
  entries: OnboardingPresetEntry[];
  /** True when at least one module would actually be enabled. */
  applicable: boolean;
}

/** Request body for POST /onboarding/preset. */
export interface OnboardingPresetRequest {
  preset: OnboardingPresetId;
  /** When true, return the diff without writing anything. */
  dryRun?: boolean;
}

/** Result of an applied preset. */
export interface OnboardingPresetResult {
  preset: OnboardingPresetId;
  enabled: ModuleId[];
  skipped: { moduleId: ModuleId; reason: ModuleStateReason }[];
  completedAt: string;
}

/** Request body for POST /onboarding/dismiss. */
export interface OnboardingDismissRequest {
  /** Step id to hide, or "__complete__" to mark the whole checklist done. */
  step: string;
}
