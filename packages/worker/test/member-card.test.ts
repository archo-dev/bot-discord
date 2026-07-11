import { beforeAll, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import type { APIEmbed } from "discord-api-types/v10";
import {
  buildMemberCardEmbed,
  extractUserMentions,
  snowflakeToTimestamp,
  type MemberCardInfo,
} from "@bot/shared";
import { withMemberCards } from "../src/discord/member-card.js";
import { upsertGuild } from "../src/db/queries.js";

// M20 — member cards on mentions.

const G_ON = "970000000000000001"; // mention_cards = 1
const G_OFF = "970000000000000002"; // mention_cards = 0

function mockMember(
  guildId: string,
  userId: string,
  member: { username?: string; globalName?: string | null; roles?: string[]; joinedAt?: string },
): void {
  fetchMock
    .get("https://discord.com")
    .intercept({ path: `/api/v10/guilds/${guildId}/members/${userId}`, method: "GET" })
    .reply(200, {
      user: {
        id: userId,
        username: member.username ?? "user",
        global_name: member.globalName ?? null,
        avatar: null,
      },
      roles: member.roles ?? [guildId],
      joined_at: member.joinedAt ?? "2024-01-01T00:00:00.000Z",
    });
}

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  await upsertGuild(env.DB, G_ON, "Cards On", null);
  await upsertGuild(env.DB, G_OFF, "Cards Off", null);
  await env.DB.prepare(`UPDATE guilds SET mention_cards = 1 WHERE id = ?1`).bind(G_ON).run();
  // Role name resolution reads the same KV cache the panel roles endpoint fills.
  await env.KV.put(`roles:${G_ON}`, JSON.stringify([{ id: "role_vip", name: "VIP" }]));
});

describe("extractUserMentions (pure)", () => {
  it("dedups and preserves first-appearance order", () => {
    expect(extractUserMentions("hi <@111> and <@!222> then <@111>")).toEqual(["111", "222"]);
  });

  it("ignores role and @everyone mentions", () => {
    expect(extractUserMentions("<@&555> @everyone <@123>")).toEqual(["123"]);
  });

  it("returns [] with no mentions", () => {
    expect(extractUserMentions("just text")).toEqual([]);
  });
});

describe("buildMemberCardEmbed (pure)", () => {
  it("derives account creation from the snowflake (documented example)", () => {
    // Discord's own docs example: 175928847299117063 → 1462015105796 ms.
    expect(snowflakeToTimestamp("175928847299117063")).toBe(1462015105796);
  });

  it("builds tag, created/joined fields, roles cap and presence", () => {
    const info: MemberCardInfo = {
      id: "175928847299117063",
      tag: "Bob",
      avatarUrl: null,
      joinedAt: "2024-01-01T00:00:00.000Z",
      roles: ["A", "B", "C", "D", "E", "F", "G"],
      presence: "idle",
    };
    const embed = buildMemberCardEmbed(info);
    expect(embed.author.name).toBe("Bob");
    expect(embed.footer.text).toBe("ID: 175928847299117063");
    expect(embed.fields.find((f) => f.name === "Compte créé")?.value).toBe("<t:1462015105:R>");
    expect(embed.fields.find((f) => f.name === "Statut")?.value).toContain("Inactif");
    // 7 roles → shows 5 + "+2"
    const rolesField = embed.fields.find((f) => f.name.startsWith("Rôles"));
    expect(rolesField?.name).toBe("Rôles (7)");
    expect(rolesField?.value).toBe("A, B, C, D, E, +2");
  });

  it("omits joined/presence/roles fields when absent", () => {
    const embed = buildMemberCardEmbed({ id: "111", tag: "x", avatarUrl: null, joinedAt: null, roles: [] });
    expect(embed.fields.map((f) => f.name)).toEqual(["Compte créé"]);
  });
});

describe("withMemberCards (integration)", () => {
  it("appends one card per unique mention when the guild opted in", async () => {
    const U = "980000000000000001";
    mockMember(G_ON, U, { globalName: "Bob", roles: ["role_vip", G_ON] });

    const out = await withMemberCards(env, G_ON, { content: `bravo <@${U}> !` });
    expect(out.embeds).toHaveLength(1);
    const card = out.embeds![0] as APIEmbed;
    expect(card.author?.name).toBe("Bob");
    expect(card.footer?.text).toBe(`ID: ${U}`);
    expect(card.fields?.find((f) => f.name.startsWith("Rôles"))?.value).toBe("VIP");
  });

  it("leaves the payload untouched when the guild opted out", async () => {
    const U = "980000000000000002";
    // No mock: mention_cards is off, so no REST call should happen.
    const payload = { content: `salut <@${U}>` };
    const out = await withMemberCards(env, G_OFF, payload);
    expect(out.embeds).toBeUndefined();
  });

  it("does nothing without mentions", async () => {
    const out = await withMemberCards(env, G_ON, { content: "aucune mention ici" });
    expect(out.embeds).toBeUndefined();
  });

  it("caps at 3 cards even with more mentions", async () => {
    const ids = ["980000000000000010", "980000000000000011", "980000000000000012", "980000000000000013"];
    // Only the first 3 are fetched (the 4th is sliced off before any REST call).
    for (const id of ids.slice(0, 3)) mockMember(G_ON, id, { globalName: `M${id.slice(-1)}` });
    const content = ids.map((id) => `<@${id}>`).join(" ");
    const out = await withMemberCards(env, G_ON, { content });
    expect(out.embeds).toHaveLength(3);
  });

  it("respects the 10-embed ceiling with pre-existing embeds", async () => {
    const existing = Array.from({ length: 9 }, () => ({ title: "x" }) as APIEmbed);
    const U1 = "980000000000000020";
    const U2 = "980000000000000021";
    mockMember(G_ON, U1, { globalName: "One" }); // only 1 slot left → only U1 fetched
    const out = await withMemberCards(env, G_ON, { content: `<@${U1}> <@${U2}>`, embeds: existing });
    expect(out.embeds).toHaveLength(10);
  });
});
