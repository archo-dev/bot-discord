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
  /** Platform rollout flag (M6). Undeclared in wrangler.jsonc → off in prod
   *  (all Gratuit). Set to "true" to enable entitlement resolution. */
  PLATFORM_ENTITLEMENTS?: string;
  /** Billing rollout flag (M9). Off by default → checkout dark. */
  PLATFORM_BILLING?: string;
  /** Client support rollout flag (M11). Off by default → support dark. */
  PLATFORM_SUPPORT?: string;
  /** Developer Studio rollout flag (M12). Off by default → every /studio* is 404. */
  PLATFORM_STUDIO?: string;
  /** Commercial launch flag (M16). Off by default → prices hidden, no launch signal. */
  PLATFORM_LAUNCH?: string;
  /** Launch pricing config (M16). Amounts are INTEGER smallest units (e.g. cents)
   *  as strings; currency is ISO 4217. Config, not secret. Absent → "Tarifs à venir". */
  LAUNCH_CURRENCY?: string;
  LAUNCH_PRICE_PREMIUM_MONTH?: string;
  LAUNCH_PRICE_PREMIUM_YEAR?: string;
  LAUNCH_PRICE_BUSINESS_MONTH?: string;
  LAUNCH_PRICE_BUSINESS_YEAR?: string;
  /** Host that serves the isolated Studio (e.g. "studio.archodev.fr"). Undeclared
   *  in prod → Studio unreachable. Studio routes 404 on any other host. */
  STUDIO_HOST?: string;
  /** Comma-separated Discord snowflakes bootstrapped as owner operators (all
   *  permissions). No public bootstrap route (doc 09 §3). Secret; absent → none. */
  STUDIO_OWNER_IDS?: string;
  /** Studio session kill-switch, independent of the client SESSION_GLOBAL_VERSION. */
  STUDIO_SESSION_GLOBAL_VERSION?: string;
  /** Immediate Studio coupe-circuit (M14): "true" → every /studio* is 503 on the
   *  studio host (client host stays 404). Absent by default. */
  STUDIO_KILL_SWITCH?: string;
  /** Billing provider for the sandbox adapter (M9). Only "stripe" wired. */
  BILLING_PROVIDER?: string;
  /** Hosted checkout return URLs (M9). */
  BILLING_SUCCESS_URL?: string;
  BILLING_CANCEL_URL?: string;
  /** Stripe price ids per plan+interval (M9), e.g. "price_...". Config, not secret. */
  BILLING_PRICE_PREMIUM_MONTH?: string;
  BILLING_PRICE_PREMIUM_YEAR?: string;
  BILLING_PRICE_BUSINESS_MONTH?: string;
  BILLING_PRICE_BUSINESS_YEAR?: string;

  // secrets (billing sandbox — TEST keys only, provided out of repo via
  // `wrangler secret bulk`/.dev.vars; absent by default → adapter unavailable)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;

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
