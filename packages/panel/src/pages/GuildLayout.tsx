import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { GuildOverview, MeResponse } from "@bot/shared";
import { api, ApiError, avatarUrl, guildIconUrl } from "../lib/api.js";
import { Icon, type IconName } from "../ui/icons.js";

const nav: { to: string; label: string; icon: IconName; end?: boolean; subtitle?: string }[] = [
  { to: "", label: "Aperçu", icon: "home", end: true, subtitle: "Bienvenue sur le dashboard de votre serveur." },
  { to: "config", label: "Configuration", icon: "sliders" },
  { to: "commands", label: "Commandes", icon: "command" },
  { to: "tickets", label: "Tickets", icon: "ticket" },
  { to: "roles", label: "Rôles", icon: "tag" },
  { to: "welcome", label: "Bienvenue", icon: "wave" },
  { to: "automod", label: "Auto-mod", icon: "shield" },
  { to: "levels", label: "Niveaux", icon: "trophy" },
  { to: "music", label: "Musique", icon: "music" },
  { to: "modlog", label: "Mod-log", icon: "scroll" },
  { to: "access", label: "Accès panel", icon: "key" },
];

export function GuildLayout({ me }: { me: MeResponse }) {
  const { guildId } = useParams<{ guildId: string }>();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: () => api<GuildOverview>(`/api/guilds/${guildId}`),
  });

  if (overview.isError) {
    const err = overview.error;
    const message =
      err instanceof ApiError && err.status === 404
        ? "Le bot n'est pas (ou plus) installé sur ce serveur."
        : err instanceof ApiError && err.status === 403
          ? "Vous n'avez pas accès au panel de ce serveur."
          : "Erreur lors du chargement du serveur.";
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-red-400">{message}</p>
        <Link to="/" className="mt-4 inline-block text-indigo-400 hover:underline">
          ← Retour à mes serveurs
        </Link>
      </div>
    );
  }

  const g = overview.data;
  const iconUrl = g ? guildIconUrl(g.id, g.icon, 128) : null;

  // Onglet actif → titre de la page (comme « Aperçu » sur la maquette)
  const base = `/guilds/${guildId}`;
  const rel = location.pathname.startsWith(base) ? location.pathname.slice(base.length).replace(/^\//, "") : "";
  const active = (nav.find((n) => (n.end ? rel === "" : rel.startsWith(n.to) && n.to !== "")) ?? nav[0])!;

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* En-tête serveur */}
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
            <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52c-.21.38-.44.9-.6 1.29a18.3 18.3 0 0 0-5.5 0c-.16-.39-.4-.91-.61-1.29A19.7 19.7 0 0 0 3.83 4.37C.53 9.05-.32 13.58.1 18.06a19.9 19.9 0 0 0 6 3.03c.46-.63.87-1.3 1.22-2a13 13 0 0 1-1.87-.9l.37-.3a14.2 14.2 0 0 0 12.06 0l.37.3c-.6.36-1.23.66-1.88.9.35.7.76 1.37 1.22 2a19.8 19.8 0 0 0 6.03-3.03c.5-5.18-.84-9.68-3.55-13.66zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-100">{g?.name ?? "…"}</span>
        <Link to="/" title="Changer de serveur" className="text-zinc-500 transition hover:text-zinc-300">
          <Icon.chevron />
        </Link>
      </div>

      {/* Bannière serveur */}
      <div className="px-4 pb-4">
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="h-20 w-full bg-gradient-to-br from-indigo-600/40 to-indigo-950/40">
            {iconUrl && <img src={iconUrl} alt="" className="h-full w-full object-cover opacity-60" />}
          </div>
        </div>
        <div className="mt-3 px-0.5">
          <div className="truncate text-sm font-semibold text-zinc-100">{g?.name ?? "…"}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            {g?.approximateMemberCount != null ? `${g.approximateMemberCount} membres` : "—"}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={() => setDrawerOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? "bg-indigo-500/15 font-semibold text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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
      </nav>

      {/* Footer utilisateur */}
      <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-3">
        <img src={avatarUrl(me.id, me.avatar, 64)} alt="" className="h-8 w-8 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">{me.globalName ?? me.username}</div>
          <div className="truncate text-xs text-zinc-500">@{me.username}</div>
        </div>
        <button
          onClick={() => fetch("/auth/logout", { method: "POST" }).then(() => window.location.reload())}
          title="Déconnexion"
          className="text-zinc-500 transition hover:text-red-400"
        >
          <Icon.logout />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar desktop + drawer mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[264px] border-r border-zinc-800 bg-[#101320] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </aside>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-[rgba(6,7,14,0.72)] lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Contenu principal */}
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <header className="mb-6 flex items-start gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="mt-0.5 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <Icon.menu />
            </button>
            <div className="min-w-0">
              <h1 className="text-[22px] font-bold tracking-tight text-zinc-100">{active.label}</h1>
              {active.subtitle && <p className="mt-0.5 text-sm text-zinc-400">{active.subtitle}</p>}
            </div>
            <span
              className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                g?.gatewayConnected ? "bg-green-950 text-green-300" : "bg-zinc-800 text-zinc-400"
              }`}
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

          <Outlet />
        </div>
      </div>
    </div>
  );
}
