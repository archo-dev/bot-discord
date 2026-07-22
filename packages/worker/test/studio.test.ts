import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import app from "../src/index.js";
import type { Env } from "../src/env.js";
import { createSession } from "../src/auth/session.js";
import { createStudioSession } from "../src/auth/studio-session.js";
import {
  createDraftReleaseNote,
  grantStudioOperatorPermission,
  insertEntitlement,
  insertSupportTicket,
  insertStudioOperator,
  publishReleaseNote,
  upsertGuild,
} from "../src/db/queries.js";

// D1/KV roll back between tests; no fetchMock (studio auth uses the studio_session
// cookie + D1 only, no Discord in these paths). Every test is self-sufficient.

const HOST = "studio.archodev.fr";
const OWNER = "700000000000000001";
const OPERATOR = "700000000000000002";
const OUTSIDER = "700000000000000003";

/** Studio enabled: flag on + STUDIO_HOST + a bootstrap owner. */
function studioEnv(extra: Partial<Env> = {}): Env {
  return { ...env, PLATFORM_STUDIO: "true", STUDIO_HOST: HOST, STUDIO_OWNER_IDS: OWNER, ...extra } as Env;
}

async function studioCookie(e: Env, userId: string): Promise<string> {
  const id = await createStudioSession(e, {
    userId,
    username: "op",
    globalName: null,
    avatar: null,
    tokenExpiresAt: Date.now() + 3_600_000,
    createdAt: Date.now(),
  });
  return `studio_session=${id}`;
}

function req(url: string, cookie: string | null, e: Env, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return app.request(url, { ...init, headers }, e, createExecutionContext());
}

describe("M12 studio — host isolation (zéro endpoint côté client)", () => {
  it("404s on the client host even with a valid studio session", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://archodev.fr/studio-api/overview`, cookie, e);
    expect(res.status).toBe(404);
    expect((await req(`https://archodev.fr/studio-api/users`, cookie, e)).status).toBe(404);
    expect((await req(`https://archodev.fr/studio-api/support`, cookie, e)).status).toBe(404);
  });

  it("keeps returning 404 on the client host before body-size checks", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const oversized = "x".repeat(65 * 1024);
    const res = await req(`https://archodev.fr/studio-api/updates`, cookie, e, {
      method: "POST",
      headers: { origin: "https://archodev.fr", "content-type": "application/json" },
      body: oversized,
    });
    expect(res.status).toBe(404);
    const studio = await req(`https://${HOST}/studio-api/updates`, cookie, e, {
      method: "POST",
      headers: { origin: `https://${HOST}`, "content-type": "application/json" },
      body: oversized,
    });
    expect(studio.status).toBe(413);
  });

  it("404s on the studio host when the flag is off", async () => {
    // Base env has no PLATFORM_STUDIO/STUDIO_HOST → studio disabled.
    const res = await req(`https://${HOST}/studio-api/overview`, null, env as Env);
    expect(res.status).toBe(404);
  });

  it("401s on the studio host with the flag on but no session", async () => {
    const res = await req(`https://${HOST}/studio-api/overview`, null, studioEnv());
    expect(res.status).toBe(401);
  });
});

describe("Studio operations — users and support", () => {
  it("lists minimized known users and the priority-ordered support queue", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const userId = "750000000000000001";
    await insertEntitlement(env.DB, {
      userId,
      planId: "premium",
      source: "granted",
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2999-01-01T00:00:00.000Z",
    });
    await insertSupportTicket(env.DB, {
      userId,
      guildId: "950000000000000001",
      planAtOpen: "premium",
      priority: "normal",
      subject: "Besoin d'aide",
    });

    const users = await req(`https://${HOST}/studio-api/users`, cookie, e);
    expect(users.status).toBe(200);
    expect((await users.json() as { items: Array<Record<string, unknown>> }).items).toContainEqual(expect.objectContaining({
      userId,
      activeEntitlements: 1,
      supportTickets: 1,
    }));

    const support = await req(`https://${HOST}/studio-api/support`, cookie, e);
    expect(support.status).toBe(200);
    expect((await support.json() as { items: Array<Record<string, unknown>> }).items).toContainEqual(expect.objectContaining({
      userId,
      priority: "normal",
      subject: "Besoin d'aide",
    }));
  });

  it("enforces the users and support permissions independently", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR, displayName: "Inspector" });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "guilds.inspect");
    const inspector = await studioCookie(e, OPERATOR);
    expect((await req(`https://${HOST}/studio-api/users`, inspector, e)).status).toBe(200);
    expect((await req(`https://${HOST}/studio-api/support`, inspector, e)).status).toBe(403);

    const supportOperator = "700000000000000004";
    await insertStudioOperator(env.DB, { userId: supportOperator, displayName: "Support" });
    await grantStudioOperatorPermission(env.DB, supportOperator, "support.manage");
    const supportCookie = await studioCookie(e, supportOperator);
    expect((await req(`https://${HOST}/studio-api/support`, supportCookie, e)).status).toBe(200);
    expect((await req(`https://${HOST}/studio-api/users`, supportCookie, e)).status).toBe(403);
  });
});

describe("M12 studio — dev-auth server-side", () => {
  it("rejects a studio session whose user is not an operator (403)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OUTSIDER);
    const res = await req(`https://${HOST}/studio-api/overview`, cookie, e);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_an_operator");
  });

  it("ignores the CLIENT session cookie — it never opens the Studio (401)", async () => {
    const e = studioEnv();
    // A fully valid CLIENT session for the owner id, presented as `session=`.
    const sid = await createSession(e, {
      userId: OWNER, username: "op", globalName: null, avatar: null,
      accessToken: "t", tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
    });
    const res = await req(`https://${HOST}/studio-api/overview`, `session=${sid}`, e);
    expect(res.status).toBe(401);
  });

  it("ignores the STUDIO cookie on the client API", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const res = await req(`https://archodev.fr/api/me`, cookie, e);
    expect(res.status).toBe(401);
  });
});

describe("M12 studio — owner bootstrap", () => {
  it("grants an owner (STUDIO_OWNER_IDS) full access without a DB row", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    const session = await req(`https://${HOST}/studio-api/session`, cookie, e);
    expect(session.status).toBe(200);
    const info = (await session.json()) as { isOwner: boolean; permissions: string[] };
    expect(info.isOwner).toBe(true);
    expect(info.permissions).toContain("updates.publish");

    expect((await req(`https://${HOST}/studio-api/overview`, cookie, e)).status).toBe(200);
    expect((await req(`https://${HOST}/studio-api/guilds`, cookie, e)).status).toBe(200);
    expect((await req(`https://${HOST}/studio-api/subscriptions`, cookie, e)).status).toBe(200);
  });
});

describe("M12 studio — granular permissions (server-enforced)", () => {
  it("allows the granted permission and forbids the others (403)", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR, displayName: "Guild inspector" });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "guilds.inspect");
    const cookie = await studioCookie(e, OPERATOR);

    expect((await req(`https://${HOST}/studio-api/guilds`, cookie, e)).status).toBe(200);
    expect((await req(`https://${HOST}/studio-api/subscriptions`, cookie, e)).status).toBe(403);
    // publish (mutation) also forbidden without updates.publish.
    const pub = await req(`https://${HOST}/studio-api/updates/x/publish`, cookie, e, {
      method: "POST",
      headers: { origin: `https://${HOST}` },
    });
    expect(pub.status).toBe(403);
  });

  it("treats a disabled operator as ineligible (403)", async () => {
    const e = studioEnv();
    await insertStudioOperator(env.DB, { userId: OPERATOR, status: "disabled" });
    await grantStudioOperatorPermission(env.DB, OPERATOR, "guilds.inspect");
    const cookie = await studioCookie(e, OPERATOR);
    expect((await req(`https://${HOST}/studio-api/overview`, cookie, e)).status).toBe(403);
  });
});

describe("M12 studio — updates publication (consumes M5 public read)", () => {
  it("publishes a draft so it becomes publicly visible; drafts stay hidden", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    await createDraftReleaseNote(env.DB, { slug: "m12-note", title: "Studio arrive" });

    // Draft is not public yet.
    expect((await req(`https://archodev.fr/api/updates/m12-note`, null, e)).status).toBe(404);

    // Publish via the studio (owner, correct Origin).
    const pub = await req(`https://${HOST}/studio-api/updates/m12-note/publish`, cookie, e, {
      method: "POST",
      headers: { origin: `https://${HOST}` },
    });
    expect(pub.status).toBe(200);

    // Now public.
    const publicRes = await req(`https://archodev.fr/api/updates/m12-note`, null, e);
    expect(publicRes.status).toBe(200);
  });

  it("rejects a mutation without the studio Origin (CSRF, 403)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    await createDraftReleaseNote(env.DB, { slug: "m12-note2", title: "T" });
    const res = await req(`https://${HOST}/studio-api/updates/m12-note2/publish`, cookie, e, { method: "POST" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("csrf_rejected");
  });
});

describe("M12 studio — overview KPIs", () => {
  it("reports counts (guilds, active entitlements, tickets by priority)", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    await upsertGuild(env.DB, "900000000000000001", "Test guild", null);
    const res = await req(`https://${HOST}/studio-api/overview`, cookie, e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guilds: number; openTickets: Record<string, number> };
    expect(body.guilds).toBeGreaterThanOrEqual(1);
    expect(body.openTickets).toMatchObject({ low: expect.any(Number), normal: expect.any(Number), high: expect.any(Number) });
  });

  it("reports the latest published update even when a newer draft exists", async () => {
    const e = studioEnv();
    const cookie = await studioCookie(e, OWNER);
    await createDraftReleaseNote(env.DB, { slug: "overview-published", title: "Published update" });
    await publishReleaseNote(env.DB, "overview-published", new Date().toISOString());
    await createDraftReleaseNote(env.DB, { slug: "overview-newer-draft", title: "Newer draft" });

    const res = await req(`https://${HOST}/studio-api/overview`, cookie, e);
    expect(res.status).toBe(200);
    expect((await res.json()) as { latestUpdate: { slug: string } | null }).toMatchObject({
      latestUpdate: { slug: "overview-published" },
    });
  });
});
