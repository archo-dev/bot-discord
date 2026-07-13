import { EmbedBuilder, Events, PermissionFlagsBits, type Client, type Message } from "discord.js";
import type { ConfigCache } from "./config-cache.js";
import type { AutomodRule, GuildGatewayConfig, WorkerApi } from "./worker-api.js";
import { errMsg } from "./util.js";
import { isGatewayModuleEnabled } from "./module-config.js";

const RULE_LABELS: Record<AutomodRule, string> = {
  spam: "spam",
  invite: "invitation Discord",
  link: "lien non autorisé",
  word: "mot interdit",
};

const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const LINK_RE = /https?:\/\/([^\s/<>]+)/gi;

/** Sliding window of message timestamps per guild:user, swept periodically. */
const spamWindows = new Map<string, number[]>();
const SWEEP_INTERVAL_MS = 300_000;

function isSpam(key: string, maxMessages: number, windowSeconds: number): boolean {
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;
  const stamps = (spamWindows.get(key) ?? []).filter((t) => t > cutoff);
  stamps.push(now);
  if (stamps.length > maxMessages) {
    spamWindows.delete(key); // reset so the next message restarts the count
    return true;
  }
  spamWindows.set(key, stamps);
  return false;
}

function matchRule(message: Message<true>, automod: GuildGatewayConfig["automod"]): AutomodRule | null {
  const content = message.content;

  if (automod.bannedWords.length > 0) {
    const lower = content.toLowerCase();
    if (automod.bannedWords.some((w) => lower.includes(w.toLowerCase()))) return "word";
  }
  if (automod.antiInviteEnabled && INVITE_RE.test(content)) return "invite";
  if (automod.antiLinkEnabled) {
    for (const match of content.matchAll(LINK_RE)) {
      const host = match[1]!.toLowerCase().split(":")[0]!;
      const allowed = automod.linkWhitelist.some((d) => host === d || host.endsWith(`.${d}`));
      if (!allowed) return "link";
    }
  }
  if (
    automod.antiSpamEnabled &&
    isSpam(`${message.guild.id}:${message.author.id}`, automod.antiSpamMaxMessages, automod.antiSpamWindowSeconds)
  ) {
    return "spam";
  }
  return null;
}

export function registerAutomod(client: Client, cache: ConfigCache, api: WorkerApi): void {
  setInterval(() => {
    const cutoff = Date.now() - 120_000;
    for (const [key, stamps] of spamWindows) {
      if (stamps.every((t) => t < cutoff)) spamWindows.delete(key);
    }
  }, SWEEP_INTERVAL_MS).unref();

  client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.bot || !message.member) return;
    const cfg = await cache.get(message.guild.id).catch(() => null);
    if (!cfg || !isGatewayModuleEnabled(cfg, "automod")) return;
    const automod = cfg.automod;
    const anyRule =
      automod.antiSpamEnabled || automod.antiInviteEnabled || automod.antiLinkEnabled || automod.bannedWords.length > 0;
    if (!anyRule) return;

    // Exemptions: moderators, exempt roles, exempt channels.
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    if (automod.exemptChannelIds.includes(message.channelId)) return;
    if (automod.exemptRoleIds.some((id) => message.member!.roles.cache.has(id))) return;

    const rule = matchRule(message, automod);
    if (!rule) return;

    await message.delete().catch(() => {});

    if (automod.action === "delete") {
      // Silent removal: no mod_actions row, but still traced in the mod-log channel.
      if (cfg.logChannelId) {
        const channel = message.guild.channels.cache.get(cfg.logChannelId);
        if (channel?.isTextBased()) {
          await channel
            .send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xed4245)
                  .setTitle("🤖 Message supprimé (auto-modération)")
                  .setDescription(message.content ? message.content.slice(0, 1000) : "*(vide)*")
                  .addFields(
                    { name: "Membre", value: `${message.author} (${message.author.id})`, inline: true },
                    { name: "Règle", value: RULE_LABELS[rule], inline: true },
                    { name: "Salon", value: `<#${message.channelId}>`, inline: true },
                  )
                  .setTimestamp(),
              ],
            })
            .catch(() => {});
        }
      }
    } else {
      // warn/timeout: the Worker inserts warnings + mod_actions and applies the
      // warn-threshold auto-timeout, so automod feeds the same pipeline as /warn.
      api
        .postAutomodSanction(message.guild.id, { userId: message.author.id, rule, action: automod.action })
        .catch((err) => console.error("automod sanction failed:", errMsg(err)));
    }

    // Short notice in the channel, self-deleted.
    try {
      const notice = await message.channel.send(`⚠️ ${message.author} : message supprimé (${RULE_LABELS[rule]}).`);
      setTimeout(() => void notice.delete().catch(() => {}), 5_000).unref();
    } catch {
      // channel may deny the bot — the sanction already happened.
    }
  });
}
