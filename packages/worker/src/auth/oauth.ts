import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  clearSessionCookie,
  consumeOAuthState,
  createOAuthState,
  createSession,
  deleteSession,
  readSessionCookie,
  setSessionCookie,
} from "./session.js";

const DISCORD_API = "https://discord.com/api/v10";
const OAUTH_SCOPES = "identify guilds";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export const authRouter = new Hono<{ Bindings: Env }>();

authRouter.get("/auth/login", async (c) => {
  const state = await createOAuthState(c.env);
  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: `${c.env.PANEL_ORIGIN}/auth/callback`,
    response_type: "code",
    scope: OAUTH_SCOPES,
    state,
  });
  return c.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

authRouter.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state || !(await consumeOAuthState(c.env, state))) {
    return c.text("Invalid OAuth state. Please retry from the login page.", 400);
  }

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${c.env.PANEL_ORIGIN}/auth/callback`,
    }),
  });
  if (!tokenRes.ok) {
    console.error(`oauth token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    return c.text("Discord token exchange failed. Please retry.", 502);
  }
  const token = (await tokenRes.json()) as TokenResponse;

  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) return c.text("Failed to fetch your Discord profile.", 502);
  const user = (await userRes.json()) as DiscordUser;

  const sessionId = await createSession(c.env, {
    userId: user.id,
    username: user.username,
    globalName: user.global_name,
    avatar: user.avatar,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: Date.now() + token.expires_in * 1000,
    createdAt: Date.now(),
  });
  setSessionCookie(c, sessionId);
  return c.redirect(`${c.env.PANEL_ORIGIN}/`);
});

authRouter.post("/auth/logout", async (c) => {
  const sid = readSessionCookie(c);
  if (sid) await deleteSession(c.env, sid);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
