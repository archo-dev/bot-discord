const encoder = new TextEncoder();

/** Context-separated HMAC pseudonym; users are correlated only inside a guild. */
export async function securityPseudonym(secret: string, context: string, guildId: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`m02:${context}:${guildId}:${value}`)));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
