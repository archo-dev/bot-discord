import { Hono } from "hono";
import type { ChannelStatsDto, MemberStatsDto, PresenceStatsDto, ScheduledEventDto } from "@bot/shared";
import { listMemberDeltas, listMemberSnapshots, topChannels } from "../db/queries.js";
import { discordJson } from "../discord/rest.js";
import { handleGuildAccessLoss, type AppContext } from "../auth/guard.js";

// Session + guild-access middlewares are applied centrally in index.ts.
// All GET ⇒ readable by moderators (M15 read-only access).
export const statsRouter = new Hono<AppContext>();

function pickDays(raw: string | undefined, allowed: number[]): number {
  const n = Number(raw);
  return allowed.includes(n) ? n : allowed[0]!;
}

statsRouter.get("/guilds/:guildId/stats/members", async (c) => {
  const guildId = c.req.param("guildId");
  const days = pickDays(c.req.query("days"), [7, 30, 90]);
  const [snapshots, deltas] = await Promise.all([
    // 7 days → hourly resolution; longer windows → one point per day.
    listMemberSnapshots(c.env.DB, guildId, days, days <= 7 ? "hourly" : "daily"),
    listMemberDeltas(c.env.DB, guildId, days),
  ]);
  const body: MemberStatsDto = { snapshots, deltas };
  return c.json(body);
});

statsRouter.get("/guilds/:guildId/stats/channels", async (c) => {
  const guildId = c.req.param("guildId");
  const days = pickDays(c.req.query("days"), [1, 7, 30]);
  const [topMessages, topVoice] = await Promise.all([
    topChannels(c.env.DB, guildId, days, "messages", 10),
    topChannels(c.env.DB, guildId, days, "voice", 10),
  ]);
  const body: ChannelStatsDto = { topMessages, topVoice };
  return c.json(body);
});

statsRouter.get("/guilds/:guildId/stats/presence", async (c) => {
  // Presence rides on the gateway heartbeat KV key; null = intent off / gateway down.
  const raw = await c.env.KV.get("gateway:status");
  if (!raw) return c.json(null);
  const status = JSON.parse(raw) as { presence?: Record<string, PresenceStatsDto> | null };
  return c.json(status.presence?.[c.req.param("guildId")] ?? null);
});

interface RESTScheduledEvent {
  id: string;
  name: string;
  description: string | null;
  scheduled_start_time: string;
  scheduled_end_time: string | null;
  channel_id: string | null;
  entity_metadata: { location?: string } | null;
  user_count?: number;
}

statsRouter.get("/guilds/:guildId/stats/events", async (c) => {
  const guildId = c.req.param("guildId");
  const cacheKey = `events:${guildId}`;
  const cached = await c.env.KV.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached) as ScheduledEventDto[]);
  try {
    const events = await discordJson<RESTScheduledEvent[]>(
      c.env,
      "GET",
      `/guilds/${guildId}/scheduled-events?with_user_count=true`,
    );
    const body: ScheduledEventDto[] = events
      .map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        scheduledStartTime: e.scheduled_start_time,
        scheduledEndTime: e.scheduled_end_time,
        channelId: e.channel_id,
        location: e.entity_metadata?.location ?? null,
        interestedCount: e.user_count ?? null,
      }))
      .sort((a, b) => a.scheduledStartTime.localeCompare(b.scheduledStartTime));
    await c.env.KV.put(cacheKey, JSON.stringify(body), { expirationTtl: 300 });
    return c.json(body);
  } catch (err) {
    if (await handleGuildAccessLoss(c.env, guildId, err)) return c.json({ error: "bot_not_installed" }, 404);
    return c.json({ error: "discord_error" }, 502);
  }
});
