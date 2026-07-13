import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { MODULE_IDS } from "@bot/shared";
import {
  ensureGuildModules,
  listEffectiveGuildModules,
  setGuildModuleEnabled,
  upsertGuild,
  upsertTicketSettings,
} from "../src/db/queries.js";

const GUILD_A = "940000000000000001";
const GUILD_B = "940000000000000002";

beforeAll(async () => {
  await upsertGuild(env.DB, GUILD_A, "Governed A", null);
  await upsertGuild(env.DB, GUILD_B, "Governed B", null);
  await ensureGuildModules(env.DB, GUILD_A);
  await ensureGuildModules(env.DB, GUILD_B);
});

describe("M03 guild module persistence", () => {
  it("creates one bounded row per registered module for new guilds", async () => {
    const rows = await listEffectiveGuildModules(env.DB, GUILD_A);
    expect(rows).toHaveLength(MODULE_IDS.length);
    expect(rows.map((row) => row.module_id).sort()).toEqual([...MODULE_IDS].sort());
  });

  it("dual-reads historical flags until governance becomes authoritative", async () => {
    await upsertTicketSettings(env.DB, GUILD_A, {
      enabled: true,
      categoryId: "640000000000000001",
      staffRoleIds: [],
      transcriptChannelId: null,
    });
    const legacy = await listEffectiveGuildModules(env.DB, GUILD_A);
    expect(legacy.find((row) => row.module_id === "tickets")?.enabled).toBe(1);

    await setGuildModuleEnabled(env.DB, GUILD_A, "tickets", false);
    const governed = await listEffectiveGuildModules(env.DB, GUILD_A);
    expect(governed.find((row) => row.module_id === "tickets")?.enabled).toBe(0);
  });

  it("keeps module state isolated between guilds", async () => {
    await setGuildModuleEnabled(env.DB, GUILD_A, "music", false);
    const [a, b] = await Promise.all([listEffectiveGuildModules(env.DB, GUILD_A), listEffectiveGuildModules(env.DB, GUILD_B)]);
    expect(a.find((row) => row.module_id === "music")?.enabled).toBe(0);
    expect(b.find((row) => row.module_id === "music")?.enabled).toBe(1);
  });
});
