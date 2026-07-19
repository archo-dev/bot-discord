import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  activeWarningCount,
  filterInstalledGuilds,
  getCounterValues,
  getCustomCommandById,
  getEnabledSlashCommand,
  getGuild,
  incrementCounter,
  insertCommandRevision,
  insertCustomCommand,
  insertModAction,
  insertWarning,
  listCommandRevisions,
  listModActions,
  listWarnings,
  replacePanelAccess,
  listPanelAccess,
  revokeWarning,
  setBotInstalled,
  setCommandEnabled,
  updateGuildConfig,
  upsertGuild,
} from "../src/db/queries.js";

const G = "900000000000000001";

describe("guilds", () => {
  it("upserts and reads a guild with defaults", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    const guild = await getGuild(env.DB, G);
    expect(guild?.name).toBe("Test Guild");
    expect(guild?.warn_threshold).toBe(3);
    expect(guild?.warn_timeout_minutes).toBe(60);
    expect(guild?.bot_installed).toBe(1);
  });

  it("updates config partially", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    await updateGuildConfig(env.DB, G, { warn_threshold: 5, log_channel_id: "123456789012345678" });
    const guild = await getGuild(env.DB, G);
    expect(guild?.warn_threshold).toBe(5);
    expect(guild?.log_channel_id).toBe("123456789012345678");
    expect(guild?.warn_timeout_minutes).toBe(60);
  });

  it("re-upsert restores bot_installed after a kick", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    await setBotInstalled(env.DB, G, false);
    expect((await getGuild(env.DB, G))?.bot_installed).toBe(0);
    await upsertGuild(env.DB, G, "Test Guild", null);
    expect((await getGuild(env.DB, G))?.bot_installed).toBe(1);
  });

  it("filters installed guilds from a candidate list", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    const installed = await filterInstalledGuilds(env.DB, [G, "900000000000000999"]);
    expect(installed.has(G)).toBe(true);
    expect(installed.has("900000000000000999")).toBe(false);
  });
});

describe("warnings", () => {
  it("counts only non-revoked warnings", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    const user = "800000000000000001";
    const id1 = await insertWarning(env.DB, G, user, "700000000000000001", "spam");
    await insertWarning(env.DB, G, user, "700000000000000001", "flood");
    expect(await activeWarningCount(env.DB, G, user)).toBe(2);

    expect(await revokeWarning(env.DB, G, id1, "700000000000000002")).toBe(true);
    expect(await activeWarningCount(env.DB, G, user)).toBe(1);
    // revoking twice is a no-op
    expect(await revokeWarning(env.DB, G, id1, "700000000000000002")).toBe(false);

    const list = await listWarnings(env.DB, G, user);
    expect(list).toHaveLength(2);
  });
});

describe("mod actions", () => {
  it("inserts and pages mod actions with filters", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    await insertModAction(env.DB, {
      guildId: G,
      action: "ban",
      targetId: "800000000000000002",
      moderatorId: "700000000000000001",
      reason: "raid",
      metadata: { deleteDays: 1 },
    });
    await insertModAction(env.DB, {
      guildId: G,
      action: "warn",
      targetId: "800000000000000002",
      moderatorId: "700000000000000001",
      reason: null,
    });
    const all = await listModActions(env.DB, G, { page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
    const bansOnly = await listModActions(env.DB, G, { page: 1, pageSize: 10, action: "ban" });
    expect(bansOnly.total).toBe(1);
    expect(bansOnly.rows[0]?.metadata).toBe(JSON.stringify({ deleteDays: 1 }));
  });

  it("filters the unified history by source and escaped reason search", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    await insertModAction(env.DB, { guildId: G, action: "kick", targetId: "800000000000000009", moderatorId: "700000000000000001", reason: "Spam avancé", source: "panel" });
    await insertModAction(env.DB, { guildId: G, action: "auto_timeout", targetId: "800000000000000009", moderatorId: "automation", reason: "Filtre anti-spam", source: "gateway" });
    await insertModAction(env.DB, { guildId: G, action: "warn", targetId: "800000000000000009", moderatorId: "700000000000000001", reason: "Autre raison", source: "interaction" });

    const panelOnly = await listModActions(env.DB, G, { page: 1, pageSize: 25, source: "panel" });
    expect(panelOnly.total).toBe(1);
    expect(panelOnly.rows[0]?.action).toBe("kick");

    const gatewayOnly = await listModActions(env.DB, G, { page: 1, pageSize: 25, source: "gateway" });
    expect(gatewayOnly.rows.every((r) => r.source === "gateway")).toBe(true);
    expect(gatewayOnly.total).toBe(1);

    // Case-insensitive substring match across both spam-related reasons.
    const spam = await listModActions(env.DB, G, { page: 1, pageSize: 25, q: "spam" });
    expect(spam.total).toBe(2);

    // A LIKE wildcard in the query must be escaped, not treated as match-any:
    // no reason contains a literal underscore, so this returns nothing.
    const underscore = await listModActions(env.DB, G, { page: 1, pageSize: 25, q: "_" });
    expect(underscore.total).toBe(0);

    // Source and search combine (AND), still server-side.
    const combined = await listModActions(env.DB, G, { page: 1, pageSize: 25, source: "gateway", q: "spam" });
    expect(combined.total).toBe(1);
    expect(combined.rows[0]?.action).toBe("auto_timeout");
  });
});

describe("custom commands", () => {
  it("full lifecycle: create, lookup, disable, revisions", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    const logic = JSON.stringify({ version: 1, trigger: { type: "slash", name: "hello" }, actions: [{ type: "reply", content: "hi" }] });
    const id = await insertCustomCommand(env.DB, {
      guildId: G,
      name: "hello",
      description: "says hi",
      triggerType: "slash",
      logic,
      cooldownSeconds: 0,
      cooldownScope: "user",
      requiredPermissions: null,
      createdBy: "700000000000000001",
    });
    await insertCommandRevision(env.DB, { commandId: id, guildId: G, changeType: "create", logic, changedBy: "700000000000000001" });

    expect((await getEnabledSlashCommand(env.DB, G, "hello"))?.id).toBe(id);
    expect(await getEnabledSlashCommand(env.DB, G, "nope")).toBeNull();

    await setCommandEnabled(env.DB, G, id, false);
    expect(await getEnabledSlashCommand(env.DB, G, "hello")).toBeNull();
    expect((await getCustomCommandById(env.DB, G, id))?.enabled).toBe(0);

    const revisions = await listCommandRevisions(env.DB, G, id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.change_type).toBe("create");
  });

  it("rejects duplicate names per guild", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    const base = {
      guildId: G,
      description: "d",
      triggerType: "slash" as const,
      logic: "{}",
      cooldownSeconds: 0,
      cooldownScope: "user" as const,
      requiredPermissions: null,
      createdBy: "700000000000000001",
    };
    await insertCustomCommand(env.DB, { ...base, name: "dup" });
    await expect(insertCustomCommand(env.DB, { ...base, name: "dup" })).rejects.toThrow();
  });
});

describe("counters + panel access", () => {
  it("increments counters via upsert", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    expect(await incrementCounter(env.DB, G, "visits", 1)).toBe(1);
    expect(await incrementCounter(env.DB, G, "visits", 5)).toBe(6);
    expect(await incrementCounter(env.DB, G, "visits", -2)).toBe(4);
    const values = await getCounterValues(env.DB, G, ["visits", "unknown"]);
    expect(values).toEqual({ visits: 4 });
  });

  it("replaces panel access atomically", async () => {
    await upsertGuild(env.DB, G, "Test Guild", null);
    await replacePanelAccess(
      env.DB,
      G,
      [{ subjectType: "role", subjectId: "600000000000000001", level: "admin" }],
      "700000000000000001",
    );
    await replacePanelAccess(
      env.DB,
      G,
      [
        { subjectType: "role", subjectId: "600000000000000002", level: "admin" },
        { subjectType: "user", subjectId: "800000000000000003", level: "moderator" },
      ],
      "700000000000000001",
    );
    const entries = await listPanelAccess(env.DB, G);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.subject_id)).toEqual(["600000000000000002", "800000000000000003"]);
    expect(entries.map((e) => e.level)).toEqual(["admin", "moderator"]);
  });
});
