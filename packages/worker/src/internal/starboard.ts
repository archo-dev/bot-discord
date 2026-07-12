/** API interne — starboard (M23) : post/édition/suppression de l'embed selon le seuil. */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { deleteStarboardPost, getStarboardPost, getStarboardSettings, upsertStarboardPost } from "../db/queries.js";
import { DiscordAPIError, discordJson } from "../discord/rest.js";

export const internalStarboardRouter = new Hono<{ Bindings: Env }>();

const starboardPostSchema = z.object({
  messageId: z.string().regex(/^\d{5,20}$/),
  channelId: z.string().regex(/^\d{5,20}$/),
  authorTag: z.string().max(120),
  authorAvatarUrl: z.string().url().nullable().optional(),
  content: z.string().max(4000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  count: z.number().int().min(0),
});

/**
 * Starboard update (M23): the gateway posts the current effective star count of
 * a message. At/above the threshold the Worker posts (or edits) an embed in the
 * starboard channel; below it, an existing entry is removed. Tracking lives in
 * starboard_posts so edits/removals target the right message.
 */
internalStarboardRouter.post("/internal/guilds/:guildId/starboard", async (c) => {
  const guildId = c.req.param("guildId");
  const parsed = starboardPostSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const d = parsed.data;

  const settings = await getStarboardSettings(c.env.DB, guildId);
  if (!settings || settings.enabled !== 1 || !settings.channel_id) return c.json({ ok: true, skipped: true });
  const sbChannel = settings.channel_id;
  const post = await getStarboardPost(c.env.DB, guildId, d.messageId);

  if (d.count >= settings.threshold) {
    const messageUrl = `https://discord.com/channels/${guildId}/${d.channelId}/${d.messageId}`;
    const payload = {
      content: `${settings.emoji} **${d.count}** · <#${d.channelId}>`,
      embeds: [
        {
          color: 0xf5b301,
          author: { name: d.authorTag, ...(d.authorAvatarUrl ? { icon_url: d.authorAvatarUrl } : {}) },
          description: d.content ?? undefined,
          ...(d.imageUrl ? { image: { url: d.imageUrl } } : {}),
          fields: [{ name: "Source", value: `[Aller au message](${messageUrl})` }],
        },
      ],
      allowed_mentions: { parse: [] as string[] },
    };

    if (post?.starboard_message_id) {
      try {
        await discordJson(c.env, "PATCH", `/channels/${sbChannel}/messages/${post.starboard_message_id}`, payload);
        await upsertStarboardPost(c.env.DB, guildId, d.messageId, d.channelId, post.starboard_message_id, d.count);
      } catch (err) {
        // Starboard message deleted manually → repost a fresh one.
        if (err instanceof DiscordAPIError && err.status === 404) {
          const msg = await discordJson<{ id: string }>(c.env, "POST", `/channels/${sbChannel}/messages`, payload);
          await upsertStarboardPost(c.env.DB, guildId, d.messageId, d.channelId, msg.id, d.count);
        } else throw err;
      }
    } else {
      const msg = await discordJson<{ id: string }>(c.env, "POST", `/channels/${sbChannel}/messages`, payload);
      await upsertStarboardPost(c.env.DB, guildId, d.messageId, d.channelId, msg.id, d.count);
    }
  } else if (post?.starboard_message_id) {
    // Dropped below the threshold → remove the starboard entry.
    try {
      await discordJson(c.env, "DELETE", `/channels/${sbChannel}/messages/${post.starboard_message_id}`);
    } catch (err) {
      if (!(err instanceof DiscordAPIError && err.status === 404)) console.error("starboard delete failed:", err);
    }
    await deleteStarboardPost(c.env.DB, guildId, d.messageId);
  }

  return c.json({ ok: true });
});
