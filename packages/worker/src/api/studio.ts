import { Hono } from "hono";
import { z } from "zod";
import type {
  PlanId,
  StudioGuildsListResponse,
  StudioGuildSummary,
  StudioAuditPage,
  StudioOverview,
  StudioSessionInfo,
  StudioSubscriptionsListResponse,
  StudioSubscriptionSummary,
  StudioUpdatesListResponse,
  StudioUpdateStatus,
  StudioUpdateSummary,
} from "@bot/shared";
import {
  requireDeveloper,
  requireStudioHost,
  requireStudioSession,
  studioMutationOrigin,
  type StudioContext,
} from "../auth/studio-guard.js";
import {
  countActiveEntitlements,
  countGuildsForStudio,
  countOpenTicketsByPriority,
  createDraftReleaseNote,
  getPublishedReleaseNoteBySlug,
  listEntitlementsForStudio,
  listGuildsForStudio,
  listAuditEvents,
  listPublishedReleaseNotes,
  listReleaseNotesForStudio,
  publishReleaseNote,
  type StudioEntitlementRow,
  type StudioGuildRow,
  type StudioReleaseNoteRow,
} from "../db/queries.js";
import { registerGrantRoutes } from "./studio-grants.js";
import { registerObservabilityRoutes } from "./studio-observability.js";

/**
 * Isolated Studio API (M12+). Every route is host-gated (requireStudioHost) and
 * requires a studio session; mutations additionally require a granular
 * permission + a strict Origin check. Reads are minimized (no PII/secret).
 * Manual grants / lifetime / revocation (M13) are registered from studio-grants.
 */
export const studioApiRouter = new Hono<StudioContext>();

// Host isolation first: on the client host (or flag off) every /studio-api/* is 404.
studioApiRouter.use("/studio-api/*", requireStudioHost);
// Then a valid studio session (resolves the operator) on every route.
studioApiRouter.use("/studio-api/*", requireStudioSession);
studioApiRouter.use("/studio-api/*", studioMutationOrigin);

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

studioApiRouter.get("/studio-api/session", (c) => {
  const op = c.get("operator");
  const body: StudioSessionInfo = {
    operatorId: op.userId,
    displayName: op.displayName,
    isOwner: op.isOwner,
    permissions: op.permissions,
  };
  return c.json(body);
});

studioApiRouter.get("/studio-api/overview", async (c) => {
  const [guilds, activeEntitlements, openTickets, latest] = await Promise.all([
    countGuildsForStudio(c.env.DB),
    countActiveEntitlements(c.env.DB),
    countOpenTicketsByPriority(c.env.DB),
    listReleaseNotesForStudio(c.env.DB, 1, 1),
  ]);
  const published = latest.rows.find((r) => r.status === "published" && r.published_at);
  const body: StudioOverview = {
    guilds,
    activeEntitlements,
    openTickets,
    latestUpdate: published ? { slug: published.slug, title: published.title, publishedAt: published.published_at! } : null,
  };
  return c.json(body);
});

function toGuildSummary(row: StudioGuildRow): StudioGuildSummary {
  return { id: row.id, name: row.name, botInstalled: row.bot_installed === 1, createdAt: row.created_at };
}

studioApiRouter.get("/studio-api/guilds", requireDeveloper("guilds.inspect"), async (c) => {
  const parsed = pageSchema.safeParse({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { rows, total } = await listGuildsForStudio(c.env.DB, parsed.data.page, parsed.data.pageSize);
  const body: StudioGuildsListResponse = {
    items: rows.map(toGuildSummary),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
  return c.json(body);
});

function toSubscriptionSummary(row: StudioEntitlementRow): StudioSubscriptionSummary {
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id as PlanId,
    source: row.source,
    status: row.status,
    isLifetime: row.is_lifetime === 1,
    startAt: row.start_at,
    endAt: row.end_at,
  };
}

studioApiRouter.get("/studio-api/subscriptions", requireDeveloper("subscriptions.read"), async (c) => {
  const parsed = pageSchema.safeParse({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { rows, total } = await listEntitlementsForStudio(c.env.DB, parsed.data.page, parsed.data.pageSize);
  const body: StudioSubscriptionsListResponse = {
    items: rows.map(toSubscriptionSummary),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
  return c.json(body);
});

function toUpdateSummary(row: StudioReleaseNoteRow): StudioUpdateSummary {
  return {
    slug: row.slug,
    version: row.version,
    title: row.title,
    status: row.status as StudioUpdateStatus,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

studioApiRouter.get("/studio-api/updates", requireDeveloper("updates.publish"), async (c) => {
  const parsed = pageSchema.safeParse({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { rows, total } = await listReleaseNotesForStudio(c.env.DB, parsed.data.page, parsed.data.pageSize);
  const body: StudioUpdatesListResponse = {
    items: rows.map(toUpdateSummary),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
  return c.json(body);
});

const createSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
  title: z.string().trim().min(3).max(200),
  version: z.string().trim().max(40).optional(),
  summary: z.string().trim().max(2000).optional(),
});

studioApiRouter.post("/studio-api/updates", requireDeveloper("updates.publish"), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body", fields: parsed.error.flatten().fieldErrors }, 400);
  const created = await createDraftReleaseNote(c.env.DB, {
    ...parsed.data,
    author: c.get("operator").userId,
  });
  if (!created) return c.json({ error: "slug_conflict" }, 409);
  return c.json({ ok: true, slug: parsed.data.slug }, 201);
});

studioApiRouter.post("/studio-api/updates/:slug/publish", requireDeveloper("updates.publish"), async (c) => {
  const slug = c.req.param("slug");
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) return c.json({ error: "invalid_slug" }, 400);
  const ok = await publishReleaseNote(c.env.DB, slug, new Date().toISOString());
  if (!ok) return c.json({ error: "not_found" }, 404);
  const published = await getPublishedReleaseNoteBySlug(c.env.DB, slug, new Date().toISOString());
  return c.json({ ok: true, slug, published: published !== null });
});

// Immutable audit journal (M14). Read-only: audit_events is append-only — there
// is deliberately no write/update/delete route on this surface.
studioApiRouter.get("/studio-api/audit", requireDeveloper("audit.read"), async (c) => {
  const parsed = pageSchema.safeParse({ page: c.req.query("page"), pageSize: c.req.query("pageSize") });
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  const { rows, total } = await listAuditEvents(c.env.DB, {
    actor: c.req.query("actor") ?? null,
    action: c.req.query("action") ?? null,
    targetType: c.req.query("targetType") ?? null,
    targetId: c.req.query("targetId") ?? null,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
  const body: StudioAuditPage = {
    items: rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      metadata: r.metadata_json ? (JSON.parse(r.metadata_json) as Record<string, unknown>) : null,
      createdAt: r.created_at,
    })),
    total,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
  return c.json(body);
});

// Manual grants, lifetime & revocation (M13) — same host/session/Origin guards.
registerGrantRoutes(studioApiRouter);
// Observability dashboards + cohort rollout (M15) — same guards.
registerObservabilityRoutes(studioApiRouter);
