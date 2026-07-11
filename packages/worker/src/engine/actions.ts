import type { APIEmbed } from "discord-api-types/v10";
import {
  isAllowedWebhookUrl,
  substituteVariables,
  type CommandAction,
  type CommandEmbed,
  type VariableContext,
} from "@bot/shared";
import type { Env } from "../env.js";
import { discordJson } from "../discord/rest.js";
import { withMemberCards } from "../discord/member-card.js";
import { incrementCounter } from "../db/queries.js";

export interface ActionContext {
  env: Env;
  guildId: string;
  userId: string;
  channelId: string;
  vars: VariableContext;
}

export interface ReplyPayload {
  content?: string;
  embeds?: APIEmbed[];
  ephemeral: boolean;
}

export function renderEmbed(embed: CommandEmbed, vars: VariableContext): APIEmbed {
  return {
    title: embed.title ? substituteVariables(embed.title, vars) : undefined,
    description: embed.description ? substituteVariables(embed.description, vars) : undefined,
    color: embed.color,
    fields: embed.fields?.map((f) => ({
      name: substituteVariables(f.name, vars),
      value: substituteVariables(f.value, vars),
      inline: f.inline,
    })),
    footer: embed.footer ? { text: substituteVariables(embed.footer.text, vars) } : undefined,
    thumbnail: embed.thumbnail,
  };
}

/** Does this channel belong to this guild? Prevents cross-guild abuse. KV-cached. */
async function channelBelongsToGuild(env: Env, channelId: string, guildId: string): Promise<boolean> {
  const cacheKey = `chanGuild:${channelId}`;
  let owner = await env.KV.get(cacheKey);
  if (!owner) {
    try {
      const channel = await discordJson<{ guild_id?: string }>(env, "GET", `/channels/${channelId}`);
      owner = channel.guild_id ?? "none";
      await env.KV.put(cacheKey, owner, { expirationTtl: 300 });
    } catch {
      return false;
    }
  }
  return owner === guildId;
}

/**
 * Executes one whitelisted action. `reply` is handled by the caller (it's the
 * interaction response, not a REST call) and must not be passed here.
 * Throws with a short reason on failure; the caller decides whether to
 * continue the chain.
 */
export async function executeAction(action: CommandAction, ctx: ActionContext): Promise<void> {
  switch (action.type) {
    case "reply":
      throw new Error("reply is handled by the interaction response, not the action executor");

    case "send_message": {
      if (!(await channelBelongsToGuild(ctx.env, action.channelId, ctx.guildId))) {
        throw new Error(`channel ${action.channelId} is not in this guild`);
      }
      await discordJson(
        ctx.env,
        "POST",
        `/channels/${action.channelId}/messages`,
        await withMemberCards(ctx.env, ctx.guildId, {
          content: action.content ? substituteVariables(action.content, ctx.vars) : undefined,
          embeds: action.embed ? [renderEmbed(action.embed, ctx.vars)] : undefined,
          allowed_mentions: { parse: [] },
        }),
      );
      return;
    }

    case "add_role":
      // Discord enforces role hierarchy (403 if the role is above the bot's top role).
      await discordJson(ctx.env, "PUT", `/guilds/${ctx.guildId}/members/${ctx.userId}/roles/${action.roleId}`, undefined, {
        auditLogReason: "Commande personnalisée",
      });
      return;

    case "remove_role":
      await discordJson(ctx.env, "DELETE", `/guilds/${ctx.guildId}/members/${ctx.userId}/roles/${action.roleId}`, undefined, {
        auditLogReason: "Commande personnalisée",
      });
      return;

    case "increment_counter":
      await incrementCounter(ctx.env.DB, ctx.guildId, action.counter, action.amount);
      return;

    case "call_webhook": {
      // Defense in depth: re-validate at execution time, not just at save time.
      if (!isAllowedWebhookUrl(action.url)) throw new Error("webhook URL rejected");
      const init: RequestInit = {
        method: action.method,
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      };
      if (action.method === "POST" && action.includeContext) {
        init.headers = { "content-type": "application/json" };
        // Fixed context shape — never user-defined code or templates.
        init.body = JSON.stringify({
          guildId: ctx.guildId,
          userId: ctx.userId,
          channelId: ctx.channelId,
          userName: ctx.vars.userName,
        });
      }
      // Fire; the response body is intentionally never read back into content.
      const res = await fetch(action.url, init);
      if (!res.ok) throw new Error(`webhook returned ${res.status}`);
      return;
    }
  }
}
