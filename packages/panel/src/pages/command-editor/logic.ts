/* Éditeur de commande — état de formulaire et conversion form <-> CommandLogic (pur, sans React). */

import {
  isAllowedWebhookUrl,
  RESERVED_COMMAND_NAMES,
  type ChannelOption,
  type CommandAction,
  type CommandCondition,
  type CommandLogic,
  type CustomCommandDto,
  type RoleOption,
} from "@bot/shared";

export const PERMISSION_OPTIONS = [
  { value: "", label: "Tout le monde" },
  { value: "8192", label: "Gérer les messages" },
  { value: "2", label: "Expulser des membres" },
  { value: "4", label: "Bannir des membres" },
  { value: "1099511627776", label: "Modérer les membres (timeout)" },
  { value: "32", label: "Gérer le serveur" },
  { value: "8", label: "Administrateur" },
] as const;

export type ReplyAction = Extract<CommandAction, { type: "reply" }>;
export type ExtraAction = Exclude<CommandAction, ReplyAction>;

export interface FormState {
  name: string;
  description: string;
  triggerType: "slash" | "keyword";
  keywords: string;
  matchMode: "contains" | "exact" | "starts_with";
  replyContent: string;
  replyEphemeral: boolean;
  embedEnabled: boolean;
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
  conditions: CommandCondition[];
  conditionMode: "all" | "any";
  extraActions: ExtraAction[];
  elseReply: string;
  cooldownSeconds: number;
  cooldownScope: "user" | "guild";
  requiredPermissions: string;
}

export const emptyForm: FormState = {
  name: "",
  description: "",
  triggerType: "slash",
  keywords: "",
  matchMode: "contains",
  replyContent: "",
  replyEphemeral: false,
  embedEnabled: false,
  embedTitle: "",
  embedDescription: "",
  embedColor: "#5865F2",
  conditions: [],
  conditionMode: "all",
  extraActions: [],
  elseReply: "",
  cooldownSeconds: 0,
  cooldownScope: "user",
  requiredPermissions: "",
};

export function hydrate(cmd: CustomCommandDto): FormState {
  const logic = cmd.logic;
  const reply = logic.actions.find((a): a is ReplyAction => a.type === "reply");
  return {
    name: cmd.name,
    description: cmd.description,
    triggerType: logic.trigger.type,
    keywords: logic.trigger.type === "keyword" ? logic.trigger.keywords.join(", ") : "",
    matchMode: logic.trigger.type === "keyword" ? logic.trigger.matchMode : "contains",
    replyContent: reply?.content ?? "",
    replyEphemeral: reply?.ephemeral ?? false,
    embedEnabled: reply?.embed !== undefined,
    embedTitle: reply?.embed?.title ?? "",
    embedDescription: reply?.embed?.description ?? "",
    embedColor: `#${(reply?.embed?.color ?? 0x5865f2).toString(16).padStart(6, "0")}`,
    conditions: logic.conditions,
    conditionMode: logic.conditionMode,
    extraActions: logic.actions.filter((a): a is ExtraAction => a.type !== "reply"),
    elseReply: logic.elseActions[0]?.content ?? "",
    cooldownSeconds: logic.cooldown.seconds,
    cooldownScope: logic.cooldown.scope,
    requiredPermissions: logic.requiredPermissions ?? "",
  };
}

export function buildLogic(f: FormState): CommandLogic {
  const actions: CommandAction[] = [];
  if (f.replyContent.trim() || f.embedEnabled) {
    actions.push({
      type: "reply",
      content: f.replyContent.trim() || undefined,
      ephemeral: f.replyEphemeral || undefined,
      embed: f.embedEnabled
        ? {
            title: f.embedTitle.trim() || undefined,
            description: f.embedDescription.trim() || undefined,
            color: parseInt(f.embedColor.replace("#", ""), 16),
          }
        : undefined,
    });
  }
  actions.push(...f.extraActions);

  return {
    version: 1,
    trigger:
      f.triggerType === "slash"
        ? { type: "slash", name: f.name }
        : {
            type: "keyword",
            name: f.name,
            keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean),
            matchMode: f.matchMode,
          },
    conditions: f.conditions,
    conditionMode: f.conditionMode,
    actions,
    elseActions: f.elseReply.trim() ? [{ type: "reply", content: f.elseReply.trim(), ephemeral: true }] : [],
    cooldown: { seconds: f.cooldownSeconds, scope: f.cooldownScope },
    requiredPermissions: f.requiredPermissions || null,
  };
}

export interface CommandDraftValidation {
  readonly valid: boolean;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly conditionErrors: readonly (string | null)[];
  readonly actionErrors: readonly (string | null)[];
  readonly blockingErrors: readonly string[];
  readonly warnings: readonly string[];
}

const COUNTER_NAME_RE = /^[a-z0-9_-]{1,32}$/;

export function validateCommandDraft(form: FormState): CommandDraftValidation {
  const fieldErrors: Record<string, string> = {};
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  if (!form.name) fieldErrors.name = "Le nom est obligatoire.";
  else if (!/^[a-z0-9_-]{1,32}$/.test(form.name)) fieldErrors.name = "Utilisez 1 à 32 caractères : a-z, 0-9, - ou _.";
  else if ((RESERVED_COMMAND_NAMES as readonly string[]).includes(form.name)) fieldErrors.name = "Ce nom est réservé à une commande intégrée.";
  if (!form.description.trim()) fieldErrors.description = "La description est obligatoire.";
  if (form.triggerType === "keyword") {
    const keywords = form.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean);
    if (keywords.length === 0) fieldErrors.keywords = "Ajoutez au moins un mot-clé.";
    else if (keywords.length > 10) fieldErrors.keywords = "Dix mots-clés maximum sont autorisés.";
    else if (keywords.some((keyword) => keyword.length > 100)) fieldErrors.keywords = "Chaque mot-clé est limité à 100 caractères.";
    warnings.push("Le déclencheur par mot-clé nécessite la Gateway.");
  }
  if (!Number.isInteger(form.cooldownSeconds) || form.cooldownSeconds < 0 || form.cooldownSeconds > 86_400) {
    fieldErrors.cooldownSeconds = "Le cooldown doit être un entier entre 0 et 86 400 secondes.";
  }

  const conditionErrors = form.conditions.map((condition): string | null => {
    if ((condition.type === "user_has_role" || condition.type === "user_lacks_role") && !condition.roleId) return "Sélectionnez un rôle.";
    if (condition.type === "channel_is" && !condition.channelId) return "Sélectionnez un salon.";
    if (condition.type === "user_has_permission" && !condition.permission) return "Sélectionnez une permission.";
    if (condition.type === "counter_compare") {
      if (!COUNTER_NAME_RE.test(condition.counter)) return "Le compteur doit utiliser 1 à 32 caractères minuscules, chiffres, - ou _.";
      if (!Number.isInteger(condition.value)) return "La valeur comparée doit être un entier.";
    }
    return null;
  });
  const actionErrors = form.extraActions.map((action): string | null => {
    if (action.type === "send_message" && (!action.channelId || !action.content?.trim())) return "Sélectionnez un salon et saisissez un message.";
    if ((action.type === "add_role" || action.type === "remove_role") && !action.roleId) return "Sélectionnez un rôle.";
    if (action.type === "increment_counter") {
      if (!COUNTER_NAME_RE.test(action.counter)) return "Le compteur doit utiliser 1 à 32 caractères minuscules, chiffres, - ou _.";
      if (!Number.isInteger(action.amount) || action.amount < -1000 || action.amount > 1000) return "La variation doit être un entier entre -1 000 et 1 000.";
    }
    if (action.type === "call_webhook" && !isAllowedWebhookUrl(action.url)) return "Utilisez une URL HTTPS publique valide.";
    return null;
  });
  const hasReply = Boolean(form.replyContent.trim());
  const hasEmbed = form.embedEnabled && Boolean(form.embedTitle.trim() || form.embedDescription.trim());
  if (!hasReply && !hasEmbed && form.extraActions.length === 0) {
    fieldErrors.response = "Ajoutez une réponse, un embed renseigné ou une action.";
  }
  if (form.conditions.length > 10) blockingErrors.push("Dix conditions maximum sont autorisées.");
  if (form.extraActions.length > 4) blockingErrors.push("Quatre actions supplémentaires maximum sont autorisées.");
  if (conditionErrors.some(Boolean)) blockingErrors.push("Une ou plusieurs conditions sont incomplètes.");
  if (actionErrors.some(Boolean)) blockingErrors.push("Une ou plusieurs actions sont incomplètes.");
  for (const error of Object.values(fieldErrors)) blockingErrors.push(error);

  return {
    valid: blockingErrors.length === 0,
    fieldErrors,
    conditionErrors,
    actionErrors,
    blockingErrors: [...new Set(blockingErrors)],
    warnings,
  };
}

export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

const roleName = (id: string, roles: readonly RoleOption[]) =>
  roles.find((role) => role.id === id)?.name ?? "rôle non sélectionné";
const channelName = (id: string, channels: readonly ChannelOption[]) =>
  channels.find((channel) => channel.id === id)?.name ?? "salon non sélectionné";

export function describeCommandCondition(
  condition: CommandCondition,
  roles: readonly RoleOption[],
  channels: readonly ChannelOption[],
): string {
  if (condition.type === "user_has_role") return `le membre possède @${roleName(condition.roleId, roles)}`;
  if (condition.type === "user_lacks_role") return `le membre ne possède pas @${roleName(condition.roleId, roles)}`;
  if (condition.type === "channel_is") return `le salon est #${channelName(condition.channelId, channels)}`;
  if (condition.type === "user_has_permission") return "le membre possède la permission sélectionnée";
  return `le compteur ${condition.counter || "non nommé"} ${condition.op} ${condition.value}`;
}

export function describeCommandAction(
  action: CommandAction,
  roles: readonly RoleOption[],
  channels: readonly ChannelOption[],
): string {
  if (action.type === "reply") return action.embed ? "répondre avec un message et un embed" : "répondre au membre";
  if (action.type === "send_message") return `envoyer un message dans #${channelName(action.channelId, channels)}`;
  if (action.type === "add_role") return `ajouter @${roleName(action.roleId, roles)}`;
  if (action.type === "remove_role") return `retirer @${roleName(action.roleId, roles)}`;
  if (action.type === "increment_counter") return `modifier le compteur ${action.counter} de ${action.amount}`;
  return `appeler le webhook en ${action.method}`;
}

export function buildCommandSummary(
  form: FormState,
  roles: readonly RoleOption[],
  channels: readonly ChannelOption[],
): { sentence: string; steps: string[]; previewMessage: string | null } {
  const trigger = form.triggerType === "slash"
    ? `Quand /${form.name || "commande"} est utilisée`
    : `Quand un message correspond à ${form.keywords.trim() || "un mot-clé non renseigné"}`;
  const conditions = form.conditions.map((condition) => describeCommandCondition(condition, roles, channels));
  const actions = buildLogic(form).actions.map((action) => describeCommandAction(action, roles, channels));
  const conditionText = conditions.length
    ? `, vérifier ${form.conditionMode === "all" ? "toutes les conditions" : "au moins une condition"}`
    : "";
  return {
    sentence: `${trigger}${conditionText}, puis ${actions.length ? actions.join(", puis ") : "aucune action valide"}.`,
    steps: [
      `Déclencheur : ${form.triggerType === "slash" ? `/${form.name || "commande"}` : form.keywords || "mot-clé non renseigné"}`,
      ...conditions.map((condition) => `Condition : ${condition}`),
      ...actions.map((action) => `Action : ${action}`),
    ],
    previewMessage: form.replyContent.trim() || form.embedDescription.trim() || form.embedTitle.trim() || null,
  };
}
