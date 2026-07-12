/**
 * Data-driven definition of the "social action" commands (/kiss, /hug, …).
 *
 * IMPORTANT: this module must stay dependency-free (no imports). It is consumed
 * both by the Worker runtime (builtins/social.ts) AND by the standalone tsx
 * script scripts/register-commands.ts, which imports it directly — so it cannot
 * pull in discord-api-types, the Env, or anything else that needs bundling.
 *
 * Templates use two placeholders, replaced with real mentions at render time:
 *   {author}  → <@authorId>
 *   {target}  → <@targetId>
 */

export interface SocialAction {
  /** Emoji prefixed to every message for this action. */
  emoji: string;
  /** Embed accent colour. */
  color: number;
  /** French command description (shown in the Discord command picker). */
  description: string;
  /** Main message, e.g. "{author} fait un bisou à {target} !". */
  template: string;
  /** Used when the author targets themselves (see allowSelf). */
  selfMessage: string;
  /** When true, self-targeting is allowed and posts publicly with a GIF. */
  allowSelf: boolean;
  /** Optional playful variant when the target is a bot. Falls back to template. */
  botMessage?: string;
  /** Curated list of embeddable GIF URLs (direct .gif links). */
  gifs: readonly string[];
}

export const SOCIAL_ACTIONS: Record<string, SocialAction> = {
  kiss: {
    emoji: "💋",
    color: 0xff5c8a,
    description: "Fait un bisou à un membre",
    template: "{author} fait un bisou à {target} !",
    selfMessage: "{author} s'envoie un bisou dans le miroir… on vous aime quand même. 😘",
    allowSelf: false,
    botMessage: "{author} embrasse {target}… le bot en court-circuite un peu. 🤖💕",
    gifs: [
      "https://media.tenor.com/Hd0iRB6nOnUAAAAC/anime-kiss.gif",
      "https://media.tenor.com/kAP7-JHfF0kAAAAC/anime-kiss-anime.gif",
      "https://media.tenor.com/Q0Q0Q0Q0Q0QAAAAC/kiss-anime.gif",
      "https://media.tenor.com/8Yr7Vf5nO2wAAAAC/kiss-love.gif",
      "https://media.tenor.com/2roX3uxz_68AAAAC/cute-anime.gif",
      "https://media.tenor.com/1sHkX9c9r9wAAAAC/anime-love.gif",
    ],
  },
  hug: {
    emoji: "🫂",
    color: 0xf49ac2,
    description: "Fait un câlin à un membre",
    template: "{author} fait un gros câlin à {target} !",
    selfMessage: "{author} se fait un câlin tout(e) seul(e)… venez, on vous en fait un vrai ! 🤗",
    allowSelf: false,
    botMessage: "{author} serre {target} dans ses bras… le bot ronronne. 🤖",
    gifs: [
      "https://media.tenor.com/9e1aE_xBLCoAAAAC/anime-hug.gif",
      "https://media.tenor.com/kCZjNQKgc8wAAAAC/hug-anime.gif",
      "https://media.tenor.com/Zy3JQZQZQZQAAAAC/anime-hug-cute.gif",
      "https://media.tenor.com/pP2gI4b8m5cAAAAC/hug.gif",
      "https://media.tenor.com/gUiu1zyxfzYAAAAC/hug-love.gif",
      "https://media.tenor.com/eXwZgW3sqIkAAAAC/cuddle-hug.gif",
    ],
  },
  pat: {
    emoji: "🖐️",
    color: 0x9b59b6,
    description: "Fait une caresse sur la tête d'un membre",
    template: "{author} tapote gentiment la tête de {target} !",
    selfMessage: "{author} se tapote la tête tout(e) seul(e)… bravo à vous. 🖐️",
    allowSelf: false,
    gifs: [
      "https://media.tenor.com/N41zKEDABuUAAAAC/anime-pat.gif",
      "https://media.tenor.com/7Nk9F5Z8xLwAAAAC/pat-head-pat.gif",
      "https://media.tenor.com/E1XQ0J8Qw3kAAAAC/anime-headpat.gif",
      "https://media.tenor.com/xr9Bn0eXWJEAAAAC/pat-pat-anime.gif",
      "https://media.tenor.com/vLGmXe9EL6cAAAAC/head-pat-anime.gif",
    ],
  },
  slap: {
    emoji: "👋",
    color: 0xe67e22,
    description: "Met une petite claque à un membre",
    template: "{author} met une claque à {target} ! 😳",
    selfMessage: "{author} se met une claque tout(e) seul(e)… ça réveille au moins. 😅",
    allowSelf: true,
    botMessage: "{author} gifle {target}… le bot ne sent rien. 🤖",
    gifs: [
      "https://media.tenor.com/uxWVJlm4rMkAAAAC/anime-slap.gif",
      "https://media.tenor.com/gmuJcSjEXBkAAAAC/slap-anime.gif",
      "https://media.tenor.com/Sd3B0J8Qw3kAAAAC/anime-slap-hit.gif",
      "https://media.tenor.com/oQ6Q0J8Qw3kAAAAC/slap-fight.gif",
      "https://media.tenor.com/8Y7Vf5nO2wAAAAC/slap-angry.gif",
    ],
  },
  poke: {
    emoji: "👉",
    color: 0x1abc9c,
    description: "Fait un petit poke à un membre",
    template: "{author} fait un poke à {target} ! 👀",
    selfMessage: "{author} se poke tout(e) seul(e)… oui, vous existez bien. 👉",
    allowSelf: false,
    gifs: [
      "https://media.tenor.com/1cU8bJ9Vm2gAAAAC/anime-poke.gif",
      "https://media.tenor.com/rJ3nQZQZQZQAAAAC/poke-anime.gif",
      "https://media.tenor.com/kQ0J8Qw3kAAAAAC/poke-poke.gif",
      "https://media.tenor.com/Vf5nO2wAAAAC/anime-poke-cute.gif",
      "https://media.tenor.com/9c9r9wAAAAAC/poke-boop.gif",
    ],
  },
  cuddle: {
    emoji: "🥰",
    color: 0xeb459e,
    description: "Fait un câlin tout doux à un membre",
    template: "{author} fait un câlin tout doux à {target} !",
    selfMessage: "{author} se blottit dans une couverture tout(e) seul(e)… c'est cosy aussi. 🥰",
    allowSelf: false,
    botMessage: "{author} se blottit contre {target}… le bot surchauffe légèrement. 🤖",
    gifs: [
      "https://media.tenor.com/eXwZgW3sqIkAAAAC/cuddle-hug.gif",
      "https://media.tenor.com/gUiu1zyxfzYAAAAC/cuddle-love.gif",
      "https://media.tenor.com/kCZjNQKgc8wAAAAC/cuddle-anime.gif",
      "https://media.tenor.com/9e1aE_xBLCoAAAAC/anime-cuddle.gif",
      "https://media.tenor.com/pP2gI4b8m5cAAAAC/cuddle-warm.gif",
    ],
  },
};

/** Picks a random GIF, or undefined when the list is empty (no crash path). */
export function pickGif(gifs: readonly string[]): string | undefined {
  if (gifs.length === 0) return undefined;
  return gifs[Math.floor(Math.random() * gifs.length)];
}

/** Slash-command definitions for register-commands.ts (bulk overwrite PUT). */
export function socialCommandDefs(): Array<{
  name: string;
  description: string;
  dm_permission: false;
  options: Array<{ type: 6; name: string; description: string; required: true }>;
}> {
  return Object.entries(SOCIAL_ACTIONS).map(([name, action]) => ({
    name,
    description: action.description,
    dm_permission: false,
    options: [{ type: 6, name: "membre", description: "Le membre à cibler", required: true }],
  }));
}
