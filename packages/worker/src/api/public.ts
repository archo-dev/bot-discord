import { Hono } from "hono";
import type { Env } from "../env.js";
import { buildInvite } from "./onboarding.js";

/**
 * Unauthenticated, read-only endpoints for the public landing page. Mounted on the
 * root app (outside the session-guarded /api sub-app). No secrets: the invite only
 * exposes the public client id and the minimal permission bitfield.
 */
export const publicRouter = new Hono<{ Bindings: Env }>();

publicRouter.get("/api/invite", (c) => c.json(buildInvite(c.env)));
