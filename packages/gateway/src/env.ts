import { z } from "zod";

const envSchema = z.object({
  /** Bot token — the same one the Worker uses. */
  DISCORD_TOKEN: z.string().min(50),
  /** Worker origin, e.g. https://botdiscord.example.workers.dev */
  WORKER_ORIGIN: z.url(),
  /** Bearer for the Worker's /internal/* API. */
  INTERNAL_API_TOKEN: z.string().min(16),
  INTERNAL_API_KEY_ID: z.string().min(1).max(40).default("gw-current"),
  /** Bearer expected on this service's own HTTP endpoints (Worker → gateway). */
  GATEWAY_HTTP_TOKEN: z.string().min(16),
  GATEWAY_HTTP_TOKEN_PREVIOUS: z.string().min(16).optional(),
  GATEWAY_HTTP_KEY_ID: z.string().min(1).max(40).default("worker-current"),
  GATEWAY_HTTP_PREVIOUS_KEY_ID: z.string().min(1).max(40).default("worker-previous"),
  GATEWAY_INTERNAL_AUTH_MODE: z.enum(["legacy", "dual", "signed"]).default("dual"),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  /**
   * Gate for the privileged GuildPresences intent (M19). Set to "true" ONLY once
   * the Presence Intent is enabled in the Discord Developer Portal — otherwise the
   * client crashes at login with "Used disallowed intents". Default off = safe.
   */
  PRESENCE_ENABLED: z.string().optional(),
});

export type GatewayEnv = z.infer<typeof envSchema>;

export function loadEnv(): GatewayEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment (see .env.example):");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}
