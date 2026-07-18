/* Éditeur de commande — état de formulaire et conversion form <-> CommandLogic (pur, sans React). */

import type { CommandAction, CommandCondition, CommandLogic, CustomCommandDto } from "@bot/shared";

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
