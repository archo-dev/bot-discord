import { z } from "zod";

const envSchema = z.object({
  /** Bot token — the same one the Worker uses. */
  DISCORD_TOKEN: z.string().min(50),
  /**
   * Public application id expected for this token. Optional for backwards
   * compatibility with the existing production service, but mandatory in the
   * staging service template so a production token can never be used there by
   * accident.
   */
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/).optional(),
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

  /**
   * Primary music source. "youtube" = historical behaviour (default, safe).
   * Set "soundcloud" as a temporary stand-in while the OVH IP can't reach
   * YouTube's media CDN (see docs/roadmap). Flip back to "youtube" once the
   * egress relay / Oracle VM is in place — no code change needed.
   */
  MUSIC_PRIMARY_SOURCE: z.enum(["youtube", "soundcloud"]).default("youtube"),

  // --- Reliable delivery (M05) ---------------------------------------------
  /**
   * Comma-separated reliable event types routed through the persistent outbox
   * instead of a direct call. EMPTY = off (historical direct behavior, safe
   * default). Enable progressively, e.g. "voice_log" then more.
   * Valid: voice_log,channel_activity,member_snapshot,gateway_event
   */
  GATEWAY_RELIABLE_TYPES: z.string().optional(),
  /** Outbox SQLite file. Default: <home>/.botdiscord/outbox.db (perms 0600). */
  GATEWAY_OUTBOX_PATH: z.string().optional(),
  GATEWAY_OUTBOX_MAX_EVENTS: z.coerce.number().int().min(100).max(5_000_000).default(20_000),
  GATEWAY_OUTBOX_MAX_BYTES: z.coerce.number().int().min(1_000_000).default(64 * 1024 * 1024),
  GATEWAY_OUTBOX_MAX_AGE_MS: z.coerce.number().int().min(60_000).default(24 * 3600 * 1000),
  GATEWAY_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(1000).default(12),
  GATEWAY_OUTBOX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  /** Dead-letter is bounded: only the most recent N are kept (older ones purged). */
  GATEWAY_OUTBOX_MAX_DEAD: z.coerce.number().int().min(0).max(1_000_000).default(5_000),
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
