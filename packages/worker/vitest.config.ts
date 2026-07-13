import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("migrations");

  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
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
              TEST_MIGRATIONS: migrations,
              // Overridden inside tests that generate their own keypair.
              DISCORD_PUBLIC_KEY: "0".repeat(64),
              DISCORD_TOKEN: "test-token",
              DISCORD_CLIENT_ID: "100000000000000000",
              DISCORD_CLIENT_SECRET: "test-secret",
              SESSION_SECRET: "test-session-secret",
              INTERNAL_API_TOKEN: "test-internal-token",
              PANEL_ORIGIN: "http://localhost:5173",
              SECURITY_ORIGIN_MODE: "report",
              SECURITY_CSP_MODE: "report",
              SESSION_GLOBAL_VERSION: "1",
              INTERNAL_AUTH_MODE: "dual",
            },
          },
        },
      },
    },
  };
});
