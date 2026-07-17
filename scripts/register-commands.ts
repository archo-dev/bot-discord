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
const MANAGE_GUILD = "32";
const MODERATE_MEMBERS = (1n << 40n).toString();

export const commands = [
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
  // Salons vocaux temporaires (M26). Option types : 1=Subcommand, 6=USER, 7=CHANNEL.
  {
    name: "tempvoice",
    description: "Configure les salons vocaux temporaires (« rejoindre pour créer »)",
    dm_permission: false,
    default_member_permissions: MANAGE_GUILD,
    options: [
      {
        type: 1,
        name: "setup",
        description: "Active le système et définit le salon déclencheur",
        options: [
          { type: 7, name: "salon", description: "Salon vocal déclencheur existant (sinon créé automatiquement)", channel_types: [2] },
          { type: 7, name: "categorie", description: "Catégorie où créer les salons temporaires", channel_types: [4] },
        ],
      },
      { type: 1, name: "disable", description: "Désactive les nouvelles créations (garde les salons existants)" },
      { type: 1, name: "status", description: "Affiche l'état du système et les permissions requises" },
      { type: 1, name: "reset", description: "Réinitialise entièrement la configuration" },
    ],
  },
  {
    name: "voice",
    description: "Gère votre salon vocal temporaire",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "rename",
        description: "Renomme votre salon",
        options: [{ type: 3, name: "nom", description: "Nouveau nom", required: true, max_length: 100 }],
      },
      {
        type: 1,
        name: "limit",
        description: "Définit la limite d'utilisateurs",
        options: [{ type: 4, name: "nombre", description: "0-99 (0 = illimité)", required: true, min_value: 0, max_value: 99 }],
      },
      { type: 1, name: "lock", description: "Verrouille votre salon (empêche de nouveaux membres)" },
      { type: 1, name: "unlock", description: "Déverrouille votre salon" },
      {
        type: 1,
        name: "permit",
        description: "Autorise un membre à rejoindre",
        options: [{ type: 6, name: "utilisateur", description: "Membre à autoriser", required: true }],
      },
      {
        type: 1,
        name: "reject",
        description: "Refuse un membre (et le déconnecte si présent)",
        options: [{ type: 6, name: "utilisateur", description: "Membre à refuser", required: true }],
      },
      {
        type: 1,
        name: "kick",
        description: "Expulse un membre de votre salon (pas du serveur)",
        options: [{ type: 6, name: "utilisateur", description: "Membre à expulser", required: true }],
      },
      {
        type: 1,
        name: "transfer",
        description: "Transfère la propriété du salon",
        options: [{ type: 6, name: "utilisateur", description: "Nouveau propriétaire (présent dans le salon)", required: true }],
      },
      { type: 1, name: "claim", description: "Récupère un salon dont le propriétaire est absent" },
    ],
  },
];

async function main(): Promise<void> {
  const mode = process.argv[2];
  const apply = process.argv.includes("--apply");
  const aliases: Record<string, "sync-guild" | "sync-global"> = { dev: "sync-guild", global: "sync-global" };
  const normalized = mode ? (aliases[mode] ?? mode) : undefined;
  if (!normalized || !["list", "diff", "sync-global", "sync-guild", "cleanup-guild"].includes(normalized)) {
    console.error("Usage: tsx scripts/register-commands.ts <list|diff|sync-global|sync-guild|cleanup-guild> [--apply]");
    process.exit(1);
  }

  const token = getVar("DISCORD_TOKEN");
  const clientId = getVar("DISCORD_CLIENT_ID");
  if (!token || !clientId) {
    console.error("DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis (env ou packages/worker/.dev.vars).");
    process.exit(1);
  }

  // This bot has one public application. Refuse an accidental .env from an
  // unrelated bot before listing, overwriting or deleting any command.
  const expectedApplicationId = "1524597895859536074";
  if (clientId !== expectedApplicationId) {
    console.error("DISCORD_CLIENT_ID ne correspond pas à l'application botdiscord attendue; aucune action effectuée.");
    process.exit(1);
  }

  const guildId = getVar("DEV_GUILD_ID");
  const api = `https://discord.com/api/v10/applications/${clientId}`;
  const headers = { authorization: `Bot ${token}`, "content-type": "application/json" };
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => fetch(`${api}${path}`, {
    ...init, headers: { ...headers, ...(init.headers ?? {}) },
  });
  type Registered = { id: string; name: string; type: number; description?: string; options?: unknown[] };
  const list = async (path: string): Promise<Registered[]> => {
    const response = await request(path);
    if (!response.ok) throw new Error(`Discord API ${response.status}`);
    return response.json() as Promise<Registered[]>;
  };
  const commandKey = (command: Pick<Registered, "name" | "type">) => `${command.type}:${command.name}`;
  const expected = new Set(commands.map((command) => `1:${command.name}`));
  const printInventory = (label: string, items: Registered[]) => {
    console.log(`${label} (${items.length}) : ${items.map((command) => command.name).sort().join(", ") || "aucune"}`);
  };

  try {
    const global = await list("/commands");
    const guild = guildId ? await list(`/guilds/${guildId}/commands`) : [];
    if (normalized === "list") {
      printInventory("Commandes globales", global);
      if (guildId) printInventory(`Commandes de guilde (${guildId})`, guild);
      return;
    }

    if (normalized === "diff") {
      if (!guildId) throw new Error("DEV_GUILD_ID est requis pour comparer la guilde de test.");
      const globalKeys = new Set(global.map(commandKey));
      const guildKeys = new Set(guild.map(commandKey));
      const overlap = [...guildKeys].filter((key) => globalKeys.has(key));
      const duplicateDefinitions = (items: Registered[]) => items.filter((item, index) => items.findIndex((other) => commandKey(other) === commandKey(item)) !== index);
      printInventory("Commandes globales", global);
      printInventory(`Commandes de guilde (${guildId})`, guild);
      console.log(`Chemins présents aux deux portées : ${overlap.map((key) => key.slice(2)).join(", ") || "aucun"}`);
      console.log(`Doublons internes globaux : ${duplicateDefinitions(global).map((item) => item.name).join(", ") || "aucun"}`);
      console.log(`Doublons internes guilde : ${duplicateDefinitions(guild).map((item) => item.name).join(", ") || "aucun"}`);
      return;
    }

    if (normalized === "cleanup-guild") {
      if (!guildId) throw new Error("DEV_GUILD_ID est requis pour nettoyer la guilde de test.");
      const globalKeys = new Set(global.map(commandKey));
      // Only built-ins owned by this application and duplicated in the global
      // collection qualify. Per-guild custom commands and /voice (therefore
      // /voice kick) are kept even if a future deployment uses both scopes.
      const candidates = guild.filter((command) => command.name !== "voice" && expected.has(commandKey(command)) && globalKeys.has(commandKey(command)));
      printInventory("Commandes globales conservées", global);
      console.log(`Commandes de guilde candidates au nettoyage : ${candidates.map((command) => command.name).join(", ") || "aucune"}`);
      if (!apply) { console.log("Dry-run : aucune commande n'a été supprimée. Relancez avec --apply pour confirmer."); return; }
      for (const command of candidates) {
        const response = await request(`/guilds/${guildId}/commands/${command.id}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error(`Suppression de ${command.name} échouée (${response.status})`);
      }
      console.log(`${candidates.length} commande(s) de guilde obsolète(s) supprimée(s). Les commandes globales et personnalisées sont intactes.`);
      return;
    }

    const path = normalized === "sync-global" ? "/commands" : guildId ? `/guilds/${guildId}/commands` : null;
    if (!path) throw new Error("DEV_GUILD_ID est requis pour synchroniser les commandes de guilde.");
    const response = await request(path, { method: "PUT", body: JSON.stringify(commands) });
    if (!response.ok) throw new Error(`Synchronisation échouée (${response.status})`);
    const registered = await response.json() as Registered[];
    console.log(`✅ ${registered.length} commandes synchronisées en mode ${normalized}.`);
    if (normalized === "sync-global") console.log("Propagation globale : jusqu'à une heure.");
  } catch (error) {
    console.error(`Échec : ${error instanceof Error ? error.message : "erreur Discord"}`);
    process.exit(1);
  }
}

await main();
