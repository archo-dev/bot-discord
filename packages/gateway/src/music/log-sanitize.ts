/**
 * Sanitises free-form media/ffmpeg output before it reaches the logs.
 *
 * ffmpeg stderr and @discordjs/voice errors can carry the full signed
 * GoogleVideo URL (which embeds the client IP + signature), cookies, auth
 * headers and — in theory — the bot token. We must keep the *diagnostic*
 * signal (hostname, HTTP status code, error text) while stripping anything
 * sensitive, and cap the length so a log line stays bounded.
 */

/** Discord bot token shape: base64url.base64url.base64url. */
const DISCORD_TOKEN = /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g;
/** `Cookie: …` / `Set-Cookie: …` / `Authorization: …` (value → end of line). */
const SENSITIVE_HEADER = /((?:set-)?cookie|authorization)(\s*[:=]\s*)([^\r\n]+)/gi;
/** Any http(s) URL (with optional user:pass@ credentials). */
const URL_RE = /\bhttps?:\/\/[^\s'"]+/gi;
/** ANSI colour codes ffmpeg emits on a TTY-ish pipe. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Strips the query/fragment (and any credentials) from a single URL match. */
function redactUrl(match: string): string {
  const noCred = match.replace(/\/\/[^/@]*@/, "//"); // drop user:pass@
  const cut = noCred.search(/[?#]/);
  return cut === -1 ? noCred : `${noCred.slice(0, cut)}?[redacted]`;
}

/**
 * Cleans `input`, keeping only non-sensitive diagnostic content, and truncates
 * to the last `maxLen` characters (ffmpeg's fatal error is at the tail).
 */
export function sanitizeMedia(input: unknown, maxLen = 1000): string {
  let out = String(input ?? "");
  out = out.replace(ANSI, "");
  out = out.replace(DISCORD_TOKEN, "[redacted-token]");
  out = out.replace(SENSITIVE_HEADER, "$1$2[redacted]");
  out = out.replace(URL_RE, redactUrl);
  out = out.replace(/[\r\n]+/g, " | ").replace(/[ \t]{2,}/g, " ").trim();
  if (out.length > maxLen) out = `…${out.slice(out.length - maxLen)}`;
  return out;
}
