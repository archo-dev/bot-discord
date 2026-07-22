import { Hono, type Context } from "hono";
import type { Env } from "../env.js";
import {
  clearSessionCookie,
  clearOAuthStateCookie,
  createOAuthState,
  createSession,
  deleteSession,
  loadSession,
  readOAuthStateCookie,
  readSessionCookie,
  setSessionCookie,
  setOAuthStateCookie,
  validateOAuthState,
  revokeUserSessions,
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

function oauthErrorPage(c: Context<{ Bindings: Env }>, message: string, status: 400 | 502) {
  return c.html(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion Discord impossible</title></head><body><main><h1>Connexion Discord impossible</h1><p>${message}</p><p><a href="/auth/login">Réessayer la connexion</a></p></main></body></html>`,
    status,
  );
}

export const authRouter = new Hono<{ Bindings: Env }>();

authRouter.get("/auth/login", async (c) => {
  const state = createOAuthState();
  await setOAuthStateCookie(c, state);
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
  const oauthError = c.req.query("error");
  const stateCookie = readOAuthStateCookie(c);
  clearOAuthStateCookie(c);
  const validation = await validateOAuthState(c.env, state, stateCookie);
  if (!validation.ok) {
    console.warn(`oauth state validation failed: reason=${validation.code}`);
    return oauthErrorPage(c, "La demande de connexion a expiré ou n'est plus valide.", 400);
  }
  if (oauthError || !code) {
    return oauthErrorPage(c, "La connexion a été annulée ou refusée par Discord.", 400);
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
    console.error(`oauth token exchange failed: ${tokenRes.status}`);
    return oauthErrorPage(c, "Discord n'a pas pu finaliser la connexion.", 502);
  }
  const token = (await tokenRes.json()) as TokenResponse;

  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) return oauthErrorPage(c, "Le profil Discord n'a pas pu être chargé.", 502);
  const user = (await userRes.json()) as DiscordUser;

  const sessionId = await createSession(c.env, {
    userId: user.id,
    username: user.username,
    globalName: user.global_name,
    avatar: user.avatar,
    accessToken: token.access_token,
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

authRouter.post("/auth/revoke-all", async (c) => {
  const sid = readSessionCookie(c);
  const loaded = sid ? await loadSession(c.env, sid) : { session: null };
  if (!loaded.session) return c.json({ error: "unauthenticated" }, 401);
  await revokeUserSessions(c.env, loaded.session.userId);
  await deleteSession(c.env, sid!);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
