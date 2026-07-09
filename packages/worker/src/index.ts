import { Hono } from "hono";
import type { Env } from "./env.js";
import { interactionsRouter } from "./interactions/router.js";
import { authRouter } from "./auth/oauth.js";
import { guildsRouter } from "./api/guilds.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", interactionsRouter);
app.route("/", authRouter);
app.route("/api", guildsRouter);

export default app;
