import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  claimPanelSanctionRequest,
  finishPanelSanctionRequest,
  getSanctionExemptions,
  insertModAction,
  listWarnings,
  listModActions,
  replaceSanctionExemptions,
  revokeModAction,
  upsertGuild,
} from "../src/db/queries.js";
import { matchPanelMutationPolicy } from "@bot/shared";
import { recordOwnerTargetAttempt } from "../src/moderation/owner-attempt.js";

const GUILD = "880000000000000001";
const GUILD_TWO = "880000000000000011";
const USER = "880000000000000002";
const USER_TWO = "880000000000000012";
const ROLE = "880000000000000003";
const OWNER = "880000000000000004";

beforeAll(async () => {
  await upsertGuild(env.DB, GUILD, "Sanctions", null);
  await upsertGuild(env.DB, GUILD_TWO, "Sanctions two", null);
});

describe("panel sanctions persistence", () => {
  it("keeps exemptions independently per sanction type", async () => {
    await replaceSanctionExemptions(env.DB, GUILD, { warn: [ROLE], timeout: [USER], kick: [], ban: [ROLE] }, USER);
    await expect(getSanctionExemptions(env.DB, GUILD)).resolves.toEqual({ warn: [ROLE], timeout: [USER], kick: [], ban: [ROLE] });
  });

  it("records expiry, filters server-side and revokes once", async () => {
    const id = await insertModAction(env.DB, {
      guildId: GUILD, action: "timeout", targetId: USER, moderatorId: USER, reason: "test", source: "panel",
      expiresAt: "2999-01-01T00:00:00.000Z", idempotencyKey: "9c41a51c-11c0-4fbb-8338-49e7da08d5aa",
    });
    const active = await listModActions(env.DB, GUILD, { page: 1, pageSize: 25, status: "active", targetId: USER });
    expect(active.rows.some((row) => row.id === id)).toBe(true);
    expect(await revokeModAction(env.DB, GUILD, id, USER, "erreur")).toBe(true);
    expect(await revokeModAction(env.DB, GUILD, id, USER, "second essai")).toBe(false);
    const revoked = await listModActions(env.DB, GUILD, { page: 1, pageSize: 25, status: "revoked", targetId: USER });
    expect(revoked.rows.some((row) => row.id === id && row.revocation_reason === "erreur")).toBe(true);
  });

  it("claims an idempotency key only once", async () => {
    const key = "be3b2f0e-38d6-4a78-8bb8-0d370abf6683";
    expect(await claimPanelSanctionRequest(env.DB, GUILD, key, USER)).toBe("claimed");
    expect(await claimPanelSanctionRequest(env.DB, GUILD, key, USER)).toBe("pending");
    await finishPanelSanctionRequest(env.DB, GUILD, key, "completed", null);
    expect(await claimPanelSanctionRequest(env.DB, GUILD, key, USER)).toBe("completed");
  });

  it("classifies every new mutation before it can be written", () => {
    expect(matchPanelMutationPolicy("POST", `/api/guilds/${GUILD}/sanctions`)?.capability).toBe("moderation_write");
    expect(matchPanelMutationPolicy("POST", `/api/guilds/${GUILD}/sanctions/42/revoke`)?.capability).toBe("moderation_write");
    expect(matchPanelMutationPolicy("PUT", `/api/guilds/${GUILD}/sanction-exemptions`)?.capability).toBe("moderation_write");
  });

  it("records one reversible automatic warning per owner-target request", async () => {
    const requestId = "owner-attempt-00000001";
    await expect(recordOwnerTargetAttempt(env.DB, {
      guildId: GUILD, actorId: USER, ownerId: OWNER, sanctionType: "ban", origin: "panel", requestId,
    })).resolves.toBe("warn_recorded");
    await expect(recordOwnerTargetAttempt(env.DB, {
      guildId: GUILD, actorId: USER, ownerId: OWNER, sanctionType: "ban", origin: "panel", requestId,
    })).resolves.toBe("duplicate");
    const warnings = await listWarnings(env.DB, GUILD, USER);
    expect(warnings.filter((warning) => warning.reason?.includes("propriétaire du serveur"))).toHaveLength(1);
    const actions = await listModActions(env.DB, GUILD, { page: 1, pageSize: 25, action: "warn", targetId: USER });
    expect(actions.rows.some((action) => action.metadata?.includes("owner_target_attempt"))).toBe(true);
  });

  it("keeps an owner or system actor audit-only", async () => {
    await expect(recordOwnerTargetAttempt(env.DB, {
      guildId: GUILD, actorId: OWNER, ownerId: OWNER, sanctionType: "warn", origin: "slash", requestId: "owner-attempt-00000002",
    })).resolves.toBe("audit_only");
    await expect(recordOwnerTargetAttempt(env.DB, {
      guildId: GUILD, actorId: "automod", ownerId: OWNER, sanctionType: "warn", origin: "automation", requestId: "owner-attempt-00000003",
    })).resolves.toBe("audit_only");
  });

  it("is concurrency-safe and isolates the idempotency key by guild", async () => {
    const input = { guildId: GUILD, actorId: USER_TWO, ownerId: OWNER, sanctionType: "kick" as const, origin: "slash" as const, requestId: "owner-attempt-concurrent" };
    const outcomes = await Promise.all([recordOwnerTargetAttempt(env.DB, input), recordOwnerTargetAttempt(env.DB, input)]);
    expect(outcomes.filter((outcome) => outcome === "warn_recorded")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "duplicate")).toHaveLength(1);
    await expect(recordOwnerTargetAttempt(env.DB, { ...input, guildId: GUILD_TWO })).resolves.toBe("warn_recorded");
  });

  it("caps distinct owner-target attempts durably at five warnings per minute", async () => {
    const actor = "880000000000000013";
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => recordOwnerTargetAttempt(env.DB, {
      guildId: GUILD_TWO, actorId: actor, ownerId: OWNER, sanctionType: "timeout", origin: "panel", requestId: `owner-attempt-rate-${index}`,
    })));
    expect(outcomes.filter((outcome) => outcome === "warn_recorded")).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome === "rate_limited")).toHaveLength(1);
    expect((await listWarnings(env.DB, GUILD_TWO, actor)).filter((warning) => warning.reason?.includes("propriétaire du serveur"))).toHaveLength(5);
  });
});
