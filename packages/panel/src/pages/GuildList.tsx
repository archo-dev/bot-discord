import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { GuildSummary, MeResponse } from "@bot/shared";
import { api, avatarUrl, guildIconUrl } from "../lib/api.js";

export function GuildList({ me }: { me: MeResponse }) {
  const guilds = useQuery({
    queryKey: ["guilds"],
    queryFn: () => api<GuildSummary[]>("/api/guilds"),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Mes serveurs</h1>
        <div className="flex items-center gap-3">
          <img src={avatarUrl(me.id, me.avatar, 64)} alt="" className="h-8 w-8 rounded-full" />
          <span className="hidden text-sm text-zinc-300 sm:inline">{me.globalName ?? me.username}</span>
          <button
            onClick={() => fetch("/auth/logout", { method: "POST" }).then(() => location.reload())}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {guilds.isPending && <p className="text-zinc-400">Chargement des serveurs…</p>}
      {guilds.isError && <p className="text-red-400">Impossible de charger vos serveurs.</p>}

      {guilds.data && guilds.data.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-300">
          <p>Aucun serveur géré avec le bot installé.</p>
          <p className="mt-2 text-sm text-zinc-400">
            Le panel liste uniquement les serveurs où vous avez la permission « Gérer le serveur » et où le bot est
            présent. Invitez d'abord le bot, puis utilisez une commande (ex. <code>/ping</code>) pour qu'il
            s'enregistre.
          </p>
        </div>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {guilds.data?.map((g) => (
          <li key={g.id}>
            <Link
              to={`/guilds/${g.id}`}
              className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-indigo-600 hover:bg-zinc-800/60"
            >
              {guildIconUrl(g.id, g.icon) ? (
                <img src={guildIconUrl(g.id, g.icon)!} alt="" className="h-12 w-12 rounded-full" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-950 font-bold text-indigo-300">
                  {g.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-medium">{g.name}</p>
                <p className="text-xs text-zinc-500">
                  {g.access === "manage_guild" ? "Gestionnaire du serveur" : "Accès panel accordé"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
