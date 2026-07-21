import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  resolveEffectiveEntitlement,
  supportPriorityForPlan,
  type PlanId,
  type SupportMessageAuthor,
  type SupportMessageView,
  type SupportTicketDetail,
  type SupportTicketsListResponse,
  type SupportTicketSummary,
} from "@bot/shared";
import type { AppContext } from "../auth/guard.js";
import type { Env } from "../env.js";
import { getWorkerFlags } from "../config/flags.js";
import {
  bumpTicketUpdatedAt,
  getTicketForUser,
  insertSupportMessage,
  insertSupportTicket,
  listClientMessages,
  listUserEntitlements,
  listUserTickets,
  rowToEntitlementInput,
  updateTicketStatusForUser,
  type SupportMessageRow,
  type SupportTicketRow,
} from "../db/queries.js";

/**
 * Client support (M11). User-level, session-scoped, behind platform.support.
 * Priority is DERIVED from the effective plan at open and frozen; the client
 * never supplies it. Internal notes and the operator assignee are never exposed.
 * Everything is scoped to session.userId (no cross-user/guild leak). No Studio.
 */
export const supportRouter = new Hono<AppContext>();

/** Effective plan of the user (respects platform.entitlements; default free). */
export async function resolveUserPlan(db: D1Database, env: Env, userId: string): Promise<PlanId> {
  if (!getWorkerFlags(env)["platform.entitlements"]) return "free";
  const effective = resolveEffectiveEntitlement(
    (await listUserEntitlements(db, userId)).map(rowToEntitlementInput),
    new Date(),
  );
  return effective.planId;
}

function toSummary(row: SupportTicketRow, currentPlan: PlanId): SupportTicketSummary {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status as SupportTicketSummary["status"],
    priority: row.priority as SupportTicketSummary["priority"],
    planAtOpen: row.plan_at_open as PlanId,
    guildId: row.guild_id,
    planChangedSinceOpen: currentPlan !== (row.plan_at_open as PlanId),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessageView(row: SupportMessageRow): SupportMessageView {
  const author: SupportMessageAuthor = row.author === "user" ? "user" : row.author.startsWith("operator") ? "operator" : "system";
  return { id: row.id, author, body: row.body, createdAt: row.created_at };
}

export async function buildTicketDetail(db: D1Database, row: SupportTicketRow, currentPlan: PlanId): Promise<SupportTicketDetail> {
  const messages = (await listClientMessages(db, row.id)).map(toMessageView);
  return { ...toSummary(row, currentPlan), messages };
}

export async function createTicket(
  db: D1Database,
  userId: string,
  plan: PlanId,
  input: { subject: string; body: string; guildId?: string | null },
): Promise<number> {
  const id = await insertSupportTicket(db, {
    userId,
    guildId: input.guildId ?? null,
    planAtOpen: plan,
    priority: supportPriorityForPlan(plan),
    subject: input.subject,
  });
  await insertSupportMessage(db, { ticketId: id, author: "user", body: input.body, internal: false });
  return id;
}

type MutationResult = { ok: true } | { ok: false; code: string; status: 404 | 409 };

/** Append a client reply. Reopens a resolved ticket; rejects a closed one. */
export async function addClientMessage(db: D1Database, userId: string, ticketId: number, body: string): Promise<MutationResult> {
  const ticket = await getTicketForUser(db, ticketId, userId);
  if (!ticket) return { ok: false, code: "not_found", status: 404 };
  if (ticket.status === "closed") return { ok: false, code: "ticket_closed", status: 409 };
  await insertSupportMessage(db, { ticketId, author: "user", body, internal: false });
  if (ticket.status === "resolved") await updateTicketStatusForUser(db, ticketId, userId, "open");
  else await bumpTicketUpdatedAt(db, ticketId);
  return { ok: true };
}

export async function closeClientTicket(db: D1Database, userId: string, ticketId: number): Promise<MutationResult> {
  const changed = await updateTicketStatusForUser(db, ticketId, userId, "closed");
  return changed ? { ok: true } : { ok: false, code: "not_found", status: 404 };
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const createSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(5000),
  guildId: z.string().regex(/^\d{5,20}$/).optional(),
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const idSchema = z.coerce.number().int().positive();

function guard(c: Context<AppContext>): boolean {
  return getWorkerFlags(c.env)["platform.support"];
}

supportRouter.get("/support/tickets", async (c) => {
  if (!guard(c)) return c.json({ error: "feature_disabled" }, 404);
  const parsed = listQuerySchema.safeParse({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const userId = c.get("session").userId;
  const plan = await resolveUserPlan(c.env.DB, c.env, userId);
  const { rows, total } = await listUserTickets(c.env.DB, userId, parsed.data.page, parsed.data.pageSize);
  const body: SupportTicketsListResponse = {
    items: rows.map((r) => toSummary(r, plan)),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
  return c.json(body);
});

supportRouter.post("/support/tickets", async (c) => {
  if (!guard(c)) return c.json({ error: "feature_disabled" }, 404);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", fields: parsed.error.flatten().fieldErrors }, 400);
  const userId = c.get("session").userId;
  const plan = await resolveUserPlan(c.env.DB, c.env, userId);
  const id = await createTicket(c.env.DB, userId, plan, parsed.data);
  const ticket = await getTicketForUser(c.env.DB, id, userId);
  return c.json(await buildTicketDetail(c.env.DB, ticket!, plan), 201);
});

supportRouter.get("/support/tickets/:id", async (c) => {
  if (!guard(c)) return c.json({ error: "feature_disabled" }, 404);
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "invalid_id" }, 400);
  const userId = c.get("session").userId;
  const ticket = await getTicketForUser(c.env.DB, id.data, userId);
  if (!ticket) return c.json({ error: "not_found" }, 404);
  const plan = await resolveUserPlan(c.env.DB, c.env, userId);
  return c.json(await buildTicketDetail(c.env.DB, ticket, plan));
});

supportRouter.post("/support/tickets/:id/messages", async (c) => {
  if (!guard(c)) return c.json({ error: "feature_disabled" }, 404);
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "invalid_id" }, 400);
  const parsed = messageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const userId = c.get("session").userId;
  const res = await addClientMessage(c.env.DB, userId, id.data, parsed.data.body);
  if (!res.ok) return c.json({ error: res.code }, res.status);
  const ticket = await getTicketForUser(c.env.DB, id.data, userId);
  const plan = await resolveUserPlan(c.env.DB, c.env, userId);
  return c.json(await buildTicketDetail(c.env.DB, ticket!, plan));
});

supportRouter.patch("/support/tickets/:id", async (c) => {
  if (!guard(c)) return c.json({ error: "feature_disabled" }, 404);
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "invalid_id" }, 400);
  const parsed = z.object({ status: z.literal("closed") }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const userId = c.get("session").userId;
  const res = await closeClientTicket(c.env.DB, userId, id.data);
  if (!res.ok) return c.json({ error: res.code }, res.status);
  const ticket = await getTicketForUser(c.env.DB, id.data, userId);
  const plan = await resolveUserPlan(c.env.DB, c.env, userId);
  return c.json(await buildTicketDetail(c.env.DB, ticket!, plan));
});
