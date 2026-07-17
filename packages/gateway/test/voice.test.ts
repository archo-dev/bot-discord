import { describe, expect, it, vi } from "vitest";
import type { Client, VoiceState } from "discord.js";
import { registerVoice } from "../src/voice.js";
import type { ConfigCache } from "../src/config-cache.js";
import type { GuildGatewayConfig, WorkerApi } from "../src/worker-api.js";

type VoiceHandler = (oldState: VoiceState, newState: VoiceState) => Promise<void>;

function fullConfig(overrides: {
  moduleEnabled?: boolean;
  channelId?: string | null;
  voiceJoin?: boolean;
  voiceLeave?: boolean;
  voiceMove?: boolean;
  voiceState?: boolean;
} = {}): GuildGatewayConfig {
  return {
    governanceVersion: 1,
    modules: { voice_logs: { enabled: overrides.moduleEnabled ?? true, configVersion: 1 } },
    id: "100000000000000001",
    logChannelId: null,
    warnThreshold: 3,
    warnTimeoutMinutes: 10,
    mentionCards: false,
    autoRoles: [],
    welcome: {
      welcomeEnabled: false,
      welcomeChannelId: null,
      welcomeMessage: "",
      leaveEnabled: false,
      leaveChannelId: null,
      leaveMessage: "",
    },
    logs: {
      channelId: overrides.channelId === undefined ? "100000000000000500" : overrides.channelId,
      memberJoin: false,
      memberLeave: false,
      messageDelete: false,
      messageEdit: false,
      memberUpdate: false,
      voiceJoin: overrides.voiceJoin ?? true,
      voiceLeave: overrides.voiceLeave ?? true,
      voiceMove: overrides.voiceMove ?? true,
      voiceState: overrides.voiceState ?? true,
    },
    automod: {
      antiSpamEnabled: false,
      antiSpamMaxMessages: 5,
      antiSpamWindowSeconds: 5,
      antiInviteEnabled: false,
      antiLinkEnabled: false,
      linkWhitelist: [],
      bannedWords: [],
      exemptRoleIds: [],
      exemptChannelIds: [],
      action: "delete",
      timeoutMinutes: 10,
    },
    xp: { enabled: false, cooldownSeconds: 60, voiceEnabled: false },
    starboard: { enabled: false, channelId: null, threshold: 3, emoji: "⭐" },
    tempVoice: { enabled: false, lobbyChannelId: null, categoryId: null, nameTemplate: "{user}", userLimit: 0, maxChannels: 10 },
  };
}

interface Harness {
  emit: VoiceHandler;
  send: ReturnType<typeof vi.fn>;
  postVoiceLogs: ReturnType<typeof vi.fn>;
  state: (channelId: string | null, flags?: Partial<Pick<VoiceState, "selfMute" | "serverMute" | "selfDeaf" | "serverDeaf">>) => VoiceState;
}

function harness(options: {
  config?: GuildGatewayConfig | null;
  configRejects?: boolean;
  channelExists?: boolean;
  sendFails?: boolean;
} = {}): Harness {
  const send = vi.fn(options.sendFails ? async () => { throw new Error("Missing Permissions"); } : async () => ({}));
  const logChannel = { isTextBased: () => true, send };
  const channelExists = options.channelExists ?? true;
  const guild = {
    id: "100000000000000001",
    channels: {
      cache: { get: (id: string) => (channelExists && id === "100000000000000500" ? logChannel : undefined) },
      fetch: async () => {
        if (!channelExists) throw new Error("Unknown Channel");
        return logChannel;
      },
    },
  };
  const member = { id: "100000000000000042", user: { tag: "user#0" }, toString: () => "<@100000000000000042>" };

  let handler: VoiceHandler | undefined;
  const client = {
    on: (event: string, fn: VoiceHandler) => {
      if (event === "voiceStateUpdate") handler = fn;
    },
  } as unknown as Client;

  const cache = {
    get: options.configRejects
      ? vi.fn(async () => { throw new Error("worker request failed with status 500"); })
      : vi.fn(async () => options.config === undefined ? fullConfig() : options.config),
    invalidate: vi.fn(),
  } as unknown as ConfigCache;

  const postVoiceLogs = vi.fn(async () => {});
  const api = { postVoiceLogs } as unknown as WorkerApi;

  registerVoice(client, cache, api);
  if (!handler) throw new Error("voiceStateUpdate handler was not registered");

  const state: Harness["state"] = (channelId, flags = {}) =>
    ({
      guild,
      id: member.id,
      channelId,
      member,
      selfMute: flags.selfMute ?? false,
      serverMute: flags.serverMute ?? false,
      selfDeaf: flags.selfDeaf ?? false,
      serverDeaf: flags.serverDeaf ?? false,
    }) as unknown as VoiceState;

  return { emit: handler, send, postVoiceLogs, state };
}

function sentDescriptions(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls.map((call) => (call[0] as { embeds: Array<{ data: { description: string } }> }).embeds[0]!.data.description);
}

describe("voice logs (M17) — flux VoiceStateUpdate complet", () => {
  it("logs a join to the configured channel and persists it", async () => {
    const h = harness();
    await h.emit(h.state(null), h.state("100000000000000200"));
    expect(sentDescriptions(h.send)).toEqual(["🔊 <@100000000000000042> a rejoint <#100000000000000200>"]);
    expect(h.postVoiceLogs).toHaveBeenCalledWith("100000000000000001", [
      expect.objectContaining({ action: "join", channelId: "100000000000000200", fromChannelId: null }),
    ]);
  });

  it("logs a leave", async () => {
    const h = harness();
    await h.emit(h.state("100000000000000200"), h.state(null));
    expect(sentDescriptions(h.send)).toEqual(["🔴 <@100000000000000042> a quitté <#100000000000000200>"]);
    expect(h.postVoiceLogs).toHaveBeenCalledWith("100000000000000001", [
      expect.objectContaining({ action: "leave", channelId: "100000000000000200" }),
    ]);
  });

  it("logs a move as a single entry", async () => {
    const h = harness();
    await h.emit(h.state("100000000000000200"), h.state("100000000000000300"));
    expect(sentDescriptions(h.send)).toEqual(["➡️ <@100000000000000042> : <#100000000000000200> → <#100000000000000300>"]);
    expect(h.postVoiceLogs).toHaveBeenCalledTimes(1);
    expect(h.postVoiceLogs).toHaveBeenCalledWith("100000000000000001", [
      expect.objectContaining({ action: "move", channelId: "100000000000000300", fromChannelId: "100000000000000200" }),
    ]);
  });

  it("logs server mute and unmute", async () => {
    const h = harness();
    await h.emit(h.state("100000000000000200"), h.state("100000000000000200", { serverMute: true }));
    await h.emit(h.state("100000000000000200", { serverMute: true }), h.state("100000000000000200"));
    expect(sentDescriptions(h.send)).toEqual([
      "🔇 <@100000000000000042> s'est mis en muet dans <#100000000000000200>",
      "🎙️ <@100000000000000042> n'est plus en muet dans <#100000000000000200>",
    ]);
    expect(h.postVoiceLogs).toHaveBeenNthCalledWith(1, "100000000000000001", [expect.objectContaining({ action: "mute" })]);
    expect(h.postVoiceLogs).toHaveBeenNthCalledWith(2, "100000000000000001", [expect.objectContaining({ action: "unmute" })]);
  });

  it("logs server deafen and undeafen", async () => {
    const h = harness();
    await h.emit(h.state("100000000000000200"), h.state("100000000000000200", { serverDeaf: true }));
    await h.emit(h.state("100000000000000200", { serverDeaf: true }), h.state("100000000000000200"));
    expect(sentDescriptions(h.send)).toEqual([
      "🔇 <@100000000000000042> a coupé son casque dans <#100000000000000200>",
      "🔊 <@100000000000000042> a réactivé son casque dans <#100000000000000200>",
    ]);
  });

  it("does not send an embed when no log channel is configured (but still persists join/leave/move)", async () => {
    const h = harness({ config: fullConfig({ channelId: null }) });
    await h.emit(h.state(null), h.state("100000000000000200"));
    expect(h.send).not.toHaveBeenCalled();
    expect(h.postVoiceLogs).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the voice_logs module is disabled", async () => {
    const h = harness({ config: fullConfig({ moduleEnabled: false }) });
    await h.emit(h.state(null), h.state("100000000000000200"));
    expect(h.send).not.toHaveBeenCalled();
    expect(h.postVoiceLogs).not.toHaveBeenCalled();
  });

  it("respects the per-event embed toggles", async () => {
    const h = harness({ config: fullConfig({ voiceJoin: false, voiceState: false }) });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await h.emit(h.state("100000000000000200"), h.state("100000000000000200", { serverMute: true }));
    expect(h.send).not.toHaveBeenCalled();
    // join always persisted; mute persisted only when the voice-state toggle is on
    expect(h.postVoiceLogs).toHaveBeenCalledTimes(1);
    expect(h.postVoiceLogs).toHaveBeenCalledWith("100000000000000001", [expect.objectContaining({ action: "join" })]);
  });

  it("does not crash when the configured channel no longer exists", async () => {
    const h = harness({ channelExists: false });
    await expect(h.emit(h.state(null), h.state("100000000000000200"))).resolves.toBeUndefined();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("does not crash when the bot lacks permission to send", async () => {
    const h = harness({ sendFails: true });
    await expect(h.emit(h.state(null), h.state("100000000000000200"))).resolves.toBeUndefined();
    expect(h.send).toHaveBeenCalledTimes(1); // attempted, failure swallowed by sendTo
  });

  it("does nothing when the config fetch fails", async () => {
    const h = harness({ configRejects: true });
    await expect(h.emit(h.state(null), h.state("100000000000000200"))).resolves.toBeUndefined();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.postVoiceLogs).not.toHaveBeenCalled();
  });

  it("stays enabled for a pre-M03 worker response without modules map (dual-read)", async () => {
    const legacy = fullConfig();
    delete (legacy as { modules?: unknown }).modules;
    const h = harness({ config: legacy });
    await h.emit(h.state(null), h.state("100000000000000200"));
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});
