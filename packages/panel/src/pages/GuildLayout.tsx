import { Link, NavLink, Outlet, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { GuildOverview, MeResponse } from "@bot/shared";
import { api, ApiError, guildIconUrl } from "../lib/api.js";

const tabs = [
  { to: "", label: "Vue d'ensemble", end: true },
  { to: "config", label: "Configuration" },
  { to: "commands", label: "Commandes" },
  { to: "tickets", label: "Tickets" },
  { to: "roles", label: "Rôles" },
  { to: "welcome", label: "Bienvenue" },
  { to: "modlog", label: "Mod-log" },
  { to: "access", label: "Accès panel" },
] as const;

export function GuildLayout(_props: { me: MeResponse }) {
  const { guildId } = useParams<{ guildId: string }>();
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center gap-4">
        <Link to="/" className="text-zinc-500 hover:text-zinc-300" title="Retour">
          ←
        </Link>
        {g && guildIconUrl(g.id, g.icon) && (
          <img src={guildIconUrl(g.id, g.icon)!} alt="" className="h-10 w-10 rounded-full" />
        )}
        <div>
          <h1 className="text-xl font-bold">{g?.name ?? "…"}</h1>
          <p className="text-xs text-zinc-500">
            {g?.approximateMemberCount !== null && g?.approximateMemberCount !== undefined
              ? `≈ ${g.approximateMemberCount} membres`
              : ""}
          </p>
        </div>
        <span
          className={`ml-auto rounded-full px-3 py-1 text-xs ${
            g?.gatewayConnected ? "bg-green-950 text-green-300" : "bg-zinc-800 text-zinc-400"
          }`}
          title={
            g?.gatewayConnected
              ? "Service Gateway en ligne (heartbeat reçu il y a moins de 3 minutes)."
              : "Service Gateway non connecté : les slash commands fonctionnent, les événements temps réel non."
          }
        >
          {g?.gatewayConnected ? "Gateway connectée" : "Mode HTTP (slash commands)"}
        </span>
      </header>

      <nav className="mb-6 flex gap-1 border-b border-zinc-800">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={"end" in t && t.end}
            className={({ isActive }) =>
              `border-b-2 px-4 py-2 text-sm transition ${
                isActive
                  ? "border-indigo-500 font-medium text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
