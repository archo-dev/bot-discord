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
      "https://nekos.best/api/v2/kiss/eb798cf3-6d89-4c01-913b-bc2bc0014797.gif",
      "https://nekos.best/api/v2/kiss/ff5b70d7-f3c5-4c90-b10c-69c2ea1d90c5.gif",
      "https://nekos.best/api/v2/kiss/5da175af-5d35-4a92-8d68-4bdc72695de9.gif",
      "https://nekos.best/api/v2/kiss/693bf6fd-0429-4d6a-9801-7fef6ed5c5e6.gif",
      "https://nekos.best/api/v2/kiss/442e2bc1-ad7d-4685-ab63-61a8c1970916.gif",
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
      "https://nekos.best/api/v2/hug/1606f27b-cc28-490b-9d1f-cb6d5f03dd15.gif",
      "https://nekos.best/api/v2/hug/4619bde0-9f22-4010-a58a-d6a4cb8d12a4.gif",
      "https://nekos.best/api/v2/hug/350aee04-6ec3-40a9-b45e-15c754b9c25d.gif",
      "https://nekos.best/api/v2/hug/09feb098-2e4d-4620-991a-82f1aac96885.gif",
      "https://nekos.best/api/v2/hug/29719456-634d-47b7-aae9-d714f0c43195.gif",
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
      "https://nekos.best/api/v2/pat/8919f8ae-da65-4c01-aaea-49e00b03c4b9.gif",
      "https://nekos.best/api/v2/pat/61cb733c-8d5a-4472-8efb-7343f0745e66.gif",
      "https://nekos.best/api/v2/pat/b8bc59e1-ae1c-4c20-89a9-bfb71a5845ca.gif",
      "https://nekos.best/api/v2/pat/da5de67a-e381-49e2-83dd-89347ead1267.gif",
      "https://nekos.best/api/v2/pat/15141385-5450-408a-b64a-1a35ed00217d.gif",
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
      "https://nekos.best/api/v2/slap/9ff484d9-1aa8-4114-86d6-cc644cc4a103.gif",
      "https://nekos.best/api/v2/slap/52955ed4-f41c-4515-8cc7-6d0a4db6b717.gif",
      "https://nekos.best/api/v2/slap/058b2593-f52b-4e23-9440-8df39c1a95d1.gif",
      "https://nekos.best/api/v2/slap/91eaebc7-5c43-41ee-9d06-04f247383227.gif",
      "https://nekos.best/api/v2/slap/cd6c2fca-c8a7-44e9-8a12-ffea629d9dd0.gif",
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
      "https://nekos.best/api/v2/poke/ddd2cf69-909e-4050-8208-7b1fde4048e5.gif",
      "https://nekos.best/api/v2/poke/2258fd44-0a30-42f5-bb3e-79b2d6c54a70.gif",
      "https://nekos.best/api/v2/poke/d4e9fea2-a3ff-4250-90bc-db2317b3e718.gif",
      "https://nekos.best/api/v2/poke/00180bac-2e91-4d03-aed4-2140160e2f61.gif",
      "https://nekos.best/api/v2/poke/85c835dc-d895-4dc6-bed4-d2f6153d986a.gif",
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
      "https://nekos.best/api/v2/cuddle/659cc980-4632-45b5-b4a5-d72337c232cf.gif",
      "https://nekos.best/api/v2/cuddle/85ba8e89-8927-48a6-8a66-dd468f34b7b5.gif",
      "https://nekos.best/api/v2/cuddle/eeb23cf1-28d2-4719-9676-271bd96df7de.gif",
      "https://nekos.best/api/v2/cuddle/d5db6099-d5df-443b-95c4-6b76399ccbe6.gif",
      "https://nekos.best/api/v2/cuddle/93af4462-da86-46e4-8101-2011458be633.gif",
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
