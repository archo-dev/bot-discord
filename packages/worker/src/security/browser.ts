import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function explicitOrigins(env: Env): Set<string> {
  const values = [env.PANEL_ORIGIN, ...(env.PANEL_ALLOWED_ORIGINS ?? "").split(",")];
  return new Set(values.map((value) => value.trim()).filter(Boolean).map((value) => new URL(value).origin));
}

export function isHttpsEnvironment(env: Env): boolean {
  return new URL(env.PANEL_ORIGIN).protocol === "https:";
}

/** Exact-origin protection for every unsafe cookie-authenticated browser call. */
export const browserMutationOrigin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const origin = c.req.header("origin");
  const allowed = origin !== undefined && explicitOrigins(c.env).has(origin);
  if (!allowed) {
    if (c.env.SECURITY_ORIGIN_MODE === "report") {
      c.header("x-security-origin-report", "rejected");
    } else {
      return c.json({ error: "csrf_rejected" }, 403);
    }
  }
  await next();
};

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https://cdn.discordapp.com",
  "object-src 'none'",
  "script-src 'self'",
  // Recharts/React currently emit bounded inline style attributes. CSP stays
  // report-only until those critical panel paths are verified without this.
  "style-src 'self' 'unsafe-inline'",
].join("; ");

export const securityResponseHeaders: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "no-referrer");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  c.header("cross-origin-opener-policy", "same-origin");
  c.header("cross-origin-resource-policy", "same-origin");
  c.header(c.env.SECURITY_CSP_MODE === "enforce" ? "content-security-policy" : "content-security-policy-report-only", CSP);
  if (isHttpsEnvironment(c.env) && new URL(c.req.url).protocol === "https:") {
    c.header("strict-transport-security", "max-age=15552000");
  }
};
