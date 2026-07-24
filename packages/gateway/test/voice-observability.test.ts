import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, VoiceState } from "discord.js";
import { registerVoice } from "../src/voice.js";
import type { ConfigCache } from "../src/config-cache.js";
import type { GuildGatewayConfig, WorkerApi } from "../src/worker-api.js";

const GUILD = "100000000000000001";
const LOG_CHANNEL = "100000000000000500";

function config(overrides: { moduleEnabled?: boolean; channelId?: string | null; voiceJoin?: boolean } = {}): GuildGatewayConfig {
  return {
    governanceVersion: 1,
    modules: { voice_logs: { enabled: overrides.moduleEnabled ?? true, configVersion: 1 } },
    id: GUILD,
    logChannelId: null,
    warnThreshold: 3,
    warnTimeoutMinutes: 10,
    mentionCards: false,
    autoRoles: [],
    welcome: { welcomeEnabled: false, welcomeChannelId: null, welcomeMessage: "", leaveEnabled: false, leaveChannelId: null, leaveMessage: "" },
    logs: {
      channelId: overrides.channelId === undefined ? LOG_CHANNEL : overrides.channelId,
      memberJoin: false, memberLeave: false, messageDelete: false, messageEdit: false, memberUpdate: false,
      voiceJoin: overrides.voiceJoin ?? true, voiceLeave: true, voiceMove: true, voiceState: true,
    },
    automod: {
      antiSpamEnabled: false, antiSpamMaxMessages: 5, antiSpamWindowSeconds: 5, antiInviteEnabled: false, antiLinkEnabled: false,
      linkWhitelist: [], bannedWords: [], exemptRoleIds: [], exemptChannelIds: [], action: "delete", timeoutMinutes: 10,
    },
    xp: { enabled: false, cooldownSeconds: 60, voiceEnabled: false },
    starboard: { enabled: false, channelId: null, threshold: 3, emoji: "⭐" },
    tempVoice: { enabled: false, lobbyChannelId: null, categoryId: null, nameTemplate: "{user}", userLimit: 0, maxChannels: 10 },
  };
}

type VoiceHandler = (oldState: VoiceState, newState: VoiceState) => Promise<void>;

function harness(options: { config?: GuildGatewayConfig | null; channelExists?: boolean; sendFails?: boolean; persistFails?: boolean } = {}): {
  emit: VoiceHandler;
  state: (channelId: string | null) => VoiceState;
} {
  const send = vi.fn(options.sendFails ? async () => { throw new Error("Missing Permissions"); } : async () => ({}));
  const logChannel = { isTextBased: () => true, send };
  const channelExists = options.channelExists ?? true;
  const guild = {
    id: GUILD,
    channels: {
      cache: { get: (id: string) => (channelExists && id === LOG_CHANNEL ? logChannel : undefined) },
      fetch: async () => (channelExists ? logChannel : null),
    },
  };
  const member = { id: "100000000000000042", user: { tag: "user#0" }, toString: () => "<@100000000000000042>" };

  let handler: VoiceHandler | undefined;
  const client = { on: (event: string, fn: VoiceHandler) => { if (event === "voiceStateUpdate") handler = fn; } } as unknown as Client;
  const cache = { get: vi.fn(async () => (options.config === undefined ? config() : options.config)), invalidate: vi.fn() } as unknown as ConfigCache;
  const postVoiceLogs = vi.fn(options.persistFails ? async () => { throw new Error("worker 500"); } : async () => {});
  const api = { postVoiceLogs } as unknown as WorkerApi;

  registerVoice(client, cache, api);
  if (!handler) throw new Error("handler not registered");
  const state = (channelId: string | null) => ({ guild, id: member.id, channelId, member, selfMute: false, serverMute: false, selfDeaf: false, serverDeaf: false }) as unknown as VoiceState;
  return { emit: handler, state };
}

interface ObsLine { event: string; action?: string; reason?: string }
let lines: ObsLine[];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

function hook(method: "log" | "warn" | "error") {
  spies.push(vi.spyOn(console, method).mockImplementation((arg?: unknown) => {
    if (typeof arg === "string") {
      try {
        const parsed = JSON.parse(arg) as { source?: string; event?: string; action?: string; reason?: string };
        if (parsed.source === "gateway" && parsed.event) lines.push({ event: parsed.event, action: parsed.action, reason: parsed.reason });
      } catch { /* not our JSON line */ }
    }
  }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const events = () => lines.map((l) => l.event);

beforeEach(() => { lines = []; hook("log"); hook("warn"); hook("error"); });
afterEach(() => { for (const s of spies) s.mockRestore(); spies.length = 0; });

describe("observabilité vocale bornée", () => {
  it("join réussi → received + persisted + sent, sans contenu utilisateur", async () => {
    const h = harness();
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(events()).toEqual(expect.arrayContaining(["voice_event_received", "voice_event_persisted", "voice_log_sent"]));
    // Aucune ligne ne doit contenir de pseudo/contenu : seuls des champs allowlistés.
    for (const l of lines) expect(Object.keys(l).every((k) => ["event", "action", "reason"].includes(k))).toBe(true);
  });

  it("module désactivé → skipped(module_disabled), ni persist ni send", async () => {
    const h = harness({ config: config({ moduleEnabled: false }) });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(lines).toContainEqual({ event: "voice_event_received", action: undefined, reason: undefined });
    expect(lines).toContainEqual({ event: "voice_log_skipped", action: undefined, reason: "module_disabled" });
    expect(events()).not.toContain("voice_event_persisted");
    expect(events()).not.toContain("voice_log_sent");
  });

  it("config absente → skipped(config_missing)", async () => {
    const h = harness({ config: null });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(lines).toContainEqual({ event: "voice_log_skipped", action: undefined, reason: "config_missing" });
  });

  it("toggle désactivé → persisté mais embed skipped(toggle_off)", async () => {
    const h = harness({ config: config({ voiceJoin: false }) });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(events()).toContain("voice_event_persisted"); // join toujours persisté
    expect(lines).toContainEqual({ event: "voice_log_skipped", action: "join", reason: "toggle_off" });
    expect(events()).not.toContain("voice_log_sent");
  });

  it("aucun salon configuré → skipped(no_channel)", async () => {
    const h = harness({ config: config({ channelId: null }) });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(lines).toContainEqual({ event: "voice_log_skipped", action: "join", reason: "no_channel" });
  });

  it("salon absent → skipped(channel_missing)", async () => {
    const h = harness({ channelExists: false });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(lines).toContainEqual({ event: "voice_log_skipped", action: "join", reason: "channel_missing" });
  });

  it("permission manquante à l'envoi → voice_log_failed(send_error)", async () => {
    const h = harness({ sendFails: true });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(lines).toContainEqual({ event: "voice_log_failed", action: "join", reason: "send_error" });
  });

  it("échec de persistance D1 → voice_log_failed(persist_error)", async () => {
    const h = harness({ persistFails: true });
    await h.emit(h.state(null), h.state("100000000000000200"));
    await flush();
    expect(lines).toContainEqual({ event: "voice_log_failed", action: "join", reason: "persist_error" });
  });
});
