import { describe, expect, it } from "vitest";
import { env, createExecutionContext } from "cloudflare:test";
import app from "../src/index.js";
import { getGuild, upsertGuild } from "../src/db/queries.js";

const G = "990000000000000050";

function req(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return Promise.resolve(
    app.request(
      path,
      {
        ...init,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      },
      env,
      createExecutionContext(),
    ),
  );
}

describe("guild lifecycle internal API", () => {
  it("rejects requests without the bearer token", async () => {
    const res = await req(`/internal/guilds/${G}/installed`, {
      method: "POST",
      body: JSON.stringify({ name: "X", icon: null }),
    });
    expect(res.status).toBe(401);
  });

  it("installed upserts the guild row with bot_installed=1", async () => {
    const res = await req(
      `/internal/guilds/${G}/installed`,
      { method: "POST", body: JSON.stringify({ name: "Nouveau serveur", icon: "abc123" }) },
      "test-internal-token",
    );
    expect(res.status).toBe(201);
    const guild = await getGuild(env.DB, G);
    expect(guild?.name).toBe("Nouveau serveur");
    expect(guild?.icon).toBe("abc123");
    expect(guild?.bot_installed).toBe(1);
  });

  it("rejects an invalid installed body with 400", async () => {
    const res = await req(
      `/internal/guilds/${G}/installed`,
      { method: "POST", body: JSON.stringify({ icon: null }) },
      "test-internal-token",
    );
    expect(res.status).toBe(400);
  });

  it("uninstalled flips bot_installed to 0 without deleting the row", async () => {
    await upsertGuild(env.DB, G, "Serveur existant", null);
    const res = await req(`/internal/guilds/${G}/uninstalled`, { method: "POST" }, "test-internal-token");
    expect(res.status).toBe(201);
    const guild = await getGuild(env.DB, G);
    expect(guild).not.toBeNull();
    expect(guild?.bot_installed).toBe(0);
  });
});
