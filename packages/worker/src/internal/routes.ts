import { Hono } from "hono";
import type { Env } from "../env.js";
import { internalMusicRouter } from "./music.js";
import { internalStatsRouter } from "./stats.js";
import { internalConfigRouter } from "./config.js";
import { internalXpRouter } from "./xp.js";
import { internalStarboardRouter } from "./starboard.js";
import { internalModerationRouter } from "./moderation.js";
import { internalGuildsRouter } from "./guilds.js";
import { internalTempVoiceRouter } from "./temp-voice.js";
import { internalEventsRouter } from "./events.js";
import { internalAuthentication } from "../security/internal-auth.js";

/**
 * Internal API for the always-on Gateway service (Option B).
 * Bearer-token-guarded from day one so the gateway lands without Worker
 * changes. Contract documented in the README. Les routes vivent dans les
 * sous-routeurs par thème (music, stats, config, xp, starboard, moderation) ;
 * le middleware d'auth ci-dessous couvre toutes les routes montées.
 */
export const internalRouter = new Hono<{ Bindings: Env }>();

internalRouter.use("/internal/*", internalAuthentication);

internalRouter.route("/", internalMusicRouter);
internalRouter.route("/", internalStatsRouter);
internalRouter.route("/", internalConfigRouter);
internalRouter.route("/", internalXpRouter);
internalRouter.route("/", internalStarboardRouter);
internalRouter.route("/", internalModerationRouter);
internalRouter.route("/", internalGuildsRouter);
internalRouter.route("/", internalTempVoiceRouter);
internalRouter.route("/", internalEventsRouter);
