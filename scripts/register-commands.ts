/**
 * Registers the built-in slash commands with Discord (bulk overwrite PUT —
 * idempotent, safe to re-run).
 *
 *   pnpm register:dev     → instant, on DEV_GUILD_ID only
 *   pnpm register:global  → all guilds, up to 1h propagation
 *
 * Reads DISCORD_TOKEN / DISCORD_CLIENT_ID / DEV_GUILD_ID from the environment,
 * falling back to packages/worker/.dev.vars.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { socialCommandDefs } from "../packages/worker/src/interactions/builtins/social-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDevVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(__dirname, "../packages/worker/.dev.vars"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) vars[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  } catch {
    // .dev.vars is optional when env vars are set directly
  }
  return vars;
}

const devVars = loadDevVars();
const getVar = (name: string): string | undefined => process.env[name] ?? devVars[name];

// Discord option types: 3=STRING, 4=INTEGER, 6=USER
// Permission bitfields (decimal strings): defense in depth — the Worker
// re-checks the member's real permissions on every invocation.
const BAN_MEMBERS = "4";
const KICK_MEMBERS = "2";
const MANAGE_MESSAGES = "8192";
const MODERATE_MEMBERS = (1n << 40n).toString();

const commands = [
  { name: "ping", description: "Vérifie que le bot répond", dm_permission: false },
  {
    name: "ban",
    description: "Bannit un membre du serveur",
    dm_permission: false,
    default_member_permissions: BAN_MEMBERS,
    options: [
      { type: 6, name: "membre", description: "Membre à bannir", required: true },
      { type: 3, name: "raison", description: "Raison du bannissement", max_length: 512 },
    ],
  },
  {
    name: "unban",
    description: "Révoque le bannissement d'un utilisateur",
    dm_permission: false,
    default_member_permissions: BAN_MEMBERS,
    options: [
      { type: 3, name: "user_id", description: "ID de l'utilisateur banni", required: true },
      { type: 3, name: "raison", description: "Raison", max_length: 512 },
    ],
  },
  {
    name: "kick",
    description: "Expulse un membre du serveur",
    dm_permission: false,
    default_member_permissions: KICK_MEMBERS,
    options: [
      { type: 6, name: "membre", description: "Membre à expulser", required: true },
      { type: 3, name: "raison", description: "Raison de l'expulsion", max_length: 512 },
    ],
  },
  {
    name: "mute",
    description: "Réduit un membre au silence (timeout)",
    dm_permission: false,
    default_member_permissions: MODERATE_MEMBERS,
    options: [
      { type: 6, name: "membre", description: "Membre à mute", required: true },
      {
        type: 4,
        name: "duree",
        description: "Durée en minutes (max 28 jours)",
        required: true,
        min_value: 1,
        max_value: 40320,
      },
      { type: 3, name: "raison", description: "Raison", max_length: 512 },
    ],
  },
  {
    name: "warn",
    description: "Avertit un membre",
    dm_permission: false,
    default_member_permissions: MODERATE_MEMBERS,
    options: [
      { type: 6, name: "membre", description: "Membre à avertir", required: true },
      { type: 3, name: "raison", description: "Raison de l'avertissement", max_length: 512 },
    ],
  },
  {
    name: "warnings",
    description: "Affiche les avertissements d'un membre",
    dm_permission: false,
    default_member_permissions: MODERATE_MEMBERS,
    options: [{ type: 6, name: "membre", description: "Membre", required: true }],
  },
  {
    name: "history",
    description: "Affiche l'historique de modération d'un membre",
    dm_permission: false,
    default_member_permissions: MODERATE_MEMBERS,
    options: [{ type: 6, name: "membre", description: "Membre", required: true }],
  },
  {
    name: "rank",
    description: "Affiche le niveau et l'XP d'un membre",
    dm_permission: false,
    options: [{ type: 6, name: "membre", description: "Membre (vous par défaut)" }],
  },
  { name: "leaderboard", description: "Classement XP du serveur", dm_permission: false },
  {
    name: "play",
    description: "Joue une musique (titre ou lien YouTube/Spotify)",
    dm_permission: false,
    options: [{ type: 3, name: "recherche", description: "Titre ou lien", required: true }],
  },
  { name: "pause", description: "Met la lecture en pause", dm_permission: false },
  { name: "resume", description: "Reprend la lecture", dm_permission: false },
  { name: "skip", description: "Passe à la piste suivante", dm_permission: false },
  { name: "stop", description: "Arrête la lecture et quitte le salon vocal", dm_permission: false },
  { name: "queue", description: "Affiche la file d'attente", dm_permission: false },
  { name: "nowplaying", description: "Affiche la piste en cours", dm_permission: false },
  { name: "shuffle", description: "Mélange la file d'attente", dm_permission: false },
  {
    name: "loop",
    description: "Change le mode de répétition",
    dm_permission: false,
    options: [
      {
        type: 3,
        name: "mode",
        description: "off, song ou queue",
        choices: [
          { name: "Désactivé", value: "off" },
          { name: "Piste", value: "song" },
          { name: "File", value: "queue" },
        ],
      },
    ],
  },
  {
    name: "volume",
    description: "Règle le volume (0-150)",
    dm_permission: false,
    options: [{ type: 4, name: "niveau", description: "Volume en %", required: true, min_value: 0, max_value: 150 }],
  },
  {
    name: "seek",
    description: "Se déplace à une position dans la piste",
    dm_permission: false,
    options: [{ type: 4, name: "secondes", description: "Position en secondes", required: true, min_value: 0 }],
  },
  {
    name: "remove",
    description: "Retire une piste de la file",
    dm_permission: false,
    options: [{ type: 4, name: "position", description: "Numéro dans la file", required: true, min_value: 1 }],
  },
  {
    name: "playlist",
    description: "Gère les playlists sauvegardées",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "save",
        description: "Enregistre la file actuelle",
        options: [{ type: 3, name: "nom", description: "Nom de la playlist", required: true, max_length: 60 }],
      },
      {
        type: 1,
        name: "load",
        description: "Charge une playlist",
        options: [{ type: 3, name: "nom", description: "Nom de la playlist", required: true, max_length: 60 }],
      },
      { type: 1, name: "list", description: "Liste les playlists" },
      {
        type: 1,
        name: "delete",
        description: "Supprime une playlist",
        options: [{ type: 3, name: "nom", description: "Nom de la playlist", required: true, max_length: 60 }],
      },
    ],
  },
  {
    name: "clear",
    description: "Supprime les derniers messages du salon",
    dm_permission: false,
    default_member_permissions: MANAGE_MESSAGES,
    options: [
      {
        type: 4,
        name: "nombre",
        description: "Nombre de messages à supprimer (1-100)",
        required: true,
        min_value: 1,
        max_value: 100,
      },
    ],
  },
  // Commandes sociales /kiss /hug /pat /slap /poke /cuddle (M24).
  ...socialCommandDefs(),
];

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "dev" && mode !== "global") {
    console.error("Usage: tsx scripts/register-commands.ts <dev|global>");
    process.exit(1);
  }

  const token = getVar("DISCORD_TOKEN");
  const clientId = getVar("DISCORD_CLIENT_ID");
  if (!token || !clientId) {
    console.error("DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis (env ou packages/worker/.dev.vars).");
    process.exit(1);
  }

  let url = `https://discord.com/api/v10/applications/${clientId}/commands`;
  if (mode === "dev") {
    const guildId = getVar("DEV_GUILD_ID");
    if (!guildId) {
      console.error("DEV_GUILD_ID est requis en mode dev (ID de votre serveur de test).");
      process.exit(1);
    }
    url = `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`;
  }

  const res = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    console.error(`Échec (${res.status}) : ${await res.text()}`);
    process.exit(1);
  }
  const registered = (await res.json()) as Array<{ name: string }>;
  console.log(
    `✅ ${registered.length} commandes enregistrées en mode ${mode} : ${registered.map((c) => c.name).join(", ")}`,
  );
  if (mode === "global") console.log("Propagation globale : jusqu'à 1 heure.");
}

await main();
