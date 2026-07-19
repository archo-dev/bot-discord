/** API interne — musique : snapshot d'état (KV) + playlists sauvegardées. */

import { Hono } from "hono";
import { z } from "zod";
import { MusicStateSchema } from "@bot/shared";
import type { Env } from "../env.js";
import { getPlaylist, upsertPlaylist } from "../db/queries.js";
import { requireInternalModule } from "./module-guard.js";

export const internalMusicRouter = new Hono<{ Bindings: Env }>();
internalMusicRouter.use("/internal/guilds/:guildId/music-state", requireInternalModule("music"));
internalMusicRouter.use("/internal/guilds/:guildId/playlists", requireInternalModule("music"));

function cachedMusicSequence(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed = MusicStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.sequence : null;
  } catch {
    return null;
  }
}

// Music playback snapshot from the gateway → KV (short TTL) for the panel.
internalMusicRouter.post("/internal/guilds/:guildId/music-state", async (c) => {
  const parsed = MusicStateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const key = `music:${c.req.param("guildId")}`;
  const cached = await c.env.KV.get(key);
  const currentSequence = cachedMusicSequence(cached);
  if (currentSequence !== null && currentSequence >= parsed.data.sequence) {
    return c.json({ ok: true, ignored: "stale_sequence" });
  }
  // 60 s = KV minimum TTL; the gateway refreshes every 15 s while playing, so a
  // stale key clears within a minute of the gateway going silent.
  await c.env.KV.put(key, JSON.stringify(parsed.data), { expirationTtl: 60 });
  return c.json({ ok: true });
});

const playlistSaveSchema = z.object({
  ownerId: z.string().regex(/^\d{5,20}$/),
  name: z.string().min(1).max(60),
  tracks: z
    .array(
      z.object({
        title: z.string().max(300),
        url: z.string().max(500),
        duration: z.number(),
        thumbnail: z.string().nullable(),
        requestedBy: z.string().nullable(),
      }),
    )
    .max(200),
});

internalMusicRouter.post("/internal/guilds/:guildId/playlists", async (c) => {
  const parsed = playlistSaveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await upsertPlaylist(c.env.DB, c.req.param("guildId"), parsed.data.ownerId, parsed.data.name, JSON.stringify(parsed.data.tracks));
  return c.json({ ok: true }, 201);
});

internalMusicRouter.get("/internal/guilds/:guildId/playlists/:name", async (c) => {
  const row = await getPlaylist(c.env.DB, c.req.param("guildId"), c.req.param("name"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ tracks: JSON.parse(row.tracks) as unknown });
});
