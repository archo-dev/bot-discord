import { Hono } from "hono";
import { z } from "zod";
import { EMPTY_MUSIC_STATE, type MusicCommandPayload, type MusicStateDto, type PlaylistSummaryDto } from "@bot/shared";
import { listPlaylists } from "../db/queries.js";
import { forwardMusic } from "../gateway/forward.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const musicRouter = new Hono<AppContext>();

musicRouter.get("/guilds/:guildId/music-state", async (c) => {
  const cached = await c.env.KV.get(`music:${c.req.param("guildId")}`);
  const state: MusicStateDto = cached ? (JSON.parse(cached) as MusicStateDto) : EMPTY_MUSIC_STATE;
  return c.json(state);
});

const controlSchema = z.object({ action: z.enum(["pause", "resume", "skip", "stop"]) });

musicRouter.post("/guilds/:guildId/music-control", rateLimit({ name: "music-control", limit: 30 }), async (c) => {
  const parsed = controlSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const payload: MusicCommandPayload = {
    command: parsed.data.action,
    guildId: c.req.param("guildId"),
    userId: c.get("session").userId,
    textChannelId: "",
    applicationId: null,
    token: null,
    arg: null,
    source: "panel",
  };
  const result = await forwardMusic(c.env, payload);
  if (!result.reachable) return c.json({ error: "gateway_unreachable" }, 503);
  return c.json({ ok: result.ok, message: result.message });
});

musicRouter.get("/guilds/:guildId/playlists", async (c) => {
  const rows = await listPlaylists(c.env.DB, c.req.param("guildId"));
  const body: PlaylistSummaryDto[] = rows.map((r) => ({
    name: r.name,
    ownerId: r.owner_id,
    trackCount: (JSON.parse(r.tracks) as unknown[]).length,
    createdAt: r.created_at,
  }));
  return c.json(body);
});
