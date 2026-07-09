import { Hono } from "hono";
import type { Env } from "./env.js";
import { interactionsRouter } from "./interactions/router.js";
import { authRouter } from "./auth/oauth.js";
import { guildsRouter } from "./api/guilds.js";
import { commandsRouter } from "./api/commands.js";
import { requireGuildAccess, requireSession, type AppContext } from "./auth/guard.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", interactionsRouter);
app.route("/", authRouter);

// Panel API: every route needs a session; every guild-scoped route re-verifies
// the user's real Discord permissions (see auth/guard.ts).
const api = new Hono<AppContext>();
api.use("*", requireSession);
api.use("/guilds/:guildId", requireGuildAccess);
api.use("/guilds/:guildId/*", requireGuildAccess);
api.route("/", commandsRouter);
api.route("/", guildsRouter);
app.route("/api", api);

export default app;
