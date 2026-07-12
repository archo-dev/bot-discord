/** API interne — cycle de vie des guildes (guildCreate/guildDelete côté gateway). */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { setBotInstalled, upsertGuild } from "../db/queries.js";

export const internalGuildsRouter = new Hono<{ Bindings: Env }>();

const installedSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(64).nullable(),
});

/**
 * guildCreate : upsert immédiat pour que le panel affiche la guilde sans
 * attendre la première interaction slash (ensureGuild reste le filet de
 * sécurité pour les guildes déjà présentes avant ce mécanisme).
 */
internalGuildsRouter.post("/internal/guilds/:guildId/installed", async (c) => {
  const parsed = installedSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  await upsertGuild(c.env.DB, c.req.param("guildId"), parsed.data.name, parsed.data.icon);
  return c.json({ ok: true }, 201);
});

/**
 * guildDelete : le bot n'a plus accès. On marque la ligne (bot_installed=0)
 * sans supprimer les données — conservation par défaut (cf. roadmap M25).
 * Idempotent : un no-op si la guilde n'a jamais été enregistrée.
 */
internalGuildsRouter.post("/internal/guilds/:guildId/uninstalled", async (c) => {
  await setBotInstalled(c.env.DB, c.req.param("guildId"), false);
  return c.json({ ok: true }, 201);
});
