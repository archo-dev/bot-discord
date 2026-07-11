import { Hono } from "hono";
import type { VoiceLogDto, VoiceLogPage } from "@bot/shared";
import { listVoiceLogs } from "../db/queries.js";
import type { AppContext } from "../auth/guard.js";

// Session + guild-access middlewares are applied centrally in index.ts.
// GET only ⇒ readable by moderators (M15 read-only access).
export const voiceLogsRouter = new Hono<AppContext>();

const SNOWFLAKE = /^\d{5,20}$/;
const PAGE_SIZE = 50;

/** Parses a `createdAt|id` cursor; returns undefined on anything malformed. */
function parseCursor(raw: string | undefined): { createdAt: string; id: number } | undefined {
  if (!raw) return undefined;
  const idx = raw.lastIndexOf("|");
  if (idx <= 0) return undefined;
  const id = Number(raw.slice(idx + 1));
  return Number.isInteger(id) ? { createdAt: raw.slice(0, idx), id } : undefined;
}

voiceLogsRouter.get("/guilds/:guildId/voice-logs", async (c) => {
  const guildId = c.req.param("guildId");
  const q = c.req.query();

  const userId = q.userId && SNOWFLAKE.test(q.userId) ? q.userId : undefined;
  const channelId = q.channelId && SNOWFLAKE.test(q.channelId) ? q.channelId : undefined;
  // Inclusive end-of-day: created_at is stored as 'YYYY-MM-DD HH:MM:SS'.
  const to = q.to ? `${q.to} 23:59:59` : undefined;

  const { rows, nextCursor } = await listVoiceLogs(c.env.DB, guildId, {
    userId,
    channelId,
    action: q.action || undefined,
    from: q.from || undefined,
    to,
    cursor: parseCursor(q.cursor),
    limit: PAGE_SIZE,
  });

  const items: VoiceLogDto[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userTag: r.user_tag,
    action: r.action,
    channelId: r.channel_id,
    fromChannelId: r.from_channel_id,
    createdAt: r.created_at,
  }));
  const body: VoiceLogPage = { items, nextCursor };
  return c.json(body);
});
