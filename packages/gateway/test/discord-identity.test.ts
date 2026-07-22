import { describe, expect, it, vi } from "vitest";
import { verifyDiscordApplicationId } from "../src/discord-identity.js";

const STAGING_APPLICATION_ID = "1529353871619522600";

describe("staging Discord application identity guard", () => {
  it("accepts only the configured bot application", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: STAGING_APPLICATION_ID, bot: true }));
    await expect(verifyDiscordApplicationId("sensitive-token", STAGING_APPLICATION_ID, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("https://discord.com/api/v10/users/@me", {
      headers: { authorization: "Bot sensitive-token" },
    });
  });

  it("rejects another application with a safe error", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "1524597895859536074", bot: true }));
    await expect(verifyDiscordApplicationId("sensitive-token", STAGING_APPLICATION_ID, fetcher))
      .rejects.toThrow("does not match DISCORD_CLIENT_ID");
  });

  it("does not expose Discord response bodies on authentication failure", async () => {
    const fetcher = vi.fn(async () => new Response('{"message":"secret-shaped-body"}', { status: 401 }));
    await expect(verifyDiscordApplicationId("sensitive-token", STAGING_APPLICATION_ID, fetcher))
      .rejects.toThrow("Discord bot identity check failed (401)");
  });
});
