import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ChannelOption, GuildOverview, ModActionDto, Paginated } from "@bot/shared";
import { api } from "../lib/api.js";
import { Card, StatCard } from "../ui/kit.js";
import { Icon } from "../ui/icons.js";
import { actionMeta, ModActionIcon, relativeTime } from "../ui/mod-meta.js";

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

  const g = overview.data;
  if (!g) return <p className="text-zinc-400">Chargement…</p>;

  const logChannel = channels.data?.find((ch) => ch.id === g.logChannelId);
  const recent = actions.data?.items.slice(0, 5) ?? [];

  return (
    <div className="space-y-5">
      {/* Rangée KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard color="violet" icon={<Icon.users />} value={g.approximateMemberCount ?? "?"} label="Membres" />
        <StatCard
          color="blue"
          icon={<Icon.hash />}
          value={g.logChannelId ? `#${logChannel?.name ?? "logs"}` : "—"}
          label="Salon de logs"
          hint={g.logChannelId ? undefined : "À configurer"}
        />
        <StatCard
          color="amber"
          icon={<Icon.shield />}
          value={g.warnThreshold}
          label="Seuil d'avertissements"
          hint={`→ mute auto ${g.warnTimeoutMinutes} min`}
        />
        <StatCard
          color={g.gatewayConnected ? "green" : "gray"}
          icon={<Icon.bolt />}
          value={g.gatewayConnected ? "En ligne" : "HTTP"}
          label="Statut du bot"
          hint={g.gatewayConnected ? "Gateway connectée" : "Slash commands"}
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
          {recent.length === 0 ? (
            <p className="text-sm text-zinc-500">Aucune action de modération enregistrée pour le moment.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3">
                  <ModActionIcon action={a.action} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-100">{actionMeta(a.action).label}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {a.targetId ? <code>{a.targetId}</code> : "—"}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">{relativeTime(a.createdAt)}</span>
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
