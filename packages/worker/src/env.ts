export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  /** Bound automatically once the `assets` config is enabled (panel build). */
  ASSETS?: Fetcher;

  // vars
  DISCORD_CLIENT_ID: string;
  PANEL_ORIGIN: string;
  PANEL_ALLOWED_ORIGINS?: string;
  SECURITY_ORIGIN_MODE?: "report" | "enforce";
  SECURITY_CSP_MODE?: "report" | "enforce";
  SESSION_GLOBAL_VERSION?: string;
  PRODUCT_ANALYTICS_ENABLED?: "true" | "false";
  APP_VERSION?: string;

  // secrets
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  INTERNAL_API_TOKEN: string;
  INTERNAL_API_TOKEN_PREVIOUS?: string;
  INTERNAL_API_KEY_ID?: string;
  INTERNAL_API_PREVIOUS_KEY_ID?: string;
  INTERNAL_AUTH_MODE?: "legacy" | "dual" | "signed";

  // Set once the gateway VPS is up (Worker → gateway calls: music forward
  // M14, panel-driven controls). Absent until then.
  GATEWAY_ORIGIN?: string;
  GATEWAY_HTTP_TOKEN?: string;
  GATEWAY_HTTP_KEY_ID?: string;
}
