import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { createSession } from "../src/auth/session.js";
import {
  addClientMessage,
  buildTicketDetail,
  closeClientTicket,
  createTicket,
  resolveUserPlan,
} from "../src/api/support.js";
import {
  getTicketForUser,
  insertEntitlement,
  insertSupportMessage,
  listSupportQueue,
  listUserTickets,
  updateTicketStatusForUser,
} from "../src/db/queries.js";

// D1/KV roll back between tests. No fetchMock: support only touches D1 and the
// session (no Discord). Services take an explicit plan → flag-independent tests.

const USER = "850000000000000001";
const OTHER = "850000000000000002";
const FUTURE = "2999-01-01T00:00:00.000Z";

async function detail(id: number, plan: "free" | "premium" | "business") {
  return buildTicketDetail(env.DB, (await getTicketForUser(env.DB, id, USER))!, plan);
}

describe("M11 support — priority (backend truth, frozen)", () => {
  it("derives priority from the effective plan at open", async () => {
    const id = await createTicket(env.DB, USER, "business", { subject: "Aide", body: "Bonjour" });
    const d = await detail(id, "business");
    expect(d.priority).toBe("high");
    expect(d.planAtOpen).toBe("business");
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]!.author).toBe("user");
  });

  it("keeps the opening priority when the plan is lost (flagged, not deprioritized)", async () => {
    const id = await createTicket(env.DB, USER, "business", { subject: "S", body: "B" });
    const d = await detail(id, "free"); // user is now Gratuit
    expect(d.priority).toBe("high"); // frozen
    expect(d.planChangedSinceOpen).toBe(true);
  });
});

describe("M11 support — isolation & internal notes", () => {
  it("never returns internal notes to the client", async () => {
    const id = await createTicket(env.DB, USER, "premium", { subject: "S", body: "public reply" });
    await insertSupportMessage(env.DB, { ticketId: id, author: "operator:999", body: "SECRET internal note", internal: true });
    await insertSupportMessage(env.DB, { ticketId: id, author: "operator:999", body: "public answer", internal: false });
    const d = await detail(id, "premium");
    expect(d.messages).toHaveLength(2); // first user + public answer
    expect(JSON.stringify(d)).not.toContain("SECRET internal note");
    // operator id is masked to the coarse role.
    expect(d.messages.some((m) => m.author === "operator")).toBe(true);
    expect(JSON.stringify(d)).not.toContain("operator:999");
  });

  it("scopes every read/mutation to the owner (404 for others)", async () => {
    const id = await createTicket(env.DB, USER, "premium", { subject: "S", body: "B" });
    expect(await getTicketForUser(env.DB, id, OTHER)).toBeNull();
    expect(await addClientMessage(env.DB, OTHER, id, "hi")).toMatchObject({ ok: false, code: "not_found" });
    expect(await closeClientTicket(env.DB, OTHER, id)).toMatchObject({ ok: false, code: "not_found" });
    // The owner still sees only their ticket.
    const { rows } = await listUserTickets(env.DB, OTHER, 1, 20);
    expect(rows).toHaveLength(0);
  });
});

describe("M11 support — transitions", () => {
  it("appends replies; rejects a closed ticket; reopens a resolved one", async () => {
    const id = await createTicket(env.DB, USER, "free", { subject: "S", body: "B" });
    expect(await addClientMessage(env.DB, USER, id, "more info")).toEqual({ ok: true });

    await updateTicketStatusForUser(env.DB, id, USER, "resolved");
    expect(await addClientMessage(env.DB, USER, id, "still broken")).toEqual({ ok: true });
    expect((await getTicketForUser(env.DB, id, USER))!.status).toBe("open"); // reopened

    expect(await closeClientTicket(env.DB, USER, id)).toEqual({ ok: true });
    expect((await getTicketForUser(env.DB, id, USER))!.status).toBe("closed");
    expect(await addClientMessage(env.DB, USER, id, "hello?")).toMatchObject({ ok: false, code: "ticket_closed" });
  });
});

describe("M11 support — priority queue (Studio M12 consumes it)", () => {
  it("orders by priority desc then oldest first", async () => {
    const low1 = await createTicket(env.DB, USER, "free", { subject: "low1", body: "b" });
    const low2 = await createTicket(env.DB, OTHER, "free", { subject: "low2", body: "b" });
    const high = await createTicket(env.DB, OTHER, "business", { subject: "high", body: "b" });
    const { rows } = await listSupportQueue(env.DB, 1, 20);
    expect(rows.map((r) => r.id)).toEqual([high, low1, low2]); // high first; equal priority → oldest first
  });
});

describe("M11 support — effective plan resolution", () => {
  it("respects platform.entitlements (off → free, on → resolved)", async () => {
    await insertEntitlement(env.DB, { userId: USER, planId: "business", source: "granted", startAt: "2020-01-01T00:00:00.000Z", endAt: FUTURE });
    expect(await resolveUserPlan(env.DB, {} as Env, USER)).toBe("free"); // flag off
    expect(await resolveUserPlan(env.DB, { PLATFORM_ENTITLEMENTS: "true" } as Env, USER)).toBe("business");
  });
});

describe("M11 support — HTTP surface", () => {
  async function session(): Promise<string> {
    return createSession(env, {
      userId: USER, username: "support-user", globalName: null, avatar: null,
      accessToken: "tok", refreshToken: "unused", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
    });
  }

  it("requires a session", async () => {
    expect((await app.request("/api/support/tickets", { method: "GET" }, env, createExecutionContext())).status).toBe(401);
  });

  it("is disabled with the flag off (default)", async () => {
    const sid = await session();
    const res = await app.request("/api/support/tickets", { method: "GET", headers: { cookie: `session=${sid}` } }, env, createExecutionContext());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("feature_disabled");
  });
});
