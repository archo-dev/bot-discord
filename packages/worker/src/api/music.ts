import { Hono } from "hono";
import {
  EMPTY_MUSIC_STATE,
  MusicControlRequestSchema,
  MusicStateSchema,
  type MusicCommandPayload,
  type MusicStateDto,
  type PlaylistSummaryDto,
} from "@bot/shared";
import { isGuildModuleEnabled, listPlaylists } from "../db/queries.js";
import { forwardMusic } from "../gateway/forward.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const musicRouter = new Hono<AppContext>();

function cachedMusicState(raw: string | null): MusicStateDto | null {
  if (!raw) return null;
  try {
    const parsed = MusicStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

musicRouter.get("/guilds/:guildId/music-state", async (c) => {
  const cached = await c.env.KV.get(`music:${c.req.param("guildId")}`);
  const state = cachedMusicState(cached) ?? EMPTY_MUSIC_STATE;
  c.header("cache-control", "no-store");
  return c.json(state);
});

musicRouter.post("/guilds/:guildId/music-control", rateLimit({ name: "music-control", limit: 30 }), async (c) => {
  if (!(await isGuildModuleEnabled(c.env.DB, c.req.param("guildId"), "music"))) {
    return c.json({ error: "module_disabled" }, 409);
  }
  const parsed = MusicControlRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { action } = parsed.data;
  const command = action === "repeat" ? "loop" : action;
  const arg = action === "volume"
    ? String(parsed.data.value)
    : action === "repeat"
      ? parsed.data.mode
      : action === "remove"
        ? String(parsed.data.position)
        : action === "seek"
          ? String(parsed.data.position)
        : null;
  const payload: MusicCommandPayload = {
    command,
    guildId: c.req.param("guildId"),
    userId: c.get("session").userId,
    textChannelId: "",
    applicationId: null,
    token: null,
    arg,
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
