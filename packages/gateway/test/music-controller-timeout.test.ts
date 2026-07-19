import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { DisTube } from "distube";
import type { MusicCommandPayload } from "@bot/shared";
import { MusicController } from "../src/music/controller.js";
import type { WorkerApi } from "../src/worker-api.js";

/** Builds a controller whose distube.play() never resolves (stuck extraction). */
function stuckController() {
  const member = { voice: { channel: { id: "vc1", guild: { id: "g1" } } } };
  const guild = { id: "g1", members: { fetch: vi.fn().mockResolvedValue(member) } };
  const textChannel = { id: "t1", isTextBased: () => true, isDMBased: () => false };
  const client = {
    guilds: { cache: { get: () => guild }, fetch: vi.fn().mockResolvedValue(guild) },
    channels: { cache: { get: () => textChannel }, fetch: vi.fn().mockResolvedValue(textChannel) },
  } as unknown as Client;
  const otherQueue = { stop: vi.fn() };
  const distube = {
    play: vi.fn(() => new Promise<void>(() => {})), // never settles
    getQueue: vi.fn((guildId: string) => (guildId === "g2" ? otherQueue : undefined)),
    voices: { get: vi.fn(() => undefined), leave: vi.fn() },
  } as unknown as DisTube;
  const api = { postMusicState: vi.fn().mockResolvedValue(undefined) } as unknown as WorkerApi;
  return { controller: new MusicController(client, distube, api), distube, otherQueue };
}

const basePayload: MusicCommandPayload = {
  command: "play",
  guildId: "g1",
  userId: "u1",
  textChannelId: "t1",
  applicationId: "app",
  token: "tok",
  arg: "https://youtu.be/dQw4w9WgXcQ",
  source: "interaction",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MusicController — extraction timeout", () => {
  it("resolves handle() with a user-facing message and edits the interaction (no pending promise)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const { controller, distube, otherQueue } = stuckController();
    const handled = controller.handle(basePayload);

    // Let the awaits before play() flush, then trip the 40s timeout.
    await vi.advanceTimersByTimeAsync(41_000);
    const result = await handled;

    expect(distube.play).toHaveBeenCalledOnce();
    expect(otherQueue.stop).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/trop de temps/i);
    // The interaction webhook was edited → Discord no longer stuck on "thinking".
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/webhooks/app/tok/messages/@original");
    expect(init).toMatchObject({ method: "PATCH" });

    const events = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "music_cleanup",
        reason: "blocked_playback",
        intentional: true,
      }),
    );
  });
});
