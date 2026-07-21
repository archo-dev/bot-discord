import { Hono } from "hono";
import type { Env } from "../env.js";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { isHttpsEnvironment } from "../security/browser.js";
import { requireStudioHost, resolveOperator, type StudioContext } from "./studio-guard.js";
import {
  clearStudioOAuthStateCookie,
  clearStudioSessionCookie,
  consumeStudioOAuthState,
  createStudioOAuthState,
  createStudioSession,
  deleteStudioSession,
  loadStudioSession,
  markStudioStepUp,
  readStudioOAuthStateCookie,
  readStudioSessionCookie,
  setStudioOAuthStateCookie,
  setStudioSessionCookie,
} from "./studio-session.js";

/**
 * Studio OAuth (M12). Same Discord app, but a fully isolated flow: distinct
 * state cookie, distinct callback path, and — crucially — a session is created
 * ONLY when the authenticated user is an eligible operator (owner bootstrap or
 * an `active` row). A non-operator gets 403 and no session (doc 09 §3). Host-gated.
 */

const DISCORD_API = "https://discord.com/api/v10";
const OAUTH_SCOPES = "identify";

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export const studioOAuthRouter = new Hono<StudioContext>();

studioOAuthRouter.use("/studio/auth/*", requireStudioHost);

function studioOrigin(env: Env): string {
  return `https://${env.STUDIO_HOST}`;
}

studioOAuthRouter.get("/studio/auth/login", async (c) => {
  const state = await createStudioOAuthState(c.env);
  setStudioOAuthStateCookie(c, state);
  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: `${studioOrigin(c.env)}/studio/auth/callback`,
    response_type: "code",
    scope: OAUTH_SCOPES,
    state,
  });
  return c.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

studioOAuthRouter.get("/studio/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stateCookie = readStudioOAuthStateCookie(c);
  clearStudioOAuthStateCookie(c);
  if (!code || !state || !(await consumeStudioOAuthState(c.env, state, stateCookie))) {
    return c.text("Invalid OAuth state. Please retry from the Studio login page.", 400);
  }

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${studioOrigin(c.env)}/studio/auth/callback`,
    }),
  });
  if (!tokenRes.ok) {
    console.error(`studio oauth token exchange failed: ${tokenRes.status}`);
    return c.text("Discord token exchange failed. Please retry.", 502);
  }
  const token = (await tokenRes.json()) as TokenResponse;

  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) return c.text("Failed to fetch your Discord profile.", 502);
  const user = (await userRes.json()) as DiscordUser;

  // Server-side gate: no session unless the user is an eligible operator.
  const operator = await resolveOperator(c.env, user.id);
  if (!operator) return c.text("This account is not a Studio operator.", 403);

  const sessionId = await createStudioSession(c.env, {
    userId: user.id,
    username: user.username,
    globalName: user.global_name,
    avatar: user.avatar,
    tokenExpiresAt: Date.now() + token.expires_in * 1000,
    createdAt: Date.now(),
  });
  setStudioSessionCookie(c, sessionId);
  return c.redirect(`${studioOrigin(c.env)}/`);
});

studioOAuthRouter.post("/studio/auth/logout", async (c) => {
  const sid = readStudioSessionCookie(c);
  if (sid) await deleteStudioSession(c.env, sid);
  clearStudioSessionCookie(c);
  return c.json({ ok: true });
});

// --- Step-up: OAuth re-consent (prompt=consent) that stamps the CURRENT session
// with a fresh stepUpAt, gating sensitive actions like lifetime grants (M14). ---

const STEPUP_STATE_COOKIE = "studio_stepup_state";

studioOAuthRouter.get("/studio/auth/step-up", async (c) => {
  const sid = readStudioSessionCookie(c);
  if (!sid) return c.text("No studio session.", 401);
  const state = await createStudioOAuthState(c.env);
  setCookie(c, STEPUP_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isHttpsEnvironment(c.env),
    sameSite: "Lax",
    path: "/studio/auth/step-up/callback",
    maxAge: 300,
  });
  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: `${studioOrigin(c.env)}/studio/auth/step-up/callback`,
    response_type: "code",
    scope: OAUTH_SCOPES,
    prompt: "consent",
    state,
  });
  return c.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

studioOAuthRouter.get("/studio/auth/step-up/callback", async (c) => {
  const sid = readStudioSessionCookie(c);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stateCookie = getCookie(c, STEPUP_STATE_COOKIE);
  deleteCookie(c, STEPUP_STATE_COOKIE, { path: "/studio/auth/step-up/callback" });
  if (!sid || !code || !state || !(await consumeStudioOAuthState(c.env, state, stateCookie))) {
    return c.text("Invalid step-up state. Please retry.", 400);
  }

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${studioOrigin(c.env)}/studio/auth/step-up/callback`,
    }),
  });
  if (!tokenRes.ok) return c.text("Discord token exchange failed. Please retry.", 502);
  const token = (await tokenRes.json()) as TokenResponse;

  const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!userRes.ok) return c.text("Failed to fetch your Discord profile.", 502);
  const user = (await userRes.json()) as DiscordUser;

  // The re-consent must be the SAME operator as the current session (no cross-user step-up).
  const { session } = await loadStudioSession(c.env, sid);
  if (!session || session.userId !== user.id) return c.text("Step-up does not match the current session.", 403);
  const operator = await resolveOperator(c.env, user.id);
  if (!operator) return c.text("This account is not a Studio operator.", 403);
  await markStudioStepUp(c.env, sid);
  return c.redirect(`${studioOrigin(c.env)}/`);
});
