export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  /** Bound automatically once the `assets` config is enabled (panel build). */
  ASSETS?: Fetcher;

  // vars
  DISCORD_CLIENT_ID: string;
  PANEL_ORIGIN: string;

  // secrets
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  INTERNAL_API_TOKEN: string;

  // Set once the gateway VPS is up (Worker → gateway calls: music forward
  // M14, panel-driven controls). Absent until then.
  GATEWAY_ORIGIN?: string;
  GATEWAY_HTTP_TOKEN?: string;
}
