import type { ModuleGatewayRequirement, ModuleId, PlatformFlagKey } from "@bot/shared";
import type { IconName } from "../ui/icons.js";

export type NavigationGroupId = "home" | "community" | "moderation" | "automation" | "audio" | "operations";
export type NavigationAccess = "read" | "write";
export type SearchResultKind = "Pages" | "Modules" | "Paramètres" | "Actions";

export interface NavigationGroup {
  readonly id: NavigationGroupId;
  readonly label: string;
  readonly icon: IconName;
}

export interface NavigationRoute {
  readonly path: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly kind?: SearchResultKind;
  readonly access?: NavigationAccess;
  readonly gateway?: ModuleGatewayRequirement;
  readonly indexable?: boolean;
  readonly showInSubnav?: boolean;
}

export interface NavigationSearchTarget {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly keywords: readonly string[];
  readonly access: NavigationAccess;
  readonly gateway: ModuleGatewayRequirement;
}

export interface NavigationDestination {
  readonly id: string;
  readonly group: NavigationGroupId;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly primaryPath: string;
  readonly secondaryRoutes: readonly NavigationRoute[];
  readonly keywords: readonly string[];
  readonly settings: readonly NavigationSearchTarget[];
  readonly actions: readonly NavigationSearchTarget[];
  readonly access: NavigationAccess;
  readonly featureFlag: PlatformFlagKey | null;
  readonly gateway: ModuleGatewayRequirement;
  readonly moduleId: ModuleId | null;
  readonly searchKind: "page" | "module";
  readonly sidebar: boolean;
}

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  { id: "home", label: "Accueil", icon: "home" },
  { id: "community", label: "Communauté", icon: "users" },
  { id: "moderation", label: "Modération", icon: "shield" },
  { id: "automation", label: "Automatisation", icon: "workflow" },
  { id: "audio", label: "Audio", icon: "music" },
  { id: "operations", label: "Pilotage", icon: "sliders" },
];

const target = (
  id: string,
  label: string,
  description: string,
  path: string,
  keywords: readonly string[],
  access: NavigationAccess = "write",
  gateway: ModuleGatewayRequirement = "none",
): NavigationSearchTarget => ({ id, label, description, path, keywords, access, gateway });

export const NAVIGATION_REGISTRY: readonly NavigationDestination[] = [
  {
    id: "overview",
    group: "home",
    label: "Vue d’ensemble",
    description: "Activité, configuration et signaux essentiels du serveur.",
    icon: "home",
    primaryPath: "",
    secondaryRoutes: [],
    keywords: ["accueil", "dashboard", "aperçu", "serveur", "résumé"],
    settings: [],
    actions: [
      target("overview.recent", "Activité récente", "Retrouver les événements récents du serveur.", "", ["activité", "récent", "événements"], "read"),
    ],
    access: "read",
    featureFlag: null,
    gateway: "optional",
    moduleId: null,
    searchKind: "page",
    sidebar: true,
  },
  {
    id: "health",
    group: "home",
    label: "Santé du serveur",
    description: "État des services et diagnostic technique du serveur.",
    icon: "pulse",
    primaryPath: "health",
    secondaryRoutes: [],
    keywords: ["santé", "health", "gateway", "diagnostic", "service"],
    settings: [],
    actions: [
      target("health.gateway", "Vérifier la Gateway", "Consulter la fraîcheur et l’état de la Gateway.", "health", ["gateway", "statut", "connexion"], "read"),
    ],
    access: "read",
    featureFlag: null,
    gateway: "optional",
    moduleId: "health",
    searchKind: "page",
    sidebar: true,
  },
  {
    id: "onboarding",
    group: "home",
    label: "Prise en main",
    description: "Checklist guidée, presets de démarrage et permissions du bot.",
    icon: "star",
    primaryPath: "onboarding",
    secondaryRoutes: [],
    keywords: ["onboarding", "installation", "démarrage", "checklist", "preset"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "optional",
    moduleId: null,
    searchKind: "page",
    sidebar: false,
  },
  {
    id: "welcome",
    group: "community",
    label: "Bienvenue",
    description: "Messages d’arrivée et de départ, auto-rôles et journaux serveur.",
    icon: "wave",
    primaryPath: "welcome",
    secondaryRoutes: [],
    keywords: ["bienvenue", "welcome", "arrivée", "départ", "autorôle", "accueil"],
    settings: [
      target("welcome.message", "Message de bienvenue", "Configurer le message envoyé aux nouveaux membres.", "welcome", ["message", "arrivée", "salon"], "write", "required"),
      target("welcome.autorole", "Rôle automatique", "Choisir les rôles attribués à l’arrivée.", "welcome", ["autorôle", "rôle", "membre"], "write", "required"),
    ],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "welcome",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "roles",
    group: "community",
    label: "Rôles",
    description: "Messages à boutons pour laisser les membres choisir leurs rôles.",
    icon: "tag",
    primaryPath: "roles",
    secondaryRoutes: [],
    keywords: ["rôle", "roles", "bouton", "autorôle", "reaction role"],
    settings: [],
    actions: [
      target("roles.publish", "Publier un panneau de rôles", "Créer ou mettre à jour un message de sélection de rôles.", "roles", ["publier", "panneau", "bouton"]),
    ],
    access: "read",
    featureFlag: null,
    gateway: "none",
    moduleId: "button_roles",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "levels",
    group: "community",
    label: "Niveaux",
    description: "XP, récompenses de niveau et classement du serveur.",
    icon: "trophy",
    primaryPath: "levels",
    secondaryRoutes: [],
    keywords: ["niveau", "levels", "xp", "classement", "récompense"],
    settings: [
      target("levels.xp", "Gain d’XP", "Régler la progression des membres.", "levels", ["xp", "gain", "progression"], "write", "required"),
    ],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "levels",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "starboard",
    group: "community",
    label: "Starboard",
    description: "Sélection communautaire des messages les plus appréciés.",
    icon: "star",
    primaryPath: "starboard",
    secondaryRoutes: [],
    keywords: ["starboard", "étoile", "réaction", "best of", "message"],
    settings: [
      target("starboard.channel", "Salon du Starboard", "Choisir le salon de republication.", "starboard", ["salon", "publication", "étoile"], "write", "required"),
    ],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "starboard",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "tempvoice",
    group: "community",
    label: "Vocaux temporaires",
    description: "Salons vocaux à la demande avec lobby rejoindre-pour-créer.",
    icon: "mic",
    primaryPath: "tempvoice",
    secondaryRoutes: [],
    keywords: ["vocal", "vocaux", "temporaire", "tempvoice", "lobby", "salon"],
    settings: [
      target("tempvoice.lobby", "Lobby vocal", "Configurer le salon rejoindre-pour-créer.", "tempvoice", ["lobby", "vocal", "salon"], "write", "required"),
    ],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "temp_voice",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "automod",
    group: "moderation",
    label: "Auto-mod",
    description: "Filtres automatiques contre le spam, les liens et les invitations.",
    icon: "shield",
    primaryPath: "automod",
    secondaryRoutes: [],
    keywords: ["automod", "auto-mod", "spam", "invitation", "filtre", "mots interdits"],
    settings: [
      target("automod.filters", "Filtres de l’Auto-mod", "Configurer les règles de filtrage automatique.", "automod", ["filtre", "spam", "liens"], "write", "required"),
    ],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "automod",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "moderation",
    group: "moderation",
    label: "Modération",
    description: "Historique unifié et application des sanctions.",
    icon: "gavel",
    primaryPath: "sanctions",
    secondaryRoutes: [
      { path: "apply", label: "Appliquer une sanction", keywords: ["warn", "mute", "ban", "sanction"], kind: "Actions", access: "write", showInSubnav: true },
      { path: "modlog", label: "Ancien journal de modération", keywords: ["modlog", "ancienne url"], indexable: false },
    ],
    keywords: ["modération", "sanction", "historique", "warn", "mute", "ban", "modlog"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "none",
    moduleId: "moderation",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "tickets",
    group: "moderation",
    label: "Tickets",
    description: "Support privé avec panneaux, salons et transcripts.",
    icon: "ticket",
    primaryPath: "tickets",
    secondaryRoutes: [],
    keywords: ["ticket", "support", "transcript", "panneau", "salon privé"],
    settings: [
      target("tickets.panel", "Panneau de tickets", "Configurer le panneau public d’ouverture.", "tickets", ["panneau", "support", "publication"]),
    ],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "none",
    moduleId: "tickets",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "logs",
    group: "moderation",
    label: "Journaux",
    description: "Historique des arrivées, départs et changements vocaux.",
    icon: "scroll",
    primaryPath: "voicelog",
    secondaryRoutes: [],
    keywords: ["journaux", "logs", "logs vocaux", "voicelog", "vocal", "historique"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "voice_logs",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "commands",
    group: "automation",
    label: "Commandes personnalisées",
    description: "Commandes créées pour le serveur avec conditions et actions.",
    icon: "command",
    primaryPath: "commands",
    secondaryRoutes: [
      { path: "commands/new", label: "Nouvelle commande", keywords: ["créer", "commande"], kind: "Actions", access: "write" },
      { path: "commands/:commandId", label: "Éditeur de commande", indexable: false },
    ],
    keywords: ["commande", "commandes", "slash", "personnalisée", "éditeur"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "optional",
    moduleId: "custom_commands",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "automations",
    group: "automation",
    label: "Automatisations",
    description: "Scénarios avec déclencheurs, conditions et actions.",
    icon: "workflow",
    primaryPath: "automations",
    secondaryRoutes: [
      { path: "automations/new", label: "Nouvelle automatisation", keywords: ["créer", "workflow", "scénario"], kind: "Actions", access: "write", gateway: "required" },
      { path: "automations/:automationId", label: "Éditeur d’automatisation", indexable: false },
    ],
    keywords: ["automatisation", "workflow", "scénario", "déclencheur", "condition", "action"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "automations",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "music",
    group: "audio",
    label: "Musique",
    description: "Lecture audio, file d’attente et playlists.",
    icon: "music",
    primaryPath: "music",
    secondaryRoutes: [],
    keywords: ["musique", "music", "audio", "playlist", "lecture", "file"],
    settings: [],
    actions: [
      target("music.player", "Ouvrir le lecteur", "Consulter la lecture et la file d’attente.", "music", ["lecteur", "queue", "file"], "read"),
    ],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "music",
    searchKind: "module",
    sidebar: true,
  },
  {
    id: "observability",
    group: "operations",
    label: "Observabilité",
    description: "Activité, tendances et statistiques détaillées du serveur.",
    icon: "chart",
    primaryPath: "stats",
    secondaryRoutes: [],
    keywords: ["observabilité", "statistiques", "stats", "activité", "membres", "tendance"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "required",
    moduleId: "stats",
    searchKind: "page",
    sidebar: true,
  },
  {
    id: "audit",
    group: "operations",
    label: "Audit",
    description: "Historique administratif minimal, sécurisé et borné.",
    icon: "shield",
    primaryPath: "audit",
    secondaryRoutes: [],
    keywords: ["audit", "administration", "historique", "sécurité"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "none",
    moduleId: "audit",
    searchKind: "page",
    sidebar: true,
  },
  {
    id: "settings",
    group: "operations",
    label: "Paramètres",
    description: "Configuration générale, accès, confidentialité et sauvegardes.",
    icon: "sliders",
    primaryPath: "config",
    secondaryRoutes: [
      { path: "access", label: "Accès panel", description: "Délégation administrateur et modérateur.", keywords: ["accès panel", "permission", "délégation", "modérateur"], kind: "Paramètres", showInSubnav: true },
      { path: "privacy", label: "Confidentialité", description: "Préférences de conservation et de confidentialité.", keywords: ["confidentialité", "privacy", "données"], kind: "Paramètres", showInSubnav: true },
      { path: "backup", label: "Sauvegardes", description: "Exporter et restaurer la configuration.", keywords: ["sauvegarde", "backup", "export", "import", "restauration"], kind: "Paramètres", showInSubnav: true },
    ],
    keywords: ["paramètres", "configuration", "réglages", "serveur", "logs"],
    settings: [
      target("settings.general", "Configuration générale", "Modifier les réglages communs du serveur.", "config", ["général", "salon logs", "avertissement"]),
    ],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "optional",
    moduleId: "general",
    searchKind: "page",
    sidebar: true,
  },
  {
    id: "modules",
    group: "operations",
    label: "Centre des modules",
    description: "Activer les capacités du bot et vérifier leurs prérequis Discord.",
    icon: "bolt",
    primaryPath: "modules",
    secondaryRoutes: [],
    keywords: ["module", "modules", "activer", "désactiver", "prérequis"],
    settings: [],
    actions: [],
    access: "read",
    featureFlag: null,
    gateway: "optional",
    moduleId: null,
    searchKind: "page",
    sidebar: false,
  },
] as const;

export const SIDEBAR_DESTINATIONS = NAVIGATION_REGISTRY.filter((destination) => destination.sidebar);

export interface NavigationAvailability {
  readonly canWrite: boolean;
  readonly gatewayConnected: boolean;
  readonly flags: Readonly<Partial<Record<PlatformFlagKey, boolean>>>;
}

export function isDestinationAvailable(destination: NavigationDestination, availability: NavigationAvailability): boolean {
  if (destination.access === "write" && !availability.canWrite) return false;
  return destination.featureFlag === null || availability.flags[destination.featureFlag] === true;
}

export function routeMatches(pattern: string, relativePath: string): boolean {
  const clean = relativePath.replace(/^\/+|\/+$/g, "");
  if (pattern === "") return clean === "";
  const patternSegments = pattern.split("/");
  const pathSegments = clean.split("/");
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((segment, index) => segment.startsWith(":") || segment === pathSegments[index]);
}

export function destinationMatches(destination: NavigationDestination, relativePath: string): boolean {
  return routeMatches(destination.primaryPath, relativePath)
    || destination.secondaryRoutes.some((route) => routeMatches(route.path, relativePath));
}

export function resolveNavigation(relativePath: string): { destination: NavigationDestination; route: NavigationRoute | null } {
  const destination = NAVIGATION_REGISTRY.find((candidate) => destinationMatches(candidate, relativePath))
    ?? NAVIGATION_REGISTRY[0]!;
  const route = destination.secondaryRoutes.find((candidate) => routeMatches(candidate.path, relativePath)) ?? null;
  return { destination, route };
}

export function navigationGroups(availability: NavigationAvailability): Array<NavigationGroup & { destinations: NavigationDestination[] }> {
  return NAVIGATION_GROUPS.map((group) => ({
    ...group,
    destinations: SIDEBAR_DESTINATIONS.filter(
      (destination) => destination.group === group.id && isDestinationAvailable(destination, availability),
    ),
  })).filter((group) => group.destinations.length > 0);
}

export function subnavRoutes(destination: NavigationDestination): NavigationRoute[] {
  return [
    { path: destination.primaryPath, label: destination.label, indexable: false, showInSubnav: true },
    ...destination.secondaryRoutes.filter((route) => route.showInSubnav),
  ];
}

export function destinationPath(id: string): string {
  const destination = NAVIGATION_REGISTRY.find((candidate) => candidate.id === id);
  if (!destination) throw new Error(`Destination de navigation inconnue : ${id}`);
  return destination.primaryPath;
}

export function isValidGuildId(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{5,20}$/.test(value);
}
