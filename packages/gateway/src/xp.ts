import { Events, type Client } from "discord.js";
import type { ConfigCache } from "./config-cache.js";
import type { WorkerApi } from "./worker-api.js";
import { errMsg } from "./util.js";
import { isGatewayModuleEnabled } from "./module-config.js";

/**
 * XP gains: the gateway only detects eligible messages and enforces the
 * per-user cooldown in memory; the Worker owns amounts, curve and rewards.
 */
const cooldowns = new Map<string, number>(); // guild:user → eligible again at (ms)
const SWEEP_INTERVAL_MS = 600_000;

export function registerXp(client: Client, cache: ConfigCache, api: WorkerApi): void {
  setInterval(() => {
    const now = Date.now();
    for (const [key, until] of cooldowns) {
      if (until < now) cooldowns.delete(key);
    }
  }, SWEEP_INTERVAL_MS).unref();

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot) return;
    const cfg = await cache.get(message.guild.id).catch(() => null);
    if (!cfg?.xp.enabled || !isGatewayModuleEnabled(cfg, "levels")) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    if ((cooldowns.get(key) ?? 0) > now) return;
    cooldowns.set(key, now + cfg.xp.cooldownSeconds * 1000);

    api
      .postXp(message.guild.id, {
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channelId,
      })
      .catch((err) => console.error("xp grant failed:", errMsg(err)));
  });
}
