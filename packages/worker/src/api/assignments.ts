import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  canManageGuild,
  PLANS,
  pickBestEntitlementIndex,
  resolveEffectiveEntitlement,
  resolveSlotAssignments,
  SLOT_REASSIGN_COOLDOWN_HOURS,
  type GuildPlan,
  type SlotAssignment,
  type SubscriptionAssignmentsResponse,
} from "@bot/shared";
import { type AppContext, getUserGuilds } from "../auth/guard.js";
import { getWorkerFlags } from "../config/flags.js";
import {
  getGuild,
  getGuildEntitlementRow,
  getGuildLastReleasedAt,
  getGuildLiveAssignment,
  insertAssignment,
  listUserAssignments,
  listUserEntitlements,
  releaseGuildAssignment,
  rowToEntitlementInput,
} from "../db/queries.js";

/**
 * Server-slot assignments (M7). User-level, session-scoped: a user attaches
 * guilds they administer to their effective entitlement, within its slots.
 * Everything is behind platform.entitlements (off → all Gratuit, no slots).
 * Over-capacity suspension is derived on the fly (never trusts the client, never
 * writes on reads). No billing.
 */
export const assignmentsRouter = new Hono<AppContext>();

const FREE_PLAN: GuildPlan = { id: "free", rank: PLANS.free.rank, slots: PLANS.free.slots };

function sqlTimeToMs(value: string): number {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

function toIso(value: string): string {
  const ms = sqlTimeToMs(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

interface UserSlotState {
  planId: "free" | "premium" | "business";
  /** Assignable slots of the effective plan (0 when no active entitlement). */
  capacity: number;
  /** guildId → derived state (active within capacity, else suspended). */
  assignments: SlotAssignment[];
  /** Best active entitlement row id, or null. */
  bestEntitlementId: number | null;
}

/** Resolve, in memory (no writes), the user's effective plan + reconciled slots. */
async function resolveUserSlots(db: D1Database, userId: string, now: Date): Promise<UserSlotState> {
  const entRows = await listUserEntitlements(db, userId);
  const inputs = entRows.map(rowToEntitlementInput);
  const effective = resolveEffectiveEntitlement(inputs, now);
  const bestIdx = pickBestEntitlementIndex(inputs, now);
  const capacity = effective.source === null ? 0 : effective.slots;

  const rows = await listUserAssignments(db, userId); // non-released, recent-first
  const resolved = resolveSlotAssignments(
    rows.map((r) => ({ guildId: r.guild_id, recencyAt: r.last_reassigned_at ?? r.assigned_at })),
    capacity,
  );
  const activeSet = new Set(resolved.active);
  const assignments: SlotAssignment[] = rows.map((r) => ({
    guildId: r.guild_id,
    state: activeSet.has(r.guild_id) ? "active" : "suspended",
    assignedAt: toIso(r.assigned_at),
  }));
  return {
    planId: effective.planId,
    capacity,
    assignments,
    bestEntitlementId: bestIdx === -1 ? null : entRows[bestIdx]!.id,
  };
}

export async function buildAssignmentsResponse(
  db: D1Database,
  userId: string,
  entitlementsEnabled: boolean,
): Promise<SubscriptionAssignmentsResponse> {
  if (!entitlementsEnabled) {
    return { planId: "free", slots: 0, used: 0, available: 0, assignments: [], entitlementsEnabled: false };
  }
  const state = await resolveUserSlots(db, userId, new Date());
  const used = state.assignments.filter((a) => a.state === "active").length;
  return {
    planId: state.planId,
    slots: state.capacity,
    used,
    available: Math.max(0, state.capacity - used),
    assignments: state.assignments,
    entitlementsEnabled: true,
  };
}

/** Effective plan of a single guild (gateway config). Derived, read-only. */
export async function resolveGuildPlan(
  db: D1Database,
  guildId: string,
  now: Date,
  entitlementsEnabled: boolean,
): Promise<GuildPlan> {
  if (!entitlementsEnabled) return FREE_PLAN;
  const entRow = await getGuildEntitlementRow(db, guildId);
  if (!entRow) return FREE_PLAN;
  const state = await resolveUserSlots(db, entRow.user_id, now);
  const active = state.assignments.find((a) => a.guildId === guildId && a.state === "active");
  if (!active) return FREE_PLAN;
  const plan = PLANS[state.planId];
  return { id: plan.id, rank: plan.rank, slots: plan.slots };
}

export type AssignResult = { ok: true } | { ok: false; code: string; status: 404 | 409 };

/** Attach a guild to the user's effective entitlement (slot/cooldown checks).
 *  Discord permission (manage_guild) is enforced at the HTTP layer, not here. */
export async function assignGuild(db: D1Database, userId: string, guildId: string, now: Date): Promise<AssignResult> {
  const state = await resolveUserSlots(db, userId, now);
  if (state.bestEntitlementId === null || state.capacity === 0) {
    return { ok: false, code: "no_active_entitlement", status: 409 };
  }
  if (await getGuildLiveAssignment(db, guildId)) {
    return { ok: false, code: "guild_already_assigned", status: 409 };
  }
  const lastReleased = await getGuildLastReleasedAt(db, guildId);
  if (lastReleased) {
    const elapsedMs = now.getTime() - sqlTimeToMs(lastReleased);
    if (elapsedMs < SLOT_REASSIGN_COOLDOWN_HOURS * 3_600_000) {
      return { ok: false, code: "reassign_cooldown", status: 409 };
    }
  }
  const liveCount = state.assignments.length; // all non-released rows occupy toward capacity
  if (liveCount >= state.capacity) return { ok: false, code: "no_slot_available", status: 409 };

  await insertAssignment(db, state.bestEntitlementId, guildId, userId, now.toISOString());
  return { ok: true };
}

export async function releaseGuild(db: D1Database, userId: string, guildId: string, now: Date): Promise<AssignResult> {
  const entRow = await getGuildEntitlementRow(db, guildId);
  if (!entRow || entRow.user_id !== userId) return { ok: false, code: "not_assigned", status: 404 };
  await releaseGuildAssignment(db, guildId, now.toISOString());
  return { ok: true };
}

const bodySchema = z.object({ guildId: z.string().regex(/^\d{5,20}$/) });

/** Re-verify the user really controls the target guild (owner/MANAGE_GUILD),
 *  never a panel grant. Returns an error Response, or null when allowed. */
async function requireManageGuild(c: Context<AppContext>, guildId: string): Promise<Response | null> {
  const guild = await getGuild(c.env.DB, guildId);
  if (!guild || guild.bot_installed !== 1) return c.json({ error: "bot_not_installed" }, 404);
  const result = await getUserGuilds(c.env, c.get("session"), { allowRecent: false });
  if (result.status === "unauthorized") return c.json({ error: "session_expired" }, 401);
  if (result.status === "rate_limited") {
    c.header("Retry-After", String(result.retryAfterSeconds));
    return c.json({ error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds }, 429);
  }
  if (result.status === "unavailable") return c.json({ error: "discord_unavailable" }, 503);
  const g = result.guilds.find((x) => x.id === guildId);
  if (!g || !(g.owner || canManageGuild(g.permissions))) return c.json({ error: "forbidden" }, 403);
  return null;
}

assignmentsRouter.get("/subscription/assignments", async (c) => {
  const enabled = getWorkerFlags(c.env)["platform.entitlements"];
  return c.json(await buildAssignmentsResponse(c.env.DB, c.get("session").userId, enabled));
});

assignmentsRouter.post("/subscription/assignment", async (c) => {
  if (!getWorkerFlags(c.env)["platform.entitlements"]) return c.json({ error: "feature_disabled" }, 404);
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const denied = await requireManageGuild(c, parsed.data.guildId);
  if (denied) return denied;
  const res = await assignGuild(c.env.DB, c.get("session").userId, parsed.data.guildId, new Date());
  if (!res.ok) return c.json({ error: res.code }, res.status);
  return c.json(await buildAssignmentsResponse(c.env.DB, c.get("session").userId, true));
});

assignmentsRouter.delete("/subscription/assignment", async (c) => {
  if (!getWorkerFlags(c.env)["platform.entitlements"]) return c.json({ error: "feature_disabled" }, 404);
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const denied = await requireManageGuild(c, parsed.data.guildId);
  if (denied) return denied;
  const res = await releaseGuild(c.env.DB, c.get("session").userId, parsed.data.guildId, new Date());
  if (!res.ok) return c.json({ error: res.code }, res.status);
  return c.json(await buildAssignmentsResponse(c.env.DB, c.get("session").userId, true));
});
