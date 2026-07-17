import { z } from "zod";
import { MODULE_IDS } from "./modules.js";

export const PRODUCT_EVENT_VALUES = [
  "guild_installed",
  "onboarding_step",
  "onboarding_completed",
  "module_activation_changed",
  "feature_result",
  "guild_uninstalled",
] as const;
export type ProductEvent = (typeof PRODUCT_EVENT_VALUES)[number];

export const PRODUCT_OUTCOME_VALUES = ["success", "failure", "enabled", "disabled", "completed", "dismissed"] as const;
export type ProductOutcome = (typeof PRODUCT_OUTCOME_VALUES)[number];

export const PRODUCT_STEP_VALUES = [
  "log_channel", "gateway", "permissions", "welcome", "automod", "levels", "tickets", "starboard", "temp_voice", "preset", "checklist",
] as const;
export type ProductStep = (typeof PRODUCT_STEP_VALUES)[number];

export const productMetricSchema = z.object({
  event: z.enum(PRODUCT_EVENT_VALUES),
  module: z.enum(MODULE_IDS).nullable().default(null),
  step: z.enum(PRODUCT_STEP_VALUES).nullable().default(null),
  outcome: z.enum(PRODUCT_OUTCOME_VALUES),
}).strict();
export type ProductMetricInput = z.infer<typeof productMetricSchema>;

export const PRODUCT_FEEDBACK_CATEGORIES = ["onboarding", "module", "problem", "idea", "uninstall", "other"] as const;
export type ProductFeedbackCategory = (typeof PRODUCT_FEEDBACK_CATEGORIES)[number];
