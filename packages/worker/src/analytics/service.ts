import { productMetricSchema, type ProductMetricInput } from "@bot/shared";
import type { Env } from "../env.js";
import { deleteMetricContributions, isProductAnalyticsEnabled, upsertMetricContribution } from "../db/queries.js";

const encoder = new TextEncoder();

async function dailyGuildKey(secret: string, guildId: string, day: string): Promise<{ key: string; cohortBucket: number }> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`product-analytics:${day}:${guildId}`)));
  return { key: Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join(""), cohortBucket: signature[0]! % 4 };
}

export async function recordProductMetric(env: Env, guildId: string, raw: ProductMetricInput): Promise<boolean> {
  if (env.PRODUCT_ANALYTICS_ENABLED === "false") return false;
  const parsed = productMetricSchema.safeParse(raw);
  if (!parsed.success || !(await isProductAnalyticsEnabled(env.DB, guildId))) return false;
  const day = new Date().toISOString().slice(0, 10);
  const identity = await dailyGuildKey(env.SESSION_SECRET, guildId, day);
  await upsertMetricContribution(env.DB, {
    ...parsed.data,
    day,
    guildKey: identity.key,
    cohortBucket: identity.cohortBucket,
    appVersion: (env.APP_VERSION ?? "unknown").slice(0, 40),
  });
  return true;
}

export async function purgeGuildContributions(env: Env, guildId: string): Promise<number> {
  const keys: string[] = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    keys.push((await dailyGuildKey(env.SESSION_SECRET, guildId, date)).key);
  }
  return deleteMetricContributions(env.DB, keys);
}
