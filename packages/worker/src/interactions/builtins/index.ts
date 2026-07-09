import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import type { Env } from "../../env.js";
import { pingHandler } from "./ping.js";
import {
  banHandler,
  clearHandler,
  historyHandler,
  kickHandler,
  muteHandler,
  unbanHandler,
  warnHandler,
  warningsHandler,
} from "./moderation.js";
import { leaderboardHandler, rankHandler } from "./xp.js";
import {
  loopHandler,
  nowplayingHandler,
  pauseHandler,
  playHandler,
  playlistHandler,
  queueHandler,
  removeHandler,
  resumeHandler,
  seekHandler,
  shuffleHandler,
  skipHandler,
  stopHandler,
  volumeHandler,
} from "./music.js";

export interface BuiltinContext {
  env: Env;
  interaction: APIChatInputApplicationCommandInteraction;
  /** Schedule work to run after the (deferred) response is returned. */
  waitUntil: (promise: Promise<unknown>) => void;
}

export type BuiltinHandler = (ctx: BuiltinContext) => Promise<Response>;

/** Registry of built-in slash commands. */
export const builtins: Record<string, BuiltinHandler> = {
  ping: pingHandler,
  ban: banHandler,
  unban: unbanHandler,
  kick: kickHandler,
  mute: muteHandler,
  warn: warnHandler,
  warnings: warningsHandler,
  history: historyHandler,
  clear: clearHandler,
  rank: rankHandler,
  leaderboard: leaderboardHandler,
  play: playHandler,
  pause: pauseHandler,
  resume: resumeHandler,
  skip: skipHandler,
  stop: stopHandler,
  queue: queueHandler,
  remove: removeHandler,
  shuffle: shuffleHandler,
  loop: loopHandler,
  volume: volumeHandler,
  seek: seekHandler,
  nowplaying: nowplayingHandler,
  playlist: playlistHandler,
};
