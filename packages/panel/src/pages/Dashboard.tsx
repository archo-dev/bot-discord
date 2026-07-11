import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ChannelOption, GuildOverview, ModActionDto, Paginated } from "@bot/shared";
import { api } from "../lib/api.js";
import { Badge, Card, EmptyState, ErrorCard, InfoTile, StatCard } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { SkeletonDashboard, SkeletonList } from "../ui/skeleton.js";
import { UserCell } from "../ui/cells.js";
import { actionMeta, ModActionIcon, TimeAgo } from "../ui/mod-meta.js";

export function Dashboard() {
  const { guildId } = useParams<{ guildId: string }>();
  const overview = useQuery({
    queryKey: ["guild", guildId],
    queryFn: () => api<GuildOverview>(`/api/guilds/${guildId}`),
  });
  const channels = useQuery({
    queryKey: ["channels", guildId],
    queryFn: () => api<ChannelOption[]>(`/api/guilds/${guildId}/channels`),
  });
  const actions = useQuery({
    queryKey: ["mod-actions", guildId, 1, ""],
    queryFn: () => api<Paginated<ModActionDto>>(`/api/guilds/${guildId}/mod-actions?page=1`),
  });

  if (overview.isPending) return <SkeletonDashboard />;
  if (overview.isError) {
    return <ErrorCard message="Impossible de charger l'aperçu du serveur." onRetry={() => void overview.refetch()} />;
  }

  const g = overview.data;
  const logChannel = channels.data?.find((ch) => ch.id === g.logChannelId);
  const recent = actions.data?.items.slice(0, 5) ?? [];

  return (
    <div className="space-y-5">
      {/* Rangée KPI : StatCard = numérique, InfoTile = état/config (D.S. v2 §4.10) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard color="violet" icon={<Icon.users />} value={g.approximateMemberCount ?? "?"} label="Membres" />
        <StatCard
          color="amber"
          icon={<Icon.shield />}
          value={g.warnThreshold}
          label="Seuil d'avertissements"
          hint={`→ mute auto ${g.warnTimeoutMinutes} min`}
        />
        <InfoTile
          color="blue"
          icon={<Icon.hash />}
          value={g.logChannelId ? `#${logChannel?.name ?? "logs"}` : "Aucun salon"}
          label="Salon de logs"
          badge={g.logChannelId ? undefined : <Badge tone="warning">À configurer</Badge>}
          to={g.logChannelId ? undefined : `/guilds/${guildId}/config`}
        />
        <InfoTile
          color={g.gatewayConnected ? "green" : "gray"}
          icon={<Icon.bolt />}
          value={g.gatewayConnected ? "En ligne" : "Mode HTTP"}
          label="Statut du bot"
          badge={
            <span
              className={`h-2 w-2 rounded-full ${g.gatewayConnected ? "bg-green-400" : "bg-zinc-600"}`}
              aria-hidden
            />
          }
        />
      </div>

      {/* Widgets */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Actions de modération récentes (données réelles) */}
        <Card
          className="lg:col-span-2"
          title="Actions de modération"
          action={
            <Link to={`/guilds/${guildId}/modlog`} className="text-[13px] font-medium text-indigo-400 hover:underline">
              Voir tout
            </Link>
          }
        >
          {actions.isPending ? (
            <SkeletonList rows={5} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Icon.scroll />}
              title="Aucune action pour le moment"
              description="Les actions de modération apparaîtront ici dès le premier /warn, /mute ou /ban."
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3">
                  <ModActionIcon action={a.action} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-100">{actionMeta(a.action).label}</div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-400">
                      {a.targetId ? <UserCell userId={a.targetId} /> : <span className="text-zinc-600">—</span>}
                      {a.reason && <span className="truncate" title={a.reason}>· {a.reason}</span>}
                    </div>
                  </div>
                  <TimeAgo iso={a.createdAt} className="shrink-0 text-xs text-zinc-500" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Résumé serveur */}
        <Card title="Résumé du serveur">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">Membres</dt>
              <dd className="font-semibold text-zinc-100">{g.approximateMemberCount ?? "?"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">Salon de logs</dt>
              <dd className="font-semibold text-zinc-100">{g.logChannelId ? `#${logChannel?.name ?? "logs"}` : "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">Seuil de warns</dt>
              <dd className="font-semibold text-zinc-100">{g.warnThreshold}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">Mute auto</dt>
              <dd className="font-semibold text-zinc-100">{g.warnTimeoutMinutes} min</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-400">Service temps réel</dt>
              <dd className={`font-semibold ${g.gatewayConnected ? "text-green-400" : "text-zinc-400"}`}>
                {g.gatewayConnected ? "Connecté" : "Hors ligne"}
              </dd>
            </div>
          </dl>
          <Link
            to={`/guilds/${guildId}/config`}
            className="mt-4 inline-flex h-9 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[13px] font-semibold text-zinc-100 transition hover:bg-zinc-700"
          >
            Modifier la configuration
          </Link>
        </Card>
      </div>

      {/* Bandeau gateway (façon promo) */}
      {!g.gatewayConnected && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 p-5 sm:flex-row sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
            <Icon.bolt />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-amber-200">Activez le service Gateway</p>
            <p className="mt-0.5 text-sm text-amber-200/70">
              Auto-modération temps réel, messages de bienvenue, logs d'arrivées/départs, XP et musique s'activent avec
              le Gateway. Les réglages peuvent déjà être enregistrés.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
