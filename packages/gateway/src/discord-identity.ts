type DiscordCurrentUser = {
  id?: unknown;
  bot?: unknown;
};

/**
 * Proves that DISCORD_TOKEN belongs to the configured public application
 * before opening a Gateway session or writing anything to the Worker.
 * The token and response body are deliberately never included in errors.
 */
export async function verifyDiscordApplicationId(
  token: string,
  expectedApplicationId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("https://discord.com/api/v10/users/@me", {
    headers: { authorization: `Bot ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Discord bot identity check failed (${response.status})`);
  }

  const current = (await response.json()) as DiscordCurrentUser;
  if (current.bot !== true || current.id !== expectedApplicationId) {
    throw new Error("Discord bot identity does not match DISCORD_CLIENT_ID");
  }
}
