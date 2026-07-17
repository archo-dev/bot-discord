import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  claimPanelSanctionRequest,
  finishPanelSanctionRequest,
  getSanctionExemptions,
  insertModAction,
  listModActions,
  replaceSanctionExemptions,
  revokeModAction,
  upsertGuild,
} from "../src/db/queries.js";
import { matchPanelMutationPolicy } from "@bot/shared";

const GUILD = "880000000000000001";
const USER = "880000000000000002";
const ROLE = "880000000000000003";

beforeAll(async () => { await upsertGuild(env.DB, GUILD, "Sanctions", null); });

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
});
