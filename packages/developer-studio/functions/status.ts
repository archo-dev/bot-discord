/**
 * Pages Function — same-origin proxy for the public `/status` route.
 *
 * The Studio SPA fetches `/status` relative to `studio.archolabs.com`, but on
 * that host the Worker only claims `/studio-api/*` and `/studio/auth/*`, so
 * `/status` would otherwise fall through to the static SPA (HTML) and break the
 * Overview health strip. This Function forwards the request **server-side** to
 * the Worker's public status endpoint, keeping the browser call same-origin (no
 * CORS) and requiring **no Worker redeploy**.
 *
 * Security: a fresh upstream request is built — no visitor cookie, Authorization
 * or other header is forwarded. The endpoint is public and read-only. Errors are
 * bounded (502/504) with a neutral JSON body; no stack trace or internal detail
 * is exposed.
 */

const UPSTREAM = "https://botdiscord.archodev.workers.dev/status";
const TIMEOUT_MS = 5_000;

/** Minimal shape of the Pages Functions event context we rely on. */
interface Ctx {
  request: Request;
}

function jsonResponse(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

async function proxyStatus(wantBody: boolean): Promise<Response> {
  let upstream: Response;
  try {
    // Fresh request only — no cookies, Authorization or visitor headers forwarded.
    upstream = await fetch(UPSTREAM, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return jsonResponse(timedOut ? 504 : 502, {
      error: timedOut ? "status_upstream_timeout" : "status_upstream_unavailable",
      message: "Service de statut momentanément indisponible.",
    });
  }

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
  });

  // HEAD: mirror status + headers with an empty body.
  if (!wantBody) return new Response(null, { status: upstream.status, headers });

  const bodyText = await upstream.text();
  return new Response(bodyText, { status: upstream.status, headers });
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const method = context.request.method.toUpperCase();
  if (method === "GET") return proxyStatus(true);
  if (method === "HEAD") return proxyStatus(false);
  return jsonResponse(
    405,
    { error: "method_not_allowed", message: "Méthode non autorisée — utilisez GET." },
    { allow: "GET, HEAD" },
  );
};
