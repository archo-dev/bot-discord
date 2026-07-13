import { Hono } from "hono";
import { PANEL_CAPABILITIES, type AdminAuditOutcome, type AdminAuditPage, type PanelCapability } from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import { listAdminAudit } from "../db/queries.js";

export const auditRouter = new Hono<AppContext>();

const OUTCOMES = new Set<AdminAuditOutcome>(["success", "error"]);
const CAPABILITIES = new Set<string>(PANEL_CAPABILITIES);

auditRouter.get("/guilds/:guildId/audit", async (c) => {
  if (c.get("guildAccess") === "panel_moderator") return c.json({ error: "forbidden" }, 403);

  const rawLimit = c.req.query("limit");
  const limit = rawLimit === undefined ? 25 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return c.json({ error: "invalid_limit" }, 400);

  const rawCursor = c.req.query("cursor");
  const cursor = rawCursor === undefined ? null : Number(rawCursor);
  if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1)) return c.json({ error: "invalid_cursor" }, 400);

  const rawCapability = c.req.query("capability");
  if (rawCapability !== undefined && !CAPABILITIES.has(rawCapability)) return c.json({ error: "invalid_capability" }, 400);
  const rawOutcome = c.req.query("outcome");
  if (rawOutcome !== undefined && !OUTCOMES.has(rawOutcome as AdminAuditOutcome)) return c.json({ error: "invalid_outcome" }, 400);

  const page = await listAdminAudit(c.env.DB, {
    guildId: c.req.param("guildId"),
    limit,
    cursor,
    capability: (rawCapability as PanelCapability | undefined) ?? null,
    outcome: (rawOutcome as AdminAuditOutcome | undefined) ?? null,
  });
  const body: AdminAuditPage = { ...page, retentionDays: 90 };
  return c.json(body);
});
