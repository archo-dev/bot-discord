import { beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import type {
  OnboardingPresetPreview,
  OnboardingPresetResult,
  OnboardingResponse,
} from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { replacePanelAccess, upsertGuild } from "../src/db/queries.js";

const GUILD = "942000000000000001";
const MANAGER = "842000000000000001";
const MODERATOR = "842000000000000002";

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId,
    username: "onboarding-user",
    globalName: null,
    avatar: null,
    accessToken: `onboarding-${userId}`,
    refreshToken: "unused",
    tokenExpiresAt: Date.now() + 3_600_000,
    createdAt: Date.now(),
  });
}

function call(path: string, sid: string, method = "GET", body?: unknown) {
  const ctx = createExecutionContext();
  const response = app.request(path, {
    method,
    headers: { cookie: `session=${sid}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, ctx);
  return { response, ctx };
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, GUILD, "Onboarding", null);
  await replacePanelAccess(env.DB, GUILD, [{ subjectType: "user", subjectId: MODERATOR, level: "moderator" }], MANAGER);
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me/guilds", method: "GET" }).reply((request) => {
    const authorization = String((request.headers as Record<string, string>)["authorization"] ?? "");
    return { statusCode: 200, data: [
      { id: GUILD, name: "Onboarding", icon: null, owner: false, permissions: authorization.includes(MANAGER) ? "32" : "0" },
    ] };
  }).persist();
});

describe("M06 onboarding API", () => {
  it("derives a checklist and a minimal, non-admin invite", async () => {
    const sid = await session(MANAGER);
    const response = await call(`/api/guilds/${GUILD}/onboarding`, sid).response;
    expect(response.status).toBe(200);
    const body = await response.json() as OnboardingResponse;

    expect(body.completedAt).toBeNull();
    expect(body.steps.find((step) => step.id === "log_channel")?.status).toBe("todo");
    expect(body.steps.some((step) => step.moduleId === "welcome")).toBe(true);
    expect(body.presets.map((preset) => preset.id)).toEqual(["community", "moderation", "support"]);

    // Invite: real oauth URL, targeted at the guild, and never requesting Administrator (bit 3).
    expect(body.invite.url).toContain("discord.com/oauth2/authorize");
    expect(body.invite.url).toContain("scope=bot");
    expect(body.invite.url).toContain(`guild_id=${GUILD}`);
    expect(BigInt(body.invite.permissions) & (1n << 3n)).toBe(0n);
  });

  it("previews a preset diff without writing", async () => {
    const sid = await session(MANAGER);
    const preview = await call(`/api/guilds/${GUILD}/onboarding/preset`, sid, "POST", { preset: "support", dryRun: true }).response;
    expect(preview.status).toBe(200);
    const body = await preview.json() as OnboardingPresetPreview;
    expect(body.preset).toBe("support");
    expect(body.entries.map((entry) => entry.moduleId).sort()).toEqual(["custom_commands", "tickets", "welcome"]);
    // custom_commands ships enabled by default → nothing was written by the dry run.
    expect(body.entries.find((entry) => entry.moduleId === "custom_commands")?.action).toBe("already_enabled");

    const after = await call(`/api/guilds/${GUILD}/onboarding`, sid).response;
    expect((await after.json() as OnboardingResponse).appliedPreset).toBeNull();
  });

  it("applies a preset transactionally, skips blocked modules and leaves others untouched", async () => {
    const sid = await session(MANAGER);
    // Warm up guild_modules (rows are created lazily on first read), then disable
    // custom_commands so the support preset has exactly one enable to perform.
    await call(`/api/guilds/${GUILD}/onboarding`, sid).response;
    await env.DB.prepare(
      `UPDATE guild_modules SET enabled = 0, authority = 'governance' WHERE guild_id = ?1 AND module_id = 'custom_commands'`,
    ).bind(GUILD).run();

    const applied = await call(`/api/guilds/${GUILD}/onboarding/preset`, sid, "POST", { preset: "support" }).response;
    expect(applied.status).toBe(200);
    const result = await applied.json() as OnboardingPresetResult;
    expect(result.enabled).toContain("custom_commands");
    // tickets/welcome are blocked while the gateway/permissions can't be verified → reported, not applied.
    expect(result.skipped.map((entry) => entry.moduleId).sort()).toEqual(["tickets", "welcome"]);

    // custom_commands enabled; a module outside the preset (starboard) is unchanged.
    const rows = await env.DB.prepare(
      `SELECT module_id, enabled FROM guild_modules WHERE guild_id = ?1 AND module_id IN ('custom_commands','starboard')`,
    ).bind(GUILD).all<{ module_id: string; enabled: number }>();
    const byId = Object.fromEntries(rows.results.map((row) => [row.module_id, row.enabled]));
    expect(byId.custom_commands).toBe(1);
    expect(byId.starboard).toBe(0);

    const after = await call(`/api/guilds/${GUILD}/onboarding`, sid).response;
    const body = await after.json() as OnboardingResponse;
    expect(body.appliedPreset).toBe("support");
    expect(body.completedAt).not.toBeNull();
  });

  it("blocks moderators from applying presets", async () => {
    const moderator = await session(MODERATOR);
    const response = await call(`/api/guilds/${GUILD}/onboarding/preset`, moderator, "POST", { preset: "community" }).response;
    expect(response.status).toBe(403);
  });

  it("dismisses an optional step and can mark the checklist complete", async () => {
    const sid = await session(MANAGER);
    const dismissed = await call(`/api/guilds/${GUILD}/onboarding/dismiss`, sid, "POST", { step: "welcome" }).response;
    expect(dismissed.status).toBe(200);
    const body = await dismissed.json() as OnboardingResponse;
    expect(body.dismissedSteps).toContain("welcome");
    expect(body.steps.find((step) => step.id === "welcome")?.status).toBe("skipped");

    const completed = await call(`/api/guilds/${GUILD}/onboarding/dismiss`, sid, "POST", { step: "__complete__" }).response;
    expect((await completed.json() as OnboardingResponse).completedAt).not.toBeNull();
  });
});
