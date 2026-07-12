import { Hono, type Context } from "hono";
import type { Env } from "./env.js";
import { interactionsRouter } from "./interactions/router.js";
import { authRouter } from "./auth/oauth.js";
import { guildsRouter } from "./api/guilds.js";
import { commandsRouter } from "./api/commands.js";
import { moderationRouter } from "./api/moderation.js";
import { ticketsRouter } from "./api/tickets.js";
import { buttonRolesRouter } from "./api/button-roles.js";
import { welcomeRouter } from "./api/welcome.js";
import { automodRouter } from "./api/automod.js";
import { xpRouter } from "./api/xp.js";
import { starboardRouter } from "./api/starboard.js";
import { tempVoiceRouter } from "./api/temp-voice.js";
import { musicRouter } from "./api/music.js";
import { membersRouter } from "./api/members.js";
import { voiceLogsRouter } from "./api/voice-logs.js";
import { statsRouter } from "./api/stats.js";
import { internalRouter } from "./internal/routes.js";
import { blockModeratorWrites, requireGuildAccess, requireSession, type AppContext } from "./auth/guard.js";
import { runScheduled } from "./cron.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", interactionsRouter);
app.route("/", authRouter);
app.route("/", internalRouter);

// Panel API: every route needs a session; every guild-scoped route re-verifies
// the user's real Discord permissions (see auth/guard.ts).
const api = new Hono<AppContext>();
api.use("*", requireSession);
api.use("/guilds/:guildId", requireGuildAccess);
api.use("/guilds/:guildId/*", requireGuildAccess);
// Moderator grants are read-only: every write verb under a guild is 403
// (see auth/guard.ts). GET/HEAD routes stay open to moderators.
api.use("/guilds/:guildId", blockModeratorWrites);
api.use("/guilds/:guildId/*", blockModeratorWrites);
api.route("/", commandsRouter);
api.route("/", moderationRouter);
api.route("/", ticketsRouter);
api.route("/", buttonRolesRouter);
api.route("/", welcomeRouter);
api.route("/", automodRouter);
api.route("/", xpRouter);
api.route("/", starboardRouter);
api.route("/", tempVoiceRouter);
api.route("/", musicRouter);
api.route("/", membersRouter);
api.route("/", voiceLogsRouter);
api.route("/", statsRouter);
api.route("/", guildsRouter);
app.route("/api", api);

// --- Panel static assets (served with correct caching to survive redeploys) ---
// The SPA fallback (not_found_handling) returns index.html for anything missing,
// including deleted /assets/*.js after a redeploy. A browser holding a stale
// index.html would then fetch an old hashed JS, receive HTML, and execute it as
// JS → blank page. So: fingerprinted assets get an immutable long cache and a
// real 404 when absent; the HTML entry point is never cached (no-store) so a
// fresh index.html — with current asset hashes — is fetched on every load.
async function serveIndex(c: Context<{ Bindings: Env }>): Promise<Response> {
  const res = await c.env.ASSETS!.fetch(new Request(new URL("/index.html", c.req.url), c.req.raw));
  const out = new Response(res.body, res);
  out.headers.set("content-type", "text/html; charset=utf-8");
  out.headers.set("cache-control", "no-store");
  return out;
}

app.get("/assets/*", async (c) => {
  const res = await c.env.ASSETS!.fetch(c.req.raw);
  // Missing fingerprinted asset → SPA fallback served HTML; return an honest 404.
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    return c.text("Not found", 404);
  }
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "public, max-age=31536000, immutable");
  return out;
});

app.get("/", (c) => serveIndex(c));
app.get("/index.html", (c) => serveIndex(c));

// Cron trigger (wrangler.jsonc → triggers.crons): daily retention purge.
const scheduled = async (_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> => {
  ctx.waitUntil(runScheduled(env));
};

// Keep the Hono instance as the default export (tests call app.request(...)) but
// attach `scheduled` so the Workers runtime picks up both handlers.
export default Object.assign(app, { scheduled });
