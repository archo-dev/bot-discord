import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { GuildOverview, MeResponse } from "@bot/shared";
import { api, ApiError, avatarUrl, guildIconUrl } from "../lib/api.js";
import { Icon, type IconName } from "../ui/icons.js";
import { IconButton, ErrorCard } from "../ui/kit.js";
import { ChunkErrorBoundary } from "../ui/error-boundary.js";
import { Skeleton, SkeletonSettingsPage } from "../ui/skeleton.js";
import { MemberResolveProvider } from "../lib/members.js";
import { AccessContext } from "../lib/access.js";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  subtitle: string;
}

/* Sidebar groupée (D.S. v2 §4.13) — chaque page porte un sous-titre d'orientation. */
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: "Serveur",
    items: [
      { to: "", label: "Aperçu", icon: "home", end: true, subtitle: "Vue d'ensemble de l'activité et de la configuration du serveur." },
      { to: "onboarding", label: "Prise en main", icon: "star", subtitle: "Checklist guidée, presets de démarrage et permissions du bot." },
      { to: "modules", label: "Modules", icon: "bolt", subtitle: "Activez les capacités du bot et vérifiez leurs prérequis Discord." },
      { to: "stats", label: "Statistiques", icon: "chart", subtitle: "Évolution des membres, salons actifs, présence et événements à venir." },
      { to: "health", label: "Santé", icon: "pulse", subtitle: "SLO, état de la Gateway et diagnostic technique des modules." },
      { to: "audit", label: "Audit", icon: "shield", subtitle: "Historique administratif minimal, sécurisé et conservé pendant 90 jours." },
      { to: "config", label: "Configuration", icon: "sliders", subtitle: "Réglages généraux du bot : salon de logs et seuil d'avertissements." },
      { to: "backup", label: "Sauvegarde", icon: "scroll", subtitle: "Sauvegardez, comparez, restaurez et transférez la configuration des modules." },
      { to: "privacy", label: "Confidentialité", icon: "shield", subtitle: "Contrôlez les analytics produit minimales et envoyez un retour volontaire." },
      { to: "access", label: "Accès panel", icon: "key", subtitle: "Choisissez qui peut accéder à ce panel en plus des gestionnaires du serveur." },
    ],
  },
  {
    group: "Engagement",
    items: [
      { to: "welcome", label: "Bienvenue", icon: "wave", subtitle: "Messages d'arrivée et de départ, auto-rôles et logs serveur." },
      { to: "roles", label: "Rôles", icon: "tag", subtitle: "Publiez des messages à boutons pour que les membres choisissent leurs rôles." },
      { to: "levels", label: "Niveaux", icon: "trophy", subtitle: "XP par message, récompenses de niveau et classement du serveur." },
      { to: "starboard", label: "Starboard", icon: "star", subtitle: "Republiez les meilleurs messages (⭐) dans un salon best-of." },
      { to: "tempvoice", label: "Vocaux temporaires", icon: "mic", subtitle: "Salons vocaux à la demande : un lobby « rejoindre pour créer »." },
    ],
  },
  {
    group: "Modération",
    items: [
      { to: "automod", label: "Auto-mod", icon: "shield", subtitle: "Filtres automatiques : spam, invitations, liens et mots interdits." },
      { to: "sanctions", label: "Sanctions", icon: "shield", subtitle: "Appliquer, révoquer et consulter les sanctions du serveur." },
      { to: "modlog", label: "Mod-log", icon: "scroll", subtitle: "Historique des actions de modération et des avertissements." },
      { to: "voicelog", label: "Logs vocaux", icon: "mic", subtitle: "Historique des arrivées, départs et déplacements en vocal." },
      { to: "tickets", label: "Tickets", icon: "ticket", subtitle: "Support par tickets : réglages, panneau public et transcripts." },
    ],
  },
  {
    group: "Outils",
    items: [
      { to: "commands", label: "Commandes", icon: "command", subtitle: "Créez des commandes personnalisées avec conditions et actions." },
      { to: "automations", label: "Automatisations", icon: "workflow", subtitle: "Composez des scénarios SI… ALORS… avec déclencheurs, conditions et actions." },
      { to: "music", label: "Musique", icon: "music", subtitle: "État de la lecture en cours et contrôles du lecteur." },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function GuildLayout({ me }: { me: MeResponse }) {
  const { guildId } = useParams<{ guildId: string }>();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: () => api<GuildOverview>(`/api/guilds/${guildId}`),
  });

  const g = overview.data;

  // Onglet actif → titre + sous-titre de la page
  const base = `/guilds/${guildId}`;
  const rel = location.pathname.startsWith(base) ? location.pathname.slice(base.length).replace(/^\//, "") : "";
  const active = (NAV_ITEMS.find((n) => (n.end ? rel === "" : rel.startsWith(n.to) && n.to !== "")) ?? NAV_ITEMS[0])!;

  // Titre de document par page (D.S. v2 / plan H4)
  useEffect(() => {
    document.title = g ? `${active.label} — ${g.name}` : active.label;
    return () => {
      document.title = "Panel du bot";
    };
  }, [active.label, g]);

  // Drawer mobile : Échap + focus trap + restitution du focus (D.S. v2 §4.2)
  useEffect(() => {
    if (!drawerOpen) return;
    const panel = drawerRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      menuButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  if (overview.isError) {
    const err = overview.error;
    const message =
      err instanceof ApiError && err.status === 404
        ? "Le bot n'est pas (ou plus) installé sur ce serveur."
        : err instanceof ApiError && err.status === 403
          ? "Vous n'avez pas accès au panel de ce serveur."
          : "Erreur lors du chargement du serveur.";
    const canRetry = !(err instanceof ApiError && (err.status === 403 || err.status === 404));
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorCard message={message} onRetry={canRetry ? () => void overview.refetch() : undefined} />
        <div className="mt-4 text-center">
          <Link to="/" className="text-sm text-indigo-400 hover:underline">
            ← Retour à mes serveurs
          </Link>
        </div>
      </div>
    );
  }

  const iconUrl = g ? guildIconUrl(g.id, g.icon, 128) : null;

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Carte serveur unifiée (D.S. v2 §4.13) : icône + nom (une fois) + membres + switch */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 shadow-(--shadow-sm)">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-[radial-gradient(circle_at_80%_0%,rgba(93,87,242,0.32),transparent_65%)]" aria-hidden />
          <div className="relative flex items-center gap-3">
          {g ? (
            iconUrl ? (
              <img src={iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-950 text-sm font-bold text-indigo-300">
                {g.name.slice(0, 2).toUpperCase()}
              </span>
            )
          ) : (
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            {g ? (
              <>
                <div className="truncate text-sm font-semibold text-zinc-100">{g.name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden />
                  {g.approximateMemberCount != null ? `${g.approximateMemberCount} membres` : "—"}
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            )}
          </div>
          <Link
            to="/"
            aria-label="Changer de serveur"
            title="Changer de serveur"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
          >
            <Icon.chevron />
          </Link>
          </div>
        </div>
      </div>

      {/* Navigation groupée */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.group} className="mt-4 first:mt-0">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {group.group}
            </div>
            <div className="space-y-0.5">
              {group.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition duration-(--motion-fast) ${
                      isActive
                        ? "bg-indigo-500/15 font-semibold text-white shadow-[inset_3px_0_0_var(--primary)]"
                        : "text-zinc-400 hover:bg-(--state-hover) hover:text-zinc-200"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={isActive ? "text-indigo-400" : "text-zinc-500"}>{Icon[n.icon]()}</span>
                      {n.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer utilisateur */}
      <div className="m-3 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/65 p-3 shadow-(--shadow-sm)">
        <span className="relative shrink-0">
          <img src={avatarUrl(me.id, me.avatar, 64)} alt="" className="h-9 w-9 rounded-full" />
          <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 bg-green-400" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">{me.globalName ?? me.username}</div>
          <div className="truncate text-xs text-zinc-500">@{me.username}</div>
        </div>
        <IconButton
          label="Déconnexion"
          danger
          onClick={() => fetch("/auth/logout", { method: "POST" }).then(() => window.location.reload())}
        >
          <Icon.logout />
        </IconButton>
      </div>
    </div>
  );

  return (
    <MemberResolveProvider guildId={guildId ?? ""}>
    <AccessContext.Provider value={{ canWrite: g ? g.access !== "moderator" : true }}>
    <div className="min-h-screen lg:flex">
      {/* Sidebar desktop + drawer mobile */}
      <aside
        ref={drawerRef}
        aria-label="Navigation du serveur"
        className={`fixed inset-y-0 left-0 z-(--z-drawer) w-[276px] border-r border-zinc-800 bg-(--surface-sidebar) shadow-(--shadow-lg) transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 lg:shadow-none ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </aside>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[25] bg-[rgba(6,7,14,0.72)] lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Contenu principal */}
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8 xl:px-10">
          <header className="mb-7 flex items-start gap-3 border-b border-zinc-800/70 pb-5 lg:border-0 lg:pb-0">
            <IconButton
              ref={menuButtonRef}
              onClick={() => setDrawerOpen(true)}
              className="-ml-1 -mt-1 lg:hidden"
              label="Ouvrir le menu"
            >
              <Icon.menu />
            </IconButton>
            <div className="min-w-0">
              <h1 className="text-[22px] font-bold tracking-tight text-zinc-100">{active.label}</h1>
              <p className="mt-0.5 text-sm text-zinc-400">{active.subtitle}</p>
            </div>
            {g?.access === "moderator" && (
              <span
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-950 px-3 py-1 text-xs font-medium text-amber-300"
                title="Accès modérateur : vous pouvez tout consulter mais rien modifier."
              >
                <Icon.key />
                <span className="hidden sm:inline">Lecture seule</span>
              </span>
            )}
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                g?.gatewayConnected ? "bg-green-950 text-green-300" : "bg-zinc-800 text-zinc-400"
              } ${g?.access === "moderator" ? "" : "ml-auto"}`}
              title={
                g?.gatewayConnected
                  ? "Service Gateway en ligne (heartbeat reçu il y a moins de 3 minutes)."
                  : "Service Gateway non connecté : les slash commands fonctionnent, les événements temps réel non."
              }
            >
              <span className={`h-1.5 w-1.5 rounded-full ${g?.gatewayConnected ? "bg-green-400" : "bg-zinc-500"}`} />
              <span className="hidden sm:inline">{g?.gatewayConnected ? "Gateway connectée" : "Mode HTTP"}</span>
            </span>
          </header>

          {/* Fondu 150 ms au changement de page (D.S. v2 §2.3) — la clé force le re-rendu animé.
              La clé remonte aussi le boundary → l'état d'erreur se réinitialise à chaque nav. */}
          <div key={location.pathname} className="animate-page-in">
            {/* Chargement du chunk de page (M04, code-splitting) : la nav et l'en-tête
                restent affichés, seul le contenu montre un squelette Nocturne. Le boundary
                rattrape un échec de chargement de chunk (redéploiement / réseau). */}
            <ChunkErrorBoundary>
              <Suspense fallback={<SkeletonSettingsPage />}>
                <Outlet />
              </Suspense>
            </ChunkErrorBoundary>
          </div>
        </div>
      </main>
    </div>
    </AccessContext.Provider>
    </MemberResolveProvider>
  );
}
