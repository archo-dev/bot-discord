import { useEffect } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { GuildSummary, MeResponse } from "@bot/shared";
import { api, avatarUrl, guildIconUrl } from "../lib/api.js";
import { EmptyState, ErrorCard, IconButton, PageHeader } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { SkeletonGuildGrid } from "../ui/skeleton.js";

export function GuildList({ me }: { me: MeResponse }) {
  const guilds = useQuery({
    queryKey: ["guilds"],
    queryFn: () => api<GuildSummary[]>("/api/guilds"),
  });

  useEffect(() => {
    document.title = "Mes serveurs — Panel du bot";
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-9 flex flex-wrap items-start justify-between gap-4">
        <PageHeader eyebrow="Panel Discord" title="Mes serveurs" description="Sélectionnez le serveur que vous souhaitez administrer." />
        <div className="flex items-center gap-3">
          <img src={avatarUrl(me.id, me.avatar, 64)} alt="" className="h-10 w-10 rounded-full ring-2 ring-zinc-800" />
          <span className="hidden text-sm text-zinc-300 sm:inline">{me.globalName ?? me.username}</span>
          <IconButton
            label="Déconnexion"
            danger
            onClick={() => fetch("/auth/logout", { method: "POST" }).then(() => location.reload())}
          >
            <Icon.logout />
          </IconButton>
        </div>
      </div>

      {guilds.isPending && <SkeletonGuildGrid />}
      {guilds.isError && (
        <ErrorCard message="Impossible de charger vos serveurs." onRetry={() => void guilds.refetch()} />
      )}

      {guilds.data && guilds.data.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <EmptyState
            icon={<Icon.users />}
            title="Aucun serveur géré avec le bot installé"
            description={
              <>
                Le panel liste uniquement les serveurs où vous avez la permission « Gérer le serveur » et où le bot est
                présent. Invitez d'abord le bot, puis utilisez une commande (ex. <code>/ping</code>) pour qu'il
                s'enregistre.
              </>
            }
          />
        </div>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guilds.data?.map((g) => (
          <li key={g.id}>
            <Link
              to={`/guilds/${g.id}`}
              className="group flex min-h-24 items-center gap-4 rounded-xl border border-zinc-800/90 bg-[linear-gradient(145deg,rgba(24,29,44,0.96),rgba(17,21,33,0.96))] p-4 shadow-(--shadow-sm) transition hover:-translate-y-0.5 hover:border-indigo-500/70 hover:shadow-(--shadow-md) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {guildIconUrl(g.id, g.icon) ? (
                <img src={guildIconUrl(g.id, g.icon)!} alt="" className="h-12 w-12 rounded-full" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-950 font-bold text-indigo-300">
                  {g.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.name}</p>
                <p className="text-xs text-zinc-500">
                  {g.access === "manage_guild" ? "Gestionnaire du serveur" : "Accès panel accordé"}
                </p>
              </div>
              <span className="text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-indigo-300" aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
