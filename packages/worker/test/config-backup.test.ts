import { beforeAll, describe, expect, it } from "vitest";
import { createExecutionContext, env, fetchMock } from "cloudflare:test";
import type {
  AutomodSettingsDto,
  ConfigExport,
  ConfigSnapshotDetail,
  ConfigSnapshotDiff,
  ConfigSnapshotList,
  ImportApplyResult,
  ImportValidateResult,
  RestoreResult,
} from "@bot/shared";
import app from "../src/index.js";
import { createSession } from "../src/auth/session.js";
import { replacePanelAccess, upsertGuild } from "../src/db/queries.js";

const GUILD = "943000000000000001";
const GUILD_B = "943000000000000002";
const MANAGER = "843000000000000001";
const MODERATOR = "843000000000000002";
const ROLE_1 = "700000000000000001";
const CHAN_1 = "700000000000000002";
const ROLE_2 = "700000000000000003";
const CHAN_2 = "700000000000000004";

const AUTOMOD_A: AutomodSettingsDto = {
  antiSpamEnabled: true, antiSpamMaxMessages: 5, antiSpamWindowSeconds: 5,
  antiInviteEnabled: true, antiLinkEnabled: false, linkWhitelist: ["example.com"],
  bannedWords: ["foo", "bar"], exemptRoleIds: [ROLE_1], exemptChannelIds: [CHAN_1],
  action: "warn", timeoutMinutes: 15,
};
const AUTOMOD_B: AutomodSettingsDto = {
  antiSpamEnabled: false, antiSpamMaxMessages: 10, antiSpamWindowSeconds: 10,
  antiInviteEnabled: false, antiLinkEnabled: true, linkWhitelist: [],
  bannedWords: [], exemptRoleIds: [], exemptChannelIds: [],
  action: "delete", timeoutMinutes: 10,
};

async function session(userId: string): Promise<string> {
  return createSession(env, {
    userId, username: "backup-user", globalName: null, avatar: null,
    accessToken: `backup-${userId}`, refreshToken: "unused",
    tokenExpiresAt: Date.now() + 3_600_000, createdAt: Date.now(),
  });
}

async function call<T>(path: string, sid: string, method = "GET", body?: unknown): Promise<{ status: number; json: T }> {
  const ctx = createExecutionContext();
  const res = await app.request(path, {
    method,
    headers: { cookie: `session=${sid}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, ctx);
  return { status: res.status, json: (await res.json().catch(() => null)) as T };
}

async function setAutomod(sid: string, guildId: string, dto: AutomodSettingsDto): Promise<void> {
  const res = await call(`/api/guilds/${guildId}/automod`, sid, "PUT", dto);
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await Promise.all([upsertGuild(env.DB, GUILD, "Backup", null), upsertGuild(env.DB, GUILD_B, "Backup B", null)]);
  await replacePanelAccess(env.DB, GUILD, [{ subjectType: "user", subjectId: MODERATOR, level: "moderator" }], MANAGER);
  fetchMock.get("https://discord.com").intercept({ path: "/api/v10/users/@me/guilds", method: "GET" }).reply((request) => {
    const authorization = String((request.headers as Record<string, string>)["authorization"] ?? "");
    const manage = authorization.includes(MANAGER);
    return { statusCode: 200, data: [
      { id: GUILD, name: "Backup", icon: null, owner: false, permissions: manage ? "32" : "0" },
      { id: GUILD_B, name: "Backup B", icon: null, owner: false, permissions: manage ? "32" : "0" },
    ] };
  }).persist();
});

describe("M07 config backup", () => {
  it("round-trips automod through snapshot → change → restore", async () => {
    const sid = await session(MANAGER);
    await setAutomod(sid, GUILD, AUTOMOD_A);

    const created = await call<ConfigSnapshotDetail>(`/api/guilds/${GUILD}/config-snapshots`, sid, "POST", { modules: ["automod"] });
    expect(created.status).toBe(201);
    const snapshotId = created.json.id;

    await setAutomod(sid, GUILD, AUTOMOD_B);
    const restore = await call<RestoreResult>(`/api/guilds/${GUILD}/config-snapshots/${snapshotId}/restore`, sid, "POST", { modules: ["automod"] });
    expect(restore.status).toBe(200);
    expect(restore.json.previousSnapshotId).toBeTruthy();

    const after = await call<AutomodSettingsDto>(`/api/guilds/${GUILD}/automod`, sid);
    expect(after.json).toEqual(AUTOMOD_A);

    // Restore created a safety snapshot of the replaced state.
    const list = await call<ConfigSnapshotList>(`/api/guilds/${GUILD}/config-snapshots`, sid);
    expect(list.json.snapshots.some((s) => s.reason === "pre_restore")).toBe(true);
  });

  it("never serializes secrets and stays within the allowlist", async () => {
    const sid = await session(MANAGER);
    const created = await call<ConfigSnapshotDetail>(`/api/guilds/${GUILD}/config-snapshots`, sid, "POST", {});
    const serialized = JSON.stringify(created.json.payload).toLowerCase();
    for (const forbidden of ["token", "secret", "webhook", "authorization", "password"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(created.json.payload.modules).sort()).toEqual(["automod", "general"]);
  });

  it("computes a semantic diff against current config", async () => {
    const sid = await session(MANAGER);
    await setAutomod(sid, GUILD, AUTOMOD_A);
    const snap = await call<ConfigSnapshotDetail>(`/api/guilds/${GUILD}/config-snapshots`, sid, "POST", { modules: ["automod"] });
    await setAutomod(sid, GUILD, AUTOMOD_B);

    const diff = await call<ConfigSnapshotDiff>(`/api/guilds/${GUILD}/config-snapshots/${snap.json.id}/diff`, sid);
    const automod = diff.json.modules.find((m) => m.module === "automod");
    expect(automod?.changes.some((change) => change.path === "antiSpamEnabled")).toBe(true);
  });

  it("exports a checksummed backup and imports it cross-guild with remap", async () => {
    const sid = await session(MANAGER);
    await setAutomod(sid, GUILD, AUTOMOD_A);
    const snap = await call<ConfigSnapshotDetail>(`/api/guilds/${GUILD}/config-snapshots`, sid, "POST", { modules: ["automod"] });
    const exported = await call<ConfigExport>(`/api/guilds/${GUILD}/config-snapshots/${snap.json.id}/export`, sid);
    expect(exported.json.format).toBe("archodev.config-backup");

    // Validate on the other guild: valid checksum, references surfaced.
    const validate = await call<ImportValidateResult>(`/api/guilds/${GUILD_B}/config-import/validate`, sid, "POST", { export: exported.json });
    expect(validate.json.ok).toBe(true);
    expect(validate.json.checksumValid).toBe(true);
    expect(validate.json.sameGuild).toBe(false);
    expect(validate.json.references.map((r) => r.sourceId).sort()).toEqual([CHAN_1, ROLE_1].sort());

    // Applying without a mapping is refused.
    const noMap = await call(`/api/guilds/${GUILD_B}/config-import/apply`, sid, "POST", { export: exported.json, modules: ["automod"], mapping: {} });
    expect(noMap.status).toBe(400);

    // Applying with an explicit remap rewrites the ids in the target guild.
    const apply = await call<ImportApplyResult>(`/api/guilds/${GUILD_B}/config-import/apply`, sid, "POST", {
      export: exported.json, modules: ["automod"], mapping: { [ROLE_1]: ROLE_2, [CHAN_1]: CHAN_2 },
    });
    expect(apply.status).toBe(200);
    const target = await call<AutomodSettingsDto>(`/api/guilds/${GUILD_B}/automod`, sid);
    expect(target.json.exemptRoleIds).toEqual([ROLE_2]);
    expect(target.json.exemptChannelIds).toEqual([CHAN_2]);
  });

  it("rejects a tampered export via checksum", async () => {
    const sid = await session(MANAGER);
    const snap = await call<ConfigSnapshotDetail>(`/api/guilds/${GUILD}/config-snapshots`, sid, "POST", { modules: ["automod"] });
    const exported = (await call<ConfigExport>(`/api/guilds/${GUILD}/config-snapshots/${snap.json.id}/export`, sid)).json;
    const tampered = { ...exported, payload: { ...exported.payload, modules: { automod: { version: 1, values: { ...AUTOMOD_B } } } } };
    const validate = await call<ImportValidateResult>(`/api/guilds/${GUILD}/config-import/validate`, sid, "POST", { export: tampered });
    expect(validate.json.checksumValid).toBe(false);
    expect(validate.json.ok).toBe(false);
  });

  it("keeps backups admin-only and guild-isolated", async () => {
    const moderator = await session(MODERATOR);
    expect((await call(`/api/guilds/${GUILD}/config-snapshots`, moderator, "POST", {})).status).toBe(403);
    // A manager of GUILD/GUILD_B is not a member of an unrelated guild.
    expect((await call(`/api/guilds/999000000000000009/config-snapshots`, await session(MANAGER))).status).toBe(404);
  });
});
