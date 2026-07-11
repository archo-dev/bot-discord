import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import {
  extractUserMentions,
  hasPermission,
  referencedCounters,
  safeParseCommandLogic,
  substituteVariables,
  type CommandAction,
  type CommandLogic,
  type VariableContext,
} from "@bot/shared";
import type { Env } from "../env.js";
import type { CustomCommandRow } from "../db/queries.js";
import { getCounterValues, getGuild } from "../db/queries.js";
import { conditionCounters, evaluateConditions } from "../engine/conditions.js";
import { remainingCooldown, startCooldown } from "../engine/cooldown.js";
import { executeAction, renderEmbed, type ReplyPayload } from "../engine/actions.js";
import { withMemberCards } from "../discord/member-card.js";
import { deferred, editOriginal, ephemeral, message } from "./respond.js";

/** Counter names used anywhere in the logic (conditions + templates). */
function collectCounterNames(logic: CommandLogic): string[] {
  const names = new Set<string>(conditionCounters(logic.conditions));
  const scanText = (text?: string): void => {
    if (text) for (const n of referencedCounters(text)) names.add(n);
  };
  for (const action of [...logic.actions, ...logic.elseActions]) {
    if (action.type === "reply" || action.type === "send_message") {
      scanText(action.content);
      scanText(action.embed?.title);
      scanText(action.embed?.description);
      scanText(action.embed?.footer?.text);
      for (const f of action.embed?.fields ?? []) {
        scanText(f.name);
        scanText(f.value);
      }
    }
  }
  return [...names];
}

function buildReply(action: Extract<CommandAction, { type: "reply" }>, vars: VariableContext): ReplyPayload {
  return {
    content: action.content ? substituteVariables(action.content, vars) : undefined,
    embeds: action.embed ? [renderEmbed(action.embed, vars)] : undefined,
    ephemeral: action.ephemeral ?? false,
  };
}

export async function executeCustomCommand(
  env: Env,
  interaction: APIChatInputApplicationCommandInteraction,
  row: CustomCommandRow,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  const guildId = interaction.guild_id!;
  const member = interaction.member!;
  const userId = member.user.id;
  const channelId = interaction.channel.id;

  // Re-validate stored logic (defense in depth against manual DB edits).
  const parsed = safeParseCommandLogic(row.logic);
  if (!parsed.success) {
    console.error(`invalid stored logic for command ${row.id}: ${parsed.error}`);
    return ephemeral("⚠️ Cette commande est mal configurée. Contactez un administrateur.");
  }
  const logic = parsed.data;

  // Real permission check from the interaction payload — never client-trusted.
  if (logic.requiredPermissions !== null && !hasPermission(member.permissions, BigInt(logic.requiredPermissions))) {
    return ephemeral("⛔ Vous n'avez pas la permission d'utiliser cette commande.");
  }

  // Cooldown (best-effort, KV).
  if (logic.cooldown.seconds > 0) {
    const remaining = await remainingCooldown(env, guildId, row.id, logic.cooldown.scope, userId);
    if (remaining > 0) {
      return ephemeral(`⏳ Cette commande est en cooldown — réessayez dans ${remaining}s.`);
    }
  }

  // Resolve everything conditions + templates need.
  const counterNames = collectCounterNames(logic);
  const counters = counterNames.length > 0 ? await getCounterValues(env.DB, guildId, counterNames) : {};
  const guildRow = await getGuild(env.DB, guildId);
  const memberCountCache = await env.KV.get(`gmeta:${guildId}`);
  const memberCount = memberCountCache ? ((JSON.parse(memberCountCache) as { count: number | null }).count ?? null) : null;

  const vars: VariableContext = {
    userName: member.user.global_name ?? member.user.username,
    userId,
    serverName: guildRow?.name ?? "ce serveur",
    memberCount,
    channelId,
    counters,
  };

  const passed = evaluateConditions(logic.conditions, logic.conditionMode, {
    memberRoles: member.roles,
    memberPermissions: member.permissions,
    channelId,
    counters,
  });

  if (!passed) {
    const elseAction = logic.elseActions[0];
    if (elseAction) {
      const payload = buildReply(elseAction, vars);
      return message(payload.content ?? "", { ephemeral: payload.ephemeral, embeds: payload.embeds });
    }
    return ephemeral("⛔ Vous ne remplissez pas les conditions pour utiliser cette commande.");
  }

  if (logic.cooldown.seconds > 0) {
    waitUntil(startCooldown(env, guildId, row.id, logic.cooldown.scope, userId, logic.cooldown.seconds));
  }

  const replyAction = logic.actions.find((a): a is Extract<CommandAction, { type: "reply" }> => a.type === "reply");
  const restActions = logic.actions.filter((a) => a.type !== "reply");

  // Member cards (M20) need an async member fetch, impossible on the type-4 fast
  // path — force the deferred path when the reply mentions someone and the guild
  // opted in, so withMemberCards can append cards before editing the response.
  const replyPreview = replyAction ? buildReply(replyAction, vars) : null;
  const wantsCards =
    guildRow?.mention_cards === 1 && !!replyPreview?.content && extractUserMentions(replyPreview.content).length > 0;

  // FAST PATH — pure reply, no REST/DB side effects: answer directly (type 4).
  if (restActions.length === 0 && !wantsCards) {
    return message(replyPreview?.content ?? "✅", {
      ephemeral: replyPreview?.ephemeral ?? true,
      embeds: replyPreview?.embeds,
    });
  }

  // SLOW PATH — defer now, run the chain, then edit the original response.
  const replyPayload = replyAction ? buildReply(replyAction, vars) : null;
  const isEphemeral = replyPayload?.ephemeral ?? true;

  waitUntil(
    (async () => {
      const actionCtx = { env, guildId, userId, channelId, vars };
      let failed: string | null = null;
      for (const action of restActions) {
        try {
          await executeAction(action, actionCtx);
        } catch (err) {
          console.error(`custom command ${row.id} action ${action.type} failed:`, err);
          failed = action.type;
          break;
        }
      }
      if (failed) {
        await editOriginal(env, interaction, {
          content: `⚠️ L'action \`${failed}\` a échoué. Vérifiez la configuration de la commande.`,
        });
      } else if (replyPayload) {
        await editOriginal(
          env,
          interaction,
          await withMemberCards(env, guildId, { content: replyPayload.content, embeds: replyPayload.embeds }),
        );
      } else {
        await editOriginal(env, interaction, { content: "✅ Actions exécutées." });
      }
    })(),
  );

  return deferred({ ephemeral: isEphemeral });
}
