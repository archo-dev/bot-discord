import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "../env.js";
import { requireStudioHost, resolveOperator, studioMutationOrigin, type StudioContext } from "./studio-guard.js";
import {
  clearStudioOAuthStateCookie,
  clearStudioSessionCookie,
  clearStudioStepUpStateCookie,
  createStudioOAuthState,
  createStudioSession,
  deleteStudioSession,
  loadStudioSession,
  markStudioStepUp,
  readStudioOAuthStateCookie,
  readStudioSessionCookie,
  readStudioStepUpStateCookie,
  setStudioOAuthStateCookie,
  setStudioSessionCookie,
  setStudioStepUpStateCookie,
  validateStudioOAuthState,
  validateStudioStepUpBoundState,
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

function studioOAuthErrorPage(c: Context<StudioContext>, message: string, status: 400 | 403 | 502) {
  return c.html(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion Studio impossible</title></head><body><main><h1>Connexion Studio impossible</h1><p>${message}</p><p><a href="/studio/auth/login">Réessayer la connexion</a></p></main></body></html>`,
    status,
  );
}

async function logTokenExchangeFailure(scope: "login" | "step-up", response: Response): Promise<void> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown; error_description?: unknown } | null;
  const clean = (value: unknown): string =>
    typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").slice(0, 200) : "unknown";
  console.error(
    `studio oauth token exchange failed: scope=${scope} status=${response.status} error=${clean(payload?.error)} description=${clean(payload?.error_description)}`,
  );
}

export const studioOAuthRouter = new Hono<StudioContext>();

studioOAuthRouter.use("/studio/auth/*", requireStudioHost);
// Applied after host gating so oversized requests still reveal nothing on the client host.
studioOAuthRouter.use("/studio/auth/*", bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: "body_too_large" }, 413) }));

function studioOrigin(env: Env): string {
  return `https://${env.STUDIO_HOST}`;
}

studioOAuthRouter.get("/studio/auth/login", async (c) => {
  const state = createStudioOAuthState();
  await setStudioOAuthStateCookie(c, state);
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
  const oauthError = c.req.query("error");
  const stateCookie = readStudioOAuthStateCookie(c);
  clearStudioOAuthStateCookie(c);
  const validation = await validateStudioOAuthState(c.env, state, stateCookie);
  if (!validation.ok) {
    console.warn(`studio oauth state validation failed: scope=login reason=${validation.code}`);
    return studioOAuthErrorPage(c, "La demande de connexion a expiré ou n'est plus valide.", 400);
  }
  if (oauthError || !code) {
    return studioOAuthErrorPage(c, "La connexion a été annulée ou refusée par Discord.", 400);
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
    await logTokenExchangeFailure("login", tokenRes);
    return studioOAuthErrorPage(c, "Discord n'a pas pu finaliser la connexion.", 502);
  }
  const token = (await tokenRes.json()) as TokenResponse;

  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) return studioOAuthErrorPage(c, "Le profil Discord n'a pas pu être chargé.", 502);
  const user = (await userRes.json()) as DiscordUser;

  // Server-side gate: no session unless the user is an eligible operator.
  const operator = await resolveOperator(c.env, user.id);
  if (!operator) return studioOAuthErrorPage(c, "Ce compte n'est pas autorisé à accéder au Studio.", 403);

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

studioOAuthRouter.post("/studio/auth/logout", studioMutationOrigin, async (c) => {
  const sid = readStudioSessionCookie(c);
  if (sid) await deleteStudioSession(c.env, sid);
  clearStudioSessionCookie(c);
  return c.json({ ok: true });
});

// --- Step-up: OAuth re-consent (prompt=consent) that stamps the CURRENT session
// with a fresh stepUpAt, gating sensitive actions like lifetime grants (M14). ---

studioOAuthRouter.get("/studio/auth/step-up", async (c) => {
  // Same-site context: the SameSite=Strict studio_session cookie IS available here.
  const sid = readStudioSessionCookie(c);
  if (!sid) return c.text("No studio session.", 401);
  // Validate the current session, then bind its id into the SIGNED step-up state so
  // the callback recovers it without needing the Strict cookie (withheld cross-site).
  const { session } = await loadStudioSession(c.env, sid);
  if (!session) return c.text("No studio session.", 401);
  const nonce = createStudioOAuthState();
  await setStudioStepUpStateCookie(c, nonce, sid);
  const params = new URLSearchParams({
    client_id: c.env.DISCORD_CLIENT_ID,
    redirect_uri: `${studioOrigin(c.env)}/studio/auth/step-up/callback`,
    response_type: "code",
    scope: OAUTH_SCOPES,
    prompt: "consent",
    state: nonce,
  });
  return c.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

/** Staging-only, bounded step-up observability — booleans/enums only, no secrets. */
function logStepUp(
  c: Context<StudioContext>,
  fields: {
    stateValidation: "valid" | "invalid";
    sessionReferencePresent: boolean;
    sessionLookup: "found" | "missing" | "expired" | "revoked" | "n/a";
    userMatch: "true" | "false" | "n/a";
    result: "success" | "failure";
  },
): void {
  if (c.env.APP_VERSION !== "staging") return;
  console.log(
    `studio step-up: scope=step-up state_validation=${fields.stateValidation} ` +
      `session_reference_present=${fields.sessionReferencePresent} session_lookup=${fields.sessionLookup} ` +
      `user_match=${fields.userMatch} result=${fields.result}`,
  );
}

studioOAuthRouter.get("/studio/auth/step-up/callback", async (c) => {
  const code = c.req.query("code");
  const urlState = c.req.query("state");
  const stateCookie = readStudioStepUpStateCookie(c);
  clearStudioStepUpStateCookie(c);

  // 1) Verify the signed, session-bound step-up state (HMAC + scope + nonce + TTL).
  const validation = await validateStudioStepUpBoundState(c.env, urlState, stateCookie);
  if (!validation.ok) {
    logStepUp(c, { stateValidation: "invalid", sessionReferencePresent: Boolean(stateCookie), sessionLookup: "n/a", userMatch: "n/a", result: "failure" });
    console.warn(`studio oauth state validation failed: scope=step-up reason=${validation.code}`);
    return c.text("Invalid step-up state. Please retry.", 400);
  }
  if (!code) {
    logStepUp(c, { stateValidation: "valid", sessionReferencePresent: true, sessionLookup: "n/a", userMatch: "n/a", result: "failure" });
    return c.text("Invalid step-up state. Please retry.", 400);
  }

  // 2) Recover the session from the SIGNED reference (never from the absent cookie),
  //    re-checking existence, absolute/idle expiry, userGeneration and globalVersion.
  const sid = validation.sid;
  const { session, reason } = await loadStudioSession(c.env, sid);
  if (!session) {
    logStepUp(c, { stateValidation: "valid", sessionReferencePresent: true, sessionLookup: reason ?? "missing", userMatch: "n/a", result: "failure" });
    return c.text("Your studio session is no longer valid. Please sign in again.", 401);
  }

  // 3) Exchange the code and confirm the re-consented Discord user IS the session's user.
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
  if (!tokenRes.ok) {
    await logTokenExchangeFailure("step-up", tokenRes);
    logStepUp(c, { stateValidation: "valid", sessionReferencePresent: true, sessionLookup: "found", userMatch: "n/a", result: "failure" });
    return c.text("Discord token exchange failed. Please retry.", 502);
  }
  const token = (await tokenRes.json()) as TokenResponse;

  const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!userRes.ok) {
    logStepUp(c, { stateValidation: "valid", sessionReferencePresent: true, sessionLookup: "found", userMatch: "n/a", result: "failure" });
    return c.text("Failed to fetch your Discord profile.", 502);
  }
  const user = (await userRes.json()) as DiscordUser;

  if (session.userId !== user.id) {
    logStepUp(c, { stateValidation: "valid", sessionReferencePresent: true, sessionLookup: "found", userMatch: "false", result: "failure" });
    return c.text("Step-up does not match the current session.", 403);
  }
  const operator = await resolveOperator(c.env, user.id);
  if (!operator) {
    logStepUp(c, { stateValidation: "valid", sessionReferencePresent: true, sessionLookup: "found", userMatch: "true", result: "failure" });
    return c.text("This account is not a Studio operator.", 403);
  }

  // 4) All checks passed → stamp the step-up on the recovered session.
  await markStudioStepUp(c.env, sid);
  logStepUp(c, { stateValidation: "valid", sessionReferencePresent: true, sessionLookup: "found", userMatch: "true", result: "success" });
  return c.redirect(`${studioOrigin(c.env)}/`);
});
