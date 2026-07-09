import { Hono } from "hono";
import type { Env } from "./env.js";
import { interactionsRouter } from "./interactions/router.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", interactionsRouter);

export default app;
