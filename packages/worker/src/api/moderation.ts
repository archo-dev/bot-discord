import { Hono } from "hono";
import type { ModActionDto, Paginated, WarningDto } from "@bot/shared";
import { listModActions, listWarnings, revokeWarning, insertModAction } from "../db/queries.js";
import type { AppContext } from "../auth/guard.js";
import { rateLimit } from "../ratelimit.js";

// Session + guild-access middlewares are applied once, centrally, in index.ts.
export const moderationRouter = new Hono<AppContext>();

moderationRouter.get("/guilds/:guildId/mod-actions", async (c) => {
  const guildId = c.req.param("guildId");
  const page = Math.max(Number(c.req.query("page") ?? "1") || 1, 1);
  const action = c.req.query("action") || undefined;
  const targetId = c.req.query("target") || undefined;

  const { rows, total } = await listModActions(c.env.DB, guildId, { page, pageSize: 25, action, targetId });
  const body: Paginated<ModActionDto> = {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetId: r.target_id,
      moderatorId: r.moderator_id,
      reason: r.reason,
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
      source: r.source,
      createdAt: r.created_at,
    })),
    total,
    page,
    pageSize: 25,
  };
  return c.json(body);
});

moderationRouter.get("/guilds/:guildId/warnings", async (c) => {
  const guildId = c.req.param("guildId");
  const userId = c.req.query("userId") || undefined;
  const rows = await listWarnings(c.env.DB, guildId, userId);
  const body: WarningDto[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    moderatorId: r.moderator_id,
    reason: r.reason,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    revokedBy: r.revoked_by,
  }));
  return c.json(body);
});

moderationRouter.delete("/guilds/:guildId/warnings/:warnId", rateLimit({ name: "warn-revoke", limit: 30 }), async (c) => {
  const guildId = c.req.param("guildId");
  const warnId = Number(c.req.param("warnId"));
  const session = c.get("session");
  const revoked = await revokeWarning(c.env.DB, guildId, warnId, session.userId);
  if (!revoked) return c.json({ error: "not_found_or_already_revoked" }, 404);
  await insertModAction(c.env.DB, {
    guildId,
    action: "unwarn",
    targetId: null,
    moderatorId: session.userId,
    reason: `Warn #${warnId} révoqué depuis le panel`,
    source: "panel",
  });
  return c.json({ ok: true });
});
