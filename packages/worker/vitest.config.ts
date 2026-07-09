import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["discord-api-types/v10"],
        },
      },
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            // Overridden inside tests that generate their own keypair.
            DISCORD_PUBLIC_KEY: "0".repeat(64),
            DISCORD_TOKEN: "test-token",
            DISCORD_CLIENT_ID: "100000000000000000",
            DISCORD_CLIENT_SECRET: "test-secret",
            SESSION_SECRET: "test-session-secret",
            INTERNAL_API_TOKEN: "test-internal-token",
            PANEL_ORIGIN: "http://localhost:5173",
          },
        },
      },
    },
  },
});
