import { z } from "zod";

const envSchema = z.object({
  /** Bot token — the same one the Worker uses. */
  DISCORD_TOKEN: z.string().min(50),
  /** Worker origin, e.g. https://botdiscord.example.workers.dev */
  WORKER_ORIGIN: z.url(),
  /** Bearer for the Worker's /internal/* API. */
  INTERNAL_API_TOKEN: z.string().min(16),
  /** Bearer expected on this service's own HTTP endpoints (Worker → gateway). */
  GATEWAY_HTTP_TOKEN: z.string().min(16),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
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
