import { EmbedBuilder, Events, type Client, type VoiceState } from "discord.js";
import type { VoiceLogAction } from "@bot/shared";
import type { ConfigCache } from "./config-cache.js";
import type { WorkerApi } from "./worker-api.js";
import { sendTo } from "./events.js";
import { isGatewayModuleEnabled } from "./module-config.js";
import { observe } from "./observability.js";

const COLORS = { green: 0x57f287, red: 0xed4245, blurple: 0x5865f2, grey: 0x99aab5 } as const;

interface Classified {
  action: VoiceLogAction;
  channelId: string | null;
  fromChannelId: string | null;
}

/**
 * Turns a VoiceStateUpdate into zero or more log entries. A channel change is a
 * single join/leave/move; if the channel is unchanged, self/server mute & deaf
 * toggles each yield their own entry.
 */
function classify(oldState: VoiceState, newState: VoiceState): Classified[] {
  const oldCh = oldState.channelId;
  const newCh = newState.channelId;
  if (oldCh === null && newCh !== null) return [{ action: "join", channelId: newCh, fromChannelId: null }];
  if (oldCh !== null && newCh === null) return [{ action: "leave", channelId: oldCh, fromChannelId: null }];
  if (oldCh !== null && newCh !== null && oldCh !== newCh)
    return [{ action: "move", channelId: newCh, fromChannelId: oldCh }];

  const out: Classified[] = [];
  const oldMute = Boolean(oldState.selfMute) || Boolean(oldState.serverMute);
  const newMute = Boolean(newState.selfMute) || Boolean(newState.serverMute);
  const oldDeaf = Boolean(oldState.selfDeaf) || Boolean(oldState.serverDeaf);
  const newDeaf = Boolean(newState.selfDeaf) || Boolean(newState.serverDeaf);
  if (oldMute !== newMute) out.push({ action: newMute ? "mute" : "unmute", channelId: newCh, fromChannelId: null });
  if (oldDeaf !== newDeaf) out.push({ action: newDeaf ? "deafen" : "undeafen", channelId: newCh, fromChannelId: null });
  return out;
}

const STATE_ACTIONS = new Set<VoiceLogAction>(["mute", "unmute", "deafen", "undeafen"]);

function embedFor(who: string, c: Classified): EmbedBuilder {
  const e = new EmbedBuilder().setTimestamp();
  switch (c.action) {
    case "join":
      return e.setColor(COLORS.green).setDescription(`🔊 ${who} a rejoint <#${c.channelId}>`);
    case "leave":
      return e.setColor(COLORS.red).setDescription(`🔴 ${who} a quitté <#${c.channelId}>`);
    case "move":
      return e.setColor(COLORS.blurple).setDescription(`➡️ ${who} : <#${c.fromChannelId}> → <#${c.channelId}>`);
    case "mute":
      return e.setColor(COLORS.grey).setDescription(`🔇 ${who} s'est mis en muet dans <#${c.channelId}>`);
    case "unmute":
      return e.setColor(COLORS.grey).setDescription(`🎙️ ${who} n'est plus en muet dans <#${c.channelId}>`);
    case "deafen":
      return e.setColor(COLORS.grey).setDescription(`🔇 ${who} a coupé son casque dans <#${c.channelId}>`);
    case "undeafen":
      return e.setColor(COLORS.grey).setDescription(`🔊 ${who} a réactivé son casque dans <#${c.channelId}>`);
  }
}

// Narrow structural type for the fields we read off cfg.logs.
interface GatewayLogs {
  channelId: string | null;
  voiceJoin: boolean;
  voiceLeave: boolean;
  voiceMove: boolean;
  voiceState: boolean;
}

function toggleFor(logs: GatewayLogs, action: VoiceLogAction): boolean {
  if (action === "join") return logs.voiceJoin;
  if (action === "leave") return logs.voiceLeave;
  if (action === "move") return logs.voiceMove;
  return logs.voiceState;
}

/**
 * Voice activity logging (M17). join/leave/move are ALWAYS persisted to D1 (the
 * panel history is independent of the log channel); mute/deafen are persisted
 * only when the voice-state toggle is on. Log-channel embeds follow each toggle.
 */
export function registerVoice(client: Client, cache: ConfigCache, api: WorkerApi): void {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guild = newState.guild;
    const actions = classify(oldState, newState);
    if (actions.length === 0) return;

    observe("info", "voice_event_received", { guildId: guild.id });

    const cfg = await cache.get(guild.id).catch(() => null);
    if (!cfg) {
      observe("warn", "voice_log_skipped", { guildId: guild.id, reason: "config_missing" });
      return;
    }
    if (!isGatewayModuleEnabled(cfg, "voice_logs")) {
      observe("info", "voice_log_skipped", { guildId: guild.id, reason: "module_disabled" });
      return;
    }
    const logs = cfg.logs;

    const member = newState.member ?? oldState.member;
    const userId = member?.id ?? newState.id;
    const userTag = member?.user.tag ?? null;
    const who = member ? `${member}` : `<@${userId}>`;

    for (const a of actions) {
      const isState = STATE_ACTIONS.has(a.action);
      // Persist: join/leave/move always; mute/deafen only when the toggle is on.
      if (!isState || logs.voiceState) {
        api
          .postVoiceLogs(guild.id, [
            { userId, userTag, action: a.action, channelId: a.channelId, fromChannelId: a.fromChannelId },
          ])
          .then(() => observe("info", "voice_event_persisted", { guildId: guild.id, action: a.action }))
          .catch(() => observe("error", "voice_log_failed", { guildId: guild.id, action: a.action, reason: "persist_error" }));
      }

      if (!toggleFor(logs, a.action)) {
        observe("info", "voice_log_skipped", { guildId: guild.id, action: a.action, reason: "toggle_off" });
        continue;
      }
      if (!logs.channelId) {
        observe("info", "voice_log_skipped", { guildId: guild.id, action: a.action, reason: "no_channel" });
        continue;
      }
      const outcome = await sendTo(guild, logs.channelId, { embeds: [embedFor(who, a)] });
      if (outcome === "sent") {
        observe("info", "voice_log_sent", { guildId: guild.id, action: a.action });
      } else if (outcome === "failed") {
        observe("error", "voice_log_failed", { guildId: guild.id, action: a.action, reason: "send_error" });
      } else {
        // no_channel already handled above; here: channel_missing | channel_not_text
        observe("warn", "voice_log_skipped", { guildId: guild.id, action: a.action, reason: outcome === "channel_not_text" ? "channel_not_text" : "channel_missing" });
      }
    }
  });
}
