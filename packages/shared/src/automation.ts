import { z } from "zod";
import { isAllowedWebhookUrl } from "./command-logic.js";

export const AUTOMATION_SCHEMA_VERSION = 1 as const;
export const AUTOMATION_MAX_DEPTH = 4;
export const AUTOMATION_EVENT_TTL_MS = 10 * 60_000;

export const AUTOMATION_TRIGGER_IDS = [
  "message_create", "member_join", "member_leave", "reaction_add", "voice_join", "voice_leave", "voice_move",
  "ticket_opened", "ticket_closed", "warn_created", "mute_applied", "role_added", "role_removed", "button_pressed",
  "select_menu", "slash_command_executed", "cron",
] as const;
export type AutomationTriggerId = (typeof AUTOMATION_TRIGGER_IDS)[number];

export const AUTOMATION_CONDITION_IDS = [
  "user_has_role", "user_lacks_role", "channel_is", "category_is", "channel_name", "message_contains",
  "message_starts_with", "regex", "warn_count", "account_age", "member_age", "is_bot", "is_webhook", "hour",
  "day", "variable", "boolean_expression",
] as const;
export type AutomationConditionId = (typeof AUTOMATION_CONDITION_IDS)[number];

export const AUTOMATION_ACTION_IDS = [
  "send_message", "send_embed", "send_dm", "delete_message", "add_role", "remove_role", "warn", "timeout", "kick",
  "ban", "create_ticket", "close_ticket", "create_log", "add_reaction", "modify_nickname", "modify_slowmode",
  "create_thread", "call_webhook", "wait", "stop_workflow",
] as const;
export type AutomationActionId = (typeof AUTOMATION_ACTION_IDS)[number];

export type AutomationCategory = "messages" | "members" | "moderation" | "voice" | "tickets" | "interactions" | "schedule" | "flow" | "integrations";
export interface AutomationConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "channel" | "role" | "select" | "json";
  required?: boolean;
  options?: readonly string[];
  placeholder?: string;
}
export interface AutomationComponentDefinition<T extends string = string> {
  id: T;
  name: string;
  description: string;
  version: 1;
  category: AutomationCategory;
  requiredPermissions: readonly string[];
  configFields: readonly AutomationConfigField[];
}

const field = (key: string, label: string, type: AutomationConfigField["type"], extra: Partial<AutomationConfigField> = {}): AutomationConfigField => ({ key, label, type, ...extra });
const def = <T extends string>(id: T, name: string, description: string, category: AutomationCategory, requiredPermissions: readonly string[] = [], configFields: readonly AutomationConfigField[] = []): AutomationComponentDefinition<T> => ({ id, name, description, version: 1, category, requiredPermissions, configFields });

export const AUTOMATION_TRIGGERS: readonly AutomationComponentDefinition<AutomationTriggerId>[] = [
  def("message_create", "Message créé", "À la réception d’un message.", "messages", [], [field("channelId", "Salon", "channel"), field("ignoreBots", "Ignorer les bots", "boolean")]),
  def("member_join", "Membre rejoint", "Lorsqu’un membre rejoint le serveur.", "members"),
  def("member_leave", "Membre quitte", "Lorsqu’un membre quitte le serveur.", "members"),
  def("reaction_add", "Réaction ajoutée", "Lorsqu’une réaction est ajoutée.", "messages", [], [field("emoji", "Emoji", "text")]),
  def("voice_join", "Arrivée vocale", "Lorsqu’un membre rejoint un vocal.", "voice"),
  def("voice_leave", "Départ vocal", "Lorsqu’un membre quitte un vocal.", "voice"),
  def("voice_move", "Déplacement vocal", "Lorsqu’un membre change de vocal.", "voice"),
  def("ticket_opened", "Ticket ouvert", "Lorsqu’un ticket est créé.", "tickets"),
  def("ticket_closed", "Ticket fermé", "Lorsqu’un ticket est fermé.", "tickets"),
  def("warn_created", "Warn créé", "Lorsqu’un avertissement est enregistré.", "moderation"),
  def("mute_applied", "Timeout appliqué", "Lorsqu’un timeout est appliqué.", "moderation"),
  def("role_added", "Rôle ajouté", "Lorsqu’un rôle est ajouté à un membre.", "members", [], [field("roleId", "Rôle", "role")]),
  def("role_removed", "Rôle retiré", "Lorsqu’un rôle est retiré à un membre.", "members", [], [field("roleId", "Rôle", "role")]),
  def("button_pressed", "Bouton pressé", "Lorsqu’un composant bouton est utilisé.", "interactions", [], [field("customId", "Identifiant", "text")]),
  def("select_menu", "Menu sélectionné", "Lorsqu’un menu est utilisé.", "interactions", [], [field("customId", "Identifiant", "text")]),
  def("slash_command_executed", "Commande slash", "Lorsqu’une commande slash est exécutée.", "interactions", [], [field("command", "Commande", "text")]),
  def("cron", "Planification", "Selon une expression cron UTC.", "schedule", [], [field("cron", "Expression cron", "text", { required: true, placeholder: "0 9 * * 1-5" })]),
];

export const AUTOMATION_CONDITIONS: readonly AutomationComponentDefinition<AutomationConditionId>[] = [
  def("user_has_role", "Possède le rôle", "Le membre possède un rôle.", "members", [], [field("roleId", "Rôle", "role", { required: true })]),
  def("user_lacks_role", "Ne possède pas le rôle", "Le membre ne possède pas un rôle.", "members", [], [field("roleId", "Rôle", "role", { required: true })]),
  def("channel_is", "Salon", "L’événement concerne un salon.", "messages", [], [field("channelId", "Salon", "channel", { required: true })]),
  def("category_is", "Catégorie", "Le salon appartient à une catégorie.", "messages", [], [field("categoryId", "Catégorie", "channel", { required: true })]),
  def("channel_name", "Nom du salon", "Compare le nom du salon.", "messages", [], [field("value", "Nom", "text", { required: true }), field("operator", "Comparaison", "select", { options: ["equals", "contains", "starts_with"] })]),
  def("message_contains", "Message contient", "Recherche un texte dans le message.", "messages", [], [field("value", "Texte", "text", { required: true }), field("caseSensitive", "Sensible à la casse", "boolean")]),
  def("message_starts_with", "Message commence par", "Teste le début du message.", "messages", [], [field("value", "Texte", "text", { required: true })]),
  def("regex", "Expression régulière", "Teste une expression bornée.", "messages", [], [field("pattern", "Regex", "text", { required: true })]),
  def("warn_count", "Nombre de warns", "Compare le nombre de warns actifs.", "moderation", [], [field("operator", "Opérateur", "select", { options: ["eq", "gt", "gte", "lt", "lte"] }), field("value", "Valeur", "number", { required: true })]),
  def("account_age", "Ancienneté du compte", "Compare l’âge du compte en jours.", "members", [], [field("minimumDays", "Jours minimum", "number", { required: true })]),
  def("member_age", "Ancienneté sur le serveur", "Compare l’ancienneté du membre en jours.", "members", [], [field("minimumDays", "Jours minimum", "number", { required: true })]),
  def("is_bot", "Bot", "Teste si l’utilisateur est un bot.", "members", [], [field("value", "Est un bot", "boolean")]),
  def("is_webhook", "Webhook", "Teste si le message vient d’un webhook.", "messages", [], [field("value", "Est un webhook", "boolean")]),
  def("hour", "Heure", "Teste une plage horaire UTC.", "schedule", [], [field("from", "De", "number"), field("to", "À", "number")]),
  def("day", "Jour", "Teste les jours UTC.", "schedule", [], [field("days", "Jours 0-6", "json", { required: true })]),
  def("variable", "Variable", "Compare une variable du contexte.", "flow", [], [field("path", "Variable", "text", { required: true }), field("operator", "Opérateur", "select", { options: ["eq", "neq", "contains", "exists", "gt", "gte", "lt", "lte"] }), field("value", "Valeur", "text")]),
  def("boolean_expression", "Expression booléenne", "Combine des comparaisons sans eval.", "flow", [], [field("expression", "Expression", "text", { required: true, placeholder: "user.bot == false && warnCount >= 2" })]),
];

export const AUTOMATION_ACTIONS: readonly AutomationComponentDefinition<AutomationActionId>[] = [
  def("send_message", "Envoyer un message", "Envoie un message dans un salon.", "messages", ["send_messages"], [field("channelId", "Salon", "channel"), field("content", "Message", "textarea", { required: true })]),
  def("send_embed", "Envoyer un embed", "Envoie un embed borné.", "messages", ["send_messages", "embed_links"], [field("channelId", "Salon", "channel"), field("title", "Titre", "text"), field("description", "Description", "textarea", { required: true }), field("color", "Couleur", "number")]),
  def("send_dm", "Envoyer un DM", "Envoie un message privé.", "messages", [], [field("content", "Message", "textarea", { required: true })]),
  def("delete_message", "Supprimer le message", "Supprime le message déclencheur.", "moderation", ["manage_messages"]),
  def("add_role", "Ajouter un rôle", "Ajoute un rôle au membre.", "members", ["manage_roles"], [field("roleId", "Rôle", "role", { required: true })]),
  def("remove_role", "Retirer un rôle", "Retire un rôle au membre.", "members", ["manage_roles"], [field("roleId", "Rôle", "role", { required: true })]),
  def("warn", "Warn", "Ajoute un avertissement audité.", "moderation", [], [field("reason", "Raison", "text")]),
  def("timeout", "Timeout", "Applique un timeout Discord.", "moderation", ["moderate_members"], [field("seconds", "Secondes", "number", { required: true }), field("reason", "Raison", "text")]),
  def("kick", "Expulser", "Expulse le membre.", "moderation", ["kick_members"], [field("reason", "Raison", "text")]),
  def("ban", "Bannir", "Bannit le membre.", "moderation", ["ban_members"], [field("reason", "Raison", "text"), field("deleteMessageSeconds", "Messages à supprimer (s)", "number")]),
  def("create_ticket", "Créer un ticket", "Crée un ticket pour le membre.", "tickets", ["manage_channels"], [field("reason", "Sujet", "text")]),
  def("close_ticket", "Fermer le ticket", "Ferme le ticket du contexte.", "tickets", ["manage_channels"], [field("reason", "Raison", "text")]),
  def("create_log", "Créer un log", "Ajoute une entrée structurée au journal.", "flow", [], [field("message", "Message", "textarea", { required: true })]),
  def("add_reaction", "Ajouter une réaction", "Ajoute une réaction au message.", "messages", [], [field("emoji", "Emoji", "text", { required: true })]),
  def("modify_nickname", "Modifier le pseudo", "Modifie le pseudo du membre.", "members", ["change_nickname"], [field("nickname", "Pseudo", "text")]),
  def("modify_slowmode", "Modifier le slowmode", "Modifie le délai du salon.", "moderation", ["manage_channels"], [field("seconds", "Secondes", "number", { required: true })]),
  def("create_thread", "Créer un thread", "Crée un thread depuis le salon.", "messages", ["send_messages"], [field("name", "Nom", "text", { required: true }), field("autoArchiveMinutes", "Archive (minutes)", "number")]),
  def("call_webhook", "Appeler un webhook", "Appelle une URL HTTPS publique.", "integrations", [], [field("url", "URL", "text", { required: true }), field("body", "Corps JSON", "json")]),
  def("wait", "Attendre", "Planifie la suite sans bloquer le Worker.", "flow", [], [field("seconds", "Secondes", "number", { required: true })]),
  def("stop_workflow", "Arrêter le workflow", "Arrête proprement la suite d’actions.", "flow"),
];

const SNOWFLAKE = z.string().regex(/^\d{5,20}$/);
const config = z.record(z.string(), z.unknown()).default({});
const component = <T extends readonly [string, ...string[]]>(ids: T) => z.object({ id: z.string().uuid().optional(), type: z.enum(ids), config });
const triggerBase = component(AUTOMATION_TRIGGER_IDS);
const conditionBase = component(AUTOMATION_CONDITION_IDS).extend({ negate: z.boolean().default(false) });
const actionBase = component(AUTOMATION_ACTION_IDS).extend({ continueOnError: z.boolean().default(false) });

const text = (max = 2000) => z.string().min(1).max(max);
const optionalSnowflake = SNOWFLAKE.optional();
const TRIGGER_CONFIG: Record<AutomationTriggerId, z.ZodType> = Object.fromEntries(AUTOMATION_TRIGGER_IDS.map((id) => [id, z.object({}).passthrough()])) as never;
TRIGGER_CONFIG.message_create = z.object({ channelId: optionalSnowflake, ignoreBots: z.boolean().default(true) });
TRIGGER_CONFIG.reaction_add = z.object({ emoji: z.string().max(100).optional() });
TRIGGER_CONFIG.role_added = z.object({ roleId: optionalSnowflake });
TRIGGER_CONFIG.role_removed = z.object({ roleId: optionalSnowflake });
TRIGGER_CONFIG.button_pressed = z.object({ customId: z.string().max(100).optional() });
TRIGGER_CONFIG.select_menu = z.object({ customId: z.string().max(100).optional() });
TRIGGER_CONFIG.slash_command_executed = z.object({ command: z.string().max(32).optional() });
TRIGGER_CONFIG.cron = z.object({ cron: z.string().regex(/^[\d*/?,\-]+\s+[\d*/?,\-]+\s+[\d*/?,\-]+\s+[\d*/?,\-]+\s+[\d*/?,\-]+$/).max(100) });

const CONDITION_CONFIG: Record<AutomationConditionId, z.ZodType> = Object.fromEntries(AUTOMATION_CONDITION_IDS.map((id) => [id, z.object({}).passthrough()])) as never;
for (const id of ["user_has_role", "user_lacks_role"] as const) CONDITION_CONFIG[id] = z.object({ roleId: SNOWFLAKE });
CONDITION_CONFIG.channel_is = z.object({ channelId: SNOWFLAKE });
CONDITION_CONFIG.category_is = z.object({ categoryId: SNOWFLAKE });
CONDITION_CONFIG.channel_name = z.object({ value: text(100), operator: z.enum(["equals", "contains", "starts_with"]).default("equals") });
CONDITION_CONFIG.message_contains = z.object({ value: text(500), caseSensitive: z.boolean().default(false) });
CONDITION_CONFIG.message_starts_with = z.object({ value: text(500), caseSensitive: z.boolean().default(false) });
CONDITION_CONFIG.regex = z.object({ pattern: text(200) }).superRefine((v, ctx) => { try { new RegExp(v.pattern); } catch { ctx.addIssue({ code: "custom", message: "invalid regex" }); } });
CONDITION_CONFIG.warn_count = z.object({ operator: z.enum(["eq", "gt", "gte", "lt", "lte"]), value: z.number().int().min(0).max(10_000) });
CONDITION_CONFIG.account_age = z.object({ minimumDays: z.number().int().min(0).max(20_000) });
CONDITION_CONFIG.member_age = z.object({ minimumDays: z.number().int().min(0).max(20_000) });
CONDITION_CONFIG.is_bot = z.object({ value: z.boolean() });
CONDITION_CONFIG.is_webhook = z.object({ value: z.boolean() });
CONDITION_CONFIG.hour = z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) });
CONDITION_CONFIG.day = z.object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7) });
CONDITION_CONFIG.variable = z.object({ path: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/), operator: z.enum(["eq", "neq", "contains", "exists", "gt", "gte", "lt", "lte"]), value: z.union([z.string(), z.number(), z.boolean()]).optional() });
CONDITION_CONFIG.boolean_expression = z.object({ expression: z.string().min(1).max(300).regex(/^[a-zA-Z0-9_.\s!=<>&|"'()-]+$/) });

const ACTION_CONFIG: Record<AutomationActionId, z.ZodType> = Object.fromEntries(AUTOMATION_ACTION_IDS.map((id) => [id, z.object({}).passthrough()])) as never;
ACTION_CONFIG.send_message = z.object({ channelId: optionalSnowflake, content: text(2000) });
ACTION_CONFIG.send_embed = z.object({ channelId: optionalSnowflake, title: z.string().max(256).optional(), description: text(4096), color: z.number().int().min(0).max(0xffffff).optional() });
ACTION_CONFIG.send_dm = z.object({ content: text(2000) });
ACTION_CONFIG.add_role = z.object({ roleId: SNOWFLAKE });
ACTION_CONFIG.remove_role = z.object({ roleId: SNOWFLAKE });
ACTION_CONFIG.warn = z.object({ reason: z.string().max(500).default("Automatisation") });
ACTION_CONFIG.timeout = z.object({ seconds: z.number().int().min(1).max(2_419_200), reason: z.string().max(500).default("Automatisation") });
ACTION_CONFIG.kick = z.object({ reason: z.string().max(500).default("Automatisation") });
ACTION_CONFIG.ban = z.object({ reason: z.string().max(500).default("Automatisation"), deleteMessageSeconds: z.number().int().min(0).max(604800).default(0) });
ACTION_CONFIG.create_ticket = z.object({ reason: z.string().max(500).default("Automatisation") });
ACTION_CONFIG.close_ticket = z.object({ reason: z.string().max(500).default("Automatisation") });
ACTION_CONFIG.create_log = z.object({ message: text(1000) });
ACTION_CONFIG.add_reaction = z.object({ emoji: text(100) });
ACTION_CONFIG.modify_nickname = z.object({ nickname: z.string().max(32) });
ACTION_CONFIG.modify_slowmode = z.object({ seconds: z.number().int().min(0).max(21600) });
ACTION_CONFIG.create_thread = z.object({ name: text(100), autoArchiveMinutes: z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)]).default(1440) });
ACTION_CONFIG.call_webhook = z.object({ url: z.string().max(500).refine(isAllowedWebhookUrl), body: z.record(z.string(), z.unknown()).default({}) });
ACTION_CONFIG.wait = z.object({ seconds: z.number().int().min(1).max(86400) });

function validateComponentConfig(value: { type: string; config: Record<string, unknown> }, schemas: Record<string, z.ZodType>, ctx: z.RefinementCtx): void {
  const parsed = schemas[value.type]?.safeParse(value.config);
  if (!parsed?.success) for (const issue of parsed?.error.issues ?? []) ctx.addIssue({ code: "custom", path: ["config", ...issue.path], message: issue.message });
}
export const automationTriggerSchema = triggerBase.superRefine((v, ctx) => validateComponentConfig(v, TRIGGER_CONFIG, ctx));
export const automationConditionSchema = conditionBase.superRefine((v, ctx) => validateComponentConfig(v, CONDITION_CONFIG, ctx));
export const automationActionSchema = actionBase.superRefine((v, ctx) => validateComponentConfig(v, ACTION_CONFIG, ctx));

export const automationWorkflowInputSchema = z.object({
  schemaVersion: z.literal(AUTOMATION_SCHEMA_VERSION).default(AUTOMATION_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  enabled: z.boolean().default(false),
  trigger: automationTriggerSchema,
  conditions: z.array(automationConditionSchema).max(20).default([]),
  conditionMode: z.enum(["all", "any"]).default("all"),
  actions: z.array(automationActionSchema).min(1).max(20),
  cooldownSeconds: z.number().int().min(0).max(86400).default(0),
  cooldownScope: z.enum(["user", "guild", "channel"]).default("user"),
  maxRunsPerMinute: z.number().int().min(1).max(60).default(10),
}).superRefine((v, ctx) => {
  if (v.actions.filter((a) => a.type === "wait").length > 5) ctx.addIssue({ code: "custom", path: ["actions"], message: "at most five wait actions" });
});
export type AutomationWorkflowInput = z.infer<typeof automationWorkflowInputSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const AUTOMATION_VARIABLES = ["user", "user.id", "user.name", "user.bot", "guild", "guild.id", "guild.name", "channel", "channel.id", "channel.name", "message", "message.id", "message.content", "reason", "warnCount", "ticket.id", "voice.channel", "event.type"] as const;
const TEMPLATE_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]{0,79})\s*\}\}/g;
export function automationTemplateVariables(template: string): string[] { return [...new Set([...template.matchAll(TEMPLATE_RE)].map((m) => m[1]!))]; }
export function renderAutomationTemplate(template: string, context: Record<string, unknown>): string {
  const read = (path: string): unknown => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, context);
  return template.replaceAll(TEMPLATE_RE, (_match, path: string) => { const value = read(path); return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""; });
}

export interface AutomationCatalogDto { schemaVersion: 1; triggers: typeof AUTOMATION_TRIGGERS; conditions: typeof AUTOMATION_CONDITIONS; actions: typeof AUTOMATION_ACTIONS; variables: readonly string[]; }
export const AUTOMATION_CATALOG: AutomationCatalogDto = { schemaVersion: 1, triggers: AUTOMATION_TRIGGERS, conditions: AUTOMATION_CONDITIONS, actions: AUTOMATION_ACTIONS, variables: AUTOMATION_VARIABLES };

export interface AutomationWorkflowDto extends AutomationWorkflowInput { id: string; guildId: string; revision: number; failureStreak: number; circuitOpenUntil: string | null; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; }
export interface AutomationRevisionDto { id: number; workflowId: string; revision: number; changeType: string; changedBy: string; createdAt: string; snapshot: AutomationWorkflowInput; }
export interface AutomationExecutionDto { id: string; workflowId: string; workflowName?: string; triggerType: AutomationTriggerId; status: "running" | "succeeded" | "failed" | "skipped" | "simulated"; actionsTotal: number; actionsSucceeded: number; durationMs: number | null; errorCode: string | null; startedAt: string; finishedAt: string | null; correlationId: string; }
export interface AutomationStatsDto { executions: number; successes: number; failures: number; skipped: number; averageDurationMs: number | null; }
export interface AutomationSimulationResult { matched: boolean; conditionResults: Array<{ type: AutomationConditionId; matched: boolean }>; actions: Array<{ type: AutomationActionId; preview: string }>; warnings: string[]; }
export interface AutomationExportEnvelope { format: "botdiscord-automation"; version: 1; exportedAt: string; workflow: AutomationWorkflowInput; }

export const automationEventContextSchema = z.object({
  event: z.object({ type: z.enum(AUTOMATION_TRIGGER_IDS), id: z.string().max(100).optional(), depth: z.number().int().min(0).max(AUTOMATION_MAX_DEPTH).default(0) }),
  guild: z.object({ id: SNOWFLAKE, name: z.string().max(100).optional() }),
  user: z.object({ id: SNOWFLAKE, name: z.string().max(100).optional(), bot: z.boolean().optional(), roleIds: z.array(SNOWFLAKE).max(100).optional(), accountCreatedAt: z.string().datetime().optional(), joinedAt: z.string().datetime().optional() }).optional(),
  channel: z.object({ id: SNOWFLAKE, name: z.string().max(100).optional(), categoryId: SNOWFLAKE.nullable().optional() }).optional(),
  message: z.object({ id: SNOWFLAKE, content: z.string().max(4000).optional(), webhook: z.boolean().optional() }).optional(),
  reaction: z.object({ emoji: z.string().max(100) }).optional(),
  voice: z.object({ channel: z.string().max(100).optional(), channelId: SNOWFLAKE.optional(), previousChannelId: SNOWFLAKE.optional() }).optional(),
  ticket: z.object({ id: z.number().int().positive(), channelId: SNOWFLAKE.optional() }).optional(),
  reason: z.string().max(500).optional(),
  warnCount: z.number().int().min(0).optional(),
  command: z.string().max(32).optional(),
  component: z.object({ customId: z.string().max(100), values: z.array(z.string().max(100)).max(25).optional() }).optional(),
  role: z.object({ id: SNOWFLAKE }).optional(),
}).passthrough();
export type AutomationEventContext = z.infer<typeof automationEventContextSchema>;
