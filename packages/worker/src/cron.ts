import type { Env } from "./env.js";
import { purgeOldStats, purgeSecurityData } from "./db/queries.js";

/**
 * Daily scheduled job (cron "23 4 * * *"). Enforces the D1 retention bounds so
 * the free-tier database doesn't grow unbounded (voice logs 90 d, channel
 * activity 180 d, hourly snapshots 14 d, daily snapshots 400 d).
 */
export async function runScheduled(env: Env): Promise<void> {
  const [stats, security] = await Promise.all([purgeOldStats(env.DB), purgeSecurityData(env.DB)]);
  console.log("cron purge:", JSON.stringify({ stats, security }));
}
