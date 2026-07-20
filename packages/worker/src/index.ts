import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
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
import { healthRouter } from "./api/health.js";
import { auditRouter } from "./api/audit.js";
import { modulesRouter } from "./api/modules.js";
import { onboardingRouter } from "./api/onboarding.js";
import { configBackupRouter } from "./api/config-backup.js";
import { privacyRouter } from "./api/privacy.js";
import { automationsRouter } from "./api/automations.js";
import { subscriptionRouter } from "./api/subscription.js";
import { assignmentsRouter } from "./api/assignments.js";
import { publicRouter } from "./api/public.js";
import { internalRouter } from "./internal/routes.js";
import { enforcePanelMutationPolicy, requireGuildAccess, requireSession, type AppContext } from "./auth/guard.js";
import { runScheduled } from "./cron.js";
import { requestTelemetry, type TelemetryVariables } from "./telemetry/request.js";
import { browserMutationOrigin, securityResponseHeaders } from "./security/browser.js";
import { adminAudit, durablePanelQuota } from "./security/panel.js";

const app = new Hono<{ Bindings: Env; Variables: TelemetryVariables }>();

app.use("*", securityResponseHeaders);
app.use("*", requestTelemetry);
app.use("/api/*", browserMutationOrigin);
app.use("/auth/logout", browserMutationOrigin);
app.use("/auth/revoke-all", browserMutationOrigin);
app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
app.use("/auth/*", bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
app.use("/interactions", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
app.use("/internal/*", bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
app.get("/health", (c) => c.json({ ok: true }));
app.route("/", interactionsRouter);
app.route("/", authRouter);
app.route("/", internalRouter);
// Public landing endpoints — registered before the session-guarded /api sub-app.
app.route("/", publicRouter);

// Panel API: every route needs a session; every guild-scoped route re-verifies
// the user's real Discord permissions (see auth/guard.ts).
const api = new Hono<AppContext>();
api.use("*", requireSession);
api.use("/guilds/:guildId", requireGuildAccess);
api.use("/guilds/:guildId/*", requireGuildAccess);
api.use("/guilds/:guildId", adminAudit);
api.use("/guilds/:guildId/*", adminAudit);
// Moderator grants are read-only: every write verb under a guild is 403
// (see auth/guard.ts). GET/HEAD routes stay open to moderators.
api.use("/guilds/:guildId", enforcePanelMutationPolicy);
api.use("/guilds/:guildId/*", enforcePanelMutationPolicy);
api.use("/guilds/:guildId", durablePanelQuota);
api.use("/guilds/:guildId/*", durablePanelQuota);
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
api.route("/", healthRouter);
api.route("/", auditRouter);
api.route("/", modulesRouter);
api.route("/", onboardingRouter);
api.route("/", configBackupRouter);
api.route("/", privacyRouter);
api.route("/", automationsRouter);
// User-level (not guild-scoped): effective subscription/plan read (M6) and
// server-slot assignments (M7). Mutations re-verify manage_guild in-handler.
api.route("/", subscriptionRouter);
api.route("/", assignmentsRouter);
api.route("/", guildsRouter);
app.route("/api", api);

// --- Panel static assets (served with correct caching to survive redeploys) ---
// The SPA fallback (not_found_handling) returns index.html for anything missing,
// including deleted /assets/*.js after a redeploy. A browser holding a stale
// index.html would then fetch an old hashed JS, receive HTML, and execute it as
// JS → blank page. So: fingerprinted assets get an immutable long cache and a
// real 404 when absent; the HTML entry point is never cached (no-store) so a
// fresh index.html — with current asset hashes — is fetched on every load.
async function serveIndex(c: Context<{ Bindings: Env; Variables: TelemetryVariables }>): Promise<Response> {
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
const scheduled = async (event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> => {
  ctx.waitUntil(runScheduled(env, { purge: event.cron === "23 4 * * *" }));
};

// Keep the Hono instance as the default export (tests call app.request(...)) but
// attach `scheduled` so the Workers runtime picks up both handlers.
export default Object.assign(app, { scheduled });
