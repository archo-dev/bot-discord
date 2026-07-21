import { Hono } from "hono";
import type { AccountResponse } from "@bot/shared";
import type { AppContext } from "../auth/guard.js";

/**
 * User-level account read (M8): the signed-in user's profile + current session
 * metadata. Session-scoped (never another user's data), read-only, and never
 * exposes the Discord access token or any secret. No D1, no billing.
 */
export const accountRouter = new Hono<AppContext>();

accountRouter.get("/account", (c) => {
  const s = c.get("session");
  const body: AccountResponse = {
    id: s.userId,
    username: s.username,
    globalName: s.globalName,
    avatar: s.avatar,
    session: {
      createdAt: new Date(s.createdAt).toISOString(),
      lastSeenAt: new Date(s.lastSeenAt).toISOString(),
      expiresAt: new Date(s.absoluteExpiresAt).toISOString(),
    },
  };
  return c.json(body);
});
