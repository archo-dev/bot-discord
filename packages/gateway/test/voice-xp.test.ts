import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { registerVoiceXp } from "../src/voice-xp.js";
import type { ConfigCache } from "../src/config-cache.js";
import type { GuildGatewayConfig, WorkerApi } from "../src/worker-api.js";

const GUILD = "100000000000000001";
const CH = "100000000000000200";
const AFK = "100000000000000999";

interface FakeMember {
  id: string;
  bot?: boolean;
  selfMute?: boolean;
  selfDeaf?: boolean;
  serverMute?: boolean;
  serverDeaf?: boolean;
}

function config(over: { voiceEnabled?: boolean; levelsModule?: boolean } = {}): GuildGatewayConfig {
  return {
    modules: { levels: { enabled: over.levelsModule ?? true, configVersion: 1 } },
    id: GUILD,
    logChannelId: null,
    warnThreshold: 3,
    warnTimeoutMinutes: 10,
    mentionCards: false,
    autoRoles: [],
    welcome: { welcomeEnabled: false, welcomeChannelId: null, welcomeMessage: "", leaveEnabled: false, leaveChannelId: null, leaveMessage: "" },
    logs: { channelId: null, memberJoin: false, memberLeave: false, messageDelete: false, messageEdit: false, memberUpdate: false, voiceJoin: false, voiceLeave: false, voiceMove: false, voiceState: false },
    automod: { antiSpamEnabled: false, antiSpamMaxMessages: 5, antiSpamWindowSeconds: 5, antiInviteEnabled: false, antiLinkEnabled: false, linkWhitelist: [], bannedWords: [], exemptRoleIds: [], exemptChannelIds: [], action: "delete", timeoutMinutes: 10 },
    xp: { enabled: true, cooldownSeconds: 60, voiceEnabled: over.voiceEnabled ?? true },
    starboard: { enabled: false, channelId: null, threshold: 3, emoji: "⭐" },
    tempVoice: { enabled: false, lobbyChannelId: null, categoryId: null, nameTemplate: "{user}", userLimit: 0, maxChannels: 10 },
  } as unknown as GuildGatewayConfig;
}

/** Builds a fake discord.js client with a single guild and one voice channel. */
function harness(members: FakeMember[], opts: { config?: GuildGatewayConfig | null; channelId?: string; afkChannelId?: string | null } = {}) {
  const memberObjs = members.map((m) => ({
    id: m.id,
    user: { bot: Boolean(m.bot), username: `user${m.id}` },
    voice: { selfMute: Boolean(m.selfMute), selfDeaf: Boolean(m.selfDeaf), serverMute: Boolean(m.serverMute), serverDeaf: Boolean(m.serverDeaf) },
  }));
  const channel = {
    id: opts.channelId ?? CH,
    isVoiceBased: () => true,
    members: { values: () => memberObjs.values() },
  };
  const guild = {
    id: GUILD,
    afkChannelId: opts.afkChannelId === undefined ? AFK : opts.afkChannelId,
    channels: { cache: { values: () => [channel].values() } },
  };
  const client = { guilds: { cache: { values: () => [guild].values() } } } as unknown as Client;

  const postVoiceXp = vi.fn(async () => {});
  const api = { postVoiceXp } as unknown as WorkerApi;
  const cache = { get: vi.fn(async () => (opts.config === undefined ? config() : opts.config)) } as unknown as ConfigCache;

  registerVoiceXp(client, cache, api);
  return { postVoiceXp };
}

/** IDs the guild would be granted XP for on the next tick. */
async function granted(postVoiceXp: ReturnType<typeof vi.fn>): Promise<string[]> {
  await vi.advanceTimersByTimeAsync(60_000);
  const ids: string[] = [];
  for (const call of postVoiceXp.mock.calls) {
    for (const e of call[1] as Array<{ userId: string }>) ids.push(e.userId);
  }
  return ids.sort();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("voice-xp tick — éligibilité anti-farm", () => {
  it("un membre seul : aucune XP", async () => {
    const h = harness([{ id: "1" }]);
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("deux humains actifs : les deux gagnent", async () => {
    const h = harness([{ id: "1" }, { id: "2" }]);
    expect(await granted(h.postVoiceXp)).toEqual(["1", "2"]);
  });

  it("un membre + un bot : aucune XP", async () => {
    const h = harness([{ id: "1" }, { id: "2", bot: true }]);
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("A actif + B deaf : personne ne gagne (A seul humain actif)", async () => {
    const h = harness([{ id: "A" }, { id: "B", selfDeaf: true }]);
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("un membre se mute : les autres redeviennent seuls et sont exclus", async () => {
    const h = harness([{ id: "1" }, { id: "2", selfMute: true }]);
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("trois humains, l'un serverMute : les deux actifs gagnent", async () => {
    const h = harness([{ id: "1" }, { id: "2" }, { id: "3", serverMute: true }]);
    expect(await granted(h.postVoiceXp)).toEqual(["1", "2"]);
  });

  it("salon AFK : aucune XP même avec plusieurs actifs", async () => {
    const h = harness([{ id: "1" }, { id: "2" }], { channelId: AFK });
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("module Niveaux désactivé : aucune XP", async () => {
    const h = harness([{ id: "1" }, { id: "2" }], { config: config({ levelsModule: false }) });
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("voice XP désactivé : aucune XP", async () => {
    const h = harness([{ id: "1" }, { id: "2" }], { config: config({ voiceEnabled: false }) });
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("config absente : aucune XP, pas de crash", async () => {
    const h = harness([{ id: "1" }, { id: "2" }], { config: null });
    expect(await granted(h.postVoiceXp)).toEqual([]);
  });

  it("serverDeaf exclut le membre concerné", async () => {
    const h = harness([{ id: "1" }, { id: "2", serverDeaf: true }, { id: "3" }]);
    expect(await granted(h.postVoiceXp)).toEqual(["1", "3"]);
  });
});
