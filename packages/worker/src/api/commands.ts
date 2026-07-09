import { Hono } from "hono";
import { z } from "zod";
import {
  COMMAND_NAME_RE,
  safeParseCommandLogic,
  type CommandRevisionDto,
  type CustomCommandDto,
} from "@bot/shared";
import type { CustomCommandRow } from "../db/queries.js";
import {
  countCustomCommands,
  deleteCustomCommand,
  getCustomCommandById,
  insertCommandRevision,
  insertCustomCommand,
  listCommandRevisions,
  listCustomCommands,
  setCommandEnabled,
  setDiscordCommandId,
  updateCustomCommand,
} from "../db/queries.js";
import { deleteGuildCommand, registerGuildCommand, updateGuildCommand } from "../discord/commands.js";
import { DiscordAPIError } from "../discord/rest.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";

/** App-side cap, leaving headroom under Discord's 100 guild-command limit. */
const MAX_COMMANDS_PER_GUILD = 80;

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const commandsRouter = new Hono<AppContext>();

function rowToDto(row: CustomCommandRow): CustomCommandDto {
  const parsed = safeParseCommandLogic(row.logic);
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    triggerType: row.trigger_type,
    enabled: row.enabled === 1,
    logic: parsed.success ? parsed.data : (JSON.parse(row.logic) as CustomCommandDto["logic"]),
    cooldownSeconds: row.cooldown_seconds,
    cooldownScope: row.cooldown_scope,
    requiredPermissions: row.required_permissions,
    discordCommandId: row.discord_command_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    gatewayRequired: row.trigger_type === "keyword",
  };
}

const upsertSchema = z.object({
  name: z.string().regex(COMMAND_NAME_RE),
  description: z.string().min(1).max(100),
  logic: z.unknown(),
});

interface ValidatedBody {
  name: string;
  description: string;
  logic: NonNullable<ReturnType<typeof safeParseCommandLogic> & { success: true }>["data"];
  logicJson: string;
}

function validateBody(raw: unknown): { ok: true; body: ValidatedBody } | { ok: false; error: string } {
  const parsed = upsertSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_body" };
  const logicParsed = safeParseCommandLogic(parsed.data.logic);
  if (!logicParsed.success) return { ok: false, error: `invalid_logic: ${logicParsed.error}` };
  const logic = logicParsed.data;
  if (logic.trigger.name !== parsed.data.name) {
    return { ok: false, error: "invalid_logic: trigger.name must match the command name" };
  }
  return {
    ok: true,
    body: {
      name: parsed.data.name,
      description: parsed.data.description,
      logic,
      logicJson: JSON.stringify(logic),
    },
  };
}

function discordError(err: unknown): { error: string; status: 502 | 409 } {
  if (err instanceof DiscordAPIError) {
    // 400 with code 50035 covers duplicate names and validation issues.
    return { error: `discord_error: ${err.body.slice(0, 200)}`, status: err.status === 400 ? 409 : 502 };
  }
  return { error: "discord_error", status: 502 };
}

commandsRouter.get("/guilds/:guildId/commands", async (c) => {
  const rows = await listCustomCommands(c.env.DB, c.req.param("guildId"));
  return c.json(rows.map(rowToDto));
});

commandsRouter.post("/guilds/:guildId/commands", rateLimit({ name: "cmd-write", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const validated = validateBody(await c.req.json().catch(() => null));
  if (!validated.ok) return c.json({ error: validated.error }, 400);
  const { body } = validated;

  if ((await countCustomCommands(c.env.DB, guildId)) >= MAX_COMMANDS_PER_GUILD) {
    return c.json({ error: "too_many_commands", max: MAX_COMMANDS_PER_GUILD }, 409);
  }

  const session = c.get("session");
  let id: number;
  try {
    id = await insertCustomCommand(c.env.DB, {
      guildId,
      name: body.name,
      description: body.description,
      triggerType: body.logic.trigger.type,
      logic: body.logicJson,
      cooldownSeconds: body.logic.cooldown.seconds,
      cooldownScope: body.logic.cooldown.scope,
      requiredPermissions: body.logic.requiredPermissions,
      createdBy: session.userId,
    });
  } catch {
    return c.json({ error: "duplicate_name" }, 409);
  }

  await insertCommandRevision(c.env.DB, {
    commandId: id,
    guildId,
    changeType: "create",
    logic: body.logicJson,
    changedBy: session.userId,
  });

  // Register with Discord (slash triggers only) — surface failures to the panel.
  if (body.logic.trigger.type === "slash") {
    try {
      const discordId = await registerGuildCommand(c.env, guildId, body.name, body.description);
      await setDiscordCommandId(c.env.DB, guildId, id, discordId);
    } catch (err) {
      await deleteCustomCommand(c.env.DB, guildId, id);
      const e = discordError(err);
      return c.json({ error: e.error }, e.status);
    }
  }

  const row = await getCustomCommandById(c.env.DB, guildId, id);
  return c.json(rowToDto(row!), 201);
});

commandsRouter.get("/guilds/:guildId/commands/:id", async (c) => {
  const row = await getCustomCommandById(c.env.DB, c.req.param("guildId"), Number(c.req.param("id")));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(rowToDto(row));
});

commandsRouter.put("/guilds/:guildId/commands/:id", rateLimit({ name: "cmd-write", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const id = Number(c.req.param("id"));
  const existing = await getCustomCommandById(c.env.DB, guildId, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const validated = validateBody(await c.req.json().catch(() => null));
  if (!validated.ok) return c.json({ error: validated.error }, 400);
  const { body } = validated;

  // Sync Discord first so a failure doesn't leave D1 and Discord diverging.
  const wasSlash = existing.trigger_type === "slash" && existing.discord_command_id;
  const isSlash = body.logic.trigger.type === "slash";
  let discordId = existing.discord_command_id;
  try {
    if (wasSlash && isSlash) {
      await updateGuildCommand(c.env, guildId, existing.discord_command_id!, body.name, body.description);
    } else if (wasSlash && !isSlash) {
      await deleteGuildCommand(c.env, guildId, existing.discord_command_id!);
      discordId = null;
    } else if (!wasSlash && isSlash && existing.enabled === 1) {
      discordId = await registerGuildCommand(c.env, guildId, body.name, body.description);
    }
  } catch (err) {
    const e = discordError(err);
    return c.json({ error: e.error }, e.status);
  }

  await updateCustomCommand(c.env.DB, guildId, id, {
    name: body.name,
    description: body.description,
    triggerType: body.logic.trigger.type,
    logic: body.logicJson,
    cooldownSeconds: body.logic.cooldown.seconds,
    cooldownScope: body.logic.cooldown.scope,
    requiredPermissions: body.logic.requiredPermissions,
  });
  await setDiscordCommandId(c.env.DB, guildId, id, discordId);
  await insertCommandRevision(c.env.DB, {
    commandId: id,
    guildId,
    changeType: "update",
    logic: body.logicJson,
    changedBy: c.get("session").userId,
  });

  const row = await getCustomCommandById(c.env.DB, guildId, id);
  return c.json(rowToDto(row!));
});

commandsRouter.patch("/guilds/:guildId/commands/:id/state", rateLimit({ name: "cmd-write", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const id = Number(c.req.param("id"));
  const existing = await getCustomCommandById(c.env.DB, guildId, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const parsed = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const { enabled } = parsed.data;
  if ((existing.enabled === 1) === enabled) return c.json(rowToDto(existing));

  try {
    if (existing.trigger_type === "slash") {
      if (enabled) {
        const discordId = await registerGuildCommand(c.env, guildId, existing.name, existing.description);
        await setDiscordCommandId(c.env.DB, guildId, id, discordId);
      } else if (existing.discord_command_id) {
        await deleteGuildCommand(c.env, guildId, existing.discord_command_id);
        await setDiscordCommandId(c.env.DB, guildId, id, null);
      }
    }
  } catch (err) {
    const e = discordError(err);
    return c.json({ error: e.error }, e.status);
  }

  await setCommandEnabled(c.env.DB, guildId, id, enabled);
  await insertCommandRevision(c.env.DB, {
    commandId: id,
    guildId,
    changeType: enabled ? "enable" : "disable",
    logic: existing.logic,
    changedBy: c.get("session").userId,
  });

  const row = await getCustomCommandById(c.env.DB, guildId, id);
  return c.json(rowToDto(row!));
});

commandsRouter.delete("/guilds/:guildId/commands/:id", rateLimit({ name: "cmd-write", limit: 20 }), async (c) => {
  const guildId = c.req.param("guildId");
  const id = Number(c.req.param("id"));
  const existing = await getCustomCommandById(c.env.DB, guildId, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  if (existing.trigger_type === "slash" && existing.discord_command_id) {
    try {
      await deleteGuildCommand(c.env, guildId, existing.discord_command_id);
    } catch (err) {
      // A 404 means it's already gone on Discord's side — safe to proceed.
      if (!(err instanceof DiscordAPIError && err.status === 404)) {
        const e = discordError(err);
        return c.json({ error: e.error }, e.status);
      }
    }
  }

  await insertCommandRevision(c.env.DB, {
    commandId: id,
    guildId,
    changeType: "delete",
    logic: existing.logic,
    changedBy: c.get("session").userId,
  });
  await deleteCustomCommand(c.env.DB, guildId, id);
  return c.json({ ok: true });
});

commandsRouter.get("/guilds/:guildId/commands/:id/revisions", async (c) => {
  const rows = await listCommandRevisions(c.env.DB, c.req.param("guildId"), Number(c.req.param("id")));
  const dtos: CommandRevisionDto[] = rows.map((r) => ({
    id: r.id,
    commandId: r.command_id,
    changeType: r.change_type,
    logic: JSON.parse(r.logic) as CommandRevisionDto["logic"],
    changedBy: r.changed_by,
    changedAt: r.changed_at,
  }));
  return c.json(dtos);
});
